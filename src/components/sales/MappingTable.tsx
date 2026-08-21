'use client'

// THE MAPPING QUEUE — the whole game.
//
// Every section view in this app is fed by pos_item_map: sales_by_section,
// section_food_cost, margin, the department pages, dish quantities sold. All
// of them were built and all of them were dark, because 94% of revenue
// belonged to no department.
//
// COVERAGE IS THE HEADLINE, NOT A COUNT. "218 unmapped" reads as an
// impossible chore; "51% of revenue attributed" reads as progress. It is also
// the honest metric — mapping a water bottle and mapping the biryani are not
// the same act, and a count says they are.
//
// EVERY ROW OFFERS BOTH TARGETS. A dish gives the department AND the cost; a
// department alone gives the department, which is most of the value and the
// only honest answer for anything bought and resold. `items_costed` is the
// second number that keeps those apart.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DishOption, MappingCoverage, PosMapRow, Section, UnmappedPosItem } from '@/lib/types'
import { mapPosItem } from '@/server/sales-actions'
import { formatMoneyString, decimalStringToPaise } from '@/lib/money'
import Honesty from '@/components/Honesty'
import { cardCls, codeCls, heroNumCls, sectionHeadCls, selectCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'

/** How much of the revenue the top N rows carry. The line this feeds —
 *  "the next 7 carry another 10%" — is what turns an endless queue into a
 *  short one, by saying where the money stops being worth chasing. */
function nextChunk(rows: UnmappedPosItem[], totalPaise: number): { count: number; pct: number } | null {
  if (rows.length === 0 || totalPaise <= 0) return null
  let run = 0
  for (let i = 0; i < rows.length; i++) {
    run += decimalStringToPaise(rows[i].revenue)
    const pct = (run / totalPaise) * 100
    // stop at the first prefix worth a tenth of what is left
    if (pct >= 10 || i === rows.length - 1) return { count: i + 1, pct }
  }
  return null
}

function Coverage({ c }: { c: MappingCoverage }) {
  const pct = Number(c.pct_attributed)
  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Revenue attributed to a department</h2>
        <span className="font-mono text-[11px] text-stone-400">mapping_coverage</span>
      </div>
      <p className={`mt-2 ${heroNumCls} text-4xl ${pct >= 90 ? 'text-emerald-700' : pct >= 50 ? 'text-stone-900' : 'text-red-700'}`}>
        {c.pct_attributed}%
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-stone-200">
        <div
          className={`h-full rounded-full ${pct >= 90 ? 'bg-emerald-700' : pct >= 50 ? 'bg-amber-500' : 'bg-red-600'}`}
          style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
        />
      </div>
      <p className="mt-2 text-sm text-stone-600">
        {/* revenue_mapped is NULL when nothing is mapped — a sum over no rows
            is not a zero, and the sentence says which case this is. */}
        {c.revenue_mapped === null ? (
          <>
            None of {formatMoneyString(c.revenue_seen)} has been attributed yet.
          </>
        ) : (
          <>
            {formatMoneyString(c.revenue_mapped)} of {formatMoneyString(c.revenue_seen)} · {c.items_mapped} of{' '}
            {c.items_seen} POS items
          </>
        )}
      </p>
      {c.items_mapped > c.items_costed && (
        <div className="mt-3">
          <Honesty verdict="attributed, not costed" compact>
            {c.items_mapped - c.items_costed} of the mapped items point at a DEPARTMENT and not a dish, so their
            revenue lands in the right place and their food cost does not. That is the right answer for anything
            bought and resold; for anything cooked, a dish is the fuller one.
          </Honesty>
        </div>
      )}
    </section>
  )
}

function Row({
  u,
  dishes,
  sections,
  busy,
  onPick,
  done,
}: {
  u: UnmappedPosItem
  dishes: DishOption[]
  sections: Section[]
  busy: boolean
  onPick: (recipeId: string, sectionId: string) => void
  done: string | undefined
}) {
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="min-w-0 text-[15px] font-medium text-stone-900">
          {u.item_name ?? `POS item ${u.pos_item_id}`}
        </span>
        <span className="shrink-0 font-mono text-sm tabular-nums text-stone-900">
          {formatMoneyString(u.revenue)}
          <span className="ml-1.5 text-[11px] font-normal text-stone-400">qty {u.qty}</span>
        </span>
      </div>
      {done !== undefined ? (
        <p className="mt-1 text-sm font-medium text-emerald-700">→ {done}</p>
      ) : (
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-stone-400">
              A dish — department and cost
            </span>
            <select
              className={selectCls}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value !== '') onPick(e.target.value, '')
              }}
            >
              <option value="">— pick a dish —</option>
              {dishes.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.code} · {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Or a department — bought and resold
            </span>
            <select
              className={selectCls}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value !== '') onPick('', e.target.value)
              }}
            >
              <option value="">— pick a department —</option>
              {sections.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </li>
  )
}

