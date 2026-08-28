'use client'

// WHAT TO COMPARE AGAINST — beside the period control, never instead of it.
//
// Same contract as ?period=: ONE parameter, presets as relative strings, a
// hand-picked window as from..to on the same PERIOD_SEP. A preset stays a
// preset in the URL for the same reason it does there — a link shared on Monday
// must still mean "the previous period" when it is opened on Friday.
//
// PRESERVES THE PARAMS ALREADY ON THE URL, including ?period=. A control that
// rebuilds the query string from its own value works until a second control
// exists, and then it silently resets the first — which is the fault this app
// has already been caught by once.

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BASELINE_KEYS, BASELINE_LABELS, type BaselineParam, baselineParamValue } from '@/lib/period'

export default function BaselineControl({
  value,
  error,
}: {
  value: BaselineParam
  error: string | null
}) {
  const pathname = usePathname()
  const sp = useSearchParams()
  const current = baselineParamValue(value)

  const href = (v: string) => {
    const next = new URLSearchParams(sp.toString())
    next.set('vs', v)
    return `${pathname}?${next.toString()}`
  }

  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-xs text-stone-500">compared with</span>
      <div className="flex flex-wrap gap-1">
        {BASELINE_KEYS.map((k) => (
          <Link
            key={k}
            href={href(k)}
            aria-current={current === k ? 'true' : undefined}
            className={`rounded-lg border px-2 py-1 text-xs font-medium ${
              current === k
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-rule bg-cell text-stone-600 hover:border-emerald-400'
            }`}
          >
            {BASELINE_LABELS[k]}
          </Link>
        ))}
        {/* A hand-picked baseline is shown as its own chip once chosen, so the
            strip always says what is actually being compared against rather
            than leaving all four unselected. */}
        {typeof value !== 'string' && (
          <span className="rounded-lg border border-emerald-700 bg-emerald-700 px-2 py-1 text-xs font-medium text-white">
            {value.from} — {value.to}
          </span>
        )}
      </div>
      {error !== null && (
        <p role="alert" className="w-full text-xs text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
