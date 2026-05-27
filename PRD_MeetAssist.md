# MeetAssist — Accelerated PRD (YOLO Build, 2-Hour Coding Block)

**Document owner:** Principal Product Architect
**Status:** Execution-ready. Lock the scope, do not negotiate with the LLM.
**Last revised:** 2026-05-24
**Build window:** 2 hours of coding, inside a 4.5-hour total session (the remaining 2.5h is research, framework, deploy, and demo).

---

## 0. Non-Negotiable Architectural Mandate

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind + shadcn/ui | Static build, no SSR surface, ships to Supabase Static Hosting or any CDN |
| Backend | Supabase (Postgres + Storage + Edge Functions on Deno) | One vendor, RLS for free, signed URLs, Realtime, secrets vault |
| Transcription | Deepgram Nova-2 (only — no fallback in MVP) | Deepgram accepts a `url` param → Edge Function never buffers audio |
| LLM | **OpenAI `gpt-4o-mini`** via `https://api.openai.com/v1/chat/completions` with `response_format: { type: "json_schema", strict: true }` | Grammar-constrained decoding makes schema-violating output structurally impossible. ~$0.006 per 60-min meeting. |
| Excel export | SheetJS (`xlsx`) on the client | Binary `.xlsx` output sidesteps CSV escaping disasters |
| Diagrams | `mermaid` v10 npm package, browser-side render | `mermaid.parse()` for pre-validation |
| Banned | Next.js, server actions, custom queueing, Redis, Lambda, `service_role` on the client, any non-Supabase auth | Increases scope, kills the 2h window |

---

## 1. Core MVP Scope (validated by First Principles)

Exactly **five user-visible features**. Anything else is post-MVP.

1. **Auth.** Email magic-link sign-in via Supabase Auth. No password UI, no signup flow, no profile page.
2. **Capture.** Single page with two affordances: (a) in-browser record via `MediaRecorder`, (b) drag-and-drop file upload (`.webm`, `.mp4`, `.m4a`, `.mp3`, `.wav`). Resumable upload via `supabase.storage.from().upload(..., { upsert: false, contentType, duplex: 'half' })` using the TUS-backed path.
3. **Process.** On upload completion, frontend `POST`s to `/functions/v1/process-meeting` with `{ meeting_id }`. The function returns `202 Accepted` immediately. Background task runs Deepgram → LLM → DB write.
4. **Watch.** UI subscribes to the `meetings` row via Supabase Realtime. Status transitions: `pending → transcribing → analysing → done | failed`.
5. **Export.** When `status='done'`, the results screen shows three tabs:
   - **Minutes** — rendered from JSON, copy-to-clipboard button.
   - **Jira Stories** — preview table, "Download .xlsx" button (SheetJS).
   - **Diagrams** — Mermaid renders in-browser, "Download .svg" button.

**Explicit out of scope (write this on the wall):** team sharing, comments, Jira API integration (export is file-based only), Slack/email delivery, billing, settings, profile, history pagination (last 20 meetings only, no search), mobile-optimised CSS (desktop-first), iOS Safari background recording.

---

## 2. Database & Storage Schema

### 2.1 PostgreSQL DDL (apply via Supabase SQL editor or `supabase/migrations/0001_init.sql`)

