// Singleton wrapper around uni.getRecorderManager().
//
// REQUIRES manifest.json's app-plus.modules to include "Record": {} — without
// it, cloud-packaged Android release builds silently fail to ever fire
// onStart/onError (no exception, no callback, just a permanently-stuck
// "starting" state). Debug/run-to-device mode worked fine without it, which
// is what made this so confusing to track down — the module requirement
// only bites in a real packaged build.
//
// Why this file exists: uni.getRecorderManager() returns a device-wide
// singleton (there's only one microphone). Its .onStart/.onStop/.onError
// are ADDITIVE listener registrations, not property setters — calling them
// again doesn't replace the previous handler, it stacks another one on top.
// Register the native listeners exactly once, here, at module scope.
// Whichever caller is currently active calls setRecorderHandlers() to CLAIM
// the callbacks — that replaces the previous claim outright.
//
// setKeepScreenOn(true) while recording is running: without it, the screen
// auto-locks mid-recording (typically after 30s-2min depending on device
// settings), which does NOT stop uni.getRecorderManager on its own, but
// leaves the user unable to see recording state or hit stop without
// unlocking. This does NOT keep recording alive if the user manually
// presses the lock button or backgrounds the app — that needs OS-level
// background-audio support (iOS UIBackgroundModes, Android foreground
// service), which this app does not have yet.
//
// Long recordings are captured as a sequence of segments (see
// utils/storage.js), so stop()+start() happen repeatedly, back to back,
// throughout one logical session — NOT just once at the very end. onStop
// deliberately does NOT turn keepScreenOn back off, since 9 times out of 10
// it's immediately followed by another start() (the next segment), and
// toggling it off-then-on-again on every single rotation was pure wasted
// round-trips through the native bridge sitting right in the gap between
// segments. The caller is responsible for turning it off once it knows
// there's no next segment coming (see pages/home/home.vue's real-stop path).

let recorderManager = null
let currentHandlers = { onStart: null, onStop: null, onError: null }

function ensureInitialized() {
  if (recorderManager) return
  recorderManager = uni.getRecorderManager()
  recorderManager.onStart(() => {
    if (currentHandlers.onStart) currentHandlers.onStart()
  })
  recorderManager.onStop(res => {
    if (currentHandlers.onStop) currentHandlers.onStop(res)
  })
  recorderManager.onError(err => {
    try {
      uni.setKeepScreenOn({ keepScreenOn: false })
    } catch (e) {
      // Non-fatal.
    }
    if (currentHandlers.onError) currentHandlers.onError(err)
  })
}

/**
 * Claim the recorder's callbacks for whichever component calls this.
 * Call from mounted() — overwrites any previous claim, so only the most
 * recently mounted instance ever actually receives events.
 * @param {{ onStart?: Function, onStop?: Function, onError?: Function }} handlers
 */
export function setRecorderHandlers({ onStart = null, onStop = null, onError = null } = {}) {
  ensureInitialized()
  currentHandlers = { onStart, onStop, onError }
}

export function startRecording(options) {
  ensureInitialized()
  try {
    uni.setKeepScreenOn({ keepScreenOn: true })
  } catch (e) {
    // Non-fatal — recording still works, screen may just auto-lock.
  }
  recorderManager.start(options)
}

/**
 * Call once the caller knows there's no next segment coming — a real user
 * stop, not a rotation. See the file-level comment above for why this isn't
 * done automatically inside onStop.
 */
export function allowScreenLock() {
  try {
    uni.setKeepScreenOn({ keepScreenOn: false })
  } catch (e) {
    // Non-fatal — worst case the screen just stays on a bit longer.
  }
}

export function stopRecording() {
  ensureInitialized()
  recorderManager.stop()
}
