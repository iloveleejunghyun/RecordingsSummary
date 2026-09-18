// Shared id generator — a recording's id has to be decided before the audio
// file is saved permanently (the id becomes the filename) and before the
// storage entry is created, so both utils/audioStore.js's caller and
// utils/storage.js need to agree on the same id up front.
export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}