```sql
-- ============================================================
-- MeetAssist initial schema
-- ============================================================

-- Use the built-in auth.users from Supabase. No custom users table.

create type meeting_status as enum (
  'pending',
  'transcribing',
  'analysing',
  'done',
  'failed'
);

create table public.meetings (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  title           text not null default 'Untitled meeting',
  audio_path      text not null,                -- e.g. "<user_id>/<meeting_id>.webm"
  audio_mime      text not null,
  duration_sec    integer,
  status          meeting_status not null default 'pending',
  error_message   text,
  transcript      text,                         -- raw Deepgram text
  result_json     jsonb,                        -- validated LLM output (see §3.2)
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index meetings_user_id_created_at_idx
  on public.meetings (user_id, created_at desc);

-- Auto-update updated_at
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.tg_set_updated_at();

-- ============================================================
-- Row Level Security
-- ============================================================

alter table public.meetings enable row level security;

-- A user can SELECT only their own meetings
create policy "meetings_select_own"
  on public.meetings for select
  using (auth.uid() = user_id);

-- A user can INSERT only with their own user_id
create policy "meetings_insert_own"
  on public.meetings for insert
  with check (auth.uid() = user_id);

-- A user can UPDATE only their own meetings, and cannot change user_id
create policy "meetings_update_own"
  on public.meetings for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- A user can DELETE only their own meetings
create policy "meetings_delete_own"
  on public.meetings for delete
  using (auth.uid() = user_id);

-- NOTE: the Edge Function uses the service_role key to update transcript/result_json.
-- service_role bypasses RLS by design. The function MUST re-derive user_id from
-- the JWT supplied in the Authorization header and validate that user_id matches
-- the row before writing. See §3.1.

-- ============================================================
-- Storage bucket: meeting-audio
-- ============================================================
-- Run via Supabase dashboard or SQL:
insert into storage.buckets (id, name, public)
values ('meeting-audio', 'meeting-audio', false)
on conflict (id) do nothing;

-- Path schema enforced by RLS: "<user_id>/<filename>"
-- (storage.foldername(name))[1] returns the first path segment.

create policy "audio_select_own"
  on storage.objects for select
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_insert_own"
  on storage.objects for insert
  with check (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_update_own"
  on storage.objects for update
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "audio_delete_own"
  on storage.objects for delete
  using (
    bucket_id = 'meeting-audio'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- Realtime: enable the meetings table
alter publication supabase_realtime add table public.meetings;
```

### 2.2 Storage bucket config (Supabase dashboard)

| Setting | Value |
|---|---|
| Bucket name | `meeting-audio` |
| Public | **false** |
| File size limit | 100 MB |
| Allowed MIME types | `audio/webm`, `audio/mp4`, `audio/mpeg`, `audio/wav`, `audio/x-m4a` |
| Signed URL TTL (server-generated) | 300 seconds |
| Path schema | `{user_id}/{meeting_id}.{ext}` — enforced client-side and by RLS |

### 2.3 Security invariants (memorise these)

1. **`anon` key is the only key the browser sees.** `VITE_SUPABASE_ANON_KEY` and `VITE_SUPABASE_URL` only.
2. **`service_role` key lives ONLY in Supabase Edge Function secrets.** Never in the repo, never in `.env.local`, never logged.
3. **Every Edge Function call MUST validate the JWT** (`verify_jwt = true` in `supabase/config.toml`) and re-derive `user_id` from the JWT before any DB write. The client-supplied `meeting_id` is treated as untrusted input.
4. **Signed URLs are 5-minute TTL**, generated server-side, never logged, never sent to any third-party analytics SDK.

---

## 3. LLM Prompting & Output Architecture

### 3.1 Edge Function flow (`supabase/functions/process-meeting/index.ts`)

```
1. Receive POST { meeting_id }
2. Read Authorization header → extract user_id via supabase-js admin auth.getUser(jwt)
3. SELECT meeting WHERE id=$1 AND user_id=$2 (defence in depth — RLS would also reject)
4. Respond 202 { ok: true } immediately
5. EdgeRuntime.waitUntil(processInBackground(meeting_id, user_id))
6. Background task:
   a. status='transcribing'
   b. createSignedUrl(audio_path, 300)
   c. POST to Deepgram with { url, model: 'nova-2', smart_format: true,
      diarize: true, redact: ['pci','ssn'], mip_opt_out: true }
   d. UPDATE meetings SET transcript=..., status='analysing'
   e. POST to OpenAI `https://api.openai.com/v1/chat/completions`
      body: { model: "gpt-4o-mini", temperature: 0.1,
              response_format: { type: "json_schema", strict: true, schema },
              messages: [system, user-with-transcript] }
      Grammar-constrained decoding means the response is guaranteed to satisfy
      the schema at the byte level.
   f. Validate parsed JSON against schema with Zod (belt-and-braces — should
      never fail given strict mode, but treat any failure as a 5xx bug, not
      a data-cleaning opportunity).
   g. Run validateMermaid() on each diagram string (see §3.4)
   h. UPDATE meetings SET result_json=..., status='done'
   i. On any throw: UPDATE meetings SET status='failed', error_message=...
