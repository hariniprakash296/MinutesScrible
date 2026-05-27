/**
 * schema.ts
 *
 * THE single source of truth for the JSON schema that controls what the AI
 * is allowed to return.
 *
 * This file is imported by:
 *   - llm.ts              — passes it to the OpenAI API as response_format.json_schema
 *   - web/src/lib/types.ts — the Zod schemas there must mirror this structure exactly
 *
 * NEVER duplicate this schema anywhere else. If you need to change what the
 * AI returns, change it HERE and update the Zod schema in types.ts to match.
 *
 * How it works:
 * OpenAI's "json_schema strict:true" mode uses this schema as a grammar.
 * When the model generates tokens, each token is filtered to only allow values
 * that keep the output on track toward valid JSON that satisfies this schema.
 * Think of it like auto-correct, but for JSON structure — the model literally
 * cannot produce output that violates it.
 *
 * Key constraints and why they matter:
 *   additionalProperties: false  — the model cannot invent new fields
 *   "Issue Type": enum ["Story"] — Jira's importer requires this exact string
 *   "Epic Link": pattern         — must be a Jira key like ABC-123, or null
 *   mermaid: maxLength 4000      — prevents runaway diagram output
 */

export const meetingExtractionSchema = {
  name: "meeting_extraction", // a name for this schema (shown in OpenAI logs)
  strict: true,               // enables grammar-constrained decoding — NEVER set to false

  schema: {
    type: "object",
    additionalProperties: false, // the model cannot add fields not listed below
    required: ["minutes", "jira_stories", "diagrams"], // all three must be present

    properties: {

      // ── minutes ────────────────────────────────────────────────────────
      // Structured summary of the meeting.
      minutes: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "attendees", "agenda", "decisions", "action_items", "summary"],
        properties: {
          title:     { type: "string", maxLength: 120 },
          date:      { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" }, // YYYY-MM-DD only
          attendees: { type: "array", items: { type: "string", maxLength: 80 } },
          agenda:    { type: "array", items: { type: "string", maxLength: 200 } },
          decisions: { type: "array", items: { type: "string", maxLength: 300 } },
          action_items: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["owner", "task", "due_date"],
              properties: {
                owner:    { type: "string", maxLength: 80 },
                task:     { type: "string", maxLength: 300 },
                // due_date can be a date string OR null (if no deadline was mentioned)
                due_date: { type: ["string", "null"], pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" },
              },
            },
          },
          summary: { type: "string", maxLength: 1500 }, // 1–2 paragraph overview
        },
      },

      // ── jira_stories ────────────────────────────────────────────────────
      // List of work items ready to import into Jira.
      jira_stories: {
        type: "array",
        minItems: 0,  // can be empty (if no actionable work was discussed)
        maxItems: 50, // cap to prevent excessive output
        items: {
          type: "object",
          additionalProperties: false,
          required: ["Summary", "Description", "Issue Type", "Epic Link"],
          properties: {
            Summary:       { type: "string", minLength: 5, maxLength: 120 },
            Description:   { type: "string", minLength: 10, maxLength: 2000 },
            // enum: ["Story"] means the model MUST use exactly "Story" — no other value is possible
            "Issue Type":  { type: "string", enum: ["Story"] },
            // Must match "ABC-123" format or be null — never a free-text epic name
            "Epic Link":   { type: ["string", "null"], pattern: "^([A-Z]{2,10}-\\d{1,6})?$" },
          },
        },
      },

      // ── diagrams ─────────────────────────────────────────────────────────
      // Optional Mermaid diagrams illustrating key flows from the meeting.
      diagrams: {
        type: "array",
        minItems: 0, // diagrams are optional
        maxItems: 3, // no more than 3 — keeps the UI readable
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "type", "mermaid"],
          properties: {
            title:   { type: "string", maxLength: 80 },
            // Only these three Mermaid diagram types are allowed.
            // Limiting the types prevents the model from generating unsupported syntax.
            type:    { type: "string", enum: ["flowchart TD", "flowchart LR", "sequenceDiagram"] },
            mermaid: { type: "string", minLength: 10, maxLength: 4000 }, // the raw Mermaid text
          },
        },
      },

    }, // end properties
  }, // end schema
} as const // "as const" makes TypeScript treat all values as literals, not general strings
