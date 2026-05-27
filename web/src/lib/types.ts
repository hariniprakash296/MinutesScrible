import { z } from 'zod'

// ── Action item ──────────────────────────────────────────────────────────────

export const ActionItemSchema = z.object({
  owner:    z.string().max(80),
  task:     z.string().max(300),
  due_date: z.string().nullable(),
})

// ── Minutes ───────────────────────────────────────────────────────────────────

export const MinutesSchema = z.object({
  title:        z.string().max(120),
  date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  attendees:    z.array(z.string().max(80)),
  agenda:       z.array(z.string().max(200)),
  decisions:    z.array(z.string().max(300)),
  action_items: z.array(ActionItemSchema),
  summary:      z.string().max(1500),
})

// ── Jira story ────────────────────────────────────────────────────────────────

export const JiraStorySchema = z.object({
  Summary:       z.string().min(5).max(120),
  Description:   z.string().min(10).max(2000),
  'Issue Type':  z.literal('Story'),
  'Epic Link':   z.string().nullable(),
})

// ── Diagram ───────────────────────────────────────────────────────────────────

export const DiagramSchema = z.object({
  title:   z.string().max(80),
  type:    z.enum(['flowchart TD', 'flowchart LR', 'sequenceDiagram']),
  mermaid: z.string().min(10).max(4000),
})

// ── Full result ───────────────────────────────────────────────────────────────

export const MeetingResultSchema = z.object({
  minutes:      MinutesSchema,
  jira_stories: z.array(JiraStorySchema).min(0).max(50),
  diagrams:     z.array(DiagramSchema).min(0).max(3),
})

// ── TS types (derived from Zod) ───────────────────────────────────────────────

export type ActionItem    = z.infer<typeof ActionItemSchema>
export type Minutes       = z.infer<typeof MinutesSchema>
export type JiraStory     = z.infer<typeof JiraStorySchema>
export type Diagram       = z.infer<typeof DiagramSchema>
export type MeetingResult = z.infer<typeof MeetingResultSchema>

// ── Meeting row (mirrors public.meetings in Supabase) ─────────────────────────

export type MeetingStatus = 'pending' | 'transcribing' | 'analysing' | 'done' | 'failed'

export interface Meeting {
  id:            string
  user_id:       string
  title:         string
  audio_path:    string
  audio_mime:    string
  duration_sec:  number | null
  status:        MeetingStatus
  error_message: string | null
  transcript:    string | null
  result_json:   MeetingResult | null
  created_at:    string
  updated_at:    string
}
