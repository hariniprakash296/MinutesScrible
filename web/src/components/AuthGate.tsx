/**
 * AuthGate.tsx
 *
 * This component controls who can see the rest of the app.
 *
 * How it works:
 * 1. When the page loads, it checks whether the user already has a valid
 *    session (e.g. they signed in earlier and the session is still active).
 * 2. If they do, it renders its children — meaning the rest of the app
 *    becomes visible inside the AuthGate wrapper.
 * 3. If they don't, it shows a sign-in form instead.
 * 4. The sign-in method is a "magic link" — the user types their email,
 *    Supabase sends them an email with a one-click login URL, and clicking
 *    it sets a session cookie. No password needed.
 *
 * It also renders the top navigation bar (with the user's email and a
 * sign-out button) when the user is signed in.
 *
 * "AuthGate" is a common pattern name — it's a gate that only opens if
 * you are authenticated.
 */

import { useState, useEffect, ReactNode } from 'react'
import { Session } from '@supabase/supabase-js' // Supabase's type for a login session
import { supabase } from '../lib/supabase'       // our configured Supabase client
import { Button } from './ui/button'              // our shared Button component

// AuthGateProps defines what props this component accepts.
// "children" is a special React prop — it means whatever JSX is placed
// between <AuthGate> and </AuthGate> tags.
interface AuthGateProps {
  children: ReactNode
}

export function AuthGate({ children }: AuthGateProps) {
  // session — the active login session, or null if the user is not signed in
  const [session, setSession] = useState<Session | null>(null)

  // loading — true while we're checking if the user is already signed in
  const [loading, setLoading] = useState(true)

  // email — what the user has typed into the email input field
  const [email, setEmail] = useState('')

  // sent — true after a magic link email has been sent successfully
  const [sent, setSent] = useState(false)

  // error — an error message to show if sign-in fails
  const [error, setError] = useState('')

  // useEffect runs once when the component first mounts (appears on screen).
  useEffect(() => {
    // Check if there's already a session saved in the browser (e.g. from a
    // previous visit). getSession() reads from the browser's local storage.
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session) // store the session (or null)
      setLoading(false)        // we're done loading
    })

    // onAuthStateChange listens for future changes — for example, when the
    // user clicks a magic link and gets signed in, or when they sign out.
    // This keeps the component in sync with the auth state automatically.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session) // update state whenever auth changes
    })

    // Return a cleanup function that unsubscribes the listener when the
    // component is removed from the screen (prevents memory leaks).
    return () => subscription.unsubscribe()
  }, []) // the empty array [] means "run this effect only once on mount"

  /**
   * handleSignIn
   * Called when the user submits the sign-in form.
   * Sends a magic link email via Supabase Auth.
   */
  async function handleSignIn(e: React.FormEvent) {
    e.preventDefault() // prevent the browser from reloading the page on form submit
    setError('')        // clear any previous error message

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // After clicking the magic link, Supabase redirects the browser here.
        // window.location.origin is the base URL, e.g. http://localhost:5173
        emailRedirectTo: window.location.origin,
      },
    })

    if (error) {
      setError(error.message) // show the error to the user
    } else {
      setSent(true) // show the "check your inbox" message
    }
  }

  /**
   * handleSignOut
   * Signs the user out and clears their session.
   * The onAuthStateChange listener above will then set session to null,
   * which causes the sign-in form to be shown again automatically.
   */
  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  // While we're checking for an existing session, show a loading state.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    )
  }

  // If there is no session, show the sign-in form instead of the app.
  if (!session) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        {/* Card container for the sign-in form */}
        <div className="w-full max-w-sm rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
          <h1 className="mb-1 text-xl font-semibold text-gray-900">MeetAssist</h1>
          <p className="mb-6 text-sm text-gray-500">Sign in with a magic link — no password needed.</p>

          {/* Show a success message after the magic link is sent */}
          {sent ? (
            <p className="rounded-lg bg-indigo-50 px-4 py-3 text-sm text-indigo-700">
              Check your inbox — a magic link is on its way to <strong>{email}</strong>.
            </p>
          ) : (
            // Sign-in form — only shows before the magic link is sent
            <form onSubmit={handleSignIn} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-gray-700">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required                         // browser will block submission if empty
                  value={email}                    // controlled input — React owns the value
                  onChange={e => setEmail(e.target.value)} // update state on every keystroke
                  placeholder="you@example.com"
                  className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm
                             focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              {/* Show error message only if there is one */}
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full">Send magic link</Button>
            </form>
          )}
        </div>
      </div>
    )
  }

  // The user IS signed in — render the nav bar and the rest of the app below it.
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Top navigation bar */}
      <header className="border-b border-gray-200 bg-white px-6 py-3 flex items-center justify-between">
        <span className="font-semibold text-gray-900">MeetAssist</span>
        <div className="flex items-center gap-3">
          {/* Show the signed-in user's email address */}
          <span className="text-sm text-gray-500">{session.user.email}</span>
          <Button variant="outline" size="sm" onClick={handleSignOut}>Sign out</Button>
        </div>
      </header>
      {/* Render whatever was placed between <AuthGate> and </AuthGate> */}
      {children}
    </div>
  )
}
