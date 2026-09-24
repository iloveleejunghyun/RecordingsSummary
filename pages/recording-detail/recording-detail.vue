<template>
  <view class="page" v-if="recording">
    <text class="date">{{ formatDate(recording.createdAt) }} · {{ formatDuration(recording.durationSec) }}</text>

    <view v-if="recording.mergedAudioPath" class="playback-row">
      <view class="btn play" @click="togglePlay">
        <text>{{ isPlaying ? '⏸ Pause' : '▶ Play Recording' }}</text>
      </view>
      <text class="export-link" @click="exportRecording">Export</text>
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
        <view class="section-header">
          <text class="section-title">Summary</text>
          <text class="copy-link" @click="copySummary">Copy</text>
        </view>
        <text class="section-body">{{ recording.summary }}</text>
      </view>
      <view class="section">
        <view class="section-header">
          <text class="section-title" @click="showCorrected = !showCorrected">Corrected Transcript {{ showCorrected ? '▲' : '▼' }}</text>
          <text v-if="showCorrected" class="copy-link" @click="copyCorrectedTranscript">Copy</text>
        </view>
        <text v-if="showCorrected" class="section-body transcript">{{ displayedTranscript || '(no speech detected)' }}</text>
      </view>
      <view class="section">
        <view class="section-header">
          <text class="section-title" @click="showOriginal = !showOriginal">Original Transcript {{ showOriginal ? '▲' : '▼' }}</text>
          <text v-if="showOriginal" class="copy-link" @click="copyOriginalTranscript">Copy</text>
        </view>
        <text v-if="showOriginal" class="section-body transcript">{{ recording.transcript || '(no speech detected)' }}</text>
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
      showCorrected: false,
      showOriginal: false,
      pollHandle: null,
      isPlaying: false
    }
  },
  computed: {
    // Used for the Corrected Transcript section — falls back to the raw
    // transcript for recordings made before correctedTranscript existed.
    // The Original Transcript section always shows recording.transcript
    // directly, regardless of this fallback.
    displayedTranscript() {
      return this.recording.correctedTranscript || this.recording.transcript
    }
  },
  onLoad(query) {
    this.id = query.id
    this.load()
    uni.$on('recordings-changed', this.refreshFromStorage)
  },
  onUnload() {
    this.stopPolling()
    uni.$off('recordings-changed', this.refreshFromStorage)
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
      // transcript comes back empty — plays the merged single-file
      // recording directly (see pipeline.js's mergeRecordingAudio),
      // independent of ASR/AI results. No fallback to the separate segment
      // files: if mergedAudioPath isn't set, there's nothing to play.
      this._audioCtx = uni.createInnerAudioContext()
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
      if (!this._audioCtx || !this.recording.mergedAudioPath) return
      if (this.isPlaying) {
        this._audioCtx.pause()
      } else {
        if (this._audioCtx.src !== this.recording.mergedAudioPath) {
          this._audioCtx.src = this.recording.mergedAudioPath
        }
        this._audioCtx.play()
      }
    },
    exportRecording() {
      if (!this.recording.mergedAudioPath) return
      plus.share.sendWithSystem(
        { type: 'file', href: this.recording.mergedAudioPath },
        () => {},
        err => {
          uni.showToast({ title: 'Could not export recording', icon: 'none' })
          console.error('Export failed:', err)
        }
      )
    },
    // Shared by the poll tick and the 'recordings-changed' event (see
    // storage.js's saveRecordings) — the event catches updates polling
    // wouldn't, e.g. a background auto-retry on a recording that's already
    // 'failed' (not in PENDING_STATUSES, so nothing would be polling it).
    refreshFromStorage() {
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
    },
    startPolling() {
      if (this.pollHandle) return
      this.pollHandle = setInterval(this.refreshFromStorage, 2000)
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
    copySummary() {
      uni.setClipboardData({
        data: this.recording.summary,
        success: () => uni.showToast({ title: 'Summary copied', icon: 'none' })
      })
    },
    copyCorrectedTranscript() {
      uni.setClipboardData({
        data: this.displayedTranscript,
        success: () => uni.showToast({ title: 'Corrected transcript copied', icon: 'none' })
      })
    },
    copyOriginalTranscript() {
      uni.setClipboardData({
        data: this.recording.transcript,
        success: () => uni.showToast({ title: 'Original transcript copied', icon: 'none' })
      })
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
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12rpx;
}
.section-title {
  display: block;
  font-size: 26rpx;
  font-weight: 600;
  color: #222;
}
.copy-link {
  font-size: 22rpx;
  color: #F97316;
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
.playback-row {
  display: flex;
  align-items: center;
  gap: 20rpx;
  margin-bottom: 24rpx;
}
.btn.play {
  flex: 1;
  background: #fff;
  color: #F97316;
  border: 2rpx solid #F97316;
  margin-top: 0;
  margin-bottom: 0;
}
.export-link {
  font-size: 24rpx;
  color: #999;
}
.btn.danger {
  background: #fff;
  color: #DD524D;
}
</style>
