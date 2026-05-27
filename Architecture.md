# MeetAssist — Architecture

> **Living document.** Updated after every build block and session.
> Last updated: 2026-05-27 · Block 4 complete.

---

## 1. Project Overview

**MeetAssist** turns raw meeting audio into structured, actionable output — formatted minutes, Jira-ready stories, and Mermaid diagrams — with no manual editing. A user records or uploads audio; an async pipeline transcribes it with Deepgram and extracts structure with OpenAI; the results appear in the browser via Supabase Realtime.

**Five user-visible features (MVP only):**

| # | Feature | Outcome delivered |
|---|---|---|
| 1 | **Auth** | Email magic-link sign-in — no passwords, no signup friction |
| 2 | **Capture** | Record in-browser or drag-and-drop a file — audio is uploaded to private cloud storage |
| 3 | **Process** | Async transcription + LLM extraction triggered on upload — UI returns immediately, no spinner block |
| 4 | **Watch** | Live status bar (pending → transcribing → analysing → done/failed) via Realtime — user always knows where their meeting is |
| 5 | **Export** | Three tabs: human-readable Minutes, Jira .xlsx download, and rendered Mermaid diagrams with .svg export |

---

## 2. C4 Level 1 — System Context

Who uses the system and what external services it depends on.

```
                        ┌────────────────────────────┐
                        │         MeetAssist         │
                        │   (browser + Supabase)     │
                        └────────────┬───────────────┘
                                     │
             ┌───────────────────────┼──────────────────────┐
             │                       │                      │
    ┌────────▼────────┐   ┌──────────▼──────────┐  ┌───────▼───────┐
    │   Deepgram API  │   │    OpenAI API        │  │  Supabase     │
    │  (Nova-2 STT)   │   │  (gpt-4o-mini,       │  │  Auth         │
    │                 │   │   json_schema strict) │  │  (magic-link) │
    └─────────────────┘   └─────────────────────-┘  └───────────────┘

Actors:
  [User]  ──browser──►  MeetAssist
```

| Actor / System | Role |
|---|---|
| **User** | Authenticated via Supabase magic-link. Records or uploads meeting audio. Views results and downloads exports. |
| **Supabase Auth** | Issues JWTs via magic-link email. No passwords stored. |
| **Deepgram Nova-2** | Transcription-as-a-service. Called via signed URL — the Edge Function never buffers the audio file. |
| **OpenAI gpt-4o-mini** | Structured extraction via `response_format: json_schema, strict: true`. Grammar-constrained — cannot produce schema-violating JSON. |

---

## 3. C4 Level 2 — Containers

The major deployable/runnable units.

```
  Browser (Vite + React 18)              Supabase Platform
  ┌──────────────────────────┐           ┌───────────────────────────────────────┐
  │                          │           │                                       │
  │  ┌────────────────────┐  │  HTTPS    │  ┌─────────────────────────────────┐  │
  │  │   React SPA        │◄─┼───────────┼─►│  Edge Function                  │  │
  │  │  (static bundle,   │  │           │  │  process-meeting  (Deno runtime) │  │
  │  │   no SSR)          │  │           │  └────────────┬────────────────────┘  │
  │  └────────┬───────────┘  │           │               │                       │
  │           │ supabase-js  │           │  ┌────────────▼───────────────────┐   │
  │           │ Realtime WS  │           │  │  Postgres DB                   │   │
  │           │              │           │  │  public.meetings  (RLS on)     │   │
  │  ┌────────▼───────────┐  │           │  └────────────────────────────────┘   │
  │  │  SheetJS (.xlsx)   │  │           │                                       │
  │  │  Mermaid (SVG)     │  │           │  ┌─────────────────────────────────┐  │
  │  └────────────────────┘  │           │  │  Storage bucket: meeting-audio  │  │
  └──────────────────────────┘           │  │  (private, RLS on, TUS upload)  │  │
                                         │  └─────────────────────────────────┘  │
                                         │                                       │
                                         │  ┌─────────────────────────────────┐  │
                                         │  │  Supabase Auth (magic-link JWT) │  │
                                         │  └─────────────────────────────────┘  │
                                         └───────────────────────────────────────┘
```

