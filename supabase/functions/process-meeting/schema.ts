// Single source of truth for the OpenAI json_schema response format.
// Imported by llm.ts (OpenAI call) and used as the Zod-mirror in web/src/lib/types.ts.
// Do NOT duplicate this object — edit here, nowhere else.

export const meetingExtractionSchema = {
  name: "meeting_extraction",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["minutes", "jira_stories", "diagrams"],
    properties: {
      minutes: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "attendees", "agenda", "decisions", "action_items", "summary"],
        properties: {
          title:     { type: "string", maxLength: 120 },
          date:      { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
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
                due_date: { type: ["string", "null"], pattern: "^(\\d{4}-\\d{2}-\\d{2})?$" },
              },
            },
          },
          summary: { type: "string", maxLength: 1500 },
        },
      },
      jira_stories: {
        type: "array",
        minItems: 0,
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["Summary", "Description", "Issue Type", "Epic Link"],
          properties: {
            Summary:       { type: "string", minLength: 5, maxLength: 120 },
            Description:   { type: "string", minLength: 10, maxLength: 2000 },
            "Issue Type":  { type: "string", enum: ["Story"] },
            "Epic Link":   { type: ["string", "null"], pattern: "^([A-Z]{2,10}-\\d{1,6})?$" },
          },
        },
      },
      diagrams: {
        type: "array",
        minItems: 0,
        maxItems: 3,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["title", "type", "mermaid"],
          properties: {
            title:   { type: "string", maxLength: 80 },
            type:    { type: "string", enum: ["flowchart TD", "flowchart LR", "sequenceDiagram"] },
            mermaid: { type: "string", minLength: 10, maxLength: 4000 },
          },
        },
      },
    },
  },
} as const