export default function MappingTable({
  unmapped,
  mapped,
  dishes,
  sections,
  coverage,
  view,
}: {
  unmapped: UnmappedPosItem[]
  mapped: PosMapRow[]
  dishes: DishOption[]
  sections: Section[]
  coverage: MappingCoverage | null
  /** UNMAPPED is the queue and the default. MAPPED is a different task —
   *  reviewing a decision somebody already made — and on a 218-row queue the
   *  two do not belong on one scroll. Coverage stays above both, because it
   *  is the headline either way. */
  view: 'unmapped' | 'mapped'
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [done, setDone] = useState<Record<string, string>>({})
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)
  const [cov, setCov] = useState(coverage)

  const remaining = useMemo(() => unmapped.filter((u) => done[u.pos_item_id] === undefined), [unmapped, done])
  const remainingPaise = useMemo(
    () => remaining.reduce((n, u) => n + decimalStringToPaise(u.revenue), 0),
    [remaining],
  )
  const chunk = useMemo(() => nextChunk(remaining, remainingPaise), [remaining, remainingPaise])

  async function pick(u: UnmappedPosItem, recipeId: string, sectionId: string) {
    setBusy(u.pos_item_id)
    setErrors((e) => ({ ...e, [u.pos_item_id]: '' }))
    try {
      const res = await mapPosItem({
        posItemId: u.pos_item_id,
        itemName: u.item_name ?? '',
        recipeId,
        sectionId,
      })
      if (res.ok) {
        const label =
          res.map.recipe_code !== null
            ? `${res.map.recipe_code} · ${res.map.recipe_name}`
            : `${res.map.section_code} · ${res.map.section_name} (department only — no cost)`
        setDone((d) => ({ ...d, [u.pos_item_id]: label }))
        // COVERAGE IS THE HEADLINE, not a count. "218 unmapped" reads as an
        // impossible chore; a rising share of revenue attributed reads as
        // progress — and it is the honest metric, because mapping a water
        // bottle and mapping the biryani are not the same act.
        setAck({
          headline: `${u.item_name} → ${label}`,
          sub: `${formatMoneyString(u.revenue)} of revenue now has a department. ${remaining.length - 1} POS ${remaining.length - 1 === 1 ? 'item is' : 'items are'} still unattributed.`,
        })
        setCov(res.coverage)
        router.refresh()
      } else {
        setErrors((e) => ({ ...e, [u.pos_item_id]: res.error }))
      }
    } catch {
      setErrors((e) => ({ ...e, [u.pos_item_id]: 'Could not reach the server — nothing was saved.' }))
    } finally {
      setBusy(null)
    }
  }

  if (dishes.length === 0 && sections.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-stone-900">Nothing to map to yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
          A POS item points at a dish or a department. Create dishes under Recipes, or departments under Kitchen.
        </p>
      </div>
    )
  }

  return (
    <div className="mt-4 space-y-4">
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      {cov !== null && <Coverage c={cov} />}

      {view === 'unmapped' && (
        <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Unmapped · biggest money first</h2>
          <span className="font-mono text-[11px] text-stone-400">unmapped_pos_items</span>
        </div>
        {remaining.length === 0 ? (
          <p className="mt-2 rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm text-emerald-800">
            Everything sold so far is attributed — the department views are telling the whole truth.
          </p>
        ) : (
          <>
            {chunk !== null && (
              <p className="mt-1 text-[13px] text-stone-600">
                {/* THE LINE THAT SHORTENS THE QUEUE. Saying where the money
                    stops being worth chasing turns 218 rows into a morning. */}
                The next {chunk.count} {chunk.count === 1 ? 'row carries' : 'rows carry'} another{' '}
                <span className="font-semibold">{chunk.pct.toFixed(0)}%</span> of what is still unattributed.
              </p>
            )}
            <ul className="mt-2 divide-y divide-rule-soft">
              {remaining.map((u) => (
                <li key={u.pos_item_id}>
                  <Row
                    u={u}
                    dishes={dishes}
                    sections={sections}
                    busy={busy === u.pos_item_id}
                    done={done[u.pos_item_id]}
                    onPick={(r, sec) => void pick(u, r, sec)}
                  />
                  {errors[u.pos_item_id] && (
                    <p className="pb-2 text-xs font-medium text-red-700">{errors[u.pos_item_id]}</p>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      )}

      {view === 'mapped' && mapped.length === 0 && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Nothing mapped yet</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            No POS item has been pointed at a dish or a department, so no revenue is attributed to anything.
          </p>
        </section>
      )}

      {view === 'mapped' && mapped.length > 0 && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Mapped</h2>
          <ul className="mt-1 divide-y divide-rule-soft">
            {mapped.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="min-w-0 truncate text-[15px] text-stone-900">
                  {m.item_name ?? `POS item ${m.pos_item_id}`}
                </span>
                <span className="shrink-0 text-xs text-stone-500">
                  {m.recipe_code !== null ? (
                    <>
                      → <span className={codeCls}>{m.recipe_code}</span> {m.recipe_name}
                    </>
                  ) : (
                    <>
                      → <span className={codeCls}>{m.section_code}</span> {m.section_name}
                      <span className="ml-1 text-stone-400">department only — no cost</span>
                    </>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