| Container | Technology | Responsibility |
|---|---|---|
| **React SPA** | Vite + React 18 + TypeScript + Tailwind | All UI. Ships as a static bundle. Talks to Supabase via `supabase-js`. |
| **Edge Function** `process-meeting` | Deno (Supabase Edge Runtime) | JWT-validated async pipeline: signed URL → Deepgram → OpenAI → DB write. Returns 202 immediately. |
| **Postgres DB** | Supabase Postgres 15 | `meetings` table with RLS. Source of truth for meeting state and results. |
| **Storage bucket** `meeting-audio` | Supabase Storage (S3-compatible, TUS) | Private audio files. Path schema: `{user_id}/{meeting_id}.{ext}`. RLS matches path prefix to JWT. |
| **Supabase Auth** | GoTrue | Magic-link emails. Issues JWTs consumed by RLS and Edge Function. |

---

## 4. C4 Level 3 — Components

### 4.1 React SPA internals

```
src/
├── main.tsx              Entry point — mounts App
├── App.tsx               Route shell — AuthGate wraps everything
├── lib/
│   ├── supabase.ts       Single supabase-js client (anon key only)
│   ├── types.ts          Zod schemas + TS types mirroring §3.2 of PRD
│   ├── jiraExport.ts     SheetJS download — sanitizeCell() on every LLM string
│   └── mermaidRender.ts  mermaid.parse() + safe render + fallback diagram
└── components/
    ├── AuthGate.tsx       Magic-link form; shows children only when session exists
    ├── Recorder.tsx       MediaRecorder with MIME negotiation (webm → mp4 for Safari)
    ├── Uploader.tsx       Resumable TUS upload → DB insert → POST to Edge Function
    ├── MeetingList.tsx    Last 20 meetings, ordered by created_at desc
    ├── MeetingDetail.tsx  Realtime subscription; 3 tabs: Minutes / Jira / Diagrams
    └── ui/
        ├── button.tsx     shadcn-style primitive
        ├── tabs.tsx       shadcn-style primitive
        └── card.tsx       shadcn-style primitive
```

### 4.2 Edge Function `process-meeting` internals

```
supabase/functions/process-meeting/
├── index.ts      JWT verify → 202 response → EdgeRuntime.waitUntil(background)
├── deepgram.ts   POST { url, model: 'nova-2', smart_format, diarize, redact }
├── llm.ts        OpenAI call with json_schema strict + Zod defensive re-validation
└── schema.ts     THE single source of truth for the JSON schema (imported by llm.ts)

supabase/functions/_shared/
└── cors.ts       CORS headers shared across all functions
```

---

## 5. Key Request Flows

### 5.1 Upload + Trigger

```
User picks file
     │
     ▼
Uploader.tsx
  supabase.storage.upload(
    'meeting-audio/{user_id}/{meeting_id}.ext',
    { upsert: false, contentType, duplex: 'half' }   ← TUS resumable
  )
     │ on complete
     ▼
  supabase.from('meetings').insert({
    user_id, title, audio_path, audio_mime, status: 'pending'
  })
     │
     ▼
  fetch('/functions/v1/process-meeting', { method: 'POST',
    body: { meeting_id }, headers: { Authorization: 'Bearer <jwt>' }
  })
     │
     ▼
Edge Function index.ts
  → validate JWT → verify meeting.user_id matches
  → respond 202 immediately
  → EdgeRuntime.waitUntil(processInBackground())
```

### 5.2 Async pipeline (inside `waitUntil`)

