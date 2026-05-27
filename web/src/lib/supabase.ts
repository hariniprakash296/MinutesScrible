/**
 * supabase.ts
 *
 * Creates and exports a single Supabase client that the entire frontend uses.
 * Supabase is the backend platform — it handles the database, file storage,
 * user authentication, and real-time updates all in one place.
 *
 * We only ever use the "anon key" here (the public key). It is safe to include
 * in the browser because Supabase's Row Level Security (RLS) rules on the
 * database ensure every user can only see and edit their own data, regardless
 * of which key they have.
 *
 * NEVER use the "service_role" key on the frontend — that key bypasses all
 * security rules and must stay in the server-side Edge Function only.
 */

import { createClient } from '@supabase/supabase-js'

// These values come from the .env.local file (which is not committed to git).
// "import.meta.env" is how Vite exposes environment variables to the browser.
const supabaseUrl     = import.meta.env.VITE_SUPABASE_URL as string      // e.g. https://xyz.supabase.co
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string // the public/anon API key

// createClient builds a configured Supabase client.
// We export it so any component can do: import { supabase } from '../lib/supabase'
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
