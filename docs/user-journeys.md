# MeetAssist — User Journey Diagrams

Five diagrams covering the complete user experience: sign-in, capture, pipeline, results, and the full end-to-end view.

---

## 1. Full end-to-end overview

The happy path from opening the app to downloading a Jira export.

```mermaid
flowchart TD
    A([User opens app]) --> B{Has session?}
    B -- No --> C[AuthGate shows sign-in form]
    C --> D[User enters email]
    D --> E[Supabase emails magic link]
    E --> F[User clicks link in email]
    F --> G[JWT session set in browser]
    B -- Yes --> G

    G --> H[MeetingList shown\nYour meetings]

    H --> I{How to add\nmeeting?}
    I -- Record --> J[Mic recorder\nRecorder.tsx]
    I -- Upload file --> K[Drag and drop or\nbrowse file picker]

    J --> L[Audio blob ready]
    K --> L

    L --> M[Uploader.tsx\nvalidates type + size]
    M -- Invalid --> N[Error shown to user]
    M -- Valid --> O[Upload to Supabase Storage\nmeeting-audio bucket]

    O --> P[Insert meetings row\nstatus: pending]
    P --> Q[POST to Edge Function\nwith JWT token]
    Q --> R[202 Accepted\nUI navigates to MeetingDetail]

    R --> S[Realtime subscription\nwatching for DB changes]

    S --> T[status: transcribing\nDeepgram running]
    T --> U[status: analysing\nOpenAI running]
    U --> V{Success?}
    V -- Yes --> W[status: done\nresult_json saved]
    V -- No --> X[status: failed\nerror_message saved]

    W --> Y[Three tabs appear]
    Y --> Y1[Minutes tab]
    Y --> Y2[Jira Stories tab]
    Y --> Y3[Diagrams tab]

    Y2 --> Z[Export .xlsx button\nExcelJS generates file\nBrowser downloads it]
```

---

## 2. Sign-in journey

How the user gets a session — magic link, no password.

```mermaid
sequenceDiagram
    actor User
    participant Browser as Browser\n(AuthGate.tsx)
    participant Supabase as Supabase Auth
    participant Email as User's Inbox

    User->>Browser: Opens app
    Browser->>Supabase: getSession() — check localStorage
    Supabase-->>Browser: null (no session)
    Browser-->>User: Shows sign-in form

    User->>Browser: Types email, clicks "Send magic link"
    Browser->>Supabase: signInWithOtp({ email, emailRedirectTo })
    Supabase->>Email: Sends one-time login URL
    Supabase-->>Browser: { error: null } — success
    Browser-->>User: "Check your inbox" message

    User->>Email: Opens email, clicks magic link
    Email->>Browser: Redirect to app with token in URL hash
    Browser->>Supabase: onAuthStateChange fires\nSupabase reads token from URL
    Supabase-->>Browser: Session object with JWT + user.id
    Browser-->>User: AuthGate renders app content\nSign-in form gone
```

---

## 3. Capture journey

Recording with the mic vs. uploading a file — both end up at the same upload step.

```mermaid
sequenceDiagram
    actor User
    participant Recorder as Recorder.tsx
    participant Uploader as Uploader.tsx
    participant Storage as Supabase Storage\n(meeting-audio bucket)
    participant DB as Postgres\n(meetings table)
    participant EF as Edge Function\n(process-meeting)

    User->>Uploader: Clicks "+ New meeting"

    alt Record with mic
        User->>Recorder: Clicks "Start recording"
        Recorder->>Browser: getUserMedia({ audio: true })
        Browser-->>User: Permission popup appears
        User-->>Browser: Clicks "Allow"
        Browser-->>Recorder: MediaStream (mic audio)
        Recorder->>Recorder: MediaRecorder starts\ncollecting 250ms chunks
        User->>Recorder: Clicks "Stop"
        Recorder->>Recorder: onstop fires\nmerge chunks into one Blob
        Recorder->>Uploader: onRecordingComplete(blob, mimeType)
    else Upload a file
        User->>Uploader: Drops file or clicks "browse"
        Uploader->>Uploader: onDrop / onFileInput fires
    end

    Uploader->>Uploader: Validate MIME type\n(webm/mp4/m4a/mp3/wav only)
    Uploader->>Uploader: Validate size ≤ 100 MB

    alt Invalid file
        Uploader-->>User: Error message shown
    else Valid file
        Uploader->>Storage: upload(userId/meetingId.ext, file)
        Note over Storage: File stored at\n{user_id}/{meeting_id}.webm\nRLS checks path prefix = user_id
        Storage-->>Uploader: { error: null }

        Uploader->>DB: insert({ id, user_id, title,\naudio_path, status:'pending' })
        DB-->>Uploader: { error: null }

        Uploader->>EF: POST /process-meeting\nAuthorization: Bearer JWT\n{ meeting_id }
        EF-->>Uploader: 202 Accepted

        Uploader->>App: onUploaded(meetingId)
        App-->>User: Navigates to MeetingDetail view
    end
```