```

### 3.2 Strict JSON Schema enforced on the LLM

> **Why this section is non-negotiable.** OpenAI's `response_format: { type: "json_schema", strict: true }` performs grammar-constrained decoding at inference time. The schema below is enforced *at the byte level by the decoder* — the model is structurally incapable of returning JSON that violates it. Zod re-validation in §3.1 step f is purely defensive and should never trigger in practice. `schema.ts` is the single source of truth, imported by both the OpenAI call and the Zod validator.

```jsonc
{
  "name": "meeting_extraction",
  "strict": true,
  "schema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["minutes", "jira_stories", "diagrams"],
    "properties": {
      "minutes": {
        "type": "object",
        "additionalProperties": false,
        "required": ["title", "date", "attendees", "agenda", "decisions", "action_items", "summary"],
        "properties": {
          "title":     { "type": "string", "maxLength": 120 },
          "date":      { "type": "string", "pattern": "^\\d{4}-\\d{2}-\\d{2}$" },
          "attendees": { "type": "array", "items": { "type": "string", "maxLength": 80 } },
          "agenda":    { "type": "array", "items": { "type": "string", "maxLength": 200 } },
          "decisions": { "type": "array", "items": { "type": "string", "maxLength": 300 } },
          "action_items": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": false,
              "required": ["owner", "task", "due_date"],
              "properties": {
                "owner":    { "type": "string", "maxLength": 80 },
                "task":     { "type": "string", "maxLength": 300 },
                "due_date": { "type": ["string", "null"], "pattern": "^(\\d{4}-\\d{2}-\\d{2})?$" }
              }
            }
          },
          "summary":   { "type": "string", "maxLength": 1500 }
        }
      },
      "jira_stories": {
        "type": "array",
        "minItems": 0,
        "maxItems": 50,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["Summary", "Description", "Issue Type", "Epic Link"],
          "properties": {
            "Summary":     { "type": "string", "minLength": 5, "maxLength": 120 },
            "Description": { "type": "string", "minLength": 10, "maxLength": 2000 },
            "Issue Type":  { "type": "string", "enum": ["Story"] },
            "Epic Link":   { "type": ["string", "null"], "pattern": "^([A-Z]{2,10}-\\d{1,6})?$" }
          }
        }
      },
      "diagrams": {
        "type": "array",
        "minItems": 0,
        "maxItems": 3,
        "items": {
          "type": "object",
          "additionalProperties": false,
          "required": ["title", "type", "mermaid"],
          "properties": {
            "title":   { "type": "string", "maxLength": 80 },
            "type":    { "type": "string", "enum": ["flowchart TD", "flowchart LR", "sequenceDiagram"] },
            "mermaid": { "type": "string", "minLength": 10, "maxLength": 4000 }
          }
        }
      }
    }
  }
}
```

**Why every constraint matters:**
- `additionalProperties: false` everywhere — the model cannot invent fields.
- `Issue Type` is `enum: ["Story"]` — Jira's exact required spelling, no variation possible.
- `Epic Link` regex matches the Jira key format `ABC-123` or is `null` — never a free-text epic name.
- `mermaid` text is bounded; node-label sanitisation is enforced via the system prompt (see §3.3) and validated in §3.4.

### 3.3 System prompt (locked, version-controlled)

```
You are a meeting-extraction service. You receive a verbatim meeting transcript
and return a single JSON object matching the supplied schema.

Rules — non-negotiable:
1. Output ONLY the JSON. No prose, no preamble, no closing remarks.
2. Generate between 0 and 50 Jira stories. Each story is a discrete unit of work
   discussed in the meeting. Do not invent work that was not discussed.
3. For every Jira story: "Issue Type" is exactly "Story". "Epic Link" is either
   null or a Jira key in the form ABC-123. Never a free-text epic name.
