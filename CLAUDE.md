# MeetAssist — Engineer Handoff

**Project:** AI meeting recorder → structured minutes, Jira stories, Mermaid diagrams
**Repo:** https://github.com/hariniprakash296/MinutesScrible.git
**Local path:** `C:\Users\harin\Documents\MeetAssist`
**PRD:** `PRD_MeetAssist.md` (single source of truth — read it before touching anything)
**Architecture:** `Architecture.md` (C4 model, feature outcomes, build status — updated after every block)
**Last updated:** 2026-05-27 · Block 3 complete

---

## Standing Instructions

**After every completed block AND every session end:**
1. Update the `## Build Status` table in `Architecture.md` — mark the block ✅ and list files produced.
2. Update `## File Map` in `Architecture.md` if new files were created.
3. Update the `## Current State` table in this file.
4. Update `## Next Steps` in this file to reflect what remains.

---

## Current State

| Area | Status |
|---|---|
| Repo cloned and git working | ✅ |
| Project outside OneDrive | ✅ |
| Node.js | ✅ v20.18.0 |
| Supabase CLI | ✅ v2.101.0 |
| Supabase CLI linked to project | ✅ (`supabase link --project-ref yadwltjglssriejfjuzx`) |
| API secrets in Supabase vault | ✅ (`DEEPGRAM_API_KEY`, `OPENAI_API_KEY`) |
| Magic-link redirect URLs | ✅ done per PRD §8.4 |
| Supabase project provisioned | ✅ (URL + anon key in PRD §8.1) |
| Vite + React scaffold (`web/`) | ✅ created, deps installed |
| Tailwind + PostCSS configured | ✅ |
| `supabase/migrations/0001_init.sql` | ✅ written and pushed |
| `meetings` table + RLS | ✅ live on remote DB |
| `meeting-audio` storage bucket | ✅ created via migration |
| Realtime enabled on `meetings` | ✅ |
| `web/.env.local` | ✅ anon key + URL set |
| `web/src/lib/supabase.ts` | ✅ |
| `components/AuthGate.tsx` (magic-link sign-in + session guard) | ✅ |
| `components/Recorder.tsx` (MediaRecorder + MIME negotiation) | ✅ |
| `components/Uploader.tsx` (TUS upload + DB insert + Edge Function dispatch) | ✅ |
| `components/ui/button.tsx` | ✅ |
| `App.tsx` (route shell: list / new / detail views) | ✅ |
| Edge Function code | ⏳ Block 4 |
| `MeetingList`, `MeetingDetail`, `ui/tabs`, `ui/card` | ⏳ Block 5 |

---

## Key Decisions

**No MCP servers.**
The PRD assumes `filesystem`, `sequential-thinking`, and `supabase` MCP servers. Proceeding with Claude's built-in tools (Read/Write/Edit/PowerShell) and explicit CLI commands at each block boundary. This covers 100% of what those MCP servers would do.

**Project location: `C:\Users\harin\Documents\MeetAssist` (outside OneDrive).**
PRD explicitly warns against OneDrive + node_modules. OneDrive may still show a phantom placeholder folder — ignore it.

**shadcn/ui primitives: hand-written.**
PRD §4.2 file list includes only `button.tsx`, `tabs.tsx`, `card.tsx` — small enough to write by hand. No shadcn CLI invocation needed.

**Architecture.md as living document.**
Added `Architecture.md` with C4 model (Context, Container, Component levels), security model, data model, key flows, and build status. Updated after every block.

---

## Rejected Approaches

**Staying in OneDrive:** OneDrive locks `.git` subdirectory files. node_modules would be worse.

**MCP-first approach:** Adds setup time with no code payoff. CLI commands are more transparent.

**Regex JSON cleaners:** Banned by PRD. If LLM output is invalid, re-check `strict:true` and schema match.

---

## Next Steps

### ~~Block 2 — Auth + Capture UI~~ ✅ Done

### ~~Block 3 — JSON Schema + lib plumbing~~ ✅ Done

### Block 4 — Edge Function [01:10–01:35]

- `supabase/functions/_shared/cors.ts`
- `supabase/functions/process-meeting/index.ts`
- `supabase/functions/process-meeting/deepgram.ts`
- `supabase/functions/process-meeting/llm.ts`
- Run: `supabase functions deploy process-meeting`

### Block 5 — Results UI + exports [01:35–02:00]

- `web/src/components/MeetingList.tsx`
- `web/src/components/MeetingDetail.tsx` (3 tabs + Realtime)
- `web/src/components/ui/tabs.tsx`
- `web/src/components/ui/card.tsx`
- `README.md` (final)
- End-to-end smoke test

---

## Open Questions

- **Safari `MediaRecorder` MIME:** PRD notes MIME negotiation (`webm/opus` → `mp4`). `Recorder.tsx` must check `MediaRecorder.isTypeSupported()` and fall back. Do not skip.
- **OneDrive phantom folder:** `C:\Users\harin\OneDrive\Documents\MeetAssist` may still appear in Explorer as a ghost. It has no real contents — ignore it.

---

## Environment & Conventions

**Runtime:**
- Windows 11 Pro, PowerShell 5.1, Node v20.18.0
- Supabase CLI: v2.101.0
- Working directory for all commands: `C:\Users\harin\Documents\MeetAssist`

**Supabase project:**
- Project ref: `yadwltjglssriejfjuzx`
- URL: `https://yadwltjglssriejfjuzx.supabase.co`
- Anon key: `sb_publishable_rp45xPGsaokWVo3dCShrHQ_OlygqA7k` (safe to commit)
- Service role: in password manager — never in code, never in `.env*`, never logged

**Security invariants (non-negotiable, from PRD §2.3):**
- Browser only sees `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL`
- `service_role` key ONLY in Supabase vault
- Every Edge Function validates JWT and re-derives `user_id` — never trust client-supplied `user_id`
- Signed URLs are 5-min TTL, generated server-side, never logged

**Code conventions (from PRD):**
- `schema.ts` is the single source of truth for the JSON schema — never duplicate it
- No `console.log` in Edge Functions — use `supabase functions logs process-meeting` to debug
- No regex JSON cleaners — if LLM output is invalid, find out why `strict:true` isn't working
- SheetJS `sanitizeCell()` must wrap every LLM string before it hits a spreadsheet cell
- `Issue Type` is hardcoded to `"Story"` in the export — never sourced from LLM output

**Stack (locked per PRD §0):**
- Frontend: Vite + React 18 + TypeScript + Tailwind + shadcn/ui
- Backend: Supabase (Postgres + Storage + Edge Functions on Deno)
- Transcription: Deepgram Nova-2 only
- LLM: OpenAI `gpt-4o-mini` with `response_format: { type: "json_schema", strict: true }`
- Excel: SheetJS (`xlsx`) client-side
- Diagrams: `mermaid` v10 browser-side

**What is explicitly banned (PRD §0):** Next.js, server actions, custom queueing, Redis, Lambda, `service_role` on client, any non-Supabase auth.