```
status = 'transcribing'
     │
     ▼
createSignedUrl(audio_path, 300s)
     │
     ▼
Deepgram Nova-2
  POST { url: signedUrl, model: 'nova-2', smart_format: true,
         diarize: true, redact: ['pci','ssn'], mip_opt_out: true }
     │
     ▼
UPDATE meetings SET transcript = ..., status = 'analysing'
     │
     ▼
OpenAI gpt-4o-mini
  response_format: { type: 'json_schema', strict: true, schema }
  temperature: 0.1
     │
     ▼
Zod re-validate (belt-and-braces — strict mode makes this nearly impossible to fail)
     │
     ▼
validateMermaid() on each diagram string
     │
     ▼
UPDATE meetings SET result_json = ..., status = 'done'
  (on any throw → status = 'failed', error_message = ...)
```

### 5.3 Realtime status watch

```
MeetingDetail.tsx
  supabase
    .channel('meeting:<id>')
    .on('postgres_changes', {
        event: 'UPDATE', schema: 'public',
        table: 'meetings', filter: 'id=eq.<id>'
      }, handler)
    .subscribe()

  Status bar updates: pending → transcribing → analysing → done | failed
  On 'done': result_json arrives in the payload → tabs render immediately
```

---

## 6. Data Model

```sql
-- Enum
meeting_status: 'pending' | 'transcribing' | 'analysing' | 'done' | 'failed'

-- Table: public.meetings
id            uuid  PK  default gen_random_uuid()
user_id       uuid  FK → auth.users(id)  ON DELETE CASCADE
title         text  default 'Untitled meeting'
audio_path    text  -- '{user_id}/{meeting_id}.{ext}'
audio_mime    text
duration_sec  integer
status        meeting_status  default 'pending'
error_message text
transcript    text  -- raw Deepgram output (PII — never logged)
result_json   jsonb -- validated LLM output (see JSON schema below)
created_at    timestamptz
updated_at    timestamptz  -- auto-updated by trigger

-- Indexes
meetings_user_id_created_at_idx  (user_id, created_at DESC)
```

### result_json shape

```
{
  minutes: {
    title, date (YYYY-MM-DD), attendees[], agenda[],
    decisions[], action_items[{ owner, task, due_date }], summary
  },
  jira_stories: [{ Summary, Description, "Issue Type": "Story", "Epic Link" }],
  diagrams: [{ title, type: "flowchart TD|LR|sequenceDiagram", mermaid }]
}
```

---

## 7. Security Model

| Invariant | Where enforced |
|---|---|
| Browser only sees `anon` key + URL | `web/.env.local`, Vite build |
| `service_role` only in Supabase vault | Never in repo, `.env*`, or logs |
| Every Edge Function validates JWT | `verify_jwt = true` in `supabase/config.toml`; `auth.getUser(jwt)` in `index.ts` |
| Edge Function re-derives `user_id` from JWT | Never trusts client-supplied `user_id` |
| RLS on `meetings` table | All four operations (SELECT / INSERT / UPDATE / DELETE) scoped to `auth.uid() = user_id` |
| RLS on `meeting-audio` storage | Path prefix `(storage.foldername(name))[1]` must equal `auth.uid()::text` |
| Signed URLs are 300s TTL | Generated server-side in Edge Function, never logged, never sent to analytics |
| No transcript logging | Logs contain only `meeting_id` + `status` |
| SheetJS `sanitizeCell()` | Strips newlines and ASCII control chars from every LLM string before writing to `.xlsx` |
| `Issue Type` hardcoded to `"Story"` | Never sourced from LLM output in `jiraExport.ts` |

---

## 8. Infrastructure & Deployment

