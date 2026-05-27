import { meetingExtractionSchema } from './schema.ts'

const SYSTEM_PROMPT = `You are a meeting-extraction service. You receive a verbatim meeting transcript
and return a single JSON object matching the supplied schema.

Rules — non-negotiable:
1. Output ONLY the JSON. No prose, no preamble, no closing remarks.
2. Generate between 0 and 50 Jira stories. Each story is a discrete unit of work
   discussed in the meeting. Do not invent work that was not discussed.
3. For every Jira story: "Issue Type" is exactly "Story". "Epic Link" is either
   null or a Jira key in the form ABC-123. Never a free-text epic name.
4. For diagrams: produce 0 to 3 diagrams that illuminate the meeting (flow of a
   decision, sequence of an integration, etc). Each "mermaid" string must:
   a. Start with the exact "type" value followed by a newline.
   b. Use ONLY node labels matching [A-Za-z0-9 _-]. No parentheses, colons,
      quotes, semicolons, or arrow characters inside labels.
   c. Never use reserved keywords (end, class, subgraph) as node IDs.
   d. Keep each line under 120 characters.
5. If the transcript is too short or unclear to produce useful output, return
   empty arrays for jira_stories and diagrams, and a brief summary in minutes.
6. Dates are ISO 8601 (YYYY-MM-DD). If no date is mentioned, use today.`

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

export async function extractMeetingData(transcript: string): Promise<AnyRecord> {
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:           'gpt-4o-mini',
      temperature:     0.1,
      response_format: {
        type:       'json_schema',
        json_schema: meetingExtractionSchema,
      },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Transcript:\n\n${transcript}` },
      ],
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI error ${response.status}: ${text}`)
  }

  const data = await response.json()
  const content: string = data.choices?.[0]?.message?.content ?? ''

  let parsed: AnyRecord
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error(`OpenAI returned non-JSON content — strict mode may not be active. Raw: ${content.slice(0, 200)}`)
  }

  // Belt-and-braces: validate required top-level keys
  if (!parsed.minutes || !Array.isArray(parsed.jira_stories) || !Array.isArray(parsed.diagrams)) {
    throw new Error(`Result JSON missing required keys. Keys present: ${Object.keys(parsed).join(', ')}`)
  }

  return parsed
}
