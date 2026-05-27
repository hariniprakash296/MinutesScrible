/**
 * types.ts
 *
 * This file is the single source of truth for all TypeScript types and data
 * validation rules used on the frontend.
 *
 * We use a library called Zod to define "schemas" — descriptions of what shape
 * data must be in. Zod can both validate data at runtime (catching bad values
 * from the AI) AND generate TypeScript types automatically from those schemas.
 *
 * Every shape here mirrors the JSON schema in
 * supabase/functions/process-meeting/schema.ts — they must always stay in sync.
 */

import { z } from 'zod'

// ── Action item ───────────────────────────────────────────────────────────────
// A single task assigned to someone during the meeting.

export const ActionItemSchema = z.object({
  owner:    z.string().max(80),   // the person responsible for the task
  task:     z.string().max(300),  // description of what needs to be done
  due_date: z.string().nullable(), // deadline in YYYY-MM-DD format, or null if none given
})

// ── Minutes ───────────────────────────────────────────────────────────────────
// The structured summary of the whole meeting.

export const MinutesSchema = z.object({
  title:        z.string().max(120),                         // short meeting title
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),   // must be YYYY-MM-DD format
  attendees:    z.array(z.string().max(80)),                 // list of people in the meeting
  agenda:       z.array(z.string().max(200)),                // list of topics covered
  decisions:    z.array(z.string().max(300)),                // decisions that were made
  action_items: z.array(ActionItemSchema),                   // tasks assigned during the meeting
  summary:      z.string().max(1500),                        // paragraph overview of the meeting
})

// ── Jira story ────────────────────────────────────────────────────────────────
// A single ticket that can be imported into Jira (a project management tool).

export const JiraStorySchema = z.object({
  Summary:       z.string().min(5).max(120),   // the ticket title
  Description:   z.string().min(10).max(2000), // detailed description of the work
  'Issue Type':  z.literal('Story'),            // always "Story" — hardcoded, never from AI
  'Epic Link':   z.string().nullable(),         // optional parent epic, e.g. "ABC-123" or null
})

// ── Diagram ───────────────────────────────────────────────────────────────────
// A flowchart or sequence diagram described using Mermaid syntax.
// Mermaid is a text-based diagramming language that renders as SVG in the browser.

export const DiagramSchema = z.object({
  title:   z.string().max(80),                                              // diagram heading
  type:    z.enum(['flowchart TD', 'flowchart LR', 'sequenceDiagram']),    // diagram style
  mermaid: z.string().min(10).max(4000),                                   // raw Mermaid text
})

// ── Full result ───────────────────────────────────────────────────────────────
// Everything the AI returns for one meeting — minutes + Jira stories + diagrams.

export const MeetingResultSchema = z.object({
  minutes:      MinutesSchema,
  jira_stories: z.array(JiraStorySchema).min(0).max(50),  // 0 to 50 Jira tickets
  diagrams:     z.array(DiagramSchema).min(0).max(3),     // 0 to 3 diagrams
})

// ── TypeScript types (auto-generated from the Zod schemas above) ──────────────
// These let us use proper types elsewhere without writing them twice.

export type ActionItem    = z.infer<typeof ActionItemSchema>
export type Minutes       = z.infer<typeof MinutesSchema>
export type JiraStory     = z.infer<typeof JiraStorySchema>
export type Diagram       = z.infer<typeof DiagramSchema>
export type MeetingResult = z.infer<typeof MeetingResultSchema>

// ── Meeting row ───────────────────────────────────────────────────────────────
// Represents one row in the "meetings" database table.
// Each field matches a column in the Postgres database.

export type MeetingStatus =
  | 'pending'       // just uploaded, waiting to start
  | 'transcribing'  // Deepgram is converting audio to text
  | 'analysing'     // OpenAI is extracting structure from the transcript
  | 'done'          // everything finished successfully
  | 'failed'        // something went wrong (see error_message)

export interface Meeting {
  id:            string              // unique ID for this meeting (UUID)
  user_id:       string              // ID of the user who owns this meeting
  title:         string              // display name shown in the list
  audio_path:    string              // where the audio file lives in storage, e.g. "{user_id}/{meeting_id}.webm"
  audio_mime:    string              // file type, e.g. "audio/webm"
  duration_sec:  number | null       // length of the recording in seconds (filled in after transcription)
  status:        MeetingStatus       // current processing stage
  error_message: string | null       // human-readable error if status === 'failed'
  transcript:    string | null       // raw text from Deepgram (PII — never logged or displayed in full)
  result_json:   MeetingResult | null // structured AI output — null until status === 'done'
  created_at:    string              // ISO timestamp when the row was created
  updated_at:    string              // ISO timestamp of last update (auto-managed by DB trigger)
}
