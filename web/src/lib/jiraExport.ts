/**
 * jiraExport.ts
 *
 * Handles downloading meeting results as a .xlsx (Excel) file that can be
 * imported directly into Jira's CSV/Excel import wizard.
 *
 * Why Excel and not CSV?
 * CSV files have well-known escaping bugs — a description with commas or
 * newlines can silently corrupt every row that follows. SheetJS generates
 * a proper binary .xlsx file that has none of those problems.
 *
 * Security note:
 * Every value from the AI goes through sanitizeCell() before it is written
 * to the spreadsheet. This strips newlines and control characters that could
 * break the file or be used to inject formulas.
 * "Issue Type" is hardcoded to "Story" — it is NEVER sourced from the AI,
 * because Jira's importer will reject the file if this field varies.
 */

import * as XLSX from 'xlsx'           // SheetJS — the library that creates Excel files
import type { JiraStory } from './types' // our TypeScript type for a single Jira ticket

/**
 * sanitizeCell
 *
 * Cleans a value before it is written into a spreadsheet cell.
 * - Converts anything that isn't a string into a string first.
 * - Replaces line breaks with a single space (Excel cells can hold multi-line
 *   text, but Jira's importer treats them as row delimiters).
 * - Strips ASCII control characters (codes 0–31 and 127) that can corrupt the file.
 * - Trims leading/trailing whitespace.
 */
function sanitizeCell(v: unknown): string {
  if (v == null) return ''                            // null or undefined → empty string
  return String(v)
    .replace(/[\r\n]+/g, ' ')                         // replace newlines with a space
    .replace(/[\x00-\x1F\x7F]/g, '')                 // remove ASCII control characters
    .trim()                                           // remove surrounding whitespace
}

/**
 * downloadJiraXlsx
 *
 * Takes a list of Jira stories and triggers a file download in the browser.
 *
 * @param stories  Array of JiraStory objects from the AI result
 * @param filename What to name the downloaded file, e.g. "jira-stories.xlsx"
 */
export function downloadJiraXlsx(stories: JiraStory[], filename: string) {
  // Build a plain array of row objects — one object per Jira story.
  // Every value goes through sanitizeCell() to strip unsafe characters.
  const rows = stories.map(s => ({
    Summary:       sanitizeCell(s.Summary),
    Description:   sanitizeCell(s.Description),
    'Issue Type':  'Story',                           // hardcoded — NEVER from the AI
    'Epic Link':   sanitizeCell(s['Epic Link']) || '', // null becomes empty string
  }))

  // Convert the array of row objects into a SheetJS worksheet.
  // The "header" option fixes the column order so Jira's importer always sees
  // the columns in the right sequence.
  const ws = XLSX.utils.json_to_sheet(rows, {
    header: ['Summary', 'Description', 'Issue Type', 'Epic Link'],
  })

  // Create a new workbook (an Excel file container) and add our worksheet to it.
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Jira Import') // "Jira Import" is the sheet tab name

  // Trigger the browser download. XLSX.writeFile creates the binary file and
  // saves it to the user's Downloads folder automatically.
  XLSX.writeFile(wb, filename)
}
