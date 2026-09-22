// Per-segment transcribe → whole-recording summarize pipeline.
//
// A recording is captured as a sequence of independent segments (see
// utils/storage.js's file comment for why). Each segment is transcribed on
// its own, as soon as it's recorded, with its own retry — a failed upload
// only costs you that one ~60s segment, never the whole recording. Once
// every segment for a recording has succeeded, their transcripts are joined
// in order and summarized as a whole.

import { recognizeAudio } from '@/services/asr.js'
import { summarizeRecording } from '@/services/ai.js'
import { getRecordingById, updateRecording, updateSegment } from '@/utils/storage.js'
import { trackTranscriptionResult, trackSummaryResult } from '@/utils/analytics.js'

/**
 * Transcribe one segment and store its result, then check whether the whole
 * recording is ready to be finalized (all segments done). Safe to call
 * concurrently for different segments of the same recording, and safe to
 * call again to retry a single failed segment.
 * @param {string} recordingId
 * @param {{ id: string, audioFilePath: string }} segment
 */
export async function transcribeSegment(recordingId, segment) {
  updateSegment(recordingId, segment.id, { status: 'transcribing' })
  try {
    const result = await recognizeAudio(segment.audioFilePath)
    updateSegment(recordingId, segment.id, {
      status: 'done',
      transcript: result.text,
      utterances: result.utterances
    })
  } catch (e) {
    updateSegment(recordingId, segment.id, { status: 'failed' })
    console.error('Segment transcription failed:', segment.id, e.message)
  }
  await maybeFinalizeRecording(recordingId)
}

/**
 * Re-run the whole-recording summary from its already-concatenated
 * transcript — used both by the normal finalize path and by retrying a
 * recording that failed specifically at the summary step.
 * @param {string} recordingId
 */
export async function summarizeFinishedRecording(recordingId) {
  const recording = getRecordingById(recordingId)
  if (!recording) return
  updateRecording(recordingId, { status: 'summarizing', failureStage: null })
  try {
    const summary = await summarizeRecording(recording.transcript)
    updateRecording(recordingId, { summary, status: 'done', failureStage: null })
    trackSummaryResult({ success: true })
  } catch (e) {
    updateRecording(recordingId, { status: 'failed', failureStage: 'summary' })
    trackSummaryResult({ success: false, errorMessage: e.message })
  }
}

/**
 * Called after every segment transcription attempt (success or failure) to
 * check whether the recording as a whole can now move forward. No-ops while
 * the user is still actively recording (more segments are still coming),
 * while any segment is still mid-transcription, or once this recording has
 * already moved past this point (status check below) — that last guard
 * matters because multiple segments can finish transcribing around the same
 * time and each independently calls this function; only 'transcribing' (the
 * normal case) or 'failed' (retrying a previously-failed segment) should
 * ever actually finalize, otherwise two segments finishing close together
 * could both pass the checks and both kick off a duplicate summary call.
 * @param {string} recordingId
 */
async function maybeFinalizeRecording(recordingId) {
  const recording = getRecordingById(recordingId)
  if (!recording || !['transcribing', 'failed'].includes(recording.status)) return
  const segments = recording.segments
  if (segments.length === 0 || segments.some(s => s.status === 'transcribing')) return

  if (segments.some(s => s.status === 'failed')) {
    updateRecording(recordingId, { status: 'failed', failureStage: 'asr' })
    trackTranscriptionResult({ success: false, errorMessage: 'one or more segments failed' })
    return
  }

  const transcript = segments.map(s => s.transcript).filter(Boolean).join(' ')
  updateRecording(recordingId, { transcript })
  trackTranscriptionResult({ success: true })
  await summarizeFinishedRecording(recordingId)
}

/**
 * Called when the user taps Stop — marks the recording as no longer
 * actively growing, then immediately checks whether it can already be
 * finalized (e.g. every segment had already finished transcribing by the
 * time the user stopped).
 * @param {string} recordingId
 */
export async function finishRecordingSession(recordingId) {
  updateRecording(recordingId, { status: 'transcribing' })
  await maybeFinalizeRecording(recordingId)
}

/**
 * Retry whatever failed for this recording — any segments still marked
 * 'failed' (finalizing automatically once they all succeed, same as the
 * normal path), or if every segment already succeeded, just the summary
 * step on its own.
 * @param {string} recordingId
 */
export async function retryRecording(recordingId) {
  const recording = getRecordingById(recordingId)
  if (!recording) return

  const failedSegments = recording.segments.filter(s => s.status === 'failed')
  if (failedSegments.length > 0) {
    updateRecording(recordingId, { status: 'transcribing', failureStage: null })
    await Promise.all(failedSegments.map(s => transcribeSegment(recordingId, s)))
    return
  }

  if (recording.failureStage === 'summary') {
    await summarizeFinishedRecording(recordingId)
  }
}
