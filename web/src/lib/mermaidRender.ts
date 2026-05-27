/**
 * mermaidRender.ts
 *
 * Safely renders Mermaid diagrams in the browser and provides a fallback
 * when the AI produces invalid diagram syntax.
 *
 * What is Mermaid?
 * Mermaid is a text-based diagramming language. You write something like:
 *   flowchart TD
 *     A[Start] --> B[End]
 * ...and Mermaid turns it into an SVG image (a vector diagram).
 *
 * Why do we need a "safe" render?
 * The AI can sometimes produce Mermaid syntax that looks valid but fails
 * to parse — for example, using a reserved keyword as a node name. If we
 * just call mermaid.render() directly and it throws, the user sees a blank
 * tab or a crash. Instead, safeRenderMermaid() catches the error and draws
 * a simple fallback diagram made from the meeting's action items so the
 * tab is never empty.
 */

import mermaid from 'mermaid'
import type { ActionItem } from './types'

// Tell Mermaid not to start automatically when the page loads (we call it manually),
// and use "strict" security mode which prevents the diagram from running JavaScript.
mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

/**
 * buildFallbackDiagram
 *
 * Creates a simple top-down flowchart from the meeting's action items.
 * This is used when the AI's diagram fails to parse — it guarantees the
 * Diagrams tab always shows something meaningful rather than a blank screen.
 *
 * @param actionItems  The action items from the meeting minutes
 * @returns  A valid Mermaid flowchart string
 */
function buildFallbackDiagram(actionItems: ActionItem[]): string {
  // If there are no action items at all, show a simple placeholder node.
  if (actionItems.length === 0) {
    return 'flowchart TD\n  A[No action items]'
  }

  const lines = ['flowchart TD'] // start the diagram declaration

  // Take up to 8 action items (more than that makes the diagram unreadable).
  actionItems.slice(0, 8).forEach((item, i) => {
    // Strip any characters Mermaid doesn't allow inside node labels.
    // Only letters, numbers, spaces, underscores, and hyphens are safe.
    const label = item.task
      .replace(/[^A-Za-z0-9 _-]/g, ' ') // replace unsafe chars with spaces
      .replace(/\s+/g, ' ')              // collapse multiple spaces into one
      .trim()
      .slice(0, 50)                      // cap at 50 chars to keep the node readable

    lines.push(`  A${i}[${label}]`)      // e.g.  A0[Review PR for auth module]

    // Connect each node to the previous one with an arrow, forming a chain.
    if (i > 0) lines.push(`  A${i - 1} --> A${i}`)
  })

  return lines.join('\n') // join all lines into a single string
}

/**
 * safeRenderMermaid
 *
 * Tries to parse and render a Mermaid diagram. If parsing fails, renders a
 * fallback diagram instead. Never throws — always returns an SVG string.
 *
 * @param diagram             The Mermaid syntax string from the AI
 * @param id                  A unique HTML element ID for this diagram (Mermaid requires one)
 * @param fallbackActionItems Action items to use if the diagram is invalid
 * @returns  { ok, svg, reason? }
 *           ok     — true if the AI's diagram rendered, false if the fallback was used
 *           svg    — the SVG markup string ready to inject into the DOM
 *           reason — the error message if ok is false
 */
export async function safeRenderMermaid(
  diagram: string,
  id: string,
  fallbackActionItems: ActionItem[] = [],
): Promise<{ ok: boolean; svg: string; reason?: string }> {
  try {
    // mermaid.parse() throws an error if the syntax is invalid.
    // We call it before render() so we can catch the error cleanly.
    await mermaid.parse(diagram)

    // If parse() succeeded, render the diagram into an SVG string.
    const { svg } = await mermaid.render(id, diagram)

    return { ok: true, svg }
  } catch (err) {
    // The AI's diagram was invalid — build and render the fallback instead.
    const fallback = buildFallbackDiagram(fallbackActionItems)
    const { svg } = await mermaid.render(`${id}-fb`, fallback) // "-fb" suffix avoids ID collision

    return { ok: false, svg, reason: String(err) }
  }
}
