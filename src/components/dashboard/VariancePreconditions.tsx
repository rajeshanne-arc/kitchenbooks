import Link from 'next/link'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { formatMoneyString } from '@/lib/money'
import type { VariancePreconditions as Preconditions } from '@/lib/variance'

// WHAT ACTUAL-VS-THEORETICAL IS WAITING FOR — four legs, each with its count
// and a door.
//
// THE EMPTY STATE IS THE FEATURE, for now. This report is a day's build
// sitting in front of weeks of data entry, and 70 dishes carry 80% of the
// revenue. A generic "not enough data yet" makes that invisible; naming the
// four with their figures is what makes the entry legible — a chef asked for
// a nightly closing every night deserves to see the thing it produces.
//
// EVERY LINK GATES ITSELF, the DateLink rule. This block renders on the
// department page (chef, manager, owner) and the owner dashboard (manager,
// owner), and the chef cannot open /store/issue — they lost the store books
// entirely, with /kitchen/indent the one carve-out. A hard-coded href here
// would be LAW 1 broken in the smallest possible way and audit:matrix would
// catch it, so the matrix is asked instead: a denied reader gets the same
// sentence and the same count, without a door they never had.

type Leg = {
  key: string
  /** what is missing, in the words of the job */
  label: string
  /** the figure — always stated, never implied by the absence of one */
  figure: string
  done: boolean
  href: string
  cta: string
}

function legs(p: Preconditions): Leg[] {
  return [
    {
      key: 'mapping',
      label: 'POS items pointed at a dish, a stock item or a department',
      figure:
        p.itemsSeen === 0
          ? 'no POS day fetched yet'
          : `${p.itemsMapped} of ${p.itemsSeen} · ${formatMoneyString(p.unattributed)} still unattributed`,
      done: p.itemsSeen > 0 && p.itemsMapped === p.itemsSeen,
      href: '/sales/books/sales/mapping',
      cta: 'Mapping queue',
    },
    {
      key: 'dishes',
      // THE ERRAND IS NAMED FROM WHAT IS ACTUALLY WRONG. A dish with a cost
      // and no portion count needs a number typed; a dish with no cost needs
      // a bill entered. Live today it is the first: Chicken 65 costs ₹316.67
      // and has no portions.
      label:
        p.dishesNoPortions > 0
          ? 'dishes with a portion count — a batch cost divided by nothing is nothing'
          : 'dishes with a costable recipe',
      figure:
        p.dishesTotal === 0
          ? 'no dishes yet'
          : `${p.dishesCostable} of ${p.dishesTotal}` +
            (p.dishesNoPortions > 0 ? ` · ${p.dishesNoPortions} with no portion count` : '') +
            (p.dishesUncosted > 0 ? ` · ${p.dishesUncosted} with no cost behind them` : ''),
      done: p.dishesTotal > 0 && p.dishesCostable === p.dishesTotal,
      href: '/kitchen/recipes',
      cta: 'Recipes',
    },
    {
      key: 'issues',
      label: 'issues recorded — what actually left the store',
      figure: p.issues === 0 ? 'none this month' : `${p.issues} this month`,
      done: p.issues > 0,
      href: '/store/issue',
      cta: 'Issue',
    },
    {
      key: 'closings',
      label: 'departments that said what they still hold',
      figure: `${p.closingsFiled} of ${p.closableSections} closed`,
      done: p.closableSections > 0 && p.closingsFiled === p.closableSections,
      href: '/kitchen/shift/closing',
      cta: 'Closing',
    },
  ]
}

export default async function VariancePreconditions({ p }: { p: Preconditions }) {
  const user = await getSessionUser()
  const rows = legs(p)
  return (
    <ul className="mt-0.5 space-y-1.5">
      {rows.map((leg) => {
        const open = user !== null && canAccess(user.role, leg.href)
        return (
          <li key={leg.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[13px]">
            <span
              aria-hidden
              className={`h-[11px] w-[11px] shrink-0 translate-y-[1px] rounded-[2px] border ${
                leg.done ? 'border-emerald-700 bg-emerald-700' : 'border-dashed border-stone-400 bg-cell'
              }`}
            />
            <span className="text-stone-600">{leg.label}</span>
            <span className="font-mono text-[12px] tabular-nums text-stone-900">{leg.figure}</span>
            {!leg.done && open && (
              <Link href={leg.href} className="text-[12px] font-medium text-emerald-700 hover:underline">
                {leg.cta} →
              </Link>
            )}
          </li>
        )
      })}
    </ul>
  )
}
