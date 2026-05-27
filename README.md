# MeetAssist

Record or upload a meeting audio file and get back structured minutes, Jira-ready stories, and Mermaid diagrams — automatically.

---

## What it does

1. **Upload or record** a meeting (drag-and-drop .webm / .mp4 / .m4a / .mp3 / .wav, or use the in-browser mic recorder).
2. **Transcription** — Deepgram Nova-2 converts the audio to text with speaker diarisation.
3. **AI extraction** — GPT-4o-mini produces a grammar-constrained JSON result containing:
   - **Minutes** — title, date, attendees, agenda, decisions, action items, and a summary paragraph.
   - **Jira Stories** — one story card per discussion item, ready to import into Jira via `.xlsx` export.
   - **Diagrams** — Mermaid flowcharts and sequence diagrams rendered as SVG in the browser.
4. **Real-time status** — a Supabase Realtime subscription updates the status banner live (Pending → Transcribing → Analysing → Done) without polling.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS |
| Auth | Supabase Auth (magic-link email, no passwords) |
| Storage | Supabase Storage (`meeting-audio` bucket, private, RLS-protected) |
| Database | Supabase Postgres with Row Level Security |
| Real-time | Supabase Realtime (Postgres changes) |
| Edge Function | Deno (Supabase Edge Functions) |
| Transcription | Deepgram Nova-2 (`nova-2`, smart_format, diarize) |
| AI extraction | OpenAI `gpt-4o-mini`, `response_format: json_schema`, `strict: true` |
| Excel export | ExcelJS — generates `.xlsx` with formula-injection protection |
| Diagrams | Mermaid v10 (browser-side, `securityLevel: strict`) |

---

## Local development

### Prerequisites

- Node.js v20+
- Supabase CLI (`npm i -g supabase`)
- A Supabase project (see [supabase.com](https://supabase.com))

### Setup

```bash
# 1. Clone the repo
git clone https://github.com/hariniprakash296/MinutesScrible.git
cd MinutesScrible

# 2. Link to your Supabase project
supabase login
supabase link --project-ref <your-project-ref>

# 3. Apply the database migration
supabase db push

# 4. Set API secrets in the Supabase vault
supabase secrets set DEEPGRAM_API_KEY=<your_key>
supabase secrets set OPENAI_API_KEY=<your_key>

# 5. Deploy the Edge Function
supabase functions deploy process-meeting

# 6. Install frontend dependencies and start dev server
cd web
npm install
# Create web/.env.local with:
# VITE_SUPABASE_URL=https://<your-project-ref>.supabase.co
# VITE_SUPABASE_ANON_KEY=<your-anon-key>
npm run dev
# -> http://localhost:5173
```

---

## Project structure

```
MeetAssist/
├── web/                              # Vite + React frontend
│   └── src/
│       ├── App.tsx                   # Root component -- three-view state machine
│       ├── lib/
│       │   ├── supabase.ts           # Supabase browser client (anon key only)
│       │   ├── types.ts              # Zod schemas + TypeScript types
│       │   ├── audio.ts              # MIME detection and file extension utilities
│       │   ├── mermaidRender.ts      # Safe Mermaid renderer with fallback
│       │   └── jiraExport.ts         # ExcelJS .xlsx export with sanitization
│       └── components/
│           ├── AuthGate.tsx          # Magic-link sign-in gate
│           ├── Uploader.tsx          # Drag-and-drop upload + Edge Function dispatch
│           ├── Recorder.tsx          # In-browser MediaRecorder
│           ├── MeetingList.tsx       # Scrollable list with Realtime status badges
│           ├── MeetingDetail.tsx     # Minutes / Jira / Diagrams tabs
│           └── ui/
│               ├── button.tsx        # Shared button primitive
│               ├── tabs.tsx          # Tabs primitive (Tabs/TabsList/TabsTrigger/TabsContent)
│               └── card.tsx          # Card primitive (Card/CardHeader/CardTitle/CardContent)
├── supabase/
│   ├── migrations/
│   │   └── 0001_init.sql             # meetings table, RLS policies, storage bucket, Realtime
│   └── functions/
│       ├── _shared/cors.ts           # CORS headers for Edge Functions
│       └── process-meeting/
│           ├── index.ts              # Edge Function entry -- JWT verify -> 202 -> background pipeline
│           ├── schema.ts             # OpenAI JSON schema (single source of truth)
│           ├── deepgram.ts           # Deepgram Nova-2 transcription helper
│           └── llm.ts                # OpenAI extraction helper
├── Architecture.md                   # C4 architecture documentation (Context/Container/Component)
└── CLAUDE.md                         # Engineer handoff and session notes
```

---

## Security

- **No secrets in the browser.** Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` reach the client. All other secrets are in the Supabase vault.
- **JWT re-validation.** The Edge Function verifies the user's JWT and re-derives `user_id` from it -- the client's claimed `user_id` is never trusted.
- **Row Level Security.** Every database query is scoped to `auth.uid() = user_id`. An attacker with a valid session cannot read another user's meetings.
- **Storage RLS.** Users can only read/write files at `{their_user_id}/*` in the `meeting-audio` bucket.
- **Formula injection protection.** Every AI string written to `.xlsx` is run through `sanitizeCell()`, which strips control characters and prefixes `=`, `+`, `-`, `@`, `|` with a single quote (OWASP CSV Injection mitigation).
- **Mermaid `securityLevel: strict`.** Prevents SVG diagrams from executing JavaScript.
- **Signed URLs are short-lived (5 min).** Audio is never streamed through the Edge Function -- Deepgram fetches it directly via a time-limited signed URL.
- **Transcript is never displayed.** The raw transcript (PII) is stored in the DB for debugging but never rendered in the UI.

---

## Limits

| Resource | Limit |
|---|---|
| Audio file size | 100 MB |
| Supported formats | .webm, .mp4, .m4a, .mp3, .wav |
| Jira stories per meeting | 50 |
| Diagrams per meeting | 3 |
| Signed URL TTL | 5 minutes |