| Layer | Platform | Notes |
|---|---|---|
| Frontend hosting | Supabase Static Hosting (or any CDN) | `vite build` → `web/dist/` → deploy |
| Edge Functions | Supabase Edge Runtime (Deno) | Deployed via `supabase functions deploy process-meeting` |
| Database | Supabase Postgres 15 | Managed, no ops burden |
| Storage | Supabase Storage (S3-compatible) | `meeting-audio` bucket, private, 100 MB limit |
| Auth | Supabase GoTrue | Magic-link; redirect URL: `http://localhost:5173` (dev) |
| Secrets | Supabase Vault | `DEEPGRAM_API_KEY`, `OPENAI_API_KEY`; `SUPABASE_SERVICE_ROLE_KEY` auto-injected |

---

## 9. Build Status

Tracks which blocks from the PRD §5 execution timeline are complete.

| Block | Scope | Status | Files produced |
|---|---|---|---|
| **Pre-Block 1** | Supabase CLI install, login, link, secrets | ✅ Done | — |
| **Block 1** | Foundations: Vite scaffold, deps, Tailwind, migration, env | ✅ Done | `web/` scaffold, `tailwind.config.js`, `postcss.config.js`, `web/src/index.css`, `web/.env.local`, `web/.env.example`, `supabase/migrations/0001_init.sql` |
| **Block 2** | Auth + Capture UI (`AuthGate`, `Recorder`, `Uploader`) | ✅ Done | `lib/supabase.ts`, `components/AuthGate.tsx`, `components/Recorder.tsx`, `components/Uploader.tsx`, `components/ui/button.tsx`, `App.tsx` |
| **Block 3** | JSON schema, LLM types, SheetJS, Mermaid plumbing | ✅ Done | `lib/types.ts`, `lib/jiraExport.ts`, `lib/mermaidRender.ts`, `functions/process-meeting/schema.ts` |
| **Block 4** | Edge Function async pipeline | ✅ Done | `functions/_shared/cors.ts`, `functions/process-meeting/index.ts`, `functions/process-meeting/deepgram.ts`, `functions/process-meeting/llm.ts` — deployed to Supabase |
| **Block 5** | Results UI, Realtime, exports | ⬜ Pending | — |

---

## 10. File Map

```
C:\Users\harin\Documents\MeetAssist\
├── PRD_MeetAssist.md               Single source of truth — read before touching anything
├── CLAUDE.md                       Engineer handoff + session notes
├── Architecture.md                 This file — updated after every block
├── README.md                       (placeholder — overwritten at Block 5)
├── web/                            Vite + React 18 SPA
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── index.html
│   ├── .env.example                Safe to commit (template only)
│   ├── .env.local                  Gitignored — real anon key + URL
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── index.css               Tailwind directives
│       ├── lib/                    (Block 2–3)
│       └── components/             (Block 2–5)
└── supabase/
    ├── config.toml                 verify_jwt = true for Edge Functions
    ├── migrations/
    │   └── 0001_init.sql           Applied ✅ — meetings table, RLS, bucket, Realtime
    └── functions/
        ├── _shared/                (Block 4)
        └── process-meeting/        (Block 4)
```

---

## 11. Glossary

| Term | Meaning |
|---|---|
| **RLS** | Row Level Security — Postgres policy that gates every query to the authenticated user's own rows |
| **TUS** | Tus resumable upload protocol — used by Supabase Storage to handle large files and network interruptions |
| **Edge Function** | Deno-based serverless function running on Supabase's edge network |
| **waitUntil** | `EdgeRuntime.waitUntil(promise)` — lets a Deno Edge Function continue work after the HTTP response is sent |
| **json_schema strict** | OpenAI `response_format` mode that applies grammar-constrained decoding — the model is structurally incapable of producing schema-violating output |
| **Magic-link** | Passwordless auth — Supabase emails a one-time login URL; clicking it sets a JWT session cookie |
| **Signed URL** | Time-limited (300s) pre-authorised URL for a private storage object — generated server-side, passed to Deepgram |
| **sanitizeCell** | Helper in `jiraExport.ts` that strips newlines and control chars from any LLM string before writing to `.xlsx` |
