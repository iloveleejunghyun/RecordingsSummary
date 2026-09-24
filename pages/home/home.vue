<template>
  <view class="page">
    <ai-consent-gate />

    <view class="record-area">
      <view class="info-banner" v-if="!isRecording">
        <text class="info-banner-title">Built to prevent lost recordings.</text>
        <text class="info-banner-body">Automatic recovery avoids endless processing when something goes wrong.</text>
      </view>
      <view class="info-banner warning" v-else>
        <text class="info-banner-title">Keep this screen open</text>
        <text class="info-banner-body">Switching apps or locking the phone may interrupt recording.</text>
      </view>
      <view class="timer" v-if="isRecording">{{ formatDuration(elapsedSec) }} / {{ formatDuration(MAX_SESSION_SEC) }}</view>
      <view class="record-btn" :class="{ recording: isRecording }" @click="toggleRecording">
        <text>{{ isRecording ? 'Stop' : 'Record' }}</text>
      </view>
      <text class="cap-note" v-if="!isRecording">Beta limit: recordings up to {{ MAX_SESSION_SEC / 60 }} minutes</text>
    </view>

    <view class="list">
      <text class="empty" v-if="recordings.length === 0">No recordings yet — tap Record to make your first one.</text>
      <view v-for="r in recordings" :key="r.id" class="item" @click="goToDetail(r.id)">
        <view class="item-main">
          <text class="item-date">{{ formatDate(r.createdAt) }}</text>
          <text class="item-duration">{{ formatDuration(r.durationSec) }}</text>
        </view>
        <text class="item-status" :class="'status-' + r.status">{{ statusLabel(r) }}</text>
      </view>
    </view>
  </view>
</template>

<script>
import AiConsentGate from '@/components/ai-consent-gate/ai-consent-gate.vue'
import { setRecorderHandlers, startRecording, stopRecording, allowScreenLock } from '@/utils/recorder.js'
import { saveAudioPermanently } from '@/utils/audioStore.js'
import { getRecordings, createRecording, addSegment, getAIConsent } from '@/utils/storage.js'
import { uid } from '@/utils/id.js'
import { transcribeSegment, finishRecordingSession } from '@/utils/pipeline.js'
import { trackRecordingCompleted } from '@/utils/analytics.js'
import { statusLabel as formatStatusLabel } from '@/utils/format.js'

// A recording is captured as a sequence of ~1 minute segments rather than
// one long file — uni's RecorderManager can only run one recording at a
// time with no way to peek at it mid-session (see services/asr.js and
// utils/storage.js's file comments for why), so long recordings are built
// by calling stop() then immediately start() again, over and over, each
// cycle producing one complete, independently-uploadable segment file.
const SEGMENT_SEC = 5      // rotate to a new segment file roughly this often
const MAX_SESSION_SEC = 1800 // 30 min safety cap on total recording length
const RECORDER_OPTIONS = { format: 'aac', sampleRate: 16000, encodeBitRate: 96000 }
const PENDING_STATUSES = ['recording', 'transcribing', 'summarizing']

