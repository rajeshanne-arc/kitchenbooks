'use client'

// ONE SEGMENTED CONTROL, for every "same data, different question" toggle.
//
// Built once on purpose. There are a dozen of these coming — dishes vs subs,
// detail vs summary, draft vs approved vs paid — and twelve copies would be
// twelve places for the next change, the same argument as PersonLink, DateLink
// and the ABC badge.
//
// THE CHOICE LIVES IN THE URL, like the period control, so a link survives a
// bookmark and a WhatsApp paste. The DEFAULT writes no param at all: a clean
// URL is the common case, and `?view=by-category` on every link would be noise
// that means "unchanged".
//
// AND IT PRESERVES EVERY OTHER PARAM. A page can carry a filter and a view and
// a period at once; a control that rebuilt the URL from its own value would
// silently reset the others. (FilterInput did exactly that until this landed.)

import { usePathname, useRouter, useSearchParams } from 'next/navigation'

export type ViewOption<T extends string> = {
  value: T
  label: string
  /** one line saying what question this answers — a toggle nobody understands
   *  is a toggle nobody presses */
  hint?: string
}

export default function ViewToggle<T extends string>({
  param,
  value,
  options,
  defaultValue,
  label,
}: {
  /** the URL key, e.g. 'view' */
  param: string
  /** the resolved current value — decided server-side, never guessed here */
  value: T
  options: ViewOption<T>[]
  /** the option that writes NO param */
  defaultValue: T
  /** what the control is choosing between, for a screen reader */
  label: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()

  function go(next: T) {
    if (next === value) return
    const params = new URLSearchParams(sp.toString())
    if (next === defaultValue) params.delete(param)
    else params.set(param, next)
    const qs = params.toString()
    router.replace((qs === '' ? pathname : `${pathname}?${qs}`) as Parameters<typeof router.replace>[0], {
      scroll: false,
    })
  }

  const active = options.find((o) => o.value === value)

  return (
    <div className="mt-4">
      <div
        role="group"
        aria-label={label}
        className="inline-flex rounded-xl border border-rule bg-cell p-0.5"
      >
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => go(o.value)}
              className={`min-h-[40px] rounded-[10px] px-3.5 text-[13px] font-medium transition-colors ${
                on
                  ? 'bg-emerald-700 text-white'
                  : 'text-stone-600 hover:bg-stone-100 hover:text-stone-900'
              }`}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      {active?.hint !== undefined && (
        <p className="mt-1.5 text-xs text-stone-500">{active.hint}</p>
      )}
    </div>
  )
}