4. For diagrams: produce 0 to 3 diagrams that illuminate the meeting (flow of a
   decision, sequence of an integration, etc). Each "mermaid" string must:
   a. Start with the exact "type" value followed by a newline.
   b. Use ONLY node labels matching [A-Za-z0-9 _-]. No parentheses, colons,
      quotes, semicolons, or arrow characters inside labels.
   c. Never use reserved keywords (end, class, subgraph) as node IDs.
   d. Keep each line under 120 characters.
5. If the transcript is too short or unclear to produce useful output, return
   empty arrays for jira_stories and diagrams, and a brief summary in minutes.
6. Dates are ISO 8601 (YYYY-MM-DD). If no date is mentioned, use today.
```

### 3.4 Mermaid validation & fallback (client-side)

```ts
import mermaid from 'mermaid';

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });

export async function safeRenderMermaid(diagram: string, id: string) {
  try {
    await mermaid.parse(diagram);                       // throws on invalid syntax
    const { svg } = await mermaid.render(id, diagram);
    return { ok: true as const, svg };
  } catch (err) {
    // Deterministic fallback: chain the action items vertically
    const fallback = buildFallbackFromActionItems(/* injected */);
    const { svg } = await mermaid.render(`${id}-fb`, fallback);
    return { ok: false as const, svg, reason: String(err) };
  }
}
```

### 3.5 SheetJS export (client-side, never trust LLM strings raw)

```ts
import * as XLSX from 'xlsx';

function sanitizeCell(v: unknown): string {
  if (v == null) return '';
  return String(v)
    .replace(/[\r\n]+/g, ' ')        // strip newlines
    .replace(/[\x00-\x1F\x7F]/g, '') // strip ASCII control chars
    .trim();
}

