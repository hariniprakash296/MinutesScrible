/**
 * button.tsx
 *
 * A reusable Button component that can be styled in different ways (variants)
 * and sizes. This is the only button used throughout the entire app — having
 * one shared button component means the UI stays consistent everywhere.
 *
 * "shadcn-style" means it follows the same pattern as the popular shadcn/ui
 * library: Tailwind CSS classes are combined based on variant and size props,
 * and the component forwards its ref so it can be used inside forms and with
 * focus management libraries.
 *
 * Variants:
 *   default     — filled indigo button (primary action)
 *   outline     — white button with a gray border (secondary action)
 *   ghost       — no border or background (tertiary / toolbar button)
 *   destructive — filled red button (dangerous actions like delete)
 *
 * Sizes:
 *   sm — small (14px text, less padding)
 *   md — medium, the default
 *   lg — large (16px text, more padding)
 */

import { ButtonHTMLAttributes, forwardRef } from 'react'

// The Variant type limits what strings are accepted for the "variant" prop.
type Variant = 'default' | 'outline' | 'ghost' | 'destructive'

// The Size type limits what strings are accepted for the "size" prop.
type Size = 'sm' | 'md' | 'lg'

// ButtonProps extends the normal HTML button attributes so our Button can
// accept all standard HTML props (onClick, disabled, type, etc.) plus our
// custom variant and size props.
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant  // optional — defaults to 'default' if not provided
  size?: Size        // optional — defaults to 'md' if not provided
}

// Maps each variant name to its Tailwind CSS classes.
// Changing a class here updates every button with that variant across the whole app.
const variantClasses: Record<Variant, string> = {
  default:     'bg-indigo-600 text-white hover:bg-indigo-700',           // filled purple/indigo
  outline:     'border border-gray-300 text-gray-700 hover:bg-gray-50',  // white with border
  ghost:       'text-gray-700 hover:bg-gray-100',                        // invisible until hovered
  destructive: 'bg-red-600 text-white hover:bg-red-700',                 // red for dangerous actions
}

// Maps each size name to its Tailwind padding and text-size classes.
const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-sm',   // compact
  md: 'px-4 py-2 text-sm',     // default
  lg: 'px-5 py-2.5 text-base', // large
}

// forwardRef allows parent components to get a direct reference to the
// underlying <button> DOM element, which is needed for things like focus().
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = 'default', // default value if no variant prop is passed
      size = 'md',         // default value if no size prop is passed
      className = '',      // extra classes the caller can add
      ...props             // all other HTML button props (onClick, disabled, etc.)
    },
    ref // the forwarded ref from the parent
  ) => (
    <button
      ref={ref}
      className={[
        // Base classes applied to every button regardless of variant/size:
        'inline-flex items-center justify-center rounded-md font-medium', // layout + shape
        'transition-colors focus-visible:outline-none focus-visible:ring-2', // animation + accessibility focus ring
        'focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50', // focus color + disabled state
        variantClasses[variant], // colour classes from the variant map above
        sizeClasses[size],       // padding/text classes from the size map above
        className,               // any extra classes passed by the caller
      ].join(' ')} // join the array of class strings into one space-separated string
      {...props} // spread all remaining HTML attributes onto the <button> element
    />
  )
)

// displayName is used by React DevTools to show "Button" instead of
// "ForwardRef" in the component tree — makes debugging easier.
Button.displayName = 'Button'
