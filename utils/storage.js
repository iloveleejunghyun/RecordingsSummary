// Local-only storage layer for MVP (no backend). Everything lives in one
// uni-storage key as a JSON blob — data volume during validation is tiny
// (a handful of recordings per user), so this is simpler than reaching for
// plus.sqlite right now.
//
// A recording is made of one or more SEGMENTS — since uni's RecorderManager
// can only run one recording at a time with no way to peek at it mid-session
// (see services/asr.js's file comment), long recordings are captured as a
// sequence of ~60s files (utils/recorder.js stop()+start() back to back)
// rather than one giant file. Each segment is transcribed independently and
// retried independently; the recording's overall `transcript` is the
// segments' transcripts joined in order once all of them succeed.

import { uid } from './id.js'

const RECORDINGS_KEY = 'rc_recordings'
const AI_CONSENT_KEY = 'rc_ai_consent_given'

function nowISO() {
  return new Date().toISOString()
}

/** @returns {Array} all recordings, newest first */
export function getRecordings() {
  const recordings = uni.getStorageSync(RECORDINGS_KEY)
  return Array.isArray(recordings) ? recordings : []
}

function saveRecordings(recordings) {
  uni.setStorageSync(RECORDINGS_KEY, recordings)
  // Every mutation (create/addSegment/updateSegment/updateRecording/delete)
  // funnels through this one function, so this is the single point that
  // needs to notify open pages — otherwise a background retry (e.g. from
  // recoverAndRetryAll after connectivity returns) on a recording that's
  // already 'failed' would update silently: 'failed' isn't in either page's
  // PENDING_STATUSES, so nothing would be polling it, and the screen would
  // keep showing the old status until the user navigated away and back.
  uni.$emit('recordings-changed')
}

export function getRecordingById(id) {
  return getRecordings().find(r => r.id === id) || null
}

/**
 * Start a new recording session, before any audio has been captured yet.
 * Segments are added one at a time as they're recorded (see addSegment).
 * @param {{ id: string }} info - id is caller-supplied (utils/id.js)
 * @returns {object} the created recording
 */
export function createRecording({ id }) {
  const recordings = getRecordings()
  const recording = {
    id,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    durationSec: 0,
    segments: [],
    status: 'recording', // 'recording' | 'transcribing' | 'summarizing' | 'done' | 'failed'
    failureStage: null,  // 'asr' | 'summary' | null
    transcript: '',
    summary: ''
  }
  recordings.unshift(recording)
  saveRecordings(recordings)
  return recording
}

/**
 * Append a newly-recorded segment to a recording, right after its audio
 * file is saved permanently, before it's been transcribed.
 * @param {string} recordingId
 * @param {{ audioFilePath: string, durationSec: number }} info
 * @returns {object|null} the created segment (with its id), or null if the recording isn't found
 */
export function addSegment(recordingId, { audioFilePath, durationSec }) {
  const recordings = getRecordings()
  const recording = recordings.find(r => r.id === recordingId)
  if (!recording) return null
  const segment = {
    id: uid(),
    audioFilePath,
    durationSec,
    status: 'transcribing', // 'transcribing' | 'done' | 'failed'
    transcript: '',
    utterances: []
  }
  recording.segments.push(segment)
  recording.durationSec += durationSec
  recording.updatedAt = nowISO()
  saveRecordings(recordings)
  return segment
}

/**
 * Merge a patch into one segment of a recording (transcript arrives, or it
 * fails) and bump the recording's updatedAt.
 * @param {string} recordingId
 * @param {string} segmentId
 * @param {object} patch
 */
export function updateSegment(recordingId, segmentId, patch) {
  const recordings = getRecordings()
  const recording = recordings.find(r => r.id === recordingId)
  if (!recording) return null
  const segment = recording.segments.find(s => s.id === segmentId)
  if (!segment) return null
  Object.assign(segment, patch)
  recording.updatedAt = nowISO()
  saveRecordings(recordings)
  return segment
}

/**
 * Merge a patch into an existing recording's own fields (overall status,
 * concatenated transcript, summary, or a failure) and bump updatedAt.
 * @param {string} id
 * @param {object} patch
 * @returns {object|null} the updated recording, or null if not found
 */
export function updateRecording(id, patch) {
  const recordings = getRecordings()
  const recording = recordings.find(r => r.id === id)
  if (!recording) return null
  Object.assign(recording, patch, { updatedAt: nowISO() })
  saveRecordings(recordings)
  return recording
}

export function deleteRecording(id) {
  saveRecordings(getRecordings().filter(r => r.id !== id))
}

/**
 * Whether the user has explicitly agreed to send recordings/transcripts to
 * the third-party AI services (百度千帆 for summarization, 火山引擎/豆包 for
 * speech-to-text) that power this app. Required before any recording/AI
 * flow runs — per App Store Guidelines 5.1.1(i)/5.1.2(i), disclosing this
 * in the privacy policy alone isn't sufficient; the app must ask first.
 * @returns {boolean}
 */
export function getAIConsent() {
  return uni.getStorageSync(AI_CONSENT_KEY) === true
}

export function setAIConsent(agreed) {
  uni.setStorageSync(AI_CONSENT_KEY, agreed === true)
}
