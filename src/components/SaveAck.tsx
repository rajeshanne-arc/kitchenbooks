'use client'

// THE SAVE ACKNOWLEDGEMENT — one shape, every form.
//
// Rajesh's ask, and it is three rules rather than a widget:
//
//   a) SAY NUMBERS, NOT "SAVED SUCCESSFULLY". "63 marked", "₹1,256 — Sneha
//      is now owed ₹4,256", "5 kg to Chinese, 15 kg left". A count is proof;
//      a checkmark is a claim.
//   b) NAME WHAT IS STILL MISSING — 2 unmarked, a line with no cost, a day
//      unclosed. The honesty discipline at the one moment somebody can still
//      fix it, which is why `missing` takes the same <Honesty> strips the
//      rest of the app uses rather than inventing a second voice.
//   c) The form BENEATH is already reset for the next entry, keeping what
//      carries — the date stays, the vendor clears. This component does not
//      do that itself; each form decides what carries, because that answer
//      differs per form and is the same judgement as the header/lines split.
//
// IT RENDERS IN PLACE, above the form, and SCROLLS ITSELF INTO VIEW. The
// save button sits at the bottom of a phone screen; an acknowledgement at
// the top that nobody ever sees is the same as no acknowledgement at all.
// The scroll honours prefers-reduced-motion like every other movement here.

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import Honesty, { type HonestyLevel } from '@/components/Honesty'

export type Missing = {
  level?: HonestyLevel
  verdict: string
  text: React.ReactNode
  meter?: { filled: number; total: number; unit: string }
}

export default function SaveAck({
  headline,
  sub,
  missing,
  actions,
  onDismiss,
  children,
}: {
  /** the numbers — never a bare "Saved" */
  headline: React.ReactNode
  /** date, department, whatever names WHICH entry this was */
  sub?: React.ReactNode
  /** what is still owed, said while it can still be fixed */
  missing?: Missing[]
  /** where to go and look at it, never where to go and do it again */
  actions?: { href: string; label: string }[]
  onDismiss?: () => void
  children?: React.ReactNode
}) {
  const ref = useRef<HTMLElement>(null)
  useEffect(() => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' })
  }, [])

  return (
    <section
      ref={ref}
      role="status"
      aria-live="polite"
      className="scroll-mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-100">
          <svg className="h-4 w-4 text-emerald-700" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M4 10.5 8.5 15 16 6"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[17px] font-bold leading-snug text-stone-900">{headline}</h2>
          {sub !== undefined && <p className="mt-0.5 text-sm text-stone-500">{sub}</p>}
        </div>
        {onDismiss !== undefined && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="-mr-1 -mt-1 shrink-0 rounded-lg px-2 py-1 text-lg leading-none text-stone-400 hover:bg-emerald-100 hover:text-stone-600"
          >
            ×
          </button>
        )}
      </div>

      {children !== undefined && <div className="mt-3">{children}</div>}

      {missing !== undefined && missing.length > 0 && (
        <div className="mt-3 space-y-2">
          {missing.map((m, i) => (
            <Honesty key={i} level={m.level} verdict={m.verdict} meter={m.meter} compact>
              {m.text}
            </Honesty>
          ))}
        </div>
      )}

      {actions !== undefined && actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
          {actions.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900"
            >
              {a.label} →
            </Link>
          ))}
        </div>
      )}
    </section>
  )
}
