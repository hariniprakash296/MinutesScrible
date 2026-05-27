/**
 * MeetingDetail.tsx
 *
 * Shows the full results for a single meeting once processing is complete.
 *
 * The component has two modes:
 *
 *  1. "In progress" — while the pipeline is running, it shows a status banner
 *     ("Transcribing…", "Analysing…") that updates in real time via Supabase
 *     Realtime. No tabs are shown yet.
 *
 *  2. "Done" — once status === 'done', it shows three tabs:
 *       Minutes    — structured meeting summary (title, attendees, agenda, decisions, action items)
 *       Jira       — Jira-ready story cards + an "Export .xlsx" button
 *       Diagrams   — rendered Mermaid SVG diagrams with parse-error fallback
 *
 * Data flow:
 * On mount we fetch the full meeting row (including result_json) from Supabase.
 * We then subscribe to Realtime so any status change updates the UI instantly.
 * When status flips to 'done', the Realtime payload includes the full result_json,
 * so we don't need a second fetch.
 *
 * Why keep the transcript out of the UI?
 * The transcript is PII — it contains everything everyone said.
 * We store it in the DB for debugging but never display it to the user.
 * result_json is the only AI output we show.
 */

import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'                   // Supabase client
import { MeetingResultSchema } from '../lib/types'            // Zod schema for runtime validation
import type { Meeting, MeetingResult, MeetingStatus } from '../lib/types'
import { safeRenderMermaid } from '../lib/mermaidRender'     // safe Mermaid renderer
import { downloadJiraXlsx } from '../lib/jiraExport'         // Excel export helper
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs'
import { Card, CardHeader, CardTitle, CardContent } from './ui/card'
import { Button } from './ui/button'

// MeetingDetailProps — what App.tsx must provide.
interface MeetingDetailProps {
  meetingId: string // the UUID of the meeting to display
}

// ── Status banner messages ─────────────────────────────────────────────────────