export function downloadJiraXlsx(stories: JiraStory[], filename: string) {
  const rows = stories.map(s => ({
    Summary:       sanitizeCell(s.Summary),
    Description:   sanitizeCell(s.Description),
    'Issue Type':  'Story',                   // hardcoded — never trust LLM
    'Epic Link':   sanitizeCell(s['Epic Link']) || ''
  }));
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['Summary', 'Description', 'Issue Type', 'Epic Link']
  });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Jira Import');
  XLSX.writeFile(wb, filename);                // binary .xlsx — no escaping bugs
}
```

---

## 4. Token-Optimised MCP Implementation Plan

We have three MCP servers wired in: `filesystem`, `supabase`, `sequential-thinking`. The principle is **never paste code into the chat as a text block** — write directly to disk and quote only file paths and line ranges back.

### 4.1 `sequential-thinking` MCP — used for ordering, not for output

Use it once, at the start, to lock the build order. We do not re-invoke it per file. One call, one ordered plan, then execute.

Prompt template (single invocation):
> "Given the PRD in `PRD_MeetAssist.md`, produce the dependency-ordered list of files to create, with one-line purpose for each. Output as a numbered list."

### 4.2 `filesystem` MCP — the workhorse

Every file-write goes through `filesystem.write_file` (or the harness-native `Write` tool when invoked from this session). We do not echo the file body into chat. Pattern:

```
filesystem.write_file({
  path: "C:/Users/harin/OneDrive/Documents/MeetAssist/web/src/lib/supabase.ts",
  content: "<…file body…>"
})
```

Then to confirm: only quote back `path` + `lines` (e.g., "wrote `src/lib/supabase.ts` — 24 lines"). Save tokens by NOT pasting bodies into the response.

**Scaffolding order (each line = one `filesystem.write_file` call):**

```
1.  PRD_MeetAssist.md                                  (this document)
2.  web/package.json
3.  web/vite.config.ts
4.  web/tailwind.config.js
5.  web/postcss.config.js
6.  web/index.html
7.  web/.env.example                                   (anon key + URL only)
8.  web/src/main.tsx
9.  web/src/App.tsx
10. web/src/lib/supabase.ts
11. web/src/lib/types.ts                               (Zod + TS types mirroring §3.2)
12. web/src/lib/jiraExport.ts                          (SheetJS, §3.5)
13. web/src/lib/mermaidRender.ts                       (§3.4)
14. web/src/components/AuthGate.tsx
15. web/src/components/Recorder.tsx
16. web/src/components/Uploader.tsx
17. web/src/components/MeetingList.tsx
18. web/src/components/MeetingDetail.tsx               (3 tabs)
19. web/src/components/ui/button.tsx                   (shadcn-style)
20. web/src/components/ui/tabs.tsx
21. web/src/components/ui/card.tsx
22. supabase/config.toml                               (verify_jwt = true)
23. supabase/migrations/0001_init.sql                  (§2.1 verbatim)
24. supabase/functions/process-meeting/index.ts
25. supabase/functions/process-meeting/deepgram.ts
26. supabase/functions/process-meeting/llm.ts          (OpenAI call w/ strict JSON schema)
27. supabase/functions/process-meeting/schema.ts       (the JSON schema, §3.2)
28. supabase/functions/_shared/cors.ts
29. README.md                                          (one page, how to run)
```

### 4.3 `supabase` MCP — one-shot bootstraps

Use the `supabase` MCP for the operations that don't fit in source files:

| Operation | MCP call | When |
|---|---|---|
| Apply migration | `supabase.apply_migration` with the body of `0001_init.sql` | Block 1 (00:00–00:30) |
| Create bucket | `supabase.execute_sql` with the `insert into storage.buckets …` snippet | Block 1 |
| Set function secrets | `supabase.set_secrets({ OPENAI_API_KEY, DEEPGRAM_API_KEY })` | Block 4 |
| Deploy function | `supabase.deploy_edge_function('process-meeting')` | Block 5 |
| Inspect logs while debugging | `supabase.get_logs('edge-function')` | Block 5 verification |

### 4.4 Token-discipline rules

1. **Never** paste a file body into the assistant reply. Write to disk via `filesystem`, confirm in <1 line.
2. **Never** ask the LLM to "regenerate the schema" — `schema.ts` is the single source of truth; everything else imports it.
3. **Diff, don't rewrite.** For changes, use `Edit` with `old_string`/`new_string` rather than re-writing the file.
4. **One Bash call per logical task.** Stack `cd … && npm i && …` rather than chaining separate shell calls.
5. **Never log the transcript.** It's PII. Logs are `meeting_id` + `status` only.

---

## 5. The 2-Hour Execution Timeline `[00:00 — 02:00]`

Strict countdown. Each block has explicit file outputs. No drift permitted.

### Block 1 — Foundations `[00:00 — 00:20]` (20 min)

| ⏱ | Action | Outputs |
|---|---|---|
| 00:00 | Initialise Vite project: `npm create vite@latest web -- --template react-ts` | `web/` skeleton |
| 00:05 | Add Tailwind, shadcn primitives, supabase-js, xlsx, mermaid, zod | `web/package.json`, `web/tailwind.config.js`, `web/postcss.config.js` |
| 00:10 | Write `supabase/migrations/0001_init.sql` verbatim from §2.1; apply via `supabase` MCP | Migration applied, RLS live |
| 00:15 | Create bucket `meeting-audio` (private) via `supabase` MCP; verify RLS policies | Bucket exists |
| 00:18 | Set `.env.example` and `web/.env.local` (anon key + URL only) | Env wired |

### Block 2 — Auth + Capture UI `[00:20 — 00:50]` (30 min)

| ⏱ | Action | Outputs |
|---|---|---|
| 00:20 | Build `AuthGate.tsx` (magic-link), wire into `App.tsx` | Auth functional |
| 00:30 | Build `Recorder.tsx` — `MediaRecorder` with MIME negotiation (`webm/opus` → `mp4`) | Recorder works in Chrome/Firefox/Safari |
| 00:40 | Build `Uploader.tsx` — supabase-js resumable upload to `meeting-audio/{user_id}/{meeting_id}.{ext}`; insert row in `meetings` (status `pending`) | Upload + DB insert |
| 00:48 | POST `meeting_id` to Edge Function (function not yet deployed — stub returns 202) | Frontend dispatch path complete |

### Block 3 — JSON Schema, LLM, Mermaid, SheetJS Plumbing `[00:50 — 01:10]` (20 min)

| ⏱ | Action | Outputs |
|---|---|---|
| 00:50 | Write `web/src/lib/types.ts` — Zod schemas mirroring §3.2 | Type-safe parsing on client |
| 00:55 | Write `web/src/lib/jiraExport.ts` — SheetJS with `sanitizeCell()` | XLSX export ready |
| 01:00 | Write `web/src/lib/mermaidRender.ts` — `mermaid.parse()` + fallback | Diagram safety net live |
| 01:05 | Write `supabase/functions/process-meeting/schema.ts` — JSON Schema literal from §3.2 | Single source of truth |

### Block 4 — Edge Function (async pipeline) `[01:10 — 01:35]` (25 min)

| ⏱ | Action | Outputs |
|---|---|---|
| 01:10 | Set Deepgram + OpenAI secrets via `supabase` MCP | Secrets vault populated |
| 01:13 | Write `supabase/functions/_shared/cors.ts` and `process-meeting/index.ts` — JWT verify, 202 + `EdgeRuntime.waitUntil(...)` | Async dispatch wired |
| 01:20 | Write `process-meeting/deepgram.ts` — POST `{url, model:'nova-2', smart_format:true, diarize:true, redact:['pci','ssn'], mip_opt_out:true}` | Transcription path |
| 01:27 | Write `process-meeting/llm.ts` — OpenAI call (`https://api.openai.com/v1/chat/completions`, model `gpt-4o-mini`, `response_format:{type:'json_schema',strict:true,schema}`, temperature 0.1) + Zod defensive validator | Structured-output call |
| 01:33 | Deploy function via `supabase` MCP; run smoke test against a 30-second sample audio | Function returns `done` state |

