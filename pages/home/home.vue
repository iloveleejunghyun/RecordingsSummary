<template>
  <view class="page">
    <ai-consent-gate />

    <view class="record-area">
      <view class="timer" v-if="isRecording">{{ formatDuration(elapsedSec) }} / {{ formatDuration(CAP_SEC) }}</view>
      <view class="record-btn" :class="{ recording: isRecording }" @click="toggleRecording">
        <text>{{ isRecording ? 'Stop' : 'Record' }}</text>
      </view>
      <text class="cap-note" v-if="!isRecording">Beta limit: recordings up to {{ CAP_SEC / 60 }} minutes</text>
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
import { setRecorderHandlers, startRecording, stopRecording } from '@/utils/recorder.js'
import { saveAudioPermanently } from '@/utils/audioStore.js'
import { getRecordings, createRecording, getAIConsent } from '@/utils/storage.js'
import { uid } from '@/utils/id.js'
import { runTranscriptionAndSummary } from '@/utils/pipeline.js'
import { trackRecordingCompleted } from '@/utils/analytics.js'

const CAP_SEC = 300 // Build-1 hard cap — see services/asr.js for why (single inline-base64 ASR request)
const PENDING_STATUSES = ['transcribing', 'summarizing']

export default {
  components: { AiConsentGate },
  data() {
    return {
      isRecording: false,
      elapsedSec: 0,
      recordings: [],
      CAP_SEC,
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
  },
  mounted() {
    setRecorderHandlers({
      onStart: this.onRecorderStart,
      onStop: this.onRecorderStop,
      onError: this.onRecorderError
    })
    this.loadRecordings()
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
        stopRecording()
      } else {
        startRecording({ format: 'aac', sampleRate: 16000, encodeBitRate: 96000 })
      }
    },
    onRecorderStart() {
      this.isRecording = true
      this.elapsedSec = 0
      this.timerHandle = setInterval(() => {
        this.elapsedSec += 1
        if (this.elapsedSec >= CAP_SEC) {
          stopRecording()
        }
      }, 1000)
    },
    async onRecorderStop(res) {
      this.stopTimer()
      this.isRecording = false

      const durationSec = res && res.duration ? Math.round(res.duration / 1000) : this.elapsedSec
      if (!res || !res.tempFilePath || durationSec < 1) {
        return // accidental tap — nothing worth saving
      }

      const id = uid()
      let audioFilePath
      try {
        audioFilePath = await saveAudioPermanently(res.tempFilePath, id)
      } catch (e) {
        uni.showToast({ title: 'Could not save recording', icon: 'none' })
        return
      }

      createRecording({ id, audioFilePath, durationSec })
      this.loadRecordings()
      trackRecordingCompleted({ durationSec, hitCap: durationSec >= CAP_SEC })
      this.maybeStartPolling()

      runTranscriptionAndSummary(id, audioFilePath)
    },
    onRecorderError(err) {
      this.stopTimer()
      this.isRecording = false
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
      switch (r.status) {
        case 'transcribing': return 'Transcribing…'
        case 'summarizing': return 'Summarizing…'
        case 'done': return 'Done'
        case 'failed': return `Failed (${r.failureStage || 'unknown'})`
        default: return r.status
      }
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
