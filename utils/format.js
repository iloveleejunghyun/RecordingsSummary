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
    case 'failed': return `Failed (${recording.failureStage || 'unknown'})`
    default: return recording.status
  }
}
