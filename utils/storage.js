// Local-only storage layer for MVP (no backend). Everything lives in one
// uni-storage key as a JSON blob — data volume during validation is tiny
// (a handful of recordings per user), so this is simpler than reaching for
// plus.sqlite right now.

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
}

export function getRecordingById(id) {
  return getRecordings().find(r => r.id === id) || null
}

/**
 * Create a new recording entry right after the audio file is saved
 * permanently, before transcription/summarization have run. The id is
 * caller-supplied (see utils/id.js) because it's also used as the audio
 * file's permanent filename — both need to agree on the same id.
 * @param {{ id: string, audioFilePath: string, durationSec: number }} info
 * @returns {object} the created recording
 */
export function createRecording({ id, audioFilePath, durationSec }) {
  const recordings = getRecordings()
  const recording = {
    id,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    durationSec,
    audioFilePath,
    status: 'transcribing', // 'transcribing' | 'summarizing' | 'done' | 'failed'
    failureStage: null,     // 'asr' | 'summary' | null
    transcript: '',
    summary: ''
  }
  recordings.unshift(recording)
  saveRecordings(recordings)
  return recording
}

/**
 * Merge a patch into an existing recording (e.g. transcript arrives, status
 * changes, summary arrives, or a failure is recorded) and bump updatedAt.
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
