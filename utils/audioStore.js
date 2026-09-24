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

// uni.getFileSystemManager() doesn't exist at all on the classic uni-app App
// (JS engine) platform — confirmed on-device ("... is not a function") and
// by DCloud's own docs: it's uni-app x (uts/uvue) only. plus.io is the only
// real file API here, and its FileWriter.write() only accepts a String (per
// html5plus.org's own spec) — an ArrayBuffer throws an opaque error. The
// real, community-documented way to write binary data is the undocumented
// but widely-used writer.writeAsBinary(base64String) — confirmed via DCloud
// forum posts, since html5plus.org's own page doesn't list it. So: read via
// readAsDataURL (proven reliable on-device, unlike readAsArrayBuffer, whose
// callback never fires at all), decode+concatenate to raw bytes, then
// re-encode the merged bytes back to base64 for the write.
function readFileAsBytes(filePath) {
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(
      filePath,
      entry => {
        entry.file(
          file => {
            try {
              const reader = new plus.io.FileReader()
              reader.onloadend = evt => {
                try {
                  const dataUrl = evt.target.result
                  const base64 = dataUrl.substring(dataUrl.indexOf(',') + 1)
                  const binary = atob(base64)
                  const bytes = new Uint8Array(binary.length)
                  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
                  console.log('[merge] read segment into bytes:', bytes.length)
                  resolve(bytes)
                } catch (err) {
                  reject(new AudioStoreError(`Failed to decode segment data URL: ${err && err.message}`))
                }
              }
              reader.onerror = err => reject(new AudioStoreError(`Failed to read segment file: ${JSON.stringify(err)}`))
              reader.readAsDataURL(file)
            } catch (err) {
              reject(new AudioStoreError(`Reading segment file threw: ${err && err.message}`))
            }
          },
          err => reject(new AudioStoreError(`Failed to open segment file: ${JSON.stringify(err)}`))
        )
      },
      err => reject(new AudioStoreError(`Failed to resolve segment file: ${JSON.stringify(err)}`))
    )
  })
}

function bytesToBase64(bytes) {
  const CHUNK_SIZE = 0x8000 // avoid a call-stack overflow from fromCharCode.apply on a huge array
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK_SIZE))
  }
  return btoa(binary)
}

function writeBytesToFile(bytes, dirEntry, filename) {
  return new Promise((resolve, reject) => {
    dirEntry.getFile(
      filename,
      { create: true },
      fileEntry => {
        fileEntry.createWriter(
          writer => {
            writer.onwrite = () => {
              console.log('[merge] write complete:', fileEntry.fullPath)
              resolve(fileEntry.fullPath)
            }
            writer.onerror = err => reject(new AudioStoreError(`Failed to write merged file: ${JSON.stringify(err)}`))
            try {
              writer.writeAsBinary(bytesToBase64(bytes))
            } catch (err) {
              reject(new AudioStoreError(`writer.writeAsBinary threw: ${err && err.message}`))
            }
          },
          err => reject(new AudioStoreError(`Failed to open file writer: ${JSON.stringify(err)}`))
        )
      },
      err => reject(new AudioStoreError(`Failed to create merged file: ${JSON.stringify(err)}`))
    )
  })
}

/**
 * Concatenate a recording's segment files into one playable file, in order.
 * Safe at the byte level because every segment is raw ADTS AAC (each frame
 * carries its own header — verified by decoding a concatenated real segment
 * set with ffmpeg) recorded with the same format/sampleRate/bitRate (see
 * home.vue's RECORDER_OPTIONS), so simple concatenation produces one valid
 * stream rather than a corrupt file. This would NOT be safe for a
 * container-based format like MP4/M4A.
 * @param {string[]} segmentPaths - in recording order
 * @param {string} id - the recording's id, used to name the merged file
 * @returns {Promise<string>} the merged file's permanent path
 */
export async function mergeSegments(segmentPaths, id) {
  if (!segmentPaths || segmentPaths.length === 0) {
    throw new AudioStoreError('No segments to merge')
  }
  const chunks = await Promise.all(segmentPaths.map(readFileAsBytes))
  const totalLength = chunks.reduce((sum, c) => sum + c.length, 0)
  const merged = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.length
  }
  const dirEntry = await getRecordingsDirEntry()
  return writeBytesToFile(merged, dirEntry, `${id}_merged.aac`)
}

export { AudioStoreError }
