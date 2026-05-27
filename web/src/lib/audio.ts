/**
 * audio.ts
 *
 * Utility functions for audio format detection and naming.
 * Kept in lib/ (not inside a component file) because ESLint's react-refresh
 * rule requires component files to export only React components — exporting
 * plain functions from a component file breaks Hot Module Replacement (HMR).
 */

/**
 * getSupportedMimeType
 *
 * Tests a list of audio MIME types in order of preference and returns the
 * first one the current browser supports. Falls back to an empty string if
 * none match, in which case the browser uses its own default.
 *
 * Priority order:
 *   1. webm/opus  — best quality; Chrome and Firefox
 *   2. webm       — Chrome/Firefox fallback without specifying codec
 *   3. mp4        — Safari (iOS and macOS require this)
 *   4. ogg/opus   — older Firefox fallback
 */
export function getSupportedMimeType(): string {
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

/**
 * mimeToExtension
 *
 * Converts a MIME type string to the matching file extension.
 * Used when naming uploaded audio files, e.g. "recording.mp4".
 */
export function mimeToExtension(mime: string): string {
  if (mime.includes('mp4')) return 'mp4'
  if (mime.includes('ogg')) return 'ogg'
  return 'webm'
}