### Block 5 — Results UI + Realtime + Exports `[01:35 — 02:00]` (25 min)

| ⏱ | Action | Outputs |
|---|---|---|
| 01:35 | Build `MeetingList.tsx` — `supabase.from('meetings').select(...).order('created_at', desc).limit(20)` | History list |
| 01:42 | Build `MeetingDetail.tsx` — Realtime subscription to `meetings:id=eq.<id>`; 3 tabs (Minutes / Jira / Diagrams) | Live status + result rendering |
| 01:50 | Wire "Download .xlsx" button → `downloadJiraXlsx(stories, 'jira-stories.xlsx')` | Excel export verified |
| 01:55 | Wire "Download .svg" per diagram from rendered Mermaid output | Diagram export verified |
| 01:58 | End-to-end smoke: record 60s → process → verify Minutes/XLSX/SVG all render | Demo-ready |

### Anti-drift rules during the 2-hour window

1. If a block runs over by >3 min, **cut scope, don't extend the block.** Drop the diagrams tab before dropping the Jira export.
2. **No styling polish until 01:55.** Tailwind utility classes inline, no custom CSS file.
3. **Never debug by adding `console.log` to the Edge Function.** Use `supabase.get_logs('edge-function')` via MCP.
4. **If the LLM ever returns invalid JSON in testing** (it won't, because of `strict:true`, but if), do NOT add a regex cleaner. Re-check that `strict:true` is actually set and that the schema in `schema.ts` matches the Zod validator. A cleaner is a code smell that masks the real bug.

---

## 6. Pre-Mortem Mitigations — Locked Into Code, Not Vibes

The three fatal mistakes identified in the cognitive framework are mitigated by the following enforced invariants. Treat them as the closing checklist before you hit deploy.

| Fatal mistake | Mitigation | Where enforced |
|---|---|---|
| Loose JSON output | `response_format: { type: "json_schema", strict: true }` (grammar-constrained decoding) + Zod defensive re-validation + `Issue Type` hardcoded to `"Story"` in export + `sanitizeCell()` strips control chars | §3.2, §3.5, `llm.ts`, `jiraExport.ts` |
| `service_role` leakage | `service_role` only in Edge Function secrets vault; `verify_jwt = true` in `config.toml`; every Edge Function re-derives `user_id` from JWT; no admin endpoints, period | §2.3, `config.toml`, `index.ts` |
| Synchronous pipeline | Edge Function returns 202 in <500ms; all work in `EdgeRuntime.waitUntil`; frontend uses Realtime subscription, not polling | §3.1, Block 4, Block 5 |

---

## 7. Done Definition

The build is "done" when, in a fresh browser session, a user can:

1. Sign in via magic-link.
2. Record or upload an audio file.
3. See status transitions arrive via Realtime within 2 seconds of each DB update.
4. Open the resulting meeting and download a `.xlsx` that imports into Jira without validation errors (CSV import wizard, schema = Story, Epic Link mappable).
5. Render at least one Mermaid diagram in the browser. If the LLM produced invalid syntax, the fallback diagram renders instead — never a stack trace, never a blank tab.

If any of the above fails, the build is not done. Go fix it before demo.

---

## 8. Claude Code Setup — Provisioned Values & Bootstrap

This section captures the concrete values for **this** project and the exact wiring for Claude Code (the CLI) so the AI engineer can pick up §5 and run.

### 8.1 Supabase project (provisioned)

| Field | Value |
|---|---|
| Project URL | `https://yadwltjglssriejfjuzx.supabase.co` |
| Project ref | `yadwltjglssriejfjuzx` |
| `anon` / publishable key | `sb_publishable_rp45xPGsaokWVo3dCShrHQ_OlygqA7k` |
| `service_role` key | Stored in user's password manager — **never** committed, **never** in `.env*`, only set via `supabase secrets set` |
| DB connection string | `postgresql://postgres:<DB_PASSWORD>@db.yadwltjglssriejfjuzx.supabase.co:5432/postgres` |

The `anon` key is safe to commit to `.env.local` and to ship in the static bundle (this is its design). The `service_role` is not.

### 8.2 Local CLI bootstrap (run these in order, in the chosen project folder)

```bash
# 0. Clone the project repo OUTSIDE OneDrive (OneDrive + node_modules = pain)
cd ~/Code                                                       # or wherever you keep code
git clone git@github.com:hariniprakash296/MinutesScrible.git
cd MinutesScrible
cp /path/to/PRD_MeetAssist.md .                                 # copy this PRD into the repo root

# 1. Supabase CLI auth & link
supabase login                                                  # opens browser
supabase init                                                   # creates supabase/ scaffold
supabase link --project-ref yadwltjglssriejfjuzx                # pairs CLI to this project

# 2. Vite + React scaffold (Block 1 of §5)
npm create vite@latest web -- --template react-ts
cd web && npm i
npm i @supabase/supabase-js zod xlsx mermaid
npm i -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
cd ..

# 3. Edge Function secrets (NEVER commit these — set via CLI into the vault)
supabase secrets set DEEPGRAM_API_KEY=<paste_from_deepgram>
supabase secrets set OPENAI_API_KEY=<paste_from_openai>
# SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected into Edge
# Functions at runtime by Supabase — do NOT set them manually.

# 4. Front-end env (committed as .env.example, real values in .env.local)
cat > web/.env.local <<'EOF'
VITE_SUPABASE_URL=https://yadwltjglssriejfjuzx.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_rp45xPGsaokWVo3dCShrHQ_OlygqA7k
EOF
```

### 8.3 `.mcp.json` (project root) — wires the three MCP servers to Claude Code

Create this file at the **project root** (`~/Code/MinutesScrible/.mcp.json`). Claude Code auto-detects it on `claude` startup. Add `.mcp.json` to `.gitignore` if your team workflow requires per-developer tokens (the `SUPABASE_PERSONAL_ACCESS_TOKEN` inline below is per-user).

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "."]
    },
    "sequential-thinking": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]
    },
    "supabase": {
      "command": "npx",
      "args": [
        "-y",
        "@supabase/mcp-server-supabase@latest",
        "--access-token",
        "<SUPABASE_PERSONAL_ACCESS_TOKEN>",
        "--project-ref",
        "yadwltjglssriejfjuzx"
      ]
    }
  }
}
```

Get `<SUPABASE_PERSONAL_ACCESS_TOKEN>` from supabase.com → *Account → Access Tokens* (this is the **personal** token, distinct from the project's anon/service-role keys).

When you run `claude` in this folder, Claude Code prompts once to approve the three servers. Approve all three. Verify with `/mcp` inside the Claude Code session — you should see `filesystem`, `sequential-thinking`, `supabase` listed as connected.

### 8.4 Magic-link redirect — workaround for the missing "URL Configuration" UI

In current Supabase dashboards the path has moved. Try these in order; one of them will be present in your project:

1. **Sidebar → Authentication → Configuration → URL Configuration** (most current path).
2. **Sidebar → Authentication → Sign In / Up → Site URL & Redirect URLs** (rolled-out variant).
3. **Sidebar → Project Settings → Authentication → URL Configuration** (legacy fallback).

Whichever screen you find, set:
- **Site URL**: `http://localhost:5173`
- **Additional Redirect URLs**: `http://localhost:5173/**` (and your eventual prod URL once you have one)

