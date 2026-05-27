import mermaid from 'mermaid'
import type { ActionItem } from './types'

mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' })

function buildFallbackDiagram(actionItems: ActionItem[]): string {
  if (actionItems.length === 0) {
    return 'flowchart TD\n  A[No action items]'
  }
  const lines = ['flowchart TD']
  actionItems.slice(0, 8).forEach((item, i) => {
    const label = item.task
      .replace(/[^A-Za-z0-9 _-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 50)
    lines.push(`  A${i}[${label}]`)
    if (i > 0) lines.push(`  A${i - 1} --> A${i}`)
  })
  return lines.join('\n')
}

export async function safeRenderMermaid(
  diagram: string,
  id: string,
  fallbackActionItems: ActionItem[] = [],
): Promise<{ ok: boolean; svg: string; reason?: string }> {
  try {
    await mermaid.parse(diagram)
    const { svg } = await mermaid.render(id, diagram)
    return { ok: true, svg }
  } catch (err) {
    const fallback = buildFallbackDiagram(fallbackActionItems)
    const { svg } = await mermaid.render(`${id}-fb`, fallback)
    return { ok: false, svg, reason: String(err) }
  }
}
