// AI integration: 百度千帆v2 (ERNIE), called directly from the client.
//
// Decision: no proxy backend for MVP — the API key ships embedded in the
// app. Known tradeoff: the key is extractable from the client bundle. Keep
// the beta small/private until retention is proven; revisit a proxy before
// any wider paid rollout.
//
// Real key lives in ai.config.js (gitignored). See ai.config.example.js.

import { AI_CONFIG } from './ai.config.js'

const QIANFAN_V2_BASE = 'https://qianfan.baidubce.com/v2'

class AIServiceUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AIServiceUnavailableError'
  }
}

function assertConfigured() {
  if (!AI_CONFIG.apiKey) {
    throw new AIServiceUnavailableError(
      'AI service is not configured yet — fill in apiKey in services/ai.config.js.'
    )
  }
}

async function chatCompletion(messages, temperature = 0.3, label = 'ai') {
  assertConfigured()
  let res
  try {
    res = await uni.request({
      url: `${QIANFAN_V2_BASE}/chat/completions`,
      method: 'POST',
      header: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_CONFIG.apiKey}`
      },
      data: {
        model: AI_CONFIG.model,
        messages,
        temperature
      }
    })
  } catch (e) {
    console.error(`[AI:${label}] network error:`, e.errMsg || e.message)
    throw new AIServiceUnavailableError(`Network error calling Qianfan: ${e.errMsg || e.message}`)
  }

  if (res.statusCode !== 200) {
    console.error(`[AI:${label}] HTTP ${res.statusCode}:`, res.data)
    throw new AIServiceUnavailableError(`Qianfan API HTTP ${res.statusCode}: ${JSON.stringify(res.data)}`)
  }
  const content = res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message
    ? res.data.choices[0].message.content
    : null
  if (!content) {
    console.error(`[AI:${label}] no content in response:`, res.data)
    throw new AIServiceUnavailableError('Qianfan API returned no content')
  }
  console.log(`[AI:${label}] raw response:`, content)
  return content
}

/**
 * Turn a raw ASR transcript into a readable summary. Combines noise
 * correction and summarization into a single pass for Build 1 — the ASR
 * transcript may contain misheard words or garbled fragments (background
 * noise, cross-talk), so the summary should read as the speaker's intended
 * meaning, not a literal transcription of ASR errors.
 * @param {string} transcript - raw text from services/asr.js
 * @returns {Promise<string>} the summary text
 * @throws {AIServiceUnavailableError} when the service isn't configured or the call fails
 */
export async function summarizeRecording(transcript) {
  const prompt = `You are a notes assistant. Below is a raw speech-to-text transcript of a recorded conversation, meeting, or lecture. The transcript may contain mistranscribed words, garbled fragments, or missing punctuation because of background noise or unclear audio.

Your job:
1. Read past likely transcription errors and infer the speaker's actual intended meaning where reasonably confident — don't preserve obvious ASR garbage literally, but never invent content that isn't grounded in the transcript.
2. Produce a concise summary as bullet points (each starting with "- " on its own line) covering the key points, decisions, and action items actually present in the transcript.
3. If the transcript is empty or contains no discernible content, say so plainly instead of fabricating a summary.

Keep the summary under 250 words. Output only the summary text directly, no prefix, explanation, or phrases like "here is the summary."

Transcript:
"""
${transcript}
"""`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.3, 'summarizeRecording')
  return content.trim()
}

export { AIServiceUnavailableError }