// Maps each pipeline status to a human-readable message shown in the banner.
const STATUS_MESSAGES: Record<MeetingStatus, string> = {
  pending:      'Waiting to start…',
  transcribing: 'Transcribing audio — this takes about 1 minute per hour of recording.',
  analysing:    'Analysing transcript with AI…',
  done:         '',      // no banner when done — we show the tabs instead
  failed:       '',      // no banner when failed — we show the error message instead
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MeetingDetail({ meetingId }: MeetingDetailProps) {
  // meeting — the full row from the DB, or null while loading
  const [meeting, setMeeting] = useState<Meeting | null>(null)

  // result — the validated AI output (from meeting.result_json), or null
  const [result, setResult] = useState<MeetingResult | null>(null)

  // error — shown if the DB fetch or Zod validation fails
  const [error, setError] = useState('')

  // activeTab — which of the three result tabs is selected
  const [activeTab, setActiveTab] = useState('minutes')

  // diagramSvgs — maps diagram index to rendered SVG string
  // We render diagrams once when the result arrives (not on every render)
  const [diagramSvgs, setDiagramSvgs] = useState<Record<number, string>>({})

  // exporting — true while downloadJiraXlsx() is running (disables the button)
  const [exporting, setExporting] = useState(false)

  // renderedRef — tracks which diagram IDs we've already rendered so we don't re-render
  const renderedRef = useRef<Set<string>>(new Set())

  // ── Parse + validate result_json ────────────────────────────────────────────
  // Runs whenever the meeting row changes (including Realtime updates).
  function applyMeetingRow(row: Meeting) {
    setMeeting(row)

    if (row.status === 'done' && row.result_json != null) {
      // Validate the AI's JSON against our Zod schema.
      // If the AI produced an unexpected shape, this will catch it early.
      const parsed = MeetingResultSchema.safeParse(row.result_json)
      if (parsed.success) {
        setResult(parsed.data)
      } else {
        setError('AI result has unexpected format — the data may be incomplete.')
      }
    }
  }

  useEffect(() => {
    // ── Initial fetch ──────────────────────────────────────────────────────────
    // Fetch the full meeting row, including transcript and result_json.
    supabase
      .from('meetings')
      .select('*')
      .eq('id', meetingId)
      .single()  // we expect exactly one row
      .then(({ data, error: fetchError }) => {
        if (fetchError || !data) {
          setError(fetchError?.message ?? 'Meeting not found.')
        } else {
          applyMeetingRow(data as unknown as Meeting)
        }
      })

    // ── Realtime subscription ──────────────────────────────────────────────────
    // Listen for UPDATE events on this specific meeting row.
    // The Edge Function updates the status column multiple times (transcribing →
    // analysing → done / failed), and each update triggers an event here.
    const channel = supabase
      .channel(`meeting-detail-${meetingId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'meetings',
          filter: `id=eq.${meetingId}`, // only updates to this specific meeting
        },
        (payload) => {
          applyMeetingRow(payload.new as unknown as Meeting)
        }
      )
      .subscribe()

    // Clean up the subscription when the component unmounts.
    return () => { supabase.removeChannel(channel) }
  }, [meetingId]) // re-subscribe if meetingId changes (shouldn't happen in practice)

  // ── Render diagrams when result arrives ────────────────────────────────────
  // We use a separate useEffect so diagram rendering runs after the result state
  // is set, not during the first render.
  useEffect(() => {
    if (!result) return

    // Render each diagram that we haven't rendered yet.
    result.diagrams.forEach(async (diagram, i) => {
      const renderId = `diagram-${meetingId}-${i}`

      // Skip if we already rendered this one.
      if (renderedRef.current.has(renderId)) return
      renderedRef.current.add(renderId)

      const { svg } = await safeRenderMermaid(
        diagram.mermaid,
        renderId,
        result.minutes.action_items, // fallback uses action items
      )

      setDiagramSvgs(prev => ({ ...prev, [i]: svg }))
    })
  }, [result, meetingId])

  // ── Export handler ─────────────────────────────────────────────────────────
  async function handleExport() {
    if (!result) return
    setExporting(true)
    try {
      const slug = meeting?.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-') // convert non-alphanumeric to hyphens
        .replace(/^-|-$/g, '')        // strip leading/trailing hyphens
        || 'jira-stories'
      await downloadJiraXlsx(result.jira_stories, `${slug}.xlsx`)
    } finally {
      setExporting(false)
    }
  }

  // ── Loading state ──────────────────────────────────────────────────────────
  if (!meeting && !error) {
    return <p className="text-sm text-gray-400">Loading…</p>
  }

  // ── Fetch error state ──────────────────────────────────────────────────────
  if (error && !meeting) {
    return <p className="text-sm text-red-600">{error}</p>
  }

  const status = meeting!.status

  // ── Failed state ───────────────────────────────────────────────────────────
  if (status === 'failed') {
    return (
      <Card>
        <CardContent>
          <p className="font-medium text-red-600">Processing failed</p>
          <p className="mt-1 text-sm text-gray-600">
            {meeting!.error_message ?? 'An unknown error occurred.'}
          </p>
          <p className="mt-2 text-xs text-gray-400">
            Meeting ID: <code className="font-mono">{meetingId}</code>
          </p>
        </CardContent>
      </Card>
    )
  }

  // ── In-progress state ──────────────────────────────────────────────────────
  if (status !== 'done') {
    return (
      <Card>
        <CardContent>
          {/* Animated spinner dots */}
          <div className="flex items-center gap-3">
            <span className="flex gap-1">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="h-2 w-2 rounded-full bg-indigo-500 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }} // stagger the bounce timing
                />
              ))}
            </span>
            <p className="text-sm text-gray-600">
              {STATUS_MESSAGES[status] ?? 'Processing…'}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  // ── Done state — show tabs ──────────────────────────────────────────────────
  // We guard against result being null even though status === 'done', because
  // Zod validation might have failed (error state shows below).
  if (!result) {
    return <p className="text-sm text-red-600">{error || 'No result available.'}</p>
  }

  const { minutes, jira_stories, diagrams } = result

  return (
    <div className="space-y-4">
      {/* Meeting title */}
      <h2 className="text-xl font-semibold text-gray-900">{minutes.title}</h2>
      <p className="text-sm text-gray-400">
        {minutes.date}
        {meeting!.duration_sec != null && (
          <span> · {Math.round(meeting!.duration_sec / 60)} min</span>
        )}
        {minutes.attendees.length > 0 && (
          <span> · {minutes.attendees.join(', ')}</span>
        )}
      </p>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="minutes">Minutes</TabsTrigger>
          <TabsTrigger value="jira">
            Jira Stories
            {jira_stories.length > 0 && (
              <span className="ml-1.5 rounded-full bg-indigo-100 px-1.5 text-xs text-indigo-700">
                {jira_stories.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="diagrams">Diagrams</TabsTrigger>
        </TabsList>

        {/* ── Minutes tab ─────────────────────────────────────────────────── */}
        <TabsContent value="minutes" className="mt-4 space-y-4">

          {/* Summary paragraph */}
          {minutes.summary && (
            <Card>
              <CardContent>
                <p className="text-sm text-gray-700 leading-relaxed">{minutes.summary}</p>
              </CardContent>
            </Card>
          )}

          {/* Agenda */}
          {minutes.agenda.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Agenda</CardTitle></CardHeader>
              <CardContent>
                <ol className="list-decimal list-inside space-y-1">
                  {minutes.agenda.map((item, i) => (
                    <li key={i} className="text-sm text-gray-700">{item}</li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {/* Decisions */}
          {minutes.decisions.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Decisions</CardTitle></CardHeader>
              <CardContent>
                <ul className="list-disc list-inside space-y-1">
                  {minutes.decisions.map((d, i) => (
                    <li key={i} className="text-sm text-gray-700">{d}</li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Action items */}
          {minutes.action_items.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Action Items</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {minutes.action_items.map((item, i) => (
                    <div key={i} className="flex items-start justify-between gap-4 text-sm">
                      <div>
                        {/* Owner name in bold */}
                        <span className="font-medium text-gray-900">{item.owner}: </span>
                        <span className="text-gray-700">{item.task}</span>
                      </div>
                      {/* Due date badge (only shown when a date was extracted) */}
                      {item.due_date && (
                        <span className="shrink-0 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                          {item.due_date}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Jira tab ────────────────────────────────────────────────────── */}
        <TabsContent value="jira" className="mt-4 space-y-4">
          {jira_stories.length === 0 ? (
            <p className="text-sm text-gray-400">No Jira stories were generated for this meeting.</p>
          ) : (
            <>
              {/* Export button — triggers async xlsx download */}
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  onClick={handleExport}
                  disabled={exporting}
                >
                  {exporting ? 'Exporting…' : `Export ${jira_stories.length} stories (.xlsx)`}
                </Button>
              </div>

              {/* Story cards */}
              {jira_stories.map((story, i) => (
                <Card key={i}>
                  <CardHeader>
                    <div className="flex items-start gap-2">
                      {/* Story index badge */}
                      <span className="shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-mono text-indigo-700">
                        Story {i + 1}
                      </span>
                      <CardTitle className="leading-snug">{story.Summary}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-gray-700 whitespace-pre-wrap">{story.Description}</p>
                    {/* Epic Link badge — only shown when an epic was extracted */}
                    {story['Epic Link'] && (
                      <p className="mt-2 text-xs text-gray-400">
                        Epic: <code className="font-mono">{story['Epic Link']}</code>
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </>
          )}
        </TabsContent>

        {/* ── Diagrams tab ─────────────────────────────────────────────────── */}
        <TabsContent value="diagrams" className="mt-4 space-y-4">
          {diagrams.length === 0 ? (
            <p className="text-sm text-gray-400">No diagrams were generated for this meeting.</p>
          ) : (
            diagrams.map((diagram, i) => (
              <Card key={i}>
                <CardHeader><CardTitle>{diagram.title}</CardTitle></CardHeader>
                <CardContent>
                  {diagramSvgs[i] ? (
                    // dangerouslySetInnerHTML is safe here: Mermaid renders
                    // to SVG elements only, with securityLevel:'strict' set in
                    // mermaidRender.ts which prevents script injection.
                    <div
                      className="overflow-x-auto"
                      dangerouslySetInnerHTML={{ __html: diagramSvgs[i] }}
                    />
                  ) : (
                    // Show a spinner while the diagram is rendering client-side.
                    <p className="text-sm text-gray-400">Rendering diagram…</p>
                  )}
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
