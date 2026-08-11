'use client'

// A value that exists to be COPIED, not read. An account number is retyped
// into a bank app under time pressure and a single transposed digit sends
// the money to a stranger, so the machine does the copying.
//
// The value is shown in mono at a readable size and grouped where grouping
// is conventional (account numbers in fours), because the human still has to
// verify it against an invoice.

import { useState } from 'react'

export default function CopyField({
  label,
  value,
  /** group long digit strings in fours, the way a bank prints them */
  group = false,
}: {
  label: string
  value: string
  group?: boolean
}) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* clipboard blocked — the value is on screen and selectable anyway */
    }
  }

  const shown = group ? value.replace(/(.{4})/g, '$1 ').trim() : value

  return (
    <div className="flex items-center justify-between gap-3 border-b border-rule-soft py-2.5 last:border-b-0">
      <div className="min-w-0">
        <div className="text-xs font-medium text-stone-500">{label}</div>
        <div className="mt-0.5 select-all break-all font-mono text-[15px] text-stone-900">{shown}</div>
      </div>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label}`}
        className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors ${
          copied
            ? 'border-emerald-700 bg-emerald-700 text-white'
            : 'border-rule bg-cell text-stone-600 hover:border-emerald-400 hover:text-emerald-700'
        }`}
      >
        {copied ? (
          'copied'
        ) : (
          <>
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
              <path d="M10.5 5.5v-1a1.5 1.5 0 0 0-1.5-1.5H4a1.5 1.5 0 0 0-1.5 1.5V9A1.5 1.5 0 0 0 4 10.5h1" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            copy
          </>
        )}
      </button>
    </div>
  )
}
