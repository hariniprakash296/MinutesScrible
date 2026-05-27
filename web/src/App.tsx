/**
 * App.tsx
 *
 * The root component of the MeetAssist frontend. Everything the user sees
 * lives inside this component.
 *
 * It does two things:
 *
 * 1. Wraps everything in <AuthGate>, which blocks access until the user is
 *    signed in. AuthGate renders the sign-in form if needed, or the app
 *    if a valid session exists.
 *
 * 2. Manages a simple three-view navigation without a URL router:
 *      "list"   — shows the user's meeting history (MeetingList, wired in Block 5)
 *      "new"    — shows the Uploader component to record or upload a new meeting
 *      "detail" — shows the results for a specific meeting (MeetingDetail, wired in Block 5)
 *
 * Why no URL router (like React Router)?
 * The app is simple enough that a plain state variable works. Adding React
 * Router would mean installing another library, handling URL params, and
 * managing history — overhead that isn't worth it for three views.
 */

import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'       // Supabase client for auth state
import { AuthGate } from './components/AuthGate' // blocks unauthenticated access
import { Uploader } from './components/Uploader' // handles audio upload + dispatch

// View describes which screen the user is currently looking at.
// TypeScript discriminated unions like this make it easy to handle each view safely.
type View =
  | { type: 'list' }                          // the meetings history list
  | { type: 'detail'; meetingId: string }     // a specific meeting's results
  | { type: 'new' }                           // the new-meeting upload screen

export default function App() {
  // userId — the ID of the currently signed-in user, or null if not signed in
  // We use this to pass to Uploader so it can name the uploaded file correctly.
  const [userId, setUserId] = useState<string | null>(null)

  // view — which screen is currently shown (list, new, or detail)
  const [view, setView] = useState<View>({ type: 'list' })

  // Keep userId in sync with the Supabase auth state.
  // This handles sign-in, sign-out, and session refresh automatically.
  useEffect(() => {
    // Get the current session immediately on mount (page load)
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
    })

    // Subscribe to future auth changes (sign-in via magic link, sign-out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null)

      // If the user signs out, go back to the list view so the sign-in form
      // appears cleanly rather than showing a half-rendered detail page.
      if (!session) setView({ type: 'list' })
    })

    // Clean up the subscription when this component unmounts.
    return () => subscription.unsubscribe()
  }, []) // run once on mount

  /**
   * handleUploaded
   * Called by Uploader when a file has been successfully uploaded and dispatched.
   * Navigates the user to the detail view for their new meeting.
   */
  function handleUploaded(meetingId: string) {
    setView({ type: 'detail', meetingId })
  }

  return (
    // AuthGate ensures the user is signed in before any of the content below is shown.
    <AuthGate>
      {/* Only render the main content once we have a userId */}
      {userId && (
        <main className="mx-auto max-w-3xl px-4 py-8">

          {/* ── List view ─────────────────────────────────────────────────── */}
          {view.type === 'list' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Your meetings</h2>
                {/* Button to go to the new-meeting upload screen */}
                <button
                  onClick={() => setView({ type: 'new' })}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  + New meeting
                </button>
              </div>
              {/* MeetingList will be wired in Block 5 — shows past meetings */}
              <p className="text-sm text-gray-400">
                No meetings yet — record or upload one to get started.
              </p>
            </div>
          )}

          {/* ── New meeting view ──────────────────────────────────────────── */}
          {view.type === 'new' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {/* Back button returns to the list */}
                <button
                  onClick={() => setView({ type: 'list' })}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-semibold text-gray-900">New meeting</h2>
              </div>
              {/* Uploader handles recording, drag-and-drop, and upload */}
              <Uploader userId={userId} onUploaded={handleUploaded} />
            </div>
          )}

          {/* ── Detail view ───────────────────────────────────────────────── */}
          {view.type === 'detail' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                {/* Back button returns to the list */}
                <button
                  onClick={() => setView({ type: 'list' })}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-semibold text-gray-900">Meeting results</h2>
              </div>
              {/* MeetingDetail will be wired in Block 5 — shows Minutes, Jira, Diagrams tabs */}
              <p className="text-sm text-gray-500">
                Meeting <code className="font-mono text-xs">{view.meetingId}</code> is processing…
              </p>
            </div>
          )}

        </main>
      )}
    </AuthGate>
  )
}
