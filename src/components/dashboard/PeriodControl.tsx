import Link from 'next/link'
import { PERIOD_KEYS, type PeriodKey } from '@/lib/period'

// ONE filter row, above everything it scopes. Plain links, so the period
// survives a reload, a bookmark and a WhatsApp paste — the owner sending
// "look at last month" wants the link to open on last month.

const LABELS: Record<PeriodKey, string> = {
  'this-month': 'This month',
  'last-month': 'Last month',
  'last-3-months': 'Last 3 months',
}

export default function PeriodControl({
  active,
  basePath = '/owner',
}: {
  active: PeriodKey
  /** the page the control scopes — the owner dashboard and the store's own */
  basePath?: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Period">
      {PERIOD_KEYS.map((k) => (
        <Link
          key={k}
          href={k === 'this-month' ? basePath : `${basePath}?period=${k}`}
          aria-current={k === active ? 'true' : undefined}
          className={`rounded-full border px-3.5 py-2 text-sm font-medium transition-colors ${
            k === active
              ? 'border-emerald-700 bg-emerald-700 text-white'
              : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
          }`}
        >
          {LABELS[k]}
        </Link>
      ))}
    </div>
  )
}
