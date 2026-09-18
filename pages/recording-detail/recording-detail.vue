<template>
  <view class="page" v-if="recording">
    <text class="date">{{ formatDate(recording.createdAt) }} · {{ formatDuration(recording.durationSec) }}</text>

    <view class="btn play" @click="togglePlay">
      <text>{{ isPlaying ? '⏸ Pause' : '▶ Play Recording' }}</text>
    </view>

    <view v-if="recording.status === 'transcribing' || recording.status === 'summarizing'" class="pending">
      <text>{{ recording.status === 'transcribing' ? 'Transcribing…' : 'Summarizing…' }}</text>
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
import { runTranscriptionAndSummary } from '@/utils/pipeline.js'
import { trackSummaryViewed } from '@/utils/analytics.js'

const PENDING_STATUSES = ['transcribing', 'summarizing']

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
      this.setupAudio()
      if (this.recording.status === 'done') {
        trackSummaryViewed()
      }
      if (PENDING_STATUSES.includes(this.recording.status)) {
        this.startPolling()
      }
    },
    setupAudio() {
      // Lets you confirm the mic actually captured sound even when a
      // transcript comes back empty — plays the raw file directly,
      // independent of ASR/AI results.
      this._audioCtx = uni.createInnerAudioContext()
      this._audioCtx.src = this.recording.audioFilePath
      this._audioCtx.onPlay(() => { this.isPlaying = true })
      this._audioCtx.onPause(() => { this.isPlaying = false })
      this._audioCtx.onStop(() => { this.isPlaying = false })
      this._audioCtx.onEnded(() => { this.isPlaying = false })
      this._audioCtx.onError(err => {
        this.isPlaying = false
        uni.showToast({ title: 'Could not play recording', icon: 'none' })
        console.error('Audio playback error:', err)
      })
    },
    togglePlay() {
      if (!this._audioCtx) return
      if (this.isPlaying) {
        this._audioCtx.pause()
      } else {
        this._audioCtx.play()
      }
    },
    startPolling() {
      if (this.pollHandle) return
      this.pollHandle = setInterval(() => {
        this.recording = getRecordingById(this.id)
        if (!this.recording || !PENDING_STATUSES.includes(this.recording.status)) {
          this.stopPolling()
          if (this.recording && this.recording.status === 'done') {
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
      const fromStage = this.recording.failureStage === 'summary' ? 'summary' : 'asr'
      runTranscriptionAndSummary(this.id, this.recording.audioFilePath, {
        fromStage,
        existingTranscript: this.recording.transcript
      })
      this.recording = getRecordingById(this.id) // pick up the immediate status flip
      this.startPolling()
    },
    remove() {
      uni.showModal({
        title: 'Delete this recording?',
        content: 'This cannot be undone.',
        success: res => {
          if (!res.confirm) return
          deleteAudioFile(this.recording.audioFilePath)
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
