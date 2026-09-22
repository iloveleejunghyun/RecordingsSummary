<template>
  <view class="page" v-if="recording">
    <text class="date">{{ formatDate(recording.createdAt) }} · {{ formatDuration(recording.durationSec) }}</text>

    <view v-if="recording.segments && recording.segments.length > 0" class="btn play" @click="togglePlay">
      <text>{{ isPlaying ? '⏸ Pause' : '▶ Play Recording' }}</text>
    </view>

    <view v-if="['recording', 'transcribing', 'summarizing'].includes(recording.status)" class="pending">
      <text>{{ statusLabel(recording) }}</text>
    </view>

    <view v-else-if="recording.status === 'failed'" class="failed">
      <text class="failed-title">Something went wrong ({{ recording.failureStage === 'asr' ? 'transcription' : 'summary' }} step)</text>
      <view class="btn primary" @click="retry">
        <text>Retry</text>
      </view>
    </view>

    <view v-else class="content">
      <view class="section">
        <text class="section-title">Summary</text>
        <text class="section-body">{{ recording.summary }}</text>
      </view>
      <view class="section">
        <text class="section-title" @click="showTranscript = !showTranscript">Transcript {{ showTranscript ? '▲' : '▼' }}</text>
        <text v-if="showTranscript" class="section-body transcript">{{ recording.transcript || '(no speech detected)' }}</text>
      </view>
    </view>

    <view class="btn danger" @click="remove">
      <text>Delete Recording</text>
    </view>
  </view>
</template>

<script>
import { getRecordingById, deleteRecording } from '@/utils/storage.js'
import { deleteAudioFile } from '@/utils/audioStore.js'
import { retryRecording } from '@/utils/pipeline.js'
import { trackSummaryViewed } from '@/utils/analytics.js'
import { statusLabel as formatStatusLabel } from '@/utils/format.js'

const PENDING_STATUSES = ['recording', 'transcribing', 'summarizing']

export default {
  data() {
    return {
      id: null,
      recording: null,
      showTranscript: false,
      pollHandle: null,
      isPlaying: false
    }
  },
  onLoad(query) {
    this.id = query.id
    this.load()
  },
  onUnload() {
    this.stopPolling()
    if (this._audioCtx) {
      this._audioCtx.destroy()
      this._audioCtx = null
    }
  },
  methods: {
    load() {
      this.recording = getRecordingById(this.id)
      if (!this.recording) {
        uni.showToast({ title: 'Recording not found', icon: 'none' })
        uni.navigateBack()
        return
      }
      this.refreshSegmentPaths()
      if (!this._audioCtx) this.setupAudio()
      if (this.recording.status === 'done') {
        trackSummaryViewed()
      }
      if (PENDING_STATUSES.includes(this.recording.status)) {
        this.startPolling()
      }
    },
    // A recording is made of one or more segment files (see
    // utils/storage.js's file comment) — keep the flat list of paths used
    // for sequential playback in sync whenever `recording` is (re)loaded.
    refreshSegmentPaths() {
      this._segmentPaths = (this.recording.segments || []).map(s => s.audioFilePath)
    },
    setupAudio() {
      // Lets you confirm the mic actually captured sound even when a
      // transcript comes back empty — plays the raw segment files
      // directly, independent of ASR/AI results. Segments play back to
      // back in order, advancing automatically as each one ends.
      this._segmentIndex = 0
      this._audioCtx = uni.createInnerAudioContext()
      this._audioCtx.onPlay(() => { this.isPlaying = true })
      this._audioCtx.onPause(() => { this.isPlaying = false })
      this._audioCtx.onStop(() => { this.isPlaying = false })
      this._audioCtx.onEnded(() => {
        this._segmentIndex += 1
        if (this._segmentIndex < this._segmentPaths.length) {
          this._audioCtx.src = this._segmentPaths[this._segmentIndex]
          this._audioCtx.play()
        } else {
          this.isPlaying = false
          this._segmentIndex = 0
        }
      })
      this._audioCtx.onError(err => {
        this.isPlaying = false
        uni.showToast({ title: 'Could not play recording', icon: 'none' })
        console.error('Audio playback error:', err)
      })
    },
    togglePlay() {
      if (!this._audioCtx || this._segmentPaths.length === 0) return
      if (this.isPlaying) {
        this._audioCtx.pause()
      } else {
        if (!this._audioCtx.src) {
          this._audioCtx.src = this._segmentPaths[this._segmentIndex]
        }
        this._audioCtx.play()
      }
    },
    startPolling() {
      if (this.pollHandle) return
      this.pollHandle = setInterval(() => {
        this.recording = getRecordingById(this.id)
        if (!this.recording) {
          this.stopPolling()
          return
        }
        this.refreshSegmentPaths()
        if (!PENDING_STATUSES.includes(this.recording.status)) {
          this.stopPolling()
          if (this.recording.status === 'done') {
            trackSummaryViewed()
          }
        }
      }, 2000)
    },
    stopPolling() {
      if (this.pollHandle) {
        clearInterval(this.pollHandle)
        this.pollHandle = null
      }
    },
    retry() {
      retryRecording(this.id)
      this.recording = getRecordingById(this.id) // pick up the immediate status flip
      this.startPolling()
    },
    remove() {
      uni.showModal({
        title: 'Delete this recording?',
        content: 'This cannot be undone.',
        success: res => {
          if (!res.confirm) return
          this._segmentPaths.forEach(deleteAudioFile)
          deleteRecording(this.id)
          uni.navigateBack()
        }
      })
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
    statusLabel(recording) {
      return formatStatusLabel(recording)
    }
  }
}
</script>

<style scoped>
.page {
  padding: 32rpx;
}
.date {
  display: block;
  font-size: 24rpx;
  color: #999;
  margin-bottom: 24rpx;
}
.pending {
  text-align: center;
  padding: 64rpx 0;
  color: #999;
  font-size: 28rpx;
}
.failed {
  text-align: center;
  padding: 48rpx 0;
}
.failed-title {
  display: block;
  color: #DD524D;
  font-size: 26rpx;
  margin-bottom: 24rpx;
}
.content {
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.section {
  background: #fff;
  border-radius: 12rpx;
  padding: 24rpx;
}
.section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #222;
  margin-bottom: 12rpx;
}
.section-body {
  display: block;
  font-size: 26rpx;
  color: #444;
  line-height: 1.6;
  white-space: pre-wrap;
}
.transcript {
  color: #777;
  font-size: 24rpx;
}
.btn {
  text-align: center;
  padding: 20rpx 0;
  border-radius: 12rpx;
  font-size: 27rpx;
  margin-top: 32rpx;
}
.btn.primary {
  background: #F97316;
  color: #fff;
}
.btn.play {
  background: #fff;
  color: #F97316;
  border: 2rpx solid #F97316;
  margin-top: 0;
  margin-bottom: 24rpx;
}
.btn.danger {
  background: #fff;
  color: #DD524D;
}
</style>
