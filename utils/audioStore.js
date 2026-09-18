// Moves a just-recorded audio file out of the OS temp location (what
// uni.getRecorderManager's onStop hands back) into this app's private,
// permanent document directory — so a recording survives an app restart
// and can still be retried (re-transcribed / re-summarized) later if a
// pipeline step failed. Temp files are not guaranteed to survive restarts,
// especially on iOS.
//
// App (vue3) platform only — uses the plus.io 5+ API, same as services/asr.js.

const RECORDINGS_DIR = 'recordings'

class AudioStoreError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AudioStoreError'
  }
}

function getRecordingsDirEntry() {
  return new Promise((resolve, reject) => {
    if (typeof plus === 'undefined' || !plus.io) {
      reject(new AudioStoreError('plus.io unavailable — this only runs on the App (iOS/Android) platform'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      '_doc/',
      docEntry => {
        docEntry.getDirectory(
          RECORDINGS_DIR,
          { create: true },
          dirEntry => resolve(dirEntry),
          err => reject(new AudioStoreError(`Failed to open/create recordings directory: ${JSON.stringify(err)}`))
        )
      },
      err => reject(new AudioStoreError(`Failed to resolve app document directory: ${JSON.stringify(err)}`))
    )
  })
}

/**
 * Copy a temp recording file into permanent app storage.
 * @param {string} tempFilePath - path from uni.getRecorderManager's onStop res.tempFilePath
 * @param {string} id - the recording's id, used as the permanent filename
 * @returns {Promise<string>} the permanent file path (usable with plus.io / passed back into services/asr.js)
 */
export async function saveAudioPermanently(tempFilePath, id) {
  if (!tempFilePath) throw new AudioStoreError('No temp file path provided')

  const dirEntry = await getRecordingsDirEntry()
  const filename = `${id}.aac`

  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(
      tempFilePath,
      tempEntry => {
        tempEntry.copyTo(
          dirEntry,
          filename,
          newEntry => resolve(newEntry.fullPath),
          err => reject(new AudioStoreError(`Failed to copy recording into permanent storage: ${JSON.stringify(err)}`))
        )
      },
      err => reject(new AudioStoreError(`Failed to resolve temp recording file: ${JSON.stringify(err)}`))
    )
  })
}

/**
 * Delete a permanently-stored recording file. Best-effort — a missing file
 * is not treated as an error, since the caller's goal (the file being gone)
 * is already satisfied.
 * @param {string} filePath
 */
export function deleteAudioFile(filePath) {
  if (!filePath || typeof plus === 'undefined' || !plus.io) return
  plus.io.resolveLocalFileSystemURL(
    filePath,
    entry => entry.remove(() => {}, () => {}),
    () => {} // already gone — fine
  )
}

export { AudioStoreError }
