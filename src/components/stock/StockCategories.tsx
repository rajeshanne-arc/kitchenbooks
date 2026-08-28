'use client'

import { useCallback, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import StockLine from '@/components/stock/StockLine'
import type { Role } from '@/lib/roles'
import type { CategoryRollupRow, StockRow } from '@/lib/types'

/**
 * THE CATEGORY FOLD — expands IN PLACE, capped at ten.
 *
 * The earlier ruling here was navigate-don't-expand, on fan-out: Dry Goods is
 * 115 items against a busiest purchase day of 25 bills. The numbers were right
 * and the conclusion was wrong — it priced expansion's cost and never priced
 * NAVIGATION's, which is a round trip, a scroll jump, and the loss of the
 * summary the reader was looking at.
 *
 * THE CAP IS WHY BOTH CAN BE TRUE. 115 and 25 are not the same problem, so a
 * category reveals its TOP TEN BY VALUE and one line for the rest — carrying
 * the VALUE, never a bare count, because six large items and a hundred trivial
 * ones read identically to six and a hundred comparable ones. "See all"
 * navigates to ?cat=, which is unchanged.
 *
 * ?cat= AND ?open= ARE DIFFERENT THINGS and both keep working: cat is the full
 * filtered list, open is a peek. A peek that had to fetch would be worse than
 * the link it replaced — it would hang where a link at least goes somewhere —
 * so the items are loaded with the page and this component only slices them.
 */

const CAP = 10

export default function StockCategories({
  groups,
  items,
  totalPaise,
  role,
}: {
  groups: CategoryRollupRow[]
  /** every stock row, already on the page — this component fetches NOTHING */
  items: StockRow[]
  totalPaise: number
  role: Role
}) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  const [open, setOpen] = useState<string | null>(sp.get('open'))

  const toggle = useCallback(
    (key: string | null) => {
      setOpen(key)
      const params = new URLSearchParams(sp.toString())
      if (key === null) params.delete('open')
      else params.set('open', key)
      const qs = params.toString()
      router.replace((qs === '' ? pathname : `${pathname}?${qs}`) as Parameters<typeof router.replace>[0], {
        scroll: false,
      })
    },
    [pathname, router, sp],
  )

  return (
    <ul className="mt-1.5 divide-y divide-rule-soft overflow-hidden rounded-2xl border border-rule bg-cell">
      {groups.map((g) => {
        const key = g.category || 'unclassified'
        const isOpen = open === key
        // ONE DENOMINATOR THROUGHOUT — every percentage is against the whole
        // stock value, so a row and a heading never need explaining against
        // each other.
        const share = totalPaise > 0 ? (decimalStringToPaise(g.value) / totalPaise) * 100 : 0
        const mine = items.filter((r) => (r.category || '') === g.category)
        const shown = mine.slice(0, CAP)
        const rest = mine.slice(CAP)
        // THE TAIL IS THE SUBTOTAL MINUS WHAT IS SHOWN, not a second sum of
        // its own rows — and that is correctness, not convenience.
        //
        // `on_hand_value` is qty x a weighted average carrying eighteen
        // decimals. Summing 105 of them AFTER rounding each to paise does not
        // equal rounding their true sum once, which is what the header above
        // does in SQL: measured, Dry Goods came out a paise high, Vegetables
        // and Sauces a paise low. Nothing was missing — rounding is simply not
        // associative, and this is the third independent arrival at that in
        // this codebase.
        //
        // Deriving the remainder makes the two halves add to the header BY
        // CONSTRUCTION. The real question — did an item fall out of the fold —
        // is not answerable by this arithmetic anyway, so it is asked exactly,
        // in SQL, in the gate.
        const subPaise = decimalStringToPaise(g.value)
        const shownPaise = shown.reduce((n, r) => n + decimalStringToPaise(r.on_hand_value), 0)
        const restPaise = subPaise - shownPaise

        return (
          <li key={key}>
            <button
              type="button"
              onClick={() => toggle(isOpen ? null : key)}
              aria-expanded={isOpen}
              className={`block w-full px-4 py-3 text-left hover:bg-stone-50 ${isOpen ? 'bg-stone-50' : ''}`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-[15px] font-medium text-stone-900">
                  <span
                    aria-hidden
                    className={`mr-1.5 inline-block text-stone-400 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                  >
                    ›
                  </span>
                  {g.category_name}
                  <span className="ml-2 text-xs font-normal text-stone-500">
                    {g.items} item{g.items === 1 ? '' : 's'}
                  </span>
                  {/* A FOLDED CATEGORY CANNOT HIDE A NEGATIVE. Unexercised
                      today — negative stock needs issues exceeding purchases
                      — so this path has never rendered against real data. */}
                  {g.negatives > 0 && (
                    <span className="ml-2 rounded-full border border-red-200 bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-700">
                      {g.negatives} negative
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-mono text-[15px] font-bold tabular-nums text-stone-900">
                    {formatMoneyString(g.value)}
                  </span>
                  <span className="ml-2 font-mono text-[11px] tabular-nums text-stone-400">
                    {share.toFixed(1)}%
                  </span>
                </span>
              </div>
              <div
                className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-stone-100"
                role="img"
                aria-label={`${g.category_name} is ${share.toFixed(1)}% of stock value`}
              >
                <div
                  className="h-full rounded-full bg-emerald-700"
                  style={{ width: `${Math.max(share, 0.5)}%` }}
                />
              </div>
            </button>

            {isOpen && (
              <div className="border-t border-rule-soft bg-stone-50/60 px-4">
                <ul className="divide-y divide-rule-soft">
                  {shown.map((r) => (
                    <StockLine key={r.item_id} r={r} role={role} showCategory={false} />
                  ))}
                </ul>
                {rest.length > 0 && (
                  <p className="py-2.5 text-xs text-stone-500">
                    {rest.length} more {rest.length === 1 ? 'item' : 'items'} · {formatPaise(restPaise)} ·{' '}
                    <Link
                      href={`?cat=${encodeURIComponent(g.category)}`}
                      className="font-medium text-emerald-800 underline underline-offset-2"
                    >
                      see all →
                    </Link>
                  </p>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
