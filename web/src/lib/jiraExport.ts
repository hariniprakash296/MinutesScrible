/**
 * jiraExport.ts
 *
 * Handles downloading meeting results as a .xlsx (Excel) file that can be
 * imported directly into Jira's CSV/Excel import wizard.
 *
 * Why Excel and not CSV?
 * CSV files have well-known escaping bugs — a description with commas or
 * newlines can silently corrupt every row that follows. ExcelJS generates
 * a proper binary .xlsx file that has none of those problems.
 *
 * Security notes:
 * 1. Every value from the AI goes through sanitizeCell() which strips
 *    newlines, control characters, AND neutralises spreadsheet formula
 *    injection. Any cell starting with =, +, -, @, or | is prefixed with
 *    a single quote so Excel treats it as plain text, not a formula.
 * 2. "Issue Type" is hardcoded to "Story" — it is NEVER sourced from the AI,
 *    because Jira's importer will reject the file if this field varies.
 */

import ExcelJS from 'exceljs'           // ExcelJS — the library that creates Excel files
import type { JiraStory } from './types' // our TypeScript type for a single Jira ticket

// Characters that Excel/LibreOffice/Google Sheets interpret as formula prefixes.
// Any cell value starting with one of these becomes a live formula when opened.
// OWASP recommendation: prefix such values with a single quote to force text mode.
const FORMULA_PREFIX_RE = /^[=+\-@|]/

/**
 * sanitizeCell
 *
 * Cleans a value before it is written into a spreadsheet cell:
 * 1. Replaces newlines with spaces (Jira's importer uses newlines as row delimiters).
 * 2. Strips ASCII control characters 0x00–0x1F and 0x7F (DEL) — written as
 *    Unicode escapes to satisfy the ESLint no-control-regex rule.
 * 3. Trims whitespace.
 * 4. Prefixes formula-trigger chars (=, +, -, @, |) with ' so spreadsheet apps
 *    treat the cell as plain text instead of evaluating it as a formula.
 */
function sanitizeCell(v: unknown): string {
  if (v == null) return ''

  // Inline char-code filter avoids a control-char regex literal (no-control-regex rule).
  // Strips characters 0x00–0x1F (ASCII control chars) and 0x7F (DEL).
  let result = String(v)
    .replace(/[\r\n]+/g, ' ')          // newlines → space
    .split('').filter(c => { const n = c.charCodeAt(0); return n > 31 && n !== 127 }).join('')
    .trim()

  // Neutralise spreadsheet formula injection (OWASP CSV Injection).
  // A leading single-quote signals "treat as text" in Excel, LibreOffice,
  // and Google Sheets — the quote itself is not shown to the user.
  if (FORMULA_PREFIX_RE.test(result)) {
    result = `'${result}`
  }

  return result
}

/**
 * downloadJiraXlsx
 *
 * Takes a list of Jira stories and triggers a browser file download.
 * This function is async because ExcelJS builds the file in memory and
 * returns a Buffer that we convert into a downloadable Blob URL.
 *
 * @param stories  Array of JiraStory objects from the AI result
 * @param filename What to name the downloaded file, e.g. "jira-stories.xlsx"
 */
export async function downloadJiraXlsx(stories: JiraStory[], filename: string) {
  // Create a new workbook — the top-level Excel file container.
  const wb = new ExcelJS.Workbook()

  // Add a worksheet named "Jira Import" — the tab that appears in Excel.
  const ws = wb.addWorksheet('Jira Import')

  // Define columns with headers and widths.
  // The "key" must match the property names used in addRow() below.
  ws.columns = [
    { header: 'Summary',    key: 'Summary',    width: 50 },
    { header: 'Description',key: 'Description',width: 80 },
    { header: 'Issue Type', key: 'Issue Type', width: 15 },
    { header: 'Epic Link',  key: 'Epic Link',  width: 30 },
  ]

  // Add one row per story, sanitizing every AI-sourced value.
  for (const s of stories) {
    ws.addRow({
      'Summary':     sanitizeCell(s.Summary),
      'Description': sanitizeCell(s.Description),
      'Issue Type':  'Story',                           // hardcoded — NEVER from the AI
      'Epic Link':   sanitizeCell(s['Epic Link']) || '', // null becomes empty string
    })
  }

  // Write the workbook to an ArrayBuffer in memory.
  // ExcelJS does not write directly to disk in the browser — we get a buffer
  // and turn it into a Blob that the browser can treat as a downloadable file.
  const buffer = await wb.xlsx.writeBuffer()

  // Wrap the raw bytes in a Blob with the Excel MIME type.
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })

  // Create a temporary object URL pointing at the Blob — this is the "fake" file URL.
  const url = URL.createObjectURL(blob)

  // Create a hidden <a> tag, click it programmatically to trigger the download,
  // then immediately revoke the object URL to free memory.
  const a = document.createElement('a')
  a.href = url
  a.download = filename  // the filename the user sees in their downloads folder
  a.click()
  URL.revokeObjectURL(url) // clean up — the URL is no longer needed after the click
}
