/**
 * tabs.tsx
 *
 * A minimal "tabs" UI primitive — the row of clickable tab labels (like "Minutes",
 * "Jira Stories", "Diagrams") and the panel that shows the active tab's content.
 *
 * This is hand-written rather than imported from a library to keep the bundle small
 * and to avoid adding dependencies. It follows the same API shape as shadcn/ui.
 *
 * How tabs work:
 * - <Tabs value={activeTab} onValueChange={setActiveTab}> wraps everything.
 *   It owns the "which tab is active" state via the value + onValueChange props.
 * - <TabsList> is the horizontal bar that holds the clickable tab buttons.
 * - <TabsTrigger value="minutes"> is one clickable tab button.
 * - <TabsContent value="minutes"> is the content shown when that tab is active.
 *   Content for inactive tabs is hidden (but still rendered in the DOM).
 */

import React from 'react'

// ── Tabs (root) ────────────────────────────────────────────────────────────────

// TabsProps defines what the <Tabs> component needs.
interface TabsProps {
  value: string                      // which tab is currently selected
  onValueChange: (v: string) => void // called when the user clicks a different tab
  children: React.ReactNode          // the TabsList and TabsContent components
  className?: string                 // optional extra CSS classes for layout
}

/**
 * Tabs
 * The root wrapper. It passes "value" and "onValueChange" down to children
 * via a React Context so we don't have to prop-drill through TabsList → TabsTrigger.
 */

// TabsContext lets child components (TabsTrigger, TabsContent) read the active tab
// and call the change handler without receiving them directly as props.
const TabsContext = React.createContext<{ value: string; onValueChange: (v: string) => void }>({
  value: '',
  onValueChange: () => {},
})

export function Tabs({ value, onValueChange, children, className }: TabsProps) {
  return (
    // Provide the context to all children inside <Tabs>
    <TabsContext.Provider value={{ value, onValueChange }}>
      <div className={className}>{children}</div>
    </TabsContext.Provider>
  )
}

// ── TabsList ──────────────────────────────────────────────────────────────────

// TabsListProps defines what the <TabsList> container needs.
interface TabsListProps {
  children: React.ReactNode  // the <TabsTrigger> buttons
  className?: string
}

/**
 * TabsList
 * A grey rounded bar that holds the tab trigger buttons side-by-side.
 */
export function TabsList({ children, className }: TabsListProps) {
  return (
    <div
      // Inline-flex so the bar only takes up as much width as the buttons inside it.
      // bg-gray-100 gives it the light grey background typical of tab bars.
      className={['inline-flex rounded-lg bg-gray-100 p-1 gap-1', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}

// ── TabsTrigger ───────────────────────────────────────────────────────────────

// TabsTriggerProps defines what each clickable tab button needs.
interface TabsTriggerProps {
  value: string             // the tab ID this button activates (must match a TabsContent value)
  children: React.ReactNode // the label shown on the button
}

/**
 * TabsTrigger
 * A single clickable tab label. It reads the current active tab from context
 * and applies a white background + shadow when it is the active one.
 */
export function TabsTrigger({ value, children }: TabsTriggerProps) {
  // Read the active tab and the change handler from the nearest <Tabs> ancestor.
  const { value: activeValue, onValueChange } = React.useContext(TabsContext)

  // isActive — true when this trigger's value matches the currently selected tab.
  const isActive = value === activeValue

  return (
    <button
      type="button"
      onClick={() => onValueChange(value)} // tell Tabs to switch to this tab
      className={[
        'rounded-md px-3 py-1.5 text-sm font-medium transition-all',
        isActive
          ? 'bg-white text-gray-900 shadow-sm'  // active style: white pill with shadow
          : 'text-gray-500 hover:text-gray-700', // inactive style: grey text
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── TabsContent ───────────────────────────────────────────────────────────────

// TabsContentProps defines what each content panel needs.
interface TabsContentProps {
  value: string             // the tab ID this panel belongs to (must match a TabsTrigger value)
  children: React.ReactNode // the content to show when this tab is active
  className?: string
}

/**
 * TabsContent
 * A content panel that is visible only when its value matches the active tab.
 * Inactive panels use `hidden` (display: none) rather than being unmounted,
 * so their scroll positions and internal state are preserved when switching tabs.
 */
export function TabsContent({ value, children, className }: TabsContentProps) {
  const { value: activeValue } = React.useContext(TabsContext)

  // When this panel is not active, hide it with the CSS "hidden" class.
  // The content is still rendered in the DOM — just invisible.
  const isActive = value === activeValue

  return (
    <div className={[isActive ? '' : 'hidden', className].filter(Boolean).join(' ')}>
      {children}
    </div>
  )
}
