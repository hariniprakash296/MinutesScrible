/**
 * Uploader.tsx
 *
 * Handles the full upload-and-dispatch flow for a meeting audio file:
 *
 *   1. Accept the file — either from the Recorder component (mic recording)
 *      or from the drag-and-drop / file-browse area.
 *   2. Validate the file type and size.
 *   3. Upload the audio to Supabase Storage in the "meeting-audio" bucket.
 *      The file is stored at the path: {userId}/{meetingId}.{extension}
 *      This path is required by the Row Level Security rules — users can only
 *      upload to a folder that starts with their own user ID.
 *   4. Insert a new row in the "meetings" database table with status "pending".
 *   5. POST the meeting ID to the Edge Function, which kicks off the async
 *      transcription + AI pipeline.
 *   6. Tell the parent component the meeting ID so it can navigate to results.
 *
 * The Edge Function returns 202 Accepted immediately and processes the audio
 * in the background — the user never waits for AI here.
 */

import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'          // generates random unique IDs
import { supabase } from '../lib/supabase'    // our Supabase client
import { Recorder, mimeToExtension } from './Recorder' // in-browser recorder component
import { Button } from './ui/button'

// List of audio MIME types we accept. Other types are rejected with an error.
// We check against the base type (before the semicolon) so "audio/webm;codecs=opus"
// still matches "audio/webm".
const ALLOWED_TYPES = new Set([
  'audio/webm', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/x-m4a', 'audio/ogg',
])

const MAX_BYTES = 100 * 1024 * 1024 // 100 MB in bytes — the Supabase storage bucket limit

// UploaderProps defines what the parent component (App.tsx) must provide.
interface UploaderProps {
  userId: string                       // the currently signed-in user's ID
  onUploaded: (meetingId: string) => void // called when upload + dispatch succeeds
}