If none of those screens exist for you (UI was clearly mid-migration on May 2026), the CLI fallback below sets it via the Management API — run from the project folder:

```bash
# Requires SUPABASE_ACCESS_TOKEN env var set to your personal access token
curl -X PATCH \
  "https://api.supabase.com/v1/projects/yadwltjglssriejfjuzx/config/auth" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "site_url": "http://localhost:5173",
    "uri_allow_list": "http://localhost:5173,http://localhost:5173/**"
  }'
```

A `200 OK` confirms the redirect allowlist is set. Magic-link emails will now redirect into your dev server.

### 8.5 The bootstrap prompt to paste into Claude Code

Once §8.2–8.4 are done, start `claude` in the project root and paste **exactly** this as the first message:

```
Read PRD_MeetAssist.md in this folder. It is the single source of truth.
Do not deviate from §0 (mandate), §3.2 (validation contract), or §5
(timeline). Three MCP servers are wired: `filesystem` for code, `supabase`
for migrations/secrets/deploy, `sequential-thinking` for one ordered plan
at the start (call it ONCE).

Project values for this run:
  Project ref:      yadwltjglssriejfjuzx
  Project URL:      https://yadwltjglssriejfjuzx.supabase.co
  anon key:         sb_publishable_rp45xPGsaokWVo3dCShrHQ_OlygqA7k
  LLM provider:     OpenAI gpt-4o-mini with response_format json_schema strict:true.
  Secrets already in Supabase vault: DEEPGRAM_API_KEY, OPENAI_API_KEY.
  service_role is in my password manager — never request it, never write
  it to disk, and never include it in any source file or .env.

Execute Block 1 of §5 first. After each block, give me a one-line summary
per file written and pause for my "go". Never paste file bodies into the
chat — write to disk only.

Begin.
```

### 8.6 Outstanding items the user still has to do (status as of this revision)

| Item | Status |
|---|---|
| Supabase project created, URL + anon key supplied | ✅ done |
| `service_role` key safely stored, not shared | ✅ done (in password manager) |
| Supabase CLI installed, `supabase login` + `supabase init` + `supabase link --project-ref yadwltjglssriejfjuzx` | ⏳ ready to run |
| Deepgram API key in hand, ready to push into vault via `supabase secrets set` | ✅ have it |
| OpenAI API key in hand, ready to push into vault | ✅ have it |
| Magic-link redirect URLs configured via §8.4 | ✅ done |
| Personal access token generated for the `supabase` MCP | ⏳ supabase.com → Account → Access Tokens |
| Claude Code CLI installed (`npm i -g @anthropic-ai/claude-code`, `claude login`) | ⏳ install if not yet |
| `.mcp.json` placed at project root with values from §8.3 | ⏳ create when scaffolding |

When every row is ✅, paste §8.5 into Claude Code and the §5 timer starts.

---

*End of PRD. Now stop reading and start writing files.*
