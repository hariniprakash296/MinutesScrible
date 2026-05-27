/**
 * cors.ts  (_shared)
 *
 * CORS stands for Cross-Origin Resource Sharing. It's a browser security
 * mechanism that blocks JavaScript from one domain making requests to a
 * different domain — unless the server explicitly says it's allowed.
 *
 * Our frontend runs on http://localhost:5173 (development) and our Edge
 * Functions run on https://yadwltjglssriejfjuzx.supabase.co — those are
 * different origins, so the browser will block requests unless we include
 * the right headers in every response.
 *
 * Why the OPTIONS method?
 * Before a browser sends a POST request to a different origin, it first
 * sends a "preflight" OPTIONS request asking "are you allowed to receive
 * this?" The server must respond to OPTIONS with the CORS headers, or the
 * browser will refuse to send the real request.
 *
 * We put these headers in a shared file so every Edge Function can import
 * and use the same set without duplicating them.
 */

export const corsHeaders = {
  // Allow requests from any origin. In production you could restrict this to
  // your actual frontend URL, but for an MVP "any origin" is acceptable.
  'Access-Control-Allow-Origin': '*',

  // List of headers the browser is allowed to include in requests.
  // "authorization" carries the JWT token. "apikey" is Supabase's header.
  // "content-type" lets us send JSON bodies.
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',

  // Only allow POST (our actual request) and OPTIONS (the preflight check).
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
