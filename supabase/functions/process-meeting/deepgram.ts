export interface DeepgramResult {
  transcript: string
  duration:   number | null
}

export async function transcribeAudio(signedUrl: string): Promise<DeepgramResult> {
  const apiKey = Deno.env.get('DEEPGRAM_API_KEY')
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY not set')

  const response = await fetch('https://api.deepgram.com/v1/listen', {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      url:           signedUrl,
      model:         'nova-2',
      smart_format:  true,
      diarize:       true,
      redact:        ['pci', 'ssn'],
      mip_opt_out:   true,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Deepgram error ${response.status}: ${text}`)
  }

  const data = await response.json()
  const channel = data?.results?.channels?.[0]?.alternatives?.[0]
  const transcript: string = channel?.transcript ?? ''
  const duration: number | null = data?.metadata?.duration ?? null

  return { transcript, duration }
}
