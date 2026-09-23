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

// Models sometimes wrap JSON in prose or ```json fences — pull out the
// first {...} block rather than trusting content to be pure JSON.
function extractJSON(text) {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new AIServiceUnavailableError(`AI response was not valid JSON: ${text}`)
  try {
    return JSON.parse(match[0])
  } catch (e) {
    throw new AIServiceUnavailableError(`Failed to parse AI JSON response: ${e.message}`)
  }
}

/**
 * Correct a raw ASR transcript and summarize it, in one call. The ASR
 * transcript may contain misheard words, garbled fragments, or missing
 * punctuation because of background noise or unclear audio; the corrected
 * transcript is a distinct, user-facing artifact (several users have hit
 * the raw transcript being hard to read), and the summary is grounded in
 * that same corrected reading rather than the raw text a second time.
 * @param {string} transcript - raw text from services/asr.js
 * @returns {Promise<{ correctedTranscript: string, summary: string }>}
 * @throws {AIServiceUnavailableError} when the service isn't configured, the call fails, or the response isn't valid JSON
 */
export async function correctAndSummarize(transcript) {
  const prompt = `You are a notes assistant. Below is a raw speech-to-text transcript of a recorded conversation, meeting, or lecture. It may contain mistranscribed words, garbled fragments, or missing punctuation because of background noise or unclear audio.

Do two things with it:
1. correctedTranscript: fix likely mishearings and infer the speaker's actual intended words where reasonably confident (never invent content not grounded in the original), add reasonable punctuation and paragraph breaks for readability, and preserve the full content — this is a correction pass, not a summary, so don't shorten, condense, or omit anything.
2. summary: a concise summary as bullet points (each starting with "- " on its own line) covering the key points, decisions, and action items actually present, based on your corrected reading of the transcript. Keep it under 250 words.

If the transcript is empty or contains no discernible content, set correctedTranscript to the original transcript unchanged and summary to a plain statement that there's nothing to summarize — don't fabricate either one.

Output only a JSON object, nothing else, in this exact format:
{"correctedTranscript": "...", "summary": "..."}

Raw transcript:
"""
${transcript}
"""`

  const content = await chatCompletion([{ role: 'user', content: prompt }], 0.2, 'correctAndSummarize')
  const parsed = extractJSON(content)
  if (typeof parsed.correctedTranscript !== 'string' || typeof parsed.summary !== 'string') {
    throw new AIServiceUnavailableError(`AI JSON response missing expected fields: ${content}`)
  }
  return { correctedTranscript: parsed.correctedTranscript, summary: parsed.summary }
}

export { AIServiceUnavailableError }
