/**
 * MeetingList.tsx
 *
 * Shows all of the signed-in user's past meetings as a scrollable list of cards.
 *
 * Each card shows:
 *   - Meeting title
 *   - Date and duration (if available)
 *   - A coloured status badge (pending, transcribing, analysing, done, failed)
 *
 * Clicking a card calls onSelect(meetingId) so App.tsx can navigate to MeetingDetail.
 *
 * Data loading:
 * We load the initial list from Supabase on mount. We also subscribe to Realtime
 * events so if an in-progress meeting changes status (e.g. from 'transcribing' to
 * 'analysing'), the badge updates instantly without a page refresh.
 *
 * Ordering:
 * Meetings are ordered newest-first (descending created_at) so the user's most
 * recent meeting is always at the top.
 */

import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'        // Supabase client
import type { Meeting, MeetingStatus } from '../lib/types' // TypeScript types
import { Card, CardContent } from './ui/card'      // card UI primitive

// MeetingListProps — what App.tsx must provide.
interface MeetingListProps {
  userId: string                        // used to scope the query to this user's meetings
  onSelect: (meetingId: string) => void // called when the user clicks a meeting card
}

// ── Status badge colours ───────────────────────────────────────────────────────

// A map from each possible status to a Tailwind colour pair (background + text).
// This keeps all colour logic in one place rather than scattered across JSX.
const STATUS_COLOURS: Record<MeetingStatus, string> = {
  pending:      'bg-gray-100   text-gray-600',
  transcribing: 'bg-blue-100   text-blue-700',
  analysing:    'bg-yellow-100 text-yellow-700',
  done:         'bg-green-100  text-green-700',
  failed:       'bg-red-100    text-red-600',
}

// Human-readable labels for each status.
const STATUS_LABELS: Record<MeetingStatus, string> = {
  pending:      'Pending',
  transcribing: 'Transcribing…',
  analysing:    'Analysing…',
  done:         'Done',
  failed:       'Failed',
}

// ── Helper: format duration ────────────────────────────────────────────────────

/**
 * formatDuration
 * Converts a duration in seconds to "X min Y sec" format.
 * Returns null if the duration hasn't been filled in yet (early pipeline stages).
 */
function formatDuration(sec: number | null): string | null {
  if (sec == null) return null
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m === 0) return `${s}s`
  return `${m}m ${s}s`
}

// ── Helper: format date ────────────────────────────────────────────────────────

/**
 * formatDate
 * Converts an ISO timestamp like "2026-05-27T14:30:00Z" to "27 May 2026".
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MeetingList({ userId, onSelect }: MeetingListProps) {
  // meetings — the list fetched from Supabase; null means "still loading"
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)

  // error — shown if the initial fetch fails
  const [error, setError] = useState('')

  useEffect(() => {
    // ── Initial fetch ──────────────────────────────────────────────────────────
    // Load all meetings for this user, newest first.
    // We exclude the transcript and result_json columns — they can be large and
    // the list view doesn't need them. They are loaded in MeetingDetail instead.
    supabase
      .from('meetings')
      .select('id, user_id, title, audio_path, audio_mime, duration_sec, status, error_message, created_at, updated_at')
      .eq('user_id', userId)               // only this user's meetings
      .order('created_at', { ascending: false }) // newest first
      .then(({ data, error: fetchError }) => {
        if (fetchError) {
          setError(fetchError.message)
        } else {
          // Cast the returned rows to our Meeting type.
          // result_json and transcript are null here because we didn't select them.
          setMeetings((data ?? []) as unknown as Meeting[])
        }
      })

    // ── Realtime subscription ──────────────────────────────────────────────────
    // Subscribe to any INSERT or UPDATE on the meetings table for this user.
    // This means status badges update live as the pipeline progresses.
    const channel = supabase
      .channel(`meeting-list-${userId}`)   // channel name must be unique per component instance
      .on(
        'postgres_changes',
        {
          event: '*',                      // '*' = INSERT and UPDATE and DELETE
          schema: 'public',
          table: 'meetings',
          filter: `user_id=eq.${userId}`,  // server-side filter — only events for this user
        },
        (payload) => {
          // payload.new is the updated row; payload.eventType is 'INSERT', 'UPDATE', or 'DELETE'
          if (payload.eventType === 'INSERT') {
            // Prepend the new meeting to the top of the list.
            setMeetings(prev =>
              prev ? [payload.new as unknown as Meeting, ...prev] : [payload.new as unknown as Meeting]
            )
          } else if (payload.eventType === 'UPDATE') {
            // Replace the matching meeting row in the list with the updated version.
            setMeetings(prev =>
              prev?.map(m => m.id === (payload.new as { id: string }).id
                ? (payload.new as unknown as Meeting)
                : m
              ) ?? null
            )
          } else if (payload.eventType === 'DELETE') {
            // Remove the deleted meeting from the list.
            setMeetings(prev =>
              prev?.filter(m => m.id !== (payload.old as { id: string }).id) ?? null
            )
          }
        }
      )
      .subscribe()

    // Clean up the subscription when this component unmounts.
    return () => { supabase.removeChannel(channel) }
  }, [userId]) // re-run if userId changes (e.g. after sign-out + sign-in as different user)

  // ── Loading state ──────────────────────────────────────────────────────────
  if (meetings === null && !error) {
    return <p className="text-sm text-gray-400">Loading meetings…</p>
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return <p className="text-sm text-red-600">Failed to load meetings: {error}</p>
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (meetings!.length === 0) {
    return (
      <p className="text-sm text-gray-400">
        No meetings yet — record or upload one to get started.
      </p>
    )
  }

  // ── List ───────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {meetings!.map(meeting => {
        const duration = formatDuration(meeting.duration_sec)
        const date     = formatDate(meeting.created_at)
        const colours  = STATUS_COLOURS[meeting.status] ?? 'bg-gray-100 text-gray-600'
        const label    = STATUS_LABELS[meeting.status] ?? meeting.status

        return (
          // Each meeting is a clickable card.
          <Card
            key={meeting.id}
            className="cursor-pointer hover:border-indigo-300 hover:shadow-md transition-all"
          >
            <CardContent className="flex items-center justify-between py-3">
              {/* Left side: title and metadata */}
              <button
                type="button"
                className="flex-1 text-left"
                onClick={() => onSelect(meeting.id)}
              >
                <p className="font-medium text-gray-900 truncate">{meeting.title}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {date}
                  {duration && <span> · {duration}</span>}
                </p>
                {/* Show error message in red if the meeting failed */}
                {meeting.status === 'failed' && meeting.error_message && (
                  <p className="text-xs text-red-500 mt-1 truncate">{meeting.error_message}</p>
                )}
              </button>

              {/* Right side: status badge */}
              <span className={['ml-4 shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', colours].join(' ')}>
                {label}
              </span>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
