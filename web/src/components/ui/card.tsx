/**
 * card.tsx
 *
 * A minimal "card" UI primitive — a white rounded box with a subtle border and
 * shadow, used to group related content visually.
 *
 * Cards are the main visual container in MeetingDetail:
 *   - The status card shows processing progress.
 *   - Minute-detail cards show agenda items, decisions, and action items.
 *   - Jira story cards show one ticket each.
 *   - Diagram cards show a rendered SVG flowchart or sequence diagram.
 *
 * Like the tabs primitive, this is hand-written to match shadcn/ui's API shape
 * without adding library dependencies.
 */

import React from 'react'

// ── Card (root) ───────────────────────────────────────────────────────────────

// CardProps — all props are optional so <Card /> works with any combination.
interface CardProps {
  children?: React.ReactNode
  className?: string          // optional extra classes for sizing, spacing, etc.
}

/**
 * Card
 * The outer container. White background, rounded corners, border, and a light
 * shadow to lift it above the page background.
 */
export function Card({ children, className }: CardProps) {
  return (
    <div
      className={[
        'rounded-xl border border-gray-200 bg-white shadow-sm',
        className,
      ].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

// ── CardHeader ─────────────────────────────────────────────────────────────────

/**
 * CardHeader
 * Optional section at the top of the card for a title and subtitle row.
 * Uses padding and a bottom border to separate it from the body.
 */
export function CardHeader({ children, className }: CardProps) {
  return (
    <div className={['px-6 py-4 border-b border-gray-100', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}

// ── CardTitle ──────────────────────────────────────────────────────────────────

/**
 * CardTitle
 * A styled heading element for use inside <CardHeader>.
 */
export function CardTitle({ children, className }: CardProps) {
  return (
    <h3 className={['text-base font-semibold text-gray-900', className].filter(Boolean).join(' ')}>
      {children}
    </h3>
  )
}

// ── CardContent ───────────────────────────────────────────────────────────────

/**
 * CardContent
 * The main body of the card. Just padding — the children provide the layout.
 */
export function CardContent({ children, className }: CardProps) {
  return (
    <div className={['px-6 py-4', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