---

## 4. Background pipeline journey

What happens inside the Edge Function after the 202 response is sent.
The user's browser never waits for this — it watches via Realtime instead.

```mermaid
sequenceDiagram
    participant EF as Edge Function\n(process-meeting/index.ts)
    participant DB as Postgres\n(meetings table)
    participant Storage as Supabase Storage
    participant DG as Deepgram Nova-2
    participant OAI as OpenAI gpt-4o-mini
    participant Browser as Browser\n(MeetingDetail Realtime sub)

    Note over EF: EdgeRuntime.waitUntil(processInBackground())\nstarts here, after 202 is already sent

    EF->>DB: UPDATE status = 'transcribing'
    DB-->>Browser: Realtime event → banner updates

    EF->>Storage: createSignedUrl(audio_path, 300s)
    Note over Storage: 5-minute temporary URL\nNever logged, never sent to browser
    Storage-->>EF: { signedUrl }

    EF->>DG: POST /v1/listen\n{ url: signedUrl, model: 'nova-2',\n  smart_format, diarize,\n  redact: ['pci','ssn'] }
    Note over DG: Deepgram fetches audio\ndirectly from Storage URL.\nEdge Function never buffers the file.
    DG-->>EF: { transcript, duration }

    EF->>DB: UPDATE status = 'analysing'\n       transcript = '...'
    DB-->>Browser: Realtime event → banner updates

    EF->>OAI: POST /v1/chat/completions\nmodel: gpt-4o-mini\nresponse_format: { type: json_schema,\n  strict: true }\n[transcript as user message]
    Note over OAI: Grammar-constrained decoding.\nCannot produce schema-violating JSON.\nNo parsing or regex cleaning needed.
    OAI-->>EF: { minutes, jira_stories, diagrams }

    EF->>EF: Zod.safeParse(result)\nbelt-and-braces check

    alt All good
        EF->>DB: UPDATE status = 'done'\n       result_json = { ... }
        DB-->>Browser: Realtime event → tabs appear
    else Any error thrown
        EF->>DB: UPDATE status = 'failed'\n       error_message = err.message
        DB-->>Browser: Realtime event → error shown
    end
```

---

## 5. Results journey

How the browser receives updates and renders the three output tabs.

```mermaid
sequenceDiagram
    actor User
    participant Browser as Browser\n(MeetingDetail.tsx)
    participant RT as Supabase Realtime\n(WebSocket)
    participant DB as Postgres\n(meetings table)

    Browser->>DB: SELECT * FROM meetings\nWHERE id = meetingId
    DB-->>Browser: Row with current status\n(may still be 'pending')

    Browser->>RT: Subscribe to\npostgres_changes UPDATE\nfilter: id=eq.{meetingId}
    Note over RT: WebSocket channel open.\nBrowser gets push notifications\nnot polling.

    RT-->>Browser: status: 'transcribing'\nBanner: "Transcribing audio…"
    RT-->>Browser: status: 'analysing'\nBanner: "Analysing transcript…"

    RT-->>Browser: status: 'done'\nresult_json: { minutes, jira_stories, diagrams }

    Browser->>Browser: MeetingResultSchema.safeParse(result_json)\nZod validates shape

    Browser-->>User: Three tabs appear

    alt User clicks Minutes tab
        Browser-->>User: Summary paragraph\nAgenda list\nDecisions list\nAction items with owners + due dates
    end

    alt User clicks Jira Stories tab
        Browser-->>User: Story cards\n(Summary + Description + Epic Link)
        User->>Browser: Clicks "Export N stories (.xlsx)"
        Browser->>Browser: ExcelJS builds Workbook in memory\nsanitizeCell() on every AI string\nwriteBuffer() → Blob → URL.createObjectURL
        Browser-->>User: File download triggered\n"meeting-title.xlsx"
    end

    alt User clicks Diagrams tab
        Browser->>Browser: mermaid.parse(diagram.mermaid)\n— validates syntax
        Browser->>Browser: mermaid.render(id, diagram)\n— produces SVG string
        Note over Browser: If parse fails, safeRenderMermaid()\nfalls back to an action-item flowchart.\nTab is never blank.
        Browser-->>User: SVG diagram rendered in DOM\nsecurityLevel: strict prevents script injection
    end
```

---

## Reading guide

| Diagram | What it answers |
|---|---|
| **1 — Overview** | "What does the app do from start to finish?" |
| **2 — Sign-in** | "How does the magic-link auth flow work?" |
| **3 — Capture** | "What happens when I record or upload a file?" |
| **4 — Pipeline** | "What does the server do after I submit a meeting?" |
| **5 — Results** | "How do the results appear without me refreshing the page?" |
