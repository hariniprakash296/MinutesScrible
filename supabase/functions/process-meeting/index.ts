/**
 * index.ts  (process-meeting Edge Function)
 *
 * This is the entry point for the Edge Function that processes meeting audio.
 * An Edge Function is a short-lived server-side function that runs on Supabase's
 * infrastructure — think of it as a tiny server that only wakes up when called.
 *
 * What this function does:
 *
 *   1. Receives a POST request from the frontend with { meeting_id }.
 *   2. Verifies the JWT token to confirm who is making the request.
 *   3. Checks that the meeting actually belongs to that user.
 *   4. Responds with 202 Accepted immediately (so the user isn't waiting).
 *   5. Runs the full pipeline in the background:
 *        a. status = 'transcribing' → call Deepgram with a signed URL
 *        b. status = 'analysing'    → call OpenAI with the transcript
 *        c. status = 'done'         → save the structured result to the DB
 *        d. status = 'failed'       → save the error message if anything throws
 *
 * Why 202 + background?
 * Transcription + AI extraction can take 30–90 seconds for a 60-minute meeting.
 * If we waited for it to finish before responding, the HTTP request would time out.
 * Instead, we return 202 ("I've received your request and I'm working on it")
 * immediately, and the frontend watches for status changes via Supabase Realtime.
 *
 * Security:
 * We use the service_role key only inside this function (never in the browser).
 * Even so, we re-verify ownership by checking meeting.user_id === jwt user_id
 * before doing any work, so even a leaked meeting_id from another user won't
 * let an attacker trigger processing of someone else's audio.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2' // Supabase client for Deno
import { corsHeaders } from '../_shared/cors.ts'     // CORS headers for cross-origin requests
import { transcribeAudio } from './deepgram.ts'       // Deepgram transcription helper
import { extractMeetingData } from './llm.ts'         // OpenAI extraction helper

// These environment variables are auto-injected by Supabase at runtime.
// SUPABASE_URL            — the project URL
// SUPABASE_SERVICE_ROLE_KEY — the admin key that bypasses RLS (server-side only)
const supabaseUrl    = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

// Deno.serve is the Deno equivalent of Node's http.createServer().
// It receives every incoming HTTP request and calls this async function.
Deno.serve(async (req: Request) => {

  // ── Handle CORS preflight ────────────────────────────────────────────────
  // Browsers send an OPTIONS request before the real POST to check permissions.
  // We must respond with the CORS headers or the browser rejects the request.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Verify the JWT token ─────────────────────────────────────────────────
  // The frontend includes the user's JWT in the "Authorization: Bearer <token>" header.
  // We read and verify it to find out who is making this request.
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '') // strip "Bearer " prefix

  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401, // 401 Unauthorized
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Create a Supabase client that acts as this specific user (using their JWT).
  // auth.getUser() validates the JWT and returns the user's ID.
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: authError } = await anonClient.auth.getUser()

  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userId = user.id // the real user ID, derived from the JWT — never trust the client

  // ── Parse the request body ───────────────────────────────────────────────
  let meeting_id: string
  try {
    const body = await req.json()
    meeting_id = body.meeting_id
    if (!meeting_id) throw new Error('missing meeting_id')
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { meeting_id: string }' }), {
      status: 400, // 400 Bad Request
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Create an admin Supabase client. This uses the service_role key, which
  // bypasses Row Level Security. We use it only after verifying the user's
  // identity above, and we still double-check ownership in the query below.
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // ── Verify ownership (defence-in-depth) ─────────────────────────────────
  // Even though RLS would also block access to other users' rows, we explicitly
  // check here so we get a clear 404 rather than a cryptic RLS error.
  const { data: meeting, error: fetchError } = await admin
    .from('meetings')
    .select('id, audio_path, user_id')
    .eq('id', meeting_id)          // find this specific meeting
    .eq('user_id', userId)         // AND confirm it belongs to the authenticated user
    .single()                       // expect exactly one result

  if (fetchError || !meeting) {
    return new Response(JSON.stringify({ error: 'Meeting not found or access denied' }), {
      status: 404, // 404 Not Found
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Return 202 and start background processing ───────────────────────────
  // EdgeRuntime.waitUntil() tells the Deno runtime to keep the function alive
  // until the promise resolves, even after we've already sent the HTTP response.
  // Without this, Deno would terminate the function as soon as we return below.
  // @ts-ignore — EdgeRuntime is a Supabase-specific global not in standard Deno types
  EdgeRuntime.waitUntil(processInBackground(admin, meeting_id, meeting.audio_path))

  // Respond immediately — the frontend gets this within milliseconds.
  return new Response(JSON.stringify({ ok: true }), {
    status: 202, // 202 Accepted — "I got it, working on it"
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

/**
 * processInBackground
 *
 * The full async pipeline: transcription → extraction → DB update.
 * Runs after the 202 response has been sent.
 * All status changes are written to the DB, where the frontend's Realtime
 * subscription picks them up and updates the UI automatically.
 *
 * @param admin      Service-role Supabase client (bypasses RLS)
 * @param meetingId  The meeting to process
 * @param audioPath  Path to the audio file in Supabase Storage, e.g. "{user_id}/{id}.webm"
 */
async function processInBackground(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  meetingId: string,
  audioPath: string,
): Promise<void> {

  /**
   * setStatus  (helper inside processInBackground)
   * Updates the status column (and optionally other columns) for this meeting row.
   * Every call here triggers a Realtime event that the frontend receives instantly.
   */
  async function setStatus(status: string, extra: Record<string, unknown> = {}) {
    await admin.from('meetings').update({ status, ...extra }).eq('id', meetingId)
  }

  try {
    // ── Step 1: Transcription ──────────────────────────────────────────────
    await setStatus('transcribing') // frontend status bar: "Transcribing…"

    // Generate a signed URL for the audio file. The URL expires in 300 seconds (5 minutes).
    // We pass this URL to Deepgram so it can fetch the audio directly — we never
    // buffer the whole file in memory.
    const { data: urlData, error: urlError } = await admin.storage
      .from('meeting-audio')
      .createSignedUrl(audioPath, 300) // 300 seconds = 5 minutes TTL

    if (urlError || !urlData?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${urlError?.message}`)
    }

    // Call Deepgram with the signed URL. Returns { transcript, duration }.
    const { transcript, duration } = await transcribeAudio(urlData.signedUrl)

    // Save the transcript to the DB and advance status to 'analysing'.
    // The transcript is PII (personally identifiable information) — it is stored
    // in the DB but NEVER logged in the Edge Function logs.
    await setStatus('analysing', {
      transcript,
      ...(duration != null ? { duration_sec: Math.round(duration) } : {}),
    })

    // ── Step 2: AI extraction ──────────────────────────────────────────────
    // Send the transcript to OpenAI. Returns a validated JS object.
    const resultJson = await extractMeetingData(transcript)

    // Save the structured result and mark the meeting as done.
    // The Realtime subscription in MeetingDetail.tsx will see this update
    // and immediately render the Minutes / Jira / Diagrams tabs.
    await setStatus('done', { result_json: resultJson })

  } catch (err) {
    // Something went wrong — save the error and mark as failed.
    // The message is shown in the frontend status bar so the user can see what happened.
    const message = err instanceof Error ? err.message : String(err)
    await admin
      .from('meetings')
      .update({ status: 'failed', error_message: message })
      .eq('id', meetingId)
  }
}
