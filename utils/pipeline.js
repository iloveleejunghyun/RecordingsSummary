// Shared transcribe → summarize pipeline, used both right after a recording
// finishes (pages/home/home.vue) and when the user retries a failed
// recording (pages/recording-detail/recording-detail.vue) — factored out
// once rather than duplicated because both call sites need the exact same
// state transitions and failure-stage bookkeeping.

import { recognizeAudio } from '@/services/asr.js'
import { summarizeRecording } from '@/services/ai.js'
import { updateRecording } from '@/utils/storage.js'
import { trackTranscriptionResult, trackSummaryResult } from '@/utils/analytics.js'

/**
 * Run transcription and/or summarization for a recording, persisting status
 * as it goes so any page reading from storage can reflect progress.
 * @param {string} id
 * @param {string} audioFilePath
 * @param {{ fromStage?: 'asr'|'summary', existingTranscript?: string }} [options]
 *   fromStage 'summary' skips re-running ASR (used when retrying a
 *   recording that already has a transcript but failed at the summary
 *   step) and reuses existingTranscript instead.
 */
export async function runTranscriptionAndSummary(id, audioFilePath, { fromStage = 'asr', existingTranscript = '' } = {}) {
  let transcript = existingTranscript

  if (fromStage === 'asr') {
    updateRecording(id, { status: 'transcribing', failureStage: null })
    try {
      const result = await recognizeAudio(audioFilePath)
      transcript = result.text
      // utterances (per-word timestamps) aren't used yet, but are stored now
      // since chunk-overlap-stitching (splitting long recordings without
      // cutting a sentence in half) will need them.
      updateRecording(id, { transcript, utterances: result.utterances, status: 'summarizing', failureStage: null })
      trackTranscriptionResult({ success: true })
    } catch (e) {
      updateRecording(id, { status: 'failed', failureStage: 'asr' })
      trackTranscriptionResult({ success: false, errorMessage: e.message })
      return
    }
  } else {
    updateRecording(id, { status: 'summarizing', failureStage: null })
  }

  try {
    const summary = await summarizeRecording(transcript)
    updateRecording(id, { summary, status: 'done', failureStage: null })
    trackSummaryResult({ success: true })
  } catch (e) {
    updateRecording(id, { status: 'failed', failureStage: 'summary' })
    trackSummaryResult({ success: false, errorMessage: e.message })
  }
}
