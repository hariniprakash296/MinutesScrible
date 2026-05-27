/**
 * llm.ts
 *
 * Sends a meeting transcript to OpenAI and returns structured meeting data
 * (minutes, Jira stories, and diagrams) as a validated JavaScript object.
 *
 * The key technique: json_schema with strict:true
 * ─────────────────────────────────────────────
 * Normally, asking an AI to "return JSON" is unreliable — it might add extra
 * text, use the wrong field names, or produce nested structures you didn't expect.
 *
 * OpenAI's "json_schema" response format changes this completely. When strict:true
 * is set, OpenAI applies grammar-constrained decoding: every token the model
 * generates is filtered to ensure the output can only ever be valid JSON that
 * exactly matches our schema. The model is structurally incapable of producing
 * invalid output. We still run a quick Zod check (belt-and-braces), but in
 * practice it should never fail.
 *
 * The system prompt (locked, version-controlled):
 * The behaviour rules for the AI are in SYSTEM_PROMPT below and must not be
 * changed without understanding the Mermaid syntax constraints (rule 4) and
 * the "Issue Type must be 'Story'" invariant (rule 3).
 */

import { meetingExtractionSchema } from './schema.ts' // the JSON schema — single source of truth

// The instructions sent to the AI before the user's transcript.
// "System" messages set context and rules; "user" messages provide the input.
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

// A loose "any record" type used for the raw parsed JSON before Zod validation.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>

/**
 * extractMeetingData
 *
 * Sends the transcript to OpenAI with our strict JSON schema and returns
 * the parsed result.
 *
 * @param transcript  The raw text from Deepgram (the full meeting transcript)
 * @returns           A plain JavaScript object matching the MeetingResult shape
 * @throws            On API errors or if the response is not valid JSON
 */
export async function extractMeetingData(transcript: string): Promise<AnyRecord> {
  // Read the API key from environment variables (injected by Supabase from the vault).
  const apiKey = Deno.env.get('OPENAI_API_KEY')
  if (!apiKey) throw new Error('OPENAI_API_KEY not set')

  // Call the OpenAI chat completions endpoint.
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization:  `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       'gpt-4o-mini', // fast and cheap; ~$0.006 per 60-min meeting transcript
      temperature: 0.1,           // low temperature = more consistent, less creative output

      // This is what enforces the schema at the token level.
      // OpenAI's decoder filters every generated token against the schema,
      // making it physically impossible to produce non-conforming JSON.
      response_format: {
        type:        'json_schema',
        json_schema: meetingExtractionSchema, // imported from schema.ts — single source of truth
      },

      messages: [
        // The system message sets the AI's role and rules (locked above).
        { role: 'system', content: SYSTEM_PROMPT },

        // The user message provides the actual transcript to extract from.
        { role: 'user', content: `Transcript:\n\n${transcript}` },
      ],
    }),
  })

  // If OpenAI returned an error, throw so the pipeline catches it.
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI error ${response.status}: ${text}`)
  }

  const data = await response.json()

  // Extract the text content from the response structure.
  // OpenAI returns: { choices: [{ message: { content: "..." } }] }
  const content: string = data.choices?.[0]?.message?.content ?? ''

  // Parse the JSON string into a JavaScript object.
  let parsed: AnyRecord
  try {
    parsed = JSON.parse(content)
  } catch {
    // This should never happen with strict:true, but if it does we want a
    // clear error rather than a cryptic downstream crash.
    throw new Error(
      `OpenAI returned non-JSON content — strict mode may not be active. Raw: ${content.slice(0, 200)}`
    )
  }

  // Belt-and-braces check: verify the top-level keys exist.
  // This should also never fail given strict mode, but a missing key here
  // would cause a confusing crash in the DB write, so we catch it early.
  if (!parsed.minutes || !Array.isArray(parsed.jira_stories) || !Array.isArray(parsed.diagrams)) {
    throw new Error(
      `Result JSON missing required keys. Keys present: ${Object.keys(parsed).join(', ')}`
    )
  }

  return parsed
}
