import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { corsHeaders } from '../_shared/cors.ts'
import { transcribeAudio } from './deepgram.ts'
import { extractMeetingData } from './llm.ts'

const supabaseUrl        = Deno.env.get('SUPABASE_URL')!
const serviceRoleKey     = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Verify JWT and derive user_id using the anon client
  const anonClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  })
  const { data: { user }, error: authError } = await anonClient.auth.getUser()
  if (authError || !user) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userId = user.id

  // ── Parse body ────────────────────────────────────────────────────────────
  let meeting_id: string
  try {
    const body = await req.json()
    meeting_id = body.meeting_id
    if (!meeting_id) throw new Error('missing meeting_id')
  } catch {
    return new Response(JSON.stringify({ error: 'Body must be { meeting_id: string }' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Service-role client used only inside the Edge Function
  const admin = createClient(supabaseUrl, serviceRoleKey)

  // Verify the meeting belongs to this user (defence-in-depth on top of RLS)
  const { data: meeting, error: fetchError } = await admin
    .from('meetings')
    .select('id, audio_path, user_id')
    .eq('id', meeting_id)
    .eq('user_id', userId)
    .single()

  if (fetchError || !meeting) {
    return new Response(JSON.stringify({ error: 'Meeting not found or access denied' }), {
      status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── Respond 202 and run pipeline in background ────────────────────────────
  // @ts-ignore — EdgeRuntime is available in Supabase Deno runtime
  EdgeRuntime.waitUntil(processInBackground(admin, meeting_id, meeting.audio_path))

  return new Response(JSON.stringify({ ok: true }), {
    status: 202,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})

async function processInBackground(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  meetingId: string,
  audioPath: string,
): Promise<void> {
  async function setStatus(status: string, extra: Record<string, unknown> = {}) {
    await admin.from('meetings').update({ status, ...extra }).eq('id', meetingId)
  }

  try {
    // ── Transcription ───────────────────────────────────────────────────────
    await setStatus('transcribing')

    const { data: urlData, error: urlError } = await admin.storage
      .from('meeting-audio')
      .createSignedUrl(audioPath, 300)

    if (urlError || !urlData?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${urlError?.message}`)
    }

    const { transcript, duration } = await transcribeAudio(urlData.signedUrl)

    await setStatus('analysing', {
      transcript,
      ...(duration != null ? { duration_sec: Math.round(duration) } : {}),
    })

    // ── LLM extraction ───────────────────────────────────────────────────────
    const resultJson = await extractMeetingData(transcript)

    await setStatus('done', { result_json: resultJson })

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await admin
      .from('meetings')
      .update({ status: 'failed', error_message: message })
      .eq('id', meetingId)
  }
}
