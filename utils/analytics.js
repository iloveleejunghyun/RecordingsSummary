// Thin wrapper around uni统计's custom event reporting (uni.report), so call
// sites stay clean and every event name/shape is defined in exactly one
// place. Requires uniStatistics.enable: true in manifest.json.
//
// These map directly to the core hypothesis's primary metric: record →
// transcript generated → view AI summary → return for another real
// recording. D14 return-usage is a uni统计 dashboard question (does this
// user's "recording_completed" event fire again on a later day) — it
// doesn't need its own custom event.
//
// Never report actual recording/transcript/summary content here — only
// structural/behavioral metadata (which action happened, via which path).

function report(eventName, data) {
  // uni.report() is a real no-op during debug runs — DCloud's own docs:
  // "应用在运行、调试时不会上报统计数据，仅在发行后...才会上报数据。" So this
  // log is the ONLY feedback you get that an event fired correctly until
  // you package a real build.
  console.log(`[analytics] ${eventName}`, data || {})
  try {
    uni.report(eventName, data || {})
  } catch (e) {
    // Analytics should never be able to break the app.
    console.warn('Analytics report failed:', eventName, e)
  }
}

/** A recording finished (user pressed stop, or the Build-1 duration cap kicked in). */
export function trackRecordingCompleted({ durationSec, hitCap }) {
  report('recording_completed', { duration_sec: durationSec, hit_cap: !!hitCap })
}

/** Transcription (ASR) finished — success or failure, with the failure stage if any. */
export function trackTranscriptionResult({ success, errorMessage }) {
  report('transcription_result', { success, error_message: success ? undefined : String(errorMessage || '') })
}

/** AI summary generation finished — success or failure. */
export function trackSummaryResult({ success, errorMessage }) {
  report('summary_result', { success, error_message: success ? undefined : String(errorMessage || '') })
}

/** The user opened a recording's detail page and its summary was visible. */
export function trackSummaryViewed() {
  report('summary_viewed')
}
