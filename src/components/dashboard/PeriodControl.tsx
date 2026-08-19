'use client'

// ONE filter row, above everything it scopes — never a filter per card, or two
// cards end up answering about two different months and the page quietly
// contradicts itself.
//
// PLAIN LINKS FOR THE PRESETS, so the period survives a reload, a bookmark and
// a WhatsApp paste — the owner sending "look at last month" wants the link to
// open on last month. The custom range carries the same property: it is one
// URL parameter, ?period=2026-08-01..2026-08-17, not a pair, so a pasted link
// is whole or it is nothing.
//
// A CLIENT COMPONENT NOW, for two reasons that are not the date inputs. It
// must read the CURRENT query string in order to keep it: the server version
// built every href from basePath alone and therefore wiped every other
// parameter, which already reset the who/what filters on /owner/activity on
// every period click. And with a range live no preset is active, so the strip
// used to render with nothing selected and read as broken.
//
// THE RESOLVED RANGE IS ALWAYS IN WORDS, preset or custom. A label alone —
// "This month" — leaves the reader guessing whether it ends today or at month
// end, and four pages print period.label as the only thing naming their scope.

import { useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  PERIOD_KEYS,
  PERIOD_SEP,
  isDate,
  type Period,
  type PeriodKey,
} from '@/lib/period'
import { fmtRange } from '@/lib/format'
import { inputCls } from '@/components/ui'

const LABELS: Record<PeriodKey, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
}

export default function PeriodControl({
  period,
  basePath = '/owner',
  error = null,
}: {
  /** the RESOLVED period, so the control can state the range it actually
   *  covers rather than only the name of the button that was pressed */
  period: Period
  /** the page the control scopes */
  basePath?: string
  /** a refusal to show beside the strip — a reversed range is a mistake
   *  somebody can fix, and swallowing it would leave them reading figures for a
   *  period they did not ask for and never noticed they did not ask for */
  error?: string | null
}) {
  const router = useRouter()
  const params = useSearchParams()
  const custom = typeof period.key !== 'string'
  const [open, setOpen] = useState(custom)
  const [from, setFrom] = useState(custom ? period.from : '')
  const [to, setTo] = useState(custom ? period.to : '')

  /** Keep every other query parameter. The old version dropped them all. */
  const href = (value: string | null) => {
    const next = new URLSearchParams(params.toString())
    if (value === null) next.delete('period')
    else next.set('period', value)
    const q = next.toString()
    return q === '' ? basePath : `${basePath}?${q}`
  }

  const bothPicked = isDate(from) && isDate(to)
  const backwards = bothPicked && to < from
  const apply = () => {
    if (!bothPicked || backwards) return
    router.push(href(`${from}${PERIOD_SEP}${to}`))
  }

  const pill = (active: boolean) =>
    `rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
      active
        ? 'border-emerald-700 bg-emerald-700 text-white'
        : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
    }`

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
        {PERIOD_KEYS.map((k) => (
          <Link
            key={k}
            href={href(k === 'this-month' ? null : k)}
            aria-current={period.key === k ? 'true' : undefined}
            className={pill(period.key === k)}
          >
            {LABELS[k]}
          </Link>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-current={custom ? 'true' : undefined}
          className={pill(custom)}
        >
          {custom ? fmtRange(period.from, period.to) : 'Dates…'}
        </button>
      </div>

      {open && (
        <div className="flex flex-wrap items-end gap-2 rounded-xl border border-rule bg-cell p-2.5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-stone-500">From</span>
            <input
              type="date"
              value={from}
              max={to === '' ? undefined : to}
              onChange={(e) => setFrom(e.target.value)}
              className={`${inputCls} w-[9.5rem]`}
              aria-label="Range start"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-stone-500">To</span>
            <input
              type="date"
              value={to}
              min={from === '' ? undefined : from}
              onChange={(e) => setTo(e.target.value)}
              className={`${inputCls} w-[9.5rem]`}
              aria-label="Range end"
            />
          </label>
          <button
            type="button"
            onClick={apply}
            disabled={!bothPicked || backwards}
            className="min-h-[40px] rounded-xl bg-emerald-700 px-4 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Show
          </button>
          {custom && (
            <Link href={href(null)} className="min-h-[40px] px-2 py-2 text-sm font-medium text-stone-500 hover:text-stone-800">
              clear
            </Link>
          )}
          {/* NAMED, not swapped. The server refuses it too — this is the
              courtesy, the refusal in readPeriodParam is the rule. */}
          {backwards && (
            <p className="basis-full text-xs text-red-700">
              The start is later than the end — swap them.
            </p>
          )}
        </div>
      )}

      {/* ALWAYS in words, preset or custom. */}
      <p className="text-xs text-stone-500">
        {custom ? 'Custom range' : period.label} · {fmtRange(period.from, period.to)}
      </p>

      {error !== null && (
        <p role="alert" className="text-xs font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