// UploadState tracks which phase of the upload process we're in.
type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export function Uploader({ userId, onUploaded }: UploaderProps) {
  // uploadState — current phase of the upload
  const [uploadState, setUploadState] = useState<UploadState>('idle')

  // progress — a number from 0–100 used to draw the progress bar
  const [progress, setProgress] = useState(0)

  // error — message shown when validation or upload fails
  const [error, setError] = useState('')

  // dragging — true while the user is dragging a file over the drop zone
  const [dragging, setDragging] = useState(false)

  /**
   * handleFile
   *
   * Core upload logic. Validates the file, uploads it to Supabase Storage,
   * creates a DB row, and dispatches to the Edge Function.
   *
   * @param file         The audio File object to upload
   * @param mimeOverride Use this MIME type instead of file.type (needed for
   *                     Blobs from the recorder, which may have extra codec info)
   */
  async function handleFile(file: File, mimeOverride?: string) {
    const mime = mimeOverride ?? file.type
    setError('')

    // Strip codec info (e.g. ";codecs=opus") to get the base MIME type for validation.
    const baseType = mime.split(';')[0]
    if (!ALLOWED_TYPES.has(baseType)) {
      setError(`Unsupported file type: ${mime}. Use .webm, .mp4, .m4a, .mp3, or .wav`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError('File exceeds 100 MB limit.')
      return
    }

    setUploadState('uploading')
    setProgress(0)

    // Generate a new random UUID for this meeting. This becomes the primary key
    // in the database AND the filename in storage.
    const meetingId = uuidv4()

    // Determine the file extension from the MIME type so the stored file has
    // the right extension (e.g. "abc123.webm" or "abc123.mp4").
    const ext = mimeToExtension(mime)

    // Build the storage path: "{userId}/{meetingId}.{ext}"
    // The RLS policy on storage.objects checks that the first path segment
    // matches the authenticated user's ID — this enforces ownership at the
    // database level, not just in our code.
    const audioPath = `${userId}/${meetingId}.${ext}`

    // ── Step 1: Upload to Supabase Storage ────────────────────────────────
    const { error: storageError } = await supabase.storage
      .from('meeting-audio')       // the name of our storage bucket
      .upload(audioPath, file, {
        contentType: mime,         // tells the storage server what type of file this is
        upsert: false,             // don't overwrite if the file already exists (it shouldn't)
      })

    if (storageError) {
      setUploadState('error')
      setError(storageError.message)
      return
    }

    setProgress(80) // update progress bar to 80% after upload completes

    // ── Step 2: Insert a row in the meetings table ─────────────────────────
    // We insert the row after the file is safely uploaded so we never have
    // a DB row pointing to a file that doesn't exist.
    const { error: dbError } = await supabase.from('meetings').insert({
      id:         meetingId,
      user_id:    userId,
      title:      file.name.replace(/\.[^.]+$/, '') || 'Untitled meeting', // strip file extension
      audio_path: audioPath,
      audio_mime: mime,
      status:     'pending', // initial status — the Edge Function will advance this
    })

    if (dbError) {
      setUploadState('error')
      setError(dbError.message)
      return
    }

    setProgress(90) // 90% — almost done

    // ── Step 3: Dispatch to the Edge Function ─────────────────────────────
    // We get the user's JWT token and include it in the Authorization header.
    // The Edge Function uses this token to verify who is making the request
    // and to re-derive the user_id on the server (never trusts our user_id).
    const { data: { session } } = await supabase.auth.getSession()
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-meeting`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`, // JWT for server-side auth
        },
        body: JSON.stringify({ meeting_id: meetingId }), // tell the function which meeting to process
      }
    )
    // Note: we don't check the response here. The Edge Function returns 202
    // (accepted) and runs in the background. If it fails, the Realtime
    // subscription in MeetingDetail will show the 'failed' status.

    setProgress(100)
    setUploadState('done')
    onUploaded(meetingId) // tell App.tsx to navigate to the detail view
  }

  /**
   * handleRecordingComplete
   * Called by the Recorder component when the user stops recording.
   * Wraps the Blob in a File object so handleFile() can work with it.
   */
  async function handleRecordingComplete(blob: Blob, mimeType: string) {
    const ext = mimeToExtension(mimeType)
    const file = new File([blob], `recording.${ext}`, { type: mimeType })
    await handleFile(file, mimeType)
  }

  /**
   * onDrop
   * Called when the user drops a file onto the drop zone.
   * useCallback memoises the function to avoid recreating it on every render.
   */
  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()      // prevent the browser from opening the file directly
    setDragging(false)
    const file = e.dataTransfer.files[0] // only handle the first dropped file
    if (file) handleFile(file)
  }, [userId]) // recreate if userId changes (in practice it never does after login)

  /**
   * onFileInput
   * Called when the user selects a file via the hidden <input type="file">.
   */
  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = '' // reset the input so the same file can be selected again
  }

  // ── Render: uploading state ───────────────────────────────────────────────
  // Show a progress bar while the upload is in progress.
  if (uploadState === 'uploading') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="mb-3 text-sm text-gray-600">Uploading…</p>
        {/* Progress bar: the inner div's width changes based on the progress state */}
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${progress}%` }} // inline style drives the animation
          />
        </div>
      </div>
    )
  }

  // ── Render: idle / error state ────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* The Recorder component for in-browser mic recording */}
      <Recorder onRecordingComplete={handleRecordingComplete} />

      {/* Drag-and-drop zone for uploading an existing file */}
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }} // highlight zone on drag-enter
        onDragLeave={() => setDragging(false)}                       // remove highlight on drag-exit
        onDrop={onDrop}                                               // handle the drop
        className={[
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-white', // change colour while dragging
        ].join(' ')}
      >
        <p className="mb-3 text-sm text-gray-600">
          Drag &amp; drop an audio file, or{' '}
          {/* The <label> wraps a hidden <input> — clicking the label text opens the file picker */}
          <label className="cursor-pointer text-indigo-600 underline-offset-2 hover:underline">
            browse
            <input
              type="file"
              accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/x-m4a" // filter shown file types
              onChange={onFileInput}
              className="sr-only" {/* visually hidden but still accessible */}
            />
          </label>
        </p>
        <p className="text-xs text-gray-400">.webm · .mp4 · .m4a · .mp3 · .wav — max 100 MB</p>
      </div>

      {/* Show validation or upload error if there is one */}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
