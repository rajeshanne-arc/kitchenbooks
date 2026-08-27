'use client'

// The count screen: every active item in stock order, a blank box against
// each. The counter types what the shelf actually holds — including 0, an
// empty shelf is information. Book quantity and cost are frozen server-side
// at save; the variance appears in the reveal, worst shortage first.

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import type { CountableItem, SaveCountResult } from '@/lib/types'
import { saveCount } from '@/server/counts-actions'
import { AbcBadge } from '@/components/stock/Abc'
import { decimalStringToPaise, formatMoneyString, parseQty } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdCodeCls,
  thCls,
  thNumCls,
} from '@/components/ui'
import { useLang } from '@/components/useLang'
import Honesty from '@/components/Honesty'
import { useBusinessToday } from '@/components/BusinessDay'
import BackdatedCost from '@/components/BackdatedCost'

export function FirstCountWarning({ days }: { days: number }) {
  if (days >= 14) return null
  return (
    <Honesty verdict="thin history" meter={{ filled: days, total: 14, unit: 'days of consumption on the book' }}>
      Book stock has only {days} {days === 1 ? 'day' : 'days'} of consumption behind it. A variance today will
      mostly measure bills that were never entered, not theft. Count anyway — just read the result that way.
    </Honesty>
  )
}

export default function CountEntry({
  items,
  historyDays,
  openCount = null,
  progress = [],
}: {
  items: CountableItem[]
  historyDays: number
  /** A count somebody else started today and nobody has accepted. Joining it
   *  rather than starting a second is the whole of shared counting: two rows
   *  for one night would freeze the same book twice. */
  openCount?: { id: string; entered_by: string | null; lines: number } | null
  /** what each room still owes, so "done" is a fact rather than a feeling */
  progress?: { location_id: string | null; location_name: string; items: number; counted: number; counters: string | null }[]
}) {
  const businessToday = useBusinessToday()
  const { label } = useLang()
  const [countDate, setCountDate] = useState(businessToday)
  const [note, setNote] = useState('')
  const [filter, setFilter] = useState('')
  // YOUR ROOM. The sheet already walks by storage location, so counting one
  // room is a filter — not a new screen and not a new habit. Empty means the
  // whole store, which is what one person counting alone wants.
  const [locationId, setLocationId] = useState('')
  const [joinOpen, setJoinOpen] = useState(openCount !== null)
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState<Extract<SaveCountResult, { ok: true }> | null>(null)

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase()
    const inRoom =
      locationId === ''
        ? items
        : items.filter((i) => (locationId === 'none' ? i.location_id === null : i.location_id === locationId))
    if (q === '') return inRoom
    return inRoom.filter((i) => i.name.toLowerCase().includes(q) || i.code.toLowerCase().includes(q))
  }, [items, filter, locationId])

  /** The rooms, in walking order, taken from the items themselves — the sheet
   *  is already sorted that way, so this needs no second source. */
  const rooms = useMemo(() => {
    const out: { id: string; name: string }[] = []
    const seen = new Set<string>()
    for (const i of items) {
      const key = i.location_id ?? 'none'
      if (seen.has(key)) continue
      seen.add(key)
      out.push({ id: key, name: i.location_name ?? 'Not placed yet' })
    }
    return out
  }, [items])

  /**
   * THE SHEET WALKS THE STORE. `listCountableItems` orders by the location's
   * sort_order — which is WALKING ORDER, not alphabetical — so grouping here
   * is a fold and never a re-sort: the order the query argued for survives to
   * the screen.
   *
   * Items with NO location come last and say so loudly. On a physical walk
   * they are exactly the ones nobody passes.
   */
  const groups = useMemo(() => {
    const out: { key: string; name: string | null; kind: string | null; rows: CountableItem[] }[] = []
    for (const i of visible) {
      const key = i.location_id ?? '—'
      const last = out[out.length - 1]
      if (last && last.key === key) last.rows.push(i)
      else out.push({ key, name: i.location_name, kind: i.location_kind, rows: [i] })
    }
    return out
  }, [visible])

  /** How many of each class are on the sheet — the schedule below is only
   *  meaningful against real counts. */
  const abcCount = useMemo(() => {
    const n = { A: 0, B: 0, C: 0 }
    for (const i of items) if (i.abc === 'A' || i.abc === 'B' || i.abc === 'C') n[i.abc]++
    return n
  }, [items])
  const unplaced = useMemo(() => items.filter((i) => i.location_id === null).length, [items])

  const filled = Object.entries(qtys).filter(([, v]) => v.trim() !== '')
  const allValid = filled.every(([, v]) => parseQty(v.trim()) !== null)
  const canSave = !saving && filled.length > 0 && allValid

  async function onSave() {
    if (!canSave) return
    setSaving(true)
    setError(null)
    try {
      const res = await saveCount({
        countId: joinOpen && openCount !== null ? openCount.id : '',
        locationId: locationId === '' || locationId === 'none' ? '' : locationId,
        countDate,
        note: note.trim(),
        lines: filled.map(([itemId, countedQty]) => ({ itemId, countedQty: countedQty.trim() })),
      })
      if (res.ok) setSaved(res)
      else setError(res.error)
    } catch {
      setError('Could not reach the server — the count was not saved. Please retry.')
    } finally {
      setSaving(false)
    }
  }

  if (saved !== null) {
    const total = decimalStringToPaise(saved.count.total_variance_value)
    return (
      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>
              Counted — {fmtDate(saved.count.count_date)}
            </h2>
            <span className="text-xs text-stone-400">frozen at save · count_variances</span>
          </div>
          <p className={`mt-2 text-3xl font-bold tabular-nums ${total < 0 ? 'text-red-700' : 'text-stone-900'}`}>
            {formatMoneyString(saved.count.total_variance_value)}
          </p>
          <p className="mt-0.5 text-sm text-stone-500">
            total variance across {saved.count.line_count} {saved.count.line_count === 1 ? 'item' : 'items'} — negative
            means the shelf holds less than the books say
          </p>
          <div className="mt-3 space-y-2">
            <FirstCountWarning days={saved.historyDays} />
            {/* AN ITEM NOT COUNTED IS NOT A ZERO — it is simply not in this
                count, so its book is untouched and its variance is unknown.
                Said here because the variance list looks complete: every row
                on it is an item somebody counted, and the ones that were
                skipped leave no row at all to notice. */}
            {items.length > saved.count.line_count && (
              <Honesty
                verdict="partly counted"
                meter={{ filled: saved.count.line_count, total: items.length, unit: 'items counted' }}
              >
                {items.length - saved.count.line_count} of {items.length} items were left blank. A blank is not a
                count of nothing — those items keep their book quantity and appear nowhere in the variance above, so
                accepting this count corrects only what was actually walked past.
              </Honesty>
            )}
          </div>
          <ul className="mt-2 divide-y divide-rule-soft">
            {saved.variances.map((v) => {
              const neg = decimalStringToPaise(v.variance_value) < 0
              return (
                <li key={v.item_id} className={`py-2 ${neg ? 'rounded-lg bg-red-50 px-2' : ''}`}>
                  <div className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className={`block truncate text-sm font-medium ${neg ? 'text-red-800' : 'text-stone-900'}`}>
                        {v.name}
                      </span>
                      <span className="block text-xs tabular-nums text-stone-500">
                        counted {v.counted_qty} · book {v.book_qty} {v.purchase_unit} · Δ {v.variance_qty}
                      </span>
                    </span>
                    <span className={`text-right text-sm font-semibold tabular-nums ${neg ? 'text-red-700' : 'text-stone-700'}`}>
                      {formatMoneyString(v.variance_value)}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
        {/* The count has changed NOTHING yet, and this is the moment that
            fact is least obvious — the variance is on screen and it looks
            settled. Accepting is a separate judgement, so it is a separate
            press, and it is offered here while the shelves are still fresh
            in mind. */}
        <p className="text-sm text-stone-600">
          Nothing has moved in the book. A count records the difference; correcting the book is a decision somebody
          makes, on the count&rsquo;s own screen.
        </p>
        <Link
          href={`/store/stock/count/${saved.count.id}`}
          className="block w-full rounded-xl bg-emerald-700 py-3 text-center text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800"
        >
          Decide about this count →
        </Link>
        <Link
          href="/store/stock/count"
          className="block text-center text-sm font-medium text-stone-500 hover:text-stone-800"
        >
          Back to counts
        </Link>
      </div>
    )
  }

  const done = progress.filter((r) => r.items > 0 && r.counted === r.items)
  const started = progress.filter((r) => r.counted > 0 && r.counted < r.items)
  const untouched = progress.filter((r) => r.counted === 0 && r.items > 0)

  return (
    <div className="space-y-4">
      <FirstCountWarning days={historyDays} />

      {/* SOMEBODY IS ALREADY COUNTING. Starting a second count for the same
          night would freeze the same book twice and produce two variance sets
          nobody could reconcile, so the choice is offered once, plainly, and
          joining is the default. */}
      {openCount !== null && (
        <section className={cardCls}>
          <Honesty verdict="a count is already open" compact>
            {openCount.entered_by ?? 'Somebody'} started a count today and has entered {openCount.lines}{' '}
            {openCount.lines === 1 ? 'line' : 'lines'}. Two people counting two rooms are doing ONE count —
            joining theirs keeps one book and one set of variances.
          </Honesty>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setJoinOpen(true)}
              className={`min-h-[40px] rounded-xl px-3.5 text-sm font-semibold ${joinOpen ? 'bg-emerald-700 text-white' : 'border border-rule bg-cell text-stone-700'}`}
            >
              Join their count
            </button>
            <button
              type="button"
              onClick={() => setJoinOpen(false)}
              className={`min-h-[40px] rounded-xl px-3.5 text-sm font-semibold ${!joinOpen ? 'bg-emerald-700 text-white' : 'border border-rule bg-cell text-stone-700'}`}
            >
              Start a separate one
            </button>
          </div>
        </section>
      )}

      {/* WHAT EACH ROOM STILL OWES. "Not started" and "nothing to count" are
          different facts, so a room with no stock is not listed as owed — and
          the count is only finished when every room that HOLDS something is
          covered. */}
      {progress.length > 0 && joinOpen && openCount !== null && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Where the count has got to</h2>
          <ul className="mt-2 space-y-1.5 text-[13px]">
            {progress
              .filter((r) => r.items > 0)
              .map((r) => (
                <li key={r.location_id ?? 'none'} className="flex flex-wrap items-baseline gap-x-2">
                  <span
                    aria-hidden
                    className={`h-[11px] w-[11px] shrink-0 translate-y-[1px] rounded-[2px] border ${
                      r.counted === r.items
                        ? 'border-emerald-700 bg-emerald-700'
                        : r.counted > 0
                          ? 'border-amber-500 bg-amber-200'
                          : 'border-dashed border-stone-400 bg-cell'
                    }`}
                  />
                  <span className="font-medium text-stone-800">{r.location_name}</span>
                  <span className="font-mono tabular-nums text-stone-600">
                    {r.counted === r.items
                      ? 'done'
                      : r.counted === 0
                        ? 'not started'
                        : `${r.counted} of ${r.items}`}
                  </span>
                  {r.counters !== null && <span className="text-stone-400">{r.counters}</span>}
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-stone-500">
            {untouched.length === 0 && started.length === 0
              ? 'Every room holding stock has been covered.'
              : `${done.length} done · ${started.length} part done · ${untouched.length} not started. The count is not complete until every room holding stock is covered.`}
          </p>
        </section>
      )}

      <section className={cardCls}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>{label('count_date')}</span>
            <input type="date" value={countDate} onChange={(e) => setCountDate(e.target.value)} className={`${numCls} w-full`} />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>{label('note')}</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="optional" className={inputCls} maxLength={300} />
          </label>
        </div>
        <BackdatedCost date={countDate} what="today's weighted average cost for each item" />
        <label className="block">
            {/* YOUR ROOM — a filter, not a new screen. The sheet already walks
                in location order, so counting one room is choosing which part
                of the walk is yours. */}
            <span className={fieldLabelCls}>Which room are you counting?</span>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)} className={selectCls}>
              <option value="">The whole store</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
          <span className={fieldLabelCls}>{label('filter_items')}</span>
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="type to narrow the list" className={inputCls} />
        </label>
        <div className="mt-3 flex items-baseline justify-between gap-3">
          <p className="text-xs text-stone-500">
            Work down the sheet. Type 0 for an empty shelf — that is information, not a blank. Leave blank only
            what you did not reach.
          </p>
          <span className="shrink-0 font-mono text-xs tabular-nums text-stone-500">
            {filled.length} / {items.length}
          </span>
        </div>

        {/* THE SCHEDULE IS THE POINT, NOT THE LETTER. A badge on a row tells
            somebody nothing they can act on; "A weekly, B fortnightly, C
            monthly" is the difference between counting happening and counting
            being theatre. At a few hundred items, counting everything every
            week is a plan nobody keeps — and a plan nobody keeps produces no
            counts at all, which is worse than counting the expensive third
            often and the tail occasionally. */}
        {abcCount.A + abcCount.B + abcCount.C > 0 && (
          <div className="mt-3 rounded-xl border border-rule bg-stone-50 px-3 py-2.5">
            <p className="text-[13px] text-stone-700">
              <b>Count A weekly, B fortnightly, C monthly.</b> {abcCount.A} {abcCount.A === 1 ? 'item' : 'items'} carry
              most of the value here, {abcCount.B} sit in the middle and {abcCount.C} are the long tail. Counting
              everything every week is a plan nobody keeps, and a plan nobody keeps produces no counts at all.
            </p>
            <p className="mt-1 text-[11px] text-stone-400">
              Classes are shares of stock value, recomputed every time this page loads · stock_abc
            </p>
          </div>
        )}

        {unplaced > 0 && (
          <div className="mt-3">
            <Honesty
              level="alarm"
              verdict="not placed yet"
              meter={{ filled: items.length - unplaced, total: items.length, unit: 'items placed' }}
            >
              {unplaced} of {items.length} {unplaced === 1 ? 'item has' : 'items have'} no storage location, so the
              sheet cannot put {unplaced === 1 ? 'it' : 'them'} on your route — {unplaced === 1 ? 'it is' : 'they are'}{' '}
              grouped at the bottom instead. On a walk round the store, those are the ones nobody passes. An owner
              sets locations under Settings; the item form asks for one.
            </Honesty>
          </div>
        )}

        {/* A SHEET, not a search box. Rajesh's paper count lists every item
            with a box against it and you work down; a screen that makes you
            search for each one in turn is slower than the paper it replaces.
            The filter narrows a long sheet, it does not gate entry. */}
        <div className="mt-2 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Item</th>
                <th className={thCls}>Code</th>
                <th className={thCls}>Category</th>
                <th className={`${thNumCls} w-28`}>Counted</th>
                <th className={thCls}>Unit</th>
              </tr>
            </thead>
            <tbody>
          {groups.map((g) => (
            <Fragment key={g.key}>
              <tr>
                <td
                  colSpan={5}
                  className={`border-b border-rule px-3 py-1.5 ${
                    g.name === null ? 'bg-red-50' : 'bg-stone-100'
                  }`}
                >
                  <span
                    className={`font-display text-[11px] font-semibold uppercase tracking-[0.08em] ${
                      g.name === null ? 'text-red-800' : 'text-stone-600'
                    }`}
                  >
                    {g.name ?? 'Not placed yet'}
                  </span>
                  <span className="ml-2 text-[11px] text-stone-400">
                    {g.name === null
                      ? `${g.rows.length} ${g.rows.length === 1 ? 'item has' : 'items have'} no shelf — you will walk past ${g.rows.length === 1 ? 'it' : 'them'}`
                      : `${g.kind} · ${g.rows.length} ${g.rows.length === 1 ? 'item' : 'items'}`}
                  </span>
                </td>
              </tr>
              {g.rows.map((i) => {
            const v = qtys[i.id] ?? ''
            const bad = v.trim() !== '' && parseQty(v.trim()) === null
            return (
              <tr key={i.id} className="h-11 hover:bg-stone-50">
                <td className={tdCls}>
                  <AbcBadge abc={i.abc} className="mr-1.5" />
                  {i.name}
                </td>
                <td className={tdCodeCls}>{i.code}</td>
                <td className={`${tdCls} text-stone-500`}>{i.category_name}</td>
                <td className="border-b border-rule-soft px-1 py-1.5">
                  <input
                    inputMode="decimal"
                    placeholder="—"
                    aria-label={`Counted quantity of ${i.name}`}
                    value={v}
                    onChange={(e) => setQtys((q) => ({ ...q, [i.id]: e.target.value.replace(/[^\d.]/g, '') }))}
                    className={`${numCls} w-full text-right font-mono tabular-nums ${bad ? 'border-red-400' : ''}`}
                  />
                </td>
                <td className={`${tdCls} text-stone-500`}>{i.purchase_unit}</td>
              </tr>
            )
              })}
            </Fragment>
          ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={5} className={`${tdCls} text-stone-400`}>
                    No items match that filter — clear it to see the whole sheet again.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-stone-400">
          Book quantities stay hidden until the save — the count is blind on purpose. Seeing the book figure
          while counting turns a count into a confirmation of it.
        </p>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={onSave}
        disabled={!canSave}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {saving ? label('saving') : `${label('save_count')} (${filled.length})`}
      </button>
    </div>
  )
}
