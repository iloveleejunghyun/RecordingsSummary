// Formatting helpers shared between the recordings list and the detail page,
// kept in one place so both always agree on what a given recording's status
// actually means to the user.

/**
 * A status label for a recording. While segments are still being captured
 * and/or transcribed, this shows live progress (e.g. "Transcribing 1/3...")
 * instead of a flat "Transcribing..." that hides how much is actually left
 * — both the numerator (segments finished) and denominator (segments
 * captured so far) grow as a long recording continues, since new segments
 * keep getting added throughout.
 * @param {{ status: string, failureStage?: string, segments: Array<{ status: string }> }} recording
 * @returns {string}
 */
export function statusLabel(recording) {
  if (recording.status === 'recording' || recording.status === 'transcribing') {
    // Guard against pre-segments recordings left over from earlier testing
    // (created before a recording had a `segments` array at all) — without
    // this, .length on undefined throws and silently blanks the label.
    const segments = recording.segments || []
    const total = segments.length
    if (total === 0) return 'Recording…'
    const done = segments.filter(s => s.status === 'done').length
    return `Transcribing ${done}/${total}...`
  }
  switch (recording.status) {
    case 'summarizing': return 'Summarizing…'
    case 'done': return 'Done'
    case 'failed': {
      const stage = recording.failureStage || 'unknown'
      if (stage === 'asr') {
        // A stopped, settled recording with any failed segment shows
        // 'failed' overall (see pipeline.js's maybeFinalizeRecording) even
        // when most segments actually succeeded — "Transcribing X/Y" alone
        // would be misleading here (nothing is still in progress, it's
        // stuck until a retry), but a bare "Failed" risks reading as "all
        // of it is lost" when it usually isn't. Show both: this needs your
        // attention, and here's how much is actually salvaged already.
        const segments = recording.segments || []
        const done = segments.filter(s => s.status === 'done').length
        return `Failed (asr) — ${done}/${segments.length} transcribed`
      }
      return `Failed (${stage})`
    }
    default: return recording.status
  }
}