export default {
  components: { AiConsentGate },
  data() {
    return {
      isRecording: false,
      elapsedSec: 0,
      recordings: [],
      MAX_SESSION_SEC,
      timerHandle: null,
      pollHandle: null
    }
  },
  onShow() {
    this.loadRecordings()
    this.maybeStartPolling()
  },
  onUnload() {
    this.stopTimer()
    this.stopPolling()
    uni.$off('recordings-changed', this.loadRecordings)
  },
  mounted() {
    setRecorderHandlers({
      onStart: this.onRecorderStart,
      onStop: this.onRecorderStop,
      onError: this.onRecorderError
    })
    this.loadRecordings()
    // Catches changes polling wouldn't (e.g. a background auto-retry on a
    // recording that's already 'failed' — see storage.js's saveRecordings).
    uni.$on('recordings-changed', this.loadRecordings)
  },
  methods: {
    loadRecordings() {
      this.recordings = getRecordings()
    },
    maybeStartPolling() {
      const hasPending = this.recordings.some(r => PENDING_STATUSES.includes(r.status))
      if (hasPending && !this.pollHandle) {
        this.pollHandle = setInterval(() => {
          this.loadRecordings()
          if (!this.recordings.some(r => PENDING_STATUSES.includes(r.status))) {
            this.stopPolling()
          }
        }, 2000)
      }
    },
    stopPolling() {
      if (this.pollHandle) {
        clearInterval(this.pollHandle)
        this.pollHandle = null
      }
    },
    toggleRecording() {
      if (!getAIConsent()) {
        // The gate overlay should already be blocking this, but guard
        // anyway in case it's mid-transition.
        return
      }
      if (this.isRecording) {
        this._userStopped = true
        stopRecording()
      } else {
        this._recordingId = uid()
        this._userStopped = false
        this._segmentElapsedSec = 0
        createRecording({ id: this._recordingId })
        this.loadRecordings()
        startRecording(RECORDER_OPTIONS)
      }
    },
    onRecorderStart() {
      this.isRecording = true
      this._segmentElapsedSec = 0
      if (!this.timerHandle) {
        // Only reset the display timer on the very first segment of a
        // session — onRecorderStart also fires again after every
        // stop()+start() rotation, and elapsedSec should keep counting
        // across the whole session, not reset each time.
        this.elapsedSec = 0
        this.timerHandle = setInterval(this.onTimerTick, 1000)
      }
    },
    onTimerTick() {
      this.elapsedSec += 1
      this._segmentElapsedSec += 1
      if (this.elapsedSec >= MAX_SESSION_SEC) {
        this._userStopped = true
        stopRecording()
      } else if (this._segmentElapsedSec >= SEGMENT_SEC) {
        // Not a real stop — this rotates to a new segment file. See
        // onRecorderStop, which immediately restarts recording when
        // _userStopped is false.
        stopRecording()
      }
    },
    async onRecorderStop(res) {
      const recordingId = this._recordingId
      const userStopped = this._userStopped
      const durationSec = res && res.duration ? Math.round(res.duration / 1000) : this._segmentElapsedSec

      if (userStopped) {
        this.stopTimer()
        this.isRecording = false
        allowScreenLock()
      }

      if (!res || !res.tempFilePath || durationSec < 1) {
        // Nothing usable in this segment (e.g. the user tapped Stop right
        // as a rotation happened to fire). If it was a rotation, just keep
        // recording; if it was the real stop, finalize whatever segments
        // already came in.
        if (userStopped) {
          await finishRecordingSession(recordingId)
          this.loadRecordings()
        } else {
          startRecording(RECORDER_OPTIONS)
        }
        return
      }

      if (!userStopped) {
        // Restart recording as the very first thing, before any file I/O —
        // saveAudioPermanently below does real async disk work (resolve +
        // copy via plus.io), which was previously running *before* this
        // call and adding its latency directly to the gap between segments.
        startRecording(RECORDER_OPTIONS)
      }

      let audioFilePath = null
      try {
        audioFilePath = await saveAudioPermanently(res.tempFilePath, uid())
      } catch (e) {
        uni.showToast({ title: 'Could not save a recording segment', icon: 'none' })
      }

      if (audioFilePath) {
        const segment = addSegment(recordingId, { audioFilePath, durationSec })
        this.loadRecordings()
        this.maybeStartPolling()
        transcribeSegment(recordingId, segment)
      }

      if (userStopped) {
        trackRecordingCompleted({ durationSec: this.elapsedSec, hitCap: this.elapsedSec >= MAX_SESSION_SEC })
        await finishRecordingSession(recordingId)
        this.loadRecordings()
      }
    },
    onRecorderError(err) {
      this.stopTimer()
      this.isRecording = false
      allowScreenLock()
      uni.showToast({ title: 'Recording failed', icon: 'none' })
      console.error('Recorder error:', err)
    },
    stopTimer() {
      if (this.timerHandle) {
        clearInterval(this.timerHandle)
        this.timerHandle = null
      }
    },
    goToDetail(id) {
      uni.navigateTo({ url: `/pages/recording-detail/recording-detail?id=${id}` })
    },
    formatDuration(sec) {
      const m = Math.floor(sec / 60)
      const s = Math.floor(sec % 60)
      return `${m}:${String(s).padStart(2, '0')}`
    },
    formatDate(iso) {
      const d = new Date(iso)
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    },
    statusLabel(r) {
      return formatStatusLabel(r)
    }
  }
}
</script>

<style scoped>
.page {
  padding: 32rpx;
}
.record-area {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48rpx 0;
}
.timer {
  font-size: 32rpx;
  color: #444;
  margin-bottom: 24rpx;
  font-variant-numeric: tabular-nums;
}
.record-btn {
  width: 180rpx;
  height: 180rpx;
  border-radius: 50%;
  background: #F97316;
  display: flex;
  align-items: center;
  justify-content: center;
}
.record-btn text {
  color: #fff;
  font-size: 30rpx;
  font-weight: 600;
}
.record-btn.recording {
  background: #DD524D;
}
.cap-note {
  margin-top: 20rpx;
  font-size: 22rpx;
  color: #999;
}
.info-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin-bottom: 32rpx;
  padding: 20rpx 28rpx;
  border-radius: 12rpx;
  text-align: center;
  max-width: 600rpx;
  background: #FFF7ED;
}
.info-banner-title {
  font-size: 27rpx;
  font-weight: 700;
  color: #9A5B1F;
  margin-bottom: 6rpx;
}
.info-banner-body {
  font-size: 22rpx;
  font-weight: 400;
  color: #B08355;
  line-height: 1.5;
}
.info-banner.warning {
  background: #FDEDED;
}
.info-banner.warning .info-banner-title {
  color: #B3372E;
}
.info-banner.warning .info-banner-body {
  color: #C56862;
}
.list {
  margin-top: 24rpx;
}
.empty {
  display: block;
  text-align: center;
  color: #999;
  font-size: 26rpx;
  padding: 48rpx 0;
}
.item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
  margin-bottom: 16rpx;
}
.item-main {
  display: flex;
  flex-direction: column;
}
.item-date {
  font-size: 28rpx;
  color: #222;
}
.item-duration {
  font-size: 22rpx;
  color: #999;
  margin-top: 4rpx;
}
.item-status {
  font-size: 24rpx;
  color: #999;
}
.item-status.status-done {
  color: #4CD964;
}
.item-status.status-failed {
  color: #DD524D;
}
</style>
