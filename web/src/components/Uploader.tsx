import { useState, useCallback } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { supabase } from '../lib/supabase'
import { Recorder, mimeToExtension } from './Recorder'
import { Button } from './ui/button'

const ALLOWED_TYPES = new Set([
  'audio/webm', 'audio/mp4', 'audio/mpeg',
  'audio/wav', 'audio/x-m4a', 'audio/ogg',
])

const MAX_BYTES = 100 * 1024 * 1024

interface UploaderProps {
  userId: string
  onUploaded: (meetingId: string) => void
}

type UploadState = 'idle' | 'uploading' | 'done' | 'error'

export function Uploader({ userId, onUploaded }: UploaderProps) {
  const [uploadState, setUploadState] = useState<UploadState>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)

  async function handleFile(file: File, mimeOverride?: string) {
    const mime = mimeOverride ?? file.type
    setError('')

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

    const meetingId = uuidv4()
    const ext = mimeToExtension(mime)
    const audioPath = `${userId}/${meetingId}.${ext}`

    const { error: storageError } = await supabase.storage
      .from('meeting-audio')
      .upload(audioPath, file, {
        contentType: mime,
        upsert: false,
      })

    if (storageError) {
      setUploadState('error')
      setError(storageError.message)
      return
    }

    setProgress(80)

    const { error: dbError } = await supabase.from('meetings').insert({
      id: meetingId,
      user_id: userId,
      title: file.name.replace(/\.[^.]+$/, '') || 'Untitled meeting',
      audio_path: audioPath,
      audio_mime: mime,
      status: 'pending',
    })

    if (dbError) {
      setUploadState('error')
      setError(dbError.message)
      return
    }

    setProgress(90)

    const { data: { session } } = await supabase.auth.getSession()
    await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/process-meeting`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token ?? ''}`,
        },
        body: JSON.stringify({ meeting_id: meetingId }),
      }
    )

    setProgress(100)
    setUploadState('done')
    onUploaded(meetingId)
  }

  async function handleRecordingComplete(blob: Blob, mimeType: string) {
    const ext = mimeToExtension(mimeType)
    const file = new File([blob], `recording.${ext}`, { type: mimeType })
    await handleFile(file, mimeType)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }, [userId])

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ''
  }

  if (uploadState === 'uploading') {
    return (
      <div className="rounded-xl border border-gray-200 bg-white p-6 text-center">
        <p className="mb-3 text-sm text-gray-600">Uploading…</p>
        <div className="h-2 w-full overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-2 rounded-full bg-indigo-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <Recorder onRecordingComplete={handleRecordingComplete} />

      <div
        onDragOver={e => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={[
          'rounded-xl border-2 border-dashed p-8 text-center transition-colors',
          dragging ? 'border-indigo-400 bg-indigo-50' : 'border-gray-300 bg-white',
        ].join(' ')}
      >
        <p className="mb-3 text-sm text-gray-600">
          Drag &amp; drop an audio file, or{' '}
          <label className="cursor-pointer text-indigo-600 underline-offset-2 hover:underline">
            browse
            <input
              type="file"
              accept="audio/webm,audio/mp4,audio/mpeg,audio/wav,audio/x-m4a"
              onChange={onFileInput}
              className="sr-only"
            />
          </label>
        </p>
        <p className="text-xs text-gray-400">.webm · .mp4 · .m4a · .mp3 · .wav — max 100 MB</p>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
