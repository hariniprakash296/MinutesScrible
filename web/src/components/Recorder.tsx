/**
 * Recorder.tsx
 *
 * Provides an in-browser audio recorder using the browser's built-in
 * MediaRecorder API. The user clicks "Start recording", speaks, then clicks
 * "Stop" — the component collects the audio chunks and passes the final
 * Blob (binary audio data) to the parent component.
 *
 * Cross-browser MIME type challenge:
 * Different browsers support different audio formats:
 *   - Chrome/Firefox: prefer "audio/webm;codecs=opus" (excellent quality)
 *   - Safari (iOS/macOS): only supports "audio/mp4"
 * getSupportedMimeType() tests each format in order and picks the first one
 * the current browser supports, so recording works on all major browsers.
 *
 * The Blob produced here is passed to the Uploader component, which uploads
 * it to Supabase Storage and triggers AI processing.
 */

import { useState, useRef } from 'react'
import { Button } from './ui/button'

// RecorderProps defines what the parent component must provide.
interface RecorderProps {
  // Called when recording is stopped — passes the audio data and its MIME type.
  onRecordingComplete: (blob: Blob, mimeType: string) => void
}

/**
 * getSupportedMimeType
 *
 * Tries a list of audio formats in order of preference and returns the first
 * one the browser supports. Falls back to an empty string if none match,
 * in which case the browser uses its own default format.
 */
function getSupportedMimeType(): string {
  const types = [
    'audio/webm;codecs=opus', // best quality, supported by Chrome and Firefox
    'audio/webm',             // fallback webm without specifying codec
    'audio/mp4',              // Safari's format
    'audio/ogg;codecs=opus',  // older Firefox fallback
  ]
  for (const type of types) {
    if (MediaRecorder.isTypeSupported(type)) return type // return the first supported type
  }
  return '' // no match — let the browser decide
}

/**
 * mimeToExtension
 *
 * Converts a MIME type string to a file extension.
 * Used when naming the uploaded file (e.g. "recording.mp4").
 */
function mimeToExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm' // default
}

// RecordState tracks what the recorder is currently doing.
type RecordState = 'idle' | 'recording' | 'stopped'

export function Recorder({ onRecordingComplete }: RecorderProps) {
  // state — current phase of the recorder (idle, recording, or stopped)
  const [state, setState] = useState<RecordState>('idle')

  // seconds — how many seconds the recording has been running (shown as a timer)
  const [seconds, setSeconds] = useState(0)

  // error — a message shown if microphone access is denied or unavailable
  const [error, setError] = useState('')

  // useRef stores values that should persist between renders but NOT trigger
  // a re-render when they change (unlike useState). Perfect for the MediaRecorder
  // object, audio chunks, and the timer interval.
  const mediaRecorderRef = useRef<MediaRecorder | null>(null) // the active MediaRecorder instance
  const chunksRef = useRef<Blob[]>([])                        // audio data chunks collected during recording
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null) // the setInterval ID for the timer
  const streamRef = useRef<MediaStream | null>(null)          // the microphone stream (needed to stop it)

  /**
   * startRecording
   * Requests microphone access, creates a MediaRecorder, and begins capturing audio.
   */
  async function startRecording() {
    setError('')          // clear any previous error
    chunksRef.current = [] // reset audio chunks from any previous recording
    setSeconds(0)          // reset the timer display

    // Ask the browser for access to the microphone.
    // This triggers the permission popup the user has to click "Allow" on.
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      // If the user clicks "Deny" or no microphone is found, show an error.
      setError('Microphone access denied. Please allow microphone access and try again.')
      return
    }
    streamRef.current = stream // save the stream so we can stop it later

    // Create a MediaRecorder with the best supported format for this browser.
    const mimeType = getSupportedMimeType()
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    mediaRecorderRef.current = recorder

    // ondataavailable is called every 250ms (see recorder.start(250) below).
    // Each call gives us a Blob chunk of audio data which we collect in chunksRef.
    recorder.ondataavailable = e => {
      if (e.data.size > 0) chunksRef.current.push(e.data) // only add non-empty chunks
    }

    // onstop is called when recorder.stop() is called.
    // We combine all the chunks into one Blob and pass it to the parent.
    recorder.onstop = () => {
      const finalMime = recorder.mimeType || mimeType || 'audio/webm' // use actual mime if available
      const blob = new Blob(chunksRef.current, { type: finalMime })   // combine all audio chunks
      onRecordingComplete(blob, finalMime)  // tell the parent component the recording is done
      stream.getTracks().forEach(t => t.stop()) // release the microphone
      setState('stopped')
    }

    // Start recording, emitting a data chunk every 250 milliseconds.
    // Smaller intervals mean less data is lost if the browser crashes.
    recorder.start(250)
    setState('recording')

    // Start the visual timer — increments the seconds counter every 1000ms.
    timerRef.current = setInterval(() => setSeconds(s => s + 1), 1000)
  }

  /**
   * stopRecording
   * Stops the recorder. The onstop handler above fires and delivers the audio.
   */
  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current) // stop the timer
    mediaRecorderRef.current?.stop()                       // stop the MediaRecorder
  }

  /**
   * reset
   * Returns the component to its idle state so the user can record again.
   */
  function reset() {
    setState('idle')
    setSeconds(0)
    chunksRef.current = []
  }

  // Format seconds as MM:SS for the timer display, e.g. "01:45"
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0') // minutes, zero-padded
  const ss = String(seconds % 60).padStart(2, '0')             // seconds, zero-padded

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm font-medium text-gray-700">Record audio</p>

      {/* Show the timer with a pulsing red dot while recording */}
      {state === 'recording' && (
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" /> {/* blinking dot */}
          <span className="font-mono text-sm text-gray-600">{mm}:{ss}</span>     {/* elapsed time */}
        </div>
      )}

      {/* Show error if microphone access was denied */}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        {/* Show Start button when idle */}
        {state === 'idle' && (
          <Button onClick={startRecording}>Start recording</Button>
        )}
        {/* Show Stop button while recording */}
        {state === 'recording' && (
          <Button variant="destructive" onClick={stopRecording}>Stop</Button>
        )}
        {/* Show completion message and Reset option after stopping */}
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

// Export the helper so Uploader.tsx can use it to determine the file extension.
export { mimeToExtension }
