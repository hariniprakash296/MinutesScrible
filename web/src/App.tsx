import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import { AuthGate } from './components/AuthGate'
import { Uploader } from './components/Uploader'

type View = { type: 'list' } | { type: 'detail'; meetingId: string } | { type: 'new' }

export default function App() {
  const [userId, setUserId] = useState<string | null>(null)
  const [view, setView] = useState<View>({ type: 'list' })

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setUserId(data.session?.user.id ?? null)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUserId(session?.user.id ?? null)
      if (!session) setView({ type: 'list' })
    })
    return () => subscription.unsubscribe()
  }, [])

  function handleUploaded(meetingId: string) {
    setView({ type: 'detail', meetingId })
  }

  return (
    <AuthGate>
      {userId && (
        <main className="mx-auto max-w-3xl px-4 py-8">
          {view.type === 'list' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Your meetings</h2>
                <button
                  onClick={() => setView({ type: 'new' })}
                  className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
                >
                  + New meeting
                </button>
              </div>
              {/* MeetingList wired in Block 5 */}
              <p className="text-sm text-gray-400">
                No meetings yet — record or upload one to get started.
              </p>
            </div>
          )}

          {view.type === 'new' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView({ type: 'list' })}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-semibold text-gray-900">New meeting</h2>
              </div>
              <Uploader userId={userId} onUploaded={handleUploaded} />
            </div>
          )}

          {view.type === 'detail' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setView({ type: 'list' })}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  ← Back
                </button>
                <h2 className="text-lg font-semibold text-gray-900">Meeting results</h2>
              </div>
              {/* MeetingDetail wired in Block 5 */}
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
