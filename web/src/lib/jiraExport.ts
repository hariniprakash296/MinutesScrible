import * as XLSX from 'xlsx'
import type { JiraStory } from './types'

function sanitizeCell(v: unknown): string {
  if (v == null) return ''
  return String(v)
    .replace(/[\r\n]+/g, ' ')         // strip newlines
    .replace(/[\x00-\x1F\x7F]/g, '')  // strip ASCII control chars
    .trim()
}

export function downloadJiraXlsx(stories: JiraStory[], filename: string) {
  const rows = stories.map(s => ({
    Summary:       sanitizeCell(s.Summary),
    Description:   sanitizeCell(s.Description),
    'Issue Type':  'Story',                        // hardcoded — never trust LLM
    'Epic Link':   sanitizeCell(s['Epic Link']) || '',
  }))

  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['Summary', 'Description', 'Issue Type', 'Epic Link'],
  })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Jira Import')
  XLSX.writeFile(wb, filename)
}
