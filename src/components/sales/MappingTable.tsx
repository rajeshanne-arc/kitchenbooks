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
// EVERY ROW OFFERS THREE TARGETS. A dish gives the department AND the cost; a
// STOCK ITEM gives the cost for something bought and resold — a bottled water
// is bought, stocked, issued and sold, and will never have a recipe — and a
// department alone gives the department, which is most of the value and the
// honest answer for anything with neither.
//
// AN ITEM IS SAVED WITH ITS DEPARTMENT, NEVER ALONE. theoretical_food_cost
// groups on coalesce(recipe.section_id, map.section_id), so an item with no
// department lands its revenue AND its cost in the Unmapped bucket, where the
// department that sold it never sees either. Measured on the probe tenant, not
// inferred; the server refuses it by name and this form asks for both.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type {
  DishOption,
  ItemOption,
  MappingCoverage,
  PosMapRow,
  Section,
  UnmappedPosItem,
} from '@/lib/types'
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
      {/* READ FROM THE VIEW AGAIN. `items_costed` counted `recipe_id IS NOT
          NULL` alone when the stock-item target shipped, so a mapped and
          priced bottled water read as uncosted and this screen counted
          item-mapped rows for itself. The view now counts both routes and the
          workaround is gone.

          THE WORD IS STILL NARROWER THAN IT SOUNDS, and the copy says so: the
          filter is "points at a recipe or an item", not "can be priced through
          it". A dish with no portion count is counted here and still prices at
          zero — which is why the variance card names those separately rather
          than leaving a reader to infer them from a percentage. */}
      {c.items_mapped > c.items_costed && (
        <div className="mt-3">
          <Honesty verdict="attributed, not costed" compact>
            {c.items_mapped - c.items_costed} of the mapped items point at a DEPARTMENT alone, so their revenue
            lands in the right place and no cost does. That is the honest answer where there is neither a
            recipe nor a stock item behind the thing sold; where there is one, it is the fuller one.
          </Honesty>
        </div>
      )}
    </section>
  )
}

function Row({
  u,
  dishes,
  items,
  sections,
  busy,
  onPick,
  done,
}: {
  u: UnmappedPosItem
  dishes: DishOption[]
  items: ItemOption[]
  sections: Section[]
  busy: boolean
  onPick: (recipeId: string, itemId: string, sectionId: string) => void
  done: string | undefined
}) {
  // AN ITEM IS HALF AN ANSWER UNTIL ITS DEPARTMENT ARRIVES, so picking one
  // holds rather than saves, and the department select beside it becomes the
  // second half. A dish clears it: a dish already carries both.
  const [item, setItem] = useState('')
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
        <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="mb-0.5 block text-[11px] font-medium uppercase tracking-wide text-stone-400">
              A dish — department and cost
            </span>
            <select
              className={selectCls}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value !== '') {
                  setItem('')
                  onPick(e.target.value, '', '')
                }
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
              A stock item — bought and resold
            </span>
            <select
              className={selectCls}
              value={item}
              disabled={busy}
              onChange={(e) => setItem(e.target.value)}
            >
              <option value="">— pick an item —</option>
              {items.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.code} · {i.name}
                  {i.issue_cost === null ? ' (no cost yet)' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span
              className={`mb-0.5 block text-[11px] font-medium uppercase tracking-wide ${
                item === '' ? 'text-stone-400' : 'text-emerald-700'
              }`}
            >
              {item === '' ? 'Or a department — no cost' : 'Where it sold — needed'}
            </span>
            <select
              className={selectCls}
              value=""
              disabled={busy}
              onChange={(e) => {
                if (e.target.value !== '') onPick('', item, e.target.value)
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
      {done === undefined && item !== '' && (
        <p className="mt-1 text-[12px] text-emerald-800">
          {items.find((i) => i.id === item)?.name} — now pick the department that sold it. An item on its own
          has a cost and nowhere to put it, so nothing is saved until both are chosen.
        </p>
      )}
    </li>
  )
}

export default function MappingTable({
  unmapped,
  mapped,
  dishes,
  items,
  sections,
  coverage,
  view,
}: {
  unmapped: UnmappedPosItem[]
  mapped: PosMapRow[]
  dishes: DishOption[]
  items: ItemOption[]
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

  async function pick(u: UnmappedPosItem, recipeId: string, itemId: string, sectionId: string) {
    setBusy(u.pos_item_id)
    setErrors((e) => ({ ...e, [u.pos_item_id]: '' }))
    try {
      const res = await mapPosItem({
        posItemId: u.pos_item_id,
        itemName: u.item_name ?? '',
        recipeId,
        itemId,
        sectionId,
      })
      if (res.ok) {
        const label =
          res.map.recipe_code !== null
            ? `${res.map.recipe_code} · ${res.map.recipe_name}`
            : res.map.item_code !== null
              ? `${res.map.item_code} · ${res.map.stock_item_name} in ${res.map.section_code} (costed as stock)`
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

  if (dishes.length === 0 && items.length === 0 && sections.length === 0) {
    return (
      <div className="mt-4 rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-10 text-center">
        <p className="text-[15px] font-semibold text-stone-900">Nothing to map to yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-stone-500">
          A POS item points at a dish, a stock item or a department. Create dishes under Recipes, items under
          Store → Masters, or departments under Kitchen.
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
                    items={items}
                    sections={sections}
                    busy={busy === u.pos_item_id}
                    done={done[u.pos_item_id]}
                    onPick={(r, it, sec) => void pick(u, r, it, sec)}
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
                  ) : m.item_code !== null ? (
                    <>
                      → <span className={codeCls}>{m.item_code}</span> {m.stock_item_name} in{' '}
                      <span className={codeCls}>{m.section_code}</span>
                      <span className="ml-1 text-stone-400">costed as stock</span>
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
