import { useEffect, useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { isComposing } from '../lib/text'

// ---------------------------------------------------------------------------
// Icons (inline SVG, inherit currentColor)
// ---------------------------------------------------------------------------

const paths = {
  back: 'M15 18l-6-6 6-6',
  gear: 'M12 15a3 3 0 100-6 3 3 0 000 6zm7.4-3a7.4 7.4 0 00-.1-1.2l2-1.6-2-3.4-2.4 1a7.3 7.3 0 00-2-1.2L14.5 3h-4l-.4 2.6a7.3 7.3 0 00-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 000 2.4l-2 1.6 2 3.4 2.4-1a7.3 7.3 0 002 1.2l.4 2.6h4l.4-2.6a7.3 7.3 0 002-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z',
  plus: 'M12 5v14M5 12h14',
  x: 'M6 6l12 12M18 6L6 18',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zm9 3l-4.35-4.35',
  speaker: 'M11 5L6 9H2v6h4l5 4V5zm4.5 3.5a5 5 0 010 7M18.4 5.6a9 9 0 010 12.8',
  chart: 'M4 20V10m6 10V4m6 16v-7m4 7H2',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 20h16',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3',
} as const

export function Icon({ name, className = 'h-5 w-5' }: { name: keyof typeof paths; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Page({
  title,
  back,
  actions,
  children,
  footer,
}: {
  title: ReactNode
  back?: string
  actions?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="pt-safe px-safe sticky top-0 z-20 border-b border-slate-200/80 bg-slate-50/90 backdrop-blur dark:border-slate-800 dark:bg-slate-950/90">
        <div className="mx-auto flex h-14 max-w-2xl items-center gap-1 px-2">
          {back !== undefined ? (
            <a href={`#${back}`} className="tap-icon" aria-label="Back">
              <Icon name="back" className="h-6 w-6" />
            </a>
          ) : (
            <span className="w-2" />
          )}
          <h1 className="hangul min-w-0 flex-1 truncate text-lg font-semibold">{title}</h1>
          {actions}
        </div>
      </header>
      <main className="px-safe mx-auto w-full max-w-2xl flex-1 px-4 pt-4 pb-[calc(1.5rem+var(--sab))]">
        {children}
      </main>
      {footer}
    </div>
  )
}

/** Bottom bar, thumb-reachable on phones. */
export function BottomBar({ children }: { children: ReactNode }) {
  return (
    <div className="pb-safe px-safe sticky bottom-0 z-20 border-t border-slate-200 bg-slate-50/95 backdrop-blur dark:border-slate-800 dark:bg-slate-950/95">
      <div className="mx-auto max-w-2xl px-3 py-3">{children}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
const variants: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-500 active:bg-indigo-700 disabled:bg-indigo-300 dark:disabled:bg-indigo-900',
  secondary:
    'bg-white text-slate-800 ring-1 ring-slate-300 hover:bg-slate-100 active:bg-slate-200 dark:bg-slate-900 dark:text-slate-100 dark:ring-slate-700 dark:hover:bg-slate-800',
  danger: 'bg-rose-600 text-white hover:bg-rose-500 active:bg-rose-700',
  ghost: 'text-slate-700 hover:bg-slate-200/70 dark:text-slate-200 dark:hover:bg-slate-800',
}

export function Button({
  variant = 'secondary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type="button"
      {...props}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 font-medium transition-colors select-none disabled:cursor-not-allowed ${variants[variant]} ${className}`}
    />
  )
}

export const inputClass =
  'w-full rounded-xl border-0 bg-white px-3 py-2.5 ring-1 ring-slate-300 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-500 dark:bg-slate-900 dark:ring-slate-700'

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-600 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  )
}

/**
 * Attach to forms as onKeyDownCapture: swallows the Enter that confirms a Hangul
 * syllable so it can't submit the form (or trigger shortcuts) mid-composition.
 */
export function imeGuard(e: KeyboardEvent) {
  if (e.key === 'Enter' && isComposing(e)) {
    e.preventDefault()
    e.stopPropagation()
  }
}

export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) onClose()
    }
    window.addEventListener('keydown', onKey)
    ref.current?.querySelector<HTMLElement>('input,textarea,select,button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="pb-safe w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-4 text-lg font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  )
}

export function Stat({ label, value, tone = '' }: { label: string; value: ReactNode; tone?: string }) {
  return (
    <div className="flex flex-col items-center">
      <span className={`text-xl font-bold tabular-nums ${tone}`}>{value}</span>
      <span className="text-xs text-slate-500">{label}</span>
    </div>
  )
}
