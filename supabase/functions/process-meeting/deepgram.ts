/**
 * deepgram.ts
 *
 * Sends an audio file URL to Deepgram's speech-to-text API and returns the
 * plain-text transcript.
 *
 * Why a URL instead of sending the file directly?
 * Deepgram supports a "url" parameter — we pass a signed URL pointing to the
 * audio file in Supabase Storage, and Deepgram downloads it directly. This
 * means the Edge Function never has to load the entire audio file into memory,
 * which avoids hitting the Deno runtime's memory limits for large recordings.
 *
 * What does "Nova-2" mean?
 * Nova-2 is the name of Deepgram's transcription model (as of 2026). It's
 * the most accurate model Deepgram offers and handles multiple speakers well.
 *
 * Parameters we enable:
 *   smart_format — adds punctuation and capitalisation automatically
 *   diarize      — labels each speaker, e.g. "Speaker 0: Hello. Speaker 1: Hi."
 *   redact       — removes PCI data (credit card numbers) and SSNs from the transcript
 *   mip_opt_out  — tells Deepgram NOT to use this audio to train their models (privacy)
 *
 * The API key is read from the Supabase Secrets vault (set via `supabase secrets set`).
 * It is NEVER hardcoded in source code.
 */

// Return type for the transcription result.
export interface DeepgramResult {
  transcript: string       // the full text of the meeting, as a single string
  duration:   number | null // length of the audio in seconds (null if not provided)
}

/**
 * transcribeAudio
 *
 * Calls the Deepgram API and returns the transcript and audio duration.
 *
 * @param signedUrl  A time-limited URL for the audio file in Supabase Storage.
 *                   Deepgram fetches the file from this URL directly.
 * @returns          The transcript text and audio duration.
 * @throws           If the API key is missing or Deepgram returns an error.
 */
export async function transcribeAudio(signedUrl: string): Promise<DeepgramResult> {
  // Read the API key from environment variables (injected by Supabase from the vault).
  const apiKey = Deno.env.get('DEEPGRAM_API_KEY')
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set')

  // Send the request to Deepgram's Listen endpoint.
  // The body is JSON, telling Deepgram the URL of the file and which options to use.
  const response = await fetch('https://api.deepgram.com/v1/listen', {
    method: 'POST',
    headers: {
      Authorization:  `Token ${apiKey}`, // Deepgram uses "Token" not "Bearer"
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url:          signedUrl,    // Deepgram fetches the audio from this URL
      model:        'nova-2',     // the transcription model to use
      smart_format: true,         // adds punctuation and capitalisation
      diarize:      true,         // labels each speaker (Speaker 0, Speaker 1, etc.)
      redact:       ['pci', 'ssn'], // remove payment card and social security numbers
      mip_opt_out:  true,         // opt out of model improvement program (privacy)
    }),
  })

  // If Deepgram returned an error status (4xx or 5xx), throw so the pipeline
  // catches it and sets the meeting status to 'failed'.
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Deepgram error ${response.status}: ${text}`)
  }

  // Parse the JSON response.
  const data = await response.json()

  // Navigate the nested response structure to find the transcript text.
  // Deepgram returns: { results: { channels: [{ alternatives: [{ transcript: "..." }] }] } }
  const channel    = data?.results?.channels?.[0]?.alternatives?.[0]
  const transcript = channel?.transcript ?? '' // empty string if no speech was detected

  // The audio duration (in seconds) is in the metadata, not the transcript.
  const duration: number | null = data?.metadata?.duration ?? null

  return { transcript, duration }
}
