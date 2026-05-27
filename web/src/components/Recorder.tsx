import { useState, useRef } from 'react'
import { Button } from './ui/button'

interface RecorderProps {
  onRecordingComplete: (blob: Blob, mimeType: string) => void
}

function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type
  }
  return ''
}

function mimeToExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}

type RecordState = 'idle' | 'recording' | 'stopped'

export function Recorder({ onRecordingComplete }: RecorderProps) {
  const [state, setState] = useState<RecordState>('idle')
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState('')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  async function startRecording() {
    setError('')
    chunksRef.current = []
    setSeconds(0)

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('Microphone access denied. Please allow microphone access and try again.')
      return
    }
    streamRef.current = stream

    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }

    recorder.onstop = () => {
      const finalMime = recorder.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type: finalMime })
      onRecordingComplete(blob, finalMime)
      stream.getTracks().forEach(t => t.stop())
      setState('stopped')
    }

    recorder.start(250)
    setState('recording')

    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current)
    mediaRecorderRef.current?.stop()
  }

  function reset() {
    setState('idle')
    setSeconds(0)
    chunksRef.current = []
  }

  const mm = String(Math.floor(seconds / 60)).padStart(2, '0')
  const ss = String(seconds % 60).padStart(2, '0')

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm font-medium text-gray-700">Record audio</p>

      {state === 'recording' && (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="font-mono text-sm text-gray-600">{mm}:{ss}</span>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {state === 'idle' && (
          <Button onClick={startRecording}>Start recording</Button>
        )}
        {state === 'recording' && (
          <Button variant="destructive" onClick={stopRecording}>Stop</Button>
        )}
        {state === 'stopped' && (
          <>
            <span className="text-sm text-gray-500">Recording complete ({mm}:{ss})</span>
            <Button variant="ghost" size="sm" onClick={reset}>Record again</Button>
          </>
        )}
      </div>
    </div>
  )
}

export { mimeToExtension }
