'use client'

// THE METER MASTER — and the two rules that have to reach the screen.
//
//   a) A MISSED READING BREAKS TWO DAYS. Read on Monday and again on
//      Wednesday and Wednesday's figure covers two days. `days_spanned` says
//      so and is NEVER divided: halving it would invent a Tuesday nobody
//      measured. Every span is stated in words beside its figure.
//   b) THE RATE IS AN ESTIMATE. Electricity is slabbed, so the true unit cost
//      depends on the month's total. Every rupee figure here says "estimated"
//      and every screen says to reconcile against the real bill.
//
// A METER IS A MASTER, NOT A SETTING — the same argument that moved partners
// out of list_options. A list row holds a name; a meter carries a unit and a
// rate, and the rate is the number every estimate turns on.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CylinderStockRow, MeterConsumptionRow, MeterKind, MeterRow, MeteringMode } from '@/lib/types'
import type { SaveMeterInput } from '@/server/meters-actions'
import { createMeter, setMeteringMode, updateMeter } from '@/server/meters-actions'
import { formatMoneyString, formatRate } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import { LockedField } from '@/components/books/Locked'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  moneyCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

const KIND_LABEL: Record<MeterKind, string> = {
  electricity: 'Electricity',
  gas: 'Gas',
  water: 'Water',
  other: 'Other',
}

/** Suggestions, not a limit — the same shape as the timezone field. A meter
 *  somewhere else may count in therms or CCF and must not be locked out. */
const UNIT_HINT: Record<MeterKind, string> = {
  electricity: 'kWh',
  gas: 'm³',
  water: 'kL',
  other: 'units',
}

const blank = (kind: MeterKind): SaveMeterInput => ({
  name: '',
  kind,
  unit: UNIT_HINT[kind],
  rate: '',
  status: 'active',
})

const toDraft = (m: MeterRow): SaveMeterInput => ({
  name: m.name,
  kind: m.kind,
  unit: m.unit,
  rate: m.assumed_rate ?? '',
  status: m.status,
})

/** Trailing zeros off a numeric column: 45231.500 reads as a precision the
 *  meter does not have. */
const num = (s: string | null): string => {
  if (s === null) return '—'
  const t = s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
  return t === '' || t === '-' ? '0' : t
}

/** The span, in words, whole. Never divided — see rule (a). */
function spanWords(days: number | null): string {
  if (days === null) return 'first reading'
  if (days === 1) return 'one day'
  return `${days} days`
}

export default function MetersClient({
  initialMeters,
  initialMode,
  consumption,
  cylinders,
  canSetMode,
  canEditMeters,
  issueHref,
}: {
  initialMeters: MeterRow[]
  initialMode: MeteringMode
  consumption: MeterConsumptionRow[]
  cylinders: CylinderStockRow[]
  /** owner only — the mode decides where a utility's cost lands */
  canSetMode: boolean
  /** owner and accountant — the master and the rate */
  canEditMeters: boolean
  /** THE LINK IS A PROP, NEVER A LITERAL. /store/issue is store, manager and
   *  owner; an accountant reading this page cannot open it, and showing them
   *  a door they cannot go through is LAW 1 broken in the smallest way. */
  issueHref: string | null
}) {
  const router = useRouter()
  const [meters, setMeters] = useState(initialMeters)
  const [mode, setMode] = useState(initialMode)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<SaveMeterInput>(() => blank('electricity'))
  const [busy, setBusy] = useState(false)

  const gasMetered = mode.gas === 'meter'
  const elecOn = mode.electricity === 'on'
  // Which kinds may be created at all. The picker is a courtesy; the server
  // refuses the same cases by name.
  const allowedKinds: MeterKind[] = (['electricity', 'gas', 'water', 'other'] as MeterKind[]).filter(
    (k) => (k === 'gas' ? gasMetered : k === 'electricity' ? elecOn : true),
  )

  async function saveMode(next: MeteringMode) {
    setBusy(true)
    try {
      const res = await setMeteringMode({ gas: next.gas, electricity: next.electricity })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setMode(res.mode)
      toast(
        `Gas measured as ${res.mode.gas === 'meter' ? 'a meter' : 'cylinders'} · electricity metering ${res.mode.electricity}`,
        'ok',
      )
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  async function saveMeter() {
    if (busy || draft.name.trim() === '') return
    setBusy(true)
    try {
      const res = editing === null ? await createMeter(draft) : await updateMeter(editing, draft)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setMeters((prev) =>
        [...prev.filter((m) => m.id !== res.meter.id), res.meter].sort(
          (a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name),
        ),
      )
      // Rule (1) of the save acknowledgement: say the figures, never "Saved".
      toast(
        `${res.meter.name} — ${KIND_LABEL[res.meter.kind].toLowerCase()} in ${res.meter.unit}${
          res.meter.assumed_rate === null
            ? ', no rate set, so no cost is estimated'
            : ` at an estimated ${formatRate(res.meter.assumed_rate)}/${res.meter.unit}`
        }`,
        'ok',
      )
      setEditing(null)
      setAdding(false)
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was saved.', 'error')
    } finally {
      setBusy(false)
    }
  }

  const noRate = meters.filter((m) => m.status === 'active' && m.assumed_rate === null)

  return (
    <div className="space-y-4">
      {/* ── HOW THIS RESTAURANT MEASURES ──────────────────────────────── */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>How the utilities are measured</h2>
          <span className="font-mono text-[11px] text-stone-400">settings</span>
        </div>
        <p className="mt-1.5 text-sm text-stone-600">
          Not a preference — a fact about the plumbing. The app refuses the entries the other answer
          would imply, which is what keeps the same gas from being counted twice.
        </p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="rounded-xl border border-rule bg-cell p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Gas</div>
            <div className="mt-0.5 text-[15px] font-medium text-stone-900">
              {gasMetered ? 'A piped meter' : 'Cylinders'}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {gasMetered
                ? 'Readings are taken at the day close and costed at the meter’s rate.'
                : 'Gas is stock: it arrives on a bill and is consumed when a cylinder is issued.'}
            </p>
            {canSetMode && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveMode({ ...mode, gas: gasMetered ? 'cylinders' : 'meter' })}
                className={`${btnGhostCls} mt-2 text-[13px]`}
              >
                {gasMetered ? 'We buy cylinders instead' : 'We are on a piped meter'}
              </button>
            )}
          </div>

          <div className="rounded-xl border border-rule bg-cell p-3">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Electricity
            </div>
            <div className="mt-0.5 text-[15px] font-medium text-stone-900">
              {elecOn ? 'Metered' : 'Not tracked'}
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {elecOn
                ? 'Readings are taken at the day close.'
                : 'Readings are refused until this is switched on — there would be nowhere for them to mean anything.'}
            </p>
            {canSetMode && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void saveMode({ ...mode, electricity: elecOn ? 'off' : 'on' })}
                className={`${btnGhostCls} mt-2 text-[13px]`}
              >
                {elecOn ? 'Stop tracking electricity' : 'Start taking readings'}
              </button>
            )}
          </div>
        </div>

        {!canSetMode && (
          <p className="mt-3 text-xs text-stone-500">
            Only an owner changes these — the answer decides whether a utility’s cost lands inside
            cost of goods or beside it.
          </p>
        )}
      </section>

      {/* ── THE CYLINDER HABIT — computed, never asserted ─────────────── */}
      {!gasMetered && cylinders.length > 0 && (
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Gas is already in the books</h2>
            <span className="font-mono text-[11px] text-stone-400">stock_on_hand</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            A cylinder is consumed on the day it is <b>connected</b>, not on the day it was bought.
            Issue it to a kitchen department then, and its cost lands in that department’s
            consumption — the same way every other item does. Nothing new to build; the issue form
            already does it.
          </p>
          <table className={`${dataTableCls} mt-3`}>
            <thead>
              <tr>
                <th className={thCls}>Item</th>
                <th className={thNumCls}>Bought</th>
                <th className={thNumCls}>Issued</th>
                <th className={thNumCls}>On hand</th>
                <th className={thNumCls}>Value</th>
              </tr>
            </thead>
            <tbody>
              {cylinders.map((c) => (
                <tr key={c.code} className={trCls}>
                  <td className={tdCls}>
                    <span className="font-mono text-[12px] text-stone-500">{c.code}</span>{' '}
                    <span className="text-stone-900">{c.name}</span>
                  </td>
                  <td className={tdNumCls}>
                    {num(c.purchased)} {c.unit}
                  </td>
                  <td className={`${tdNumCls} ${Number(c.issued) === 0 ? 'text-red-700' : ''}`}>
                    {num(c.issued)}
                  </td>
                  <td className={tdNumCls}>{num(c.on_hand)}</td>
                  <td className={tdNumCls}>
                    {c.on_hand_value === null ? '—' : formatMoneyString(c.on_hand_value)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {cylinders.some((c) => Number(c.issued) === 0 && Number(c.purchased) > 0) && (
            <div className="mt-3">
              <Honesty
                level="alarm"
                verdict="bought, never issued"
                {...(issueHref === null ? {} : { action: { href: issueHref, label: 'Issue a cylinder' } })}
              >
                {cylinders
                  .filter((c) => Number(c.issued) === 0 && Number(c.purchased) > 0)
                  .map((c) => `${num(c.purchased)} ${c.unit} of ${c.name}`)
                  .join(', ')}{' '}
                {cylinders.filter((c) => Number(c.issued) === 0 && Number(c.purchased) > 0).length === 1
                  ? 'has'
                  : 'have'}{' '}
                been bought and none has ever been issued, so no gas cost has reached any
                department’s consumption. The money is on the shelf, not in the food cost.
              </Honesty>
            </div>
          )}
        </section>
      )}

      {/* ── THE METERS ─────────────────────────────────────────────────── */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Meters</h2>
          <span className="font-mono text-[11px] text-stone-400">meters</span>
        </div>

        {meters.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">
            No meter is set up. {allowedKinds.length === 0
              ? 'Nothing can be added while gas is on cylinders and electricity is not tracked — switch one on above.'
              : 'A meter needs a name, what it counts, and — for an estimate to be possible — a rate per unit.'}
          </p>
        ) : (
          <ul className="mt-2 divide-y divide-rule-soft">
            {meters.map((m) =>
              editing === m.id ? (
                <li key={m.id} className="py-2">
                  <Fields
                    draft={draft}
                    setDraft={setDraft}
                    lockedKind={m.kind}
                    allowedKinds={allowedKinds}
                    busy={busy}
                    onSave={() => void saveMeter()}
                    onCancel={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li key={m.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span>
                    <span className={m.status === 'inactive' ? 'text-stone-400 line-through' : 'text-stone-900'}>
                      {m.name}
                    </span>
                    <span className="ml-2 text-[11px] text-stone-400">
                      {KIND_LABEL[m.kind].toLowerCase()} · {m.unit}
                    </span>
                  </span>
                  <span className="flex items-baseline gap-3">
                    <span className={`${moneyCls} text-sm text-stone-600`}>
                      {m.assumed_rate === null ? (
                        <span className="text-doubt">no rate</span>
                      ) : (
                        <>
                          {formatRate(m.assumed_rate)}/{m.unit}{' '}
                          <span className="text-[11px] text-stone-400">est.</span>
                        </>
                      )}
                    </span>
                    {canEditMeters && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(m.id)
                          setAdding(false)
                          setDraft(toDraft(m))
                        }}
                        className="text-[13px] font-medium text-emerald-800 underline underline-offset-2"
                      >
                        Edit
                      </button>
                    )}
                  </span>
                </li>
              ),
            )}
          </ul>
        )}

        {noRate.length > 0 && (
          <div className="mt-3">
            <Honesty verdict="no rate set">
              {noRate.map((m) => m.name).join(', ')} {noRate.length === 1 ? 'carries' : 'carry'} no
              rate per unit, so {noRate.length === 1 ? 'its' : 'their'} readings record units and no
              rupee figure at all. That is deliberate — an estimate of ₹0.00 would read as free
              electricity.
            </Honesty>
          </div>
        )}

        {canEditMeters && allowedKinds.length > 0 && (
          adding ? (
            <div className="mt-3">
              <Fields
                draft={draft}
                setDraft={setDraft}
                lockedKind={null}
                allowedKinds={allowedKinds}
                busy={busy}
                onSave={() => void saveMeter()}
                onCancel={() => setAdding(false)}
              />
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setAdding(true)
                setEditing(null)
                setDraft(blank(allowedKinds[0]))
              }}
              className={`${btnGhostCls} mt-3`}
            >
              ＋ Add a meter
            </button>
          )
        )}
      </section>

      {/* ── THE READINGS ───────────────────────────────────────────────── */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Readings</h2>
          <span className="font-mono text-[11px] text-stone-400">meter_consumption</span>
        </div>

        {consumption.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">
            No reading has been filed. They are taken at the day close, where somebody is already
            standing at a fixed time every night — which is the only reason a reading actually
            happens.
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Meter</th>
                    <th className={thNumCls}>Reading</th>
                    <th className={thNumCls}>Used</th>
                    <th className={thCls}>Covers</th>
                    <th className={thNumCls}>Estimated</th>
                  </tr>
                </thead>
                <tbody>
                  {consumption.map((r) => {
                    const backwards = r.units !== null && Number(r.units) < 0
                    return (
                      <tr key={`${r.meter_id}-${r.read_date}`} className={trCls}>
                        <td className={tdCls}>{fmtDate(r.read_date)}</td>
                        <td className={tdCls}>
                          {r.name}
                          <span className="ml-1.5 text-[11px] text-stone-400">{r.unit}</span>
                        </td>
                        <td className={tdNumCls}>{num(r.reading)}</td>
                        <td className={`${tdNumCls} ${backwards ? 'text-red-700' : ''}`}>
                          {r.units === null ? (
                            <span className="text-stone-400">baseline</span>
                          ) : backwards ? (
                            'went backwards'
                          ) : (
                            `${num(r.units)} ${r.unit}`
                          )}
                        </td>
                        <td className={`${tdCls} text-[12px] ${r.days_spanned !== null && r.days_spanned > 1 ? 'text-doubt' : 'text-stone-500'}`}>
                          {spanWords(r.days_spanned)}
                        </td>
                        <td className={tdNumCls}>
                          {r.estimated_cost === null || backwards ? (
                            <span className="text-stone-400">—</span>
                          ) : (
                            formatMoneyString(r.estimated_cost)
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* RULE (a), where the gap actually is. */}
            {consumption.some((r) => (r.days_spanned ?? 1) > 1) && (
              <div className="mt-3">
                <Honesty verdict="a reading was missed">
                  {consumption.filter((r) => (r.days_spanned ?? 1) > 1).length} of these figures cover
                  more than one day, because no reading was taken on the day before. The figure is
                  left whole and is <b>not</b> divided across the days it spans — splitting it would
                  invent a day nobody measured. Read the meter every night and each figure is one
                  day’s.
                </Honesty>
              </div>
            )}

            {/* RULE (b), once, under the numbers it qualifies. */}
            <div className="mt-3">
              <Honesty verdict="every rupee here is an estimate">
                Cost is units × the rate somebody typed on the meter. Electricity is slabbed, so the
                true unit cost depends on the month’s total and is not known until the bill arrives.
                Treat these as a running check on the bill, never as the bill.
              </Honesty>
            </div>

            {consumption.some((r) => r.units !== null && Number(r.units) < 0) && (
              <div className="mt-3">
                <Honesty level="alarm" verdict="the meter went backwards">
                  A reading came in below the one before it. That is real when a meter rolls over
                  from all-nines to zero or when one is replaced — and it is far more often a typo.
                  No consumption and no cost is stated for those rows, because a negative is not a
                  smaller number here, it is a broken comparison. File the correct reading for that
                  date; the latest filing for a date wins and both stay on the record.
                </Honesty>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}

function Fields({
  draft,
  setDraft,
  lockedKind,
  allowedKinds,
  busy,
  onSave,
  onCancel,
}: {
  draft: SaveMeterInput
  setDraft: (d: SaveMeterInput) => void
  /** non-null while editing: kind is locked, and the screen says why */
  lockedKind: MeterKind | null
  allowedKinds: MeterKind[]
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-xl border border-rule bg-stone-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Main board, kitchen sub-meter…"
            className={inputCls}
          />
        </label>

        {lockedKind === null ? (
          <label className="block">
            <span className={fieldLabelCls}>What it measures</span>
            <select
              value={draft.kind}
              onChange={(e) => {
                const kind = e.target.value as MeterKind
                setDraft({ ...draft, kind, unit: UNIT_HINT[kind] })
              }}
              className={selectCls}
            >
              {allowedKinds.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        ) : (
          // Locked with its reason, never hidden — the same treatment a
          // money account's kind and an item's category get. Every reading
          // already filed belongs to this utility.
          <LockedField
            label="What it measures"
            value={KIND_LABEL[lockedKind]}
            reason="Every reading already filed belongs to this utility. Retire this meter and add a new one rather than moving its history."
          />
        )}

        <label className="block">
          <span className={fieldLabelCls}>Unit</span>
          <input
            value={draft.unit}
            onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
            placeholder={UNIT_HINT[draft.kind]}
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Whatever the dial counts in. Not a stock unit — this is not kg or litres.
          </span>
        </label>

        <label className="block">
          <span className={fieldLabelCls}>Rate per unit — an estimate</span>
          <input
            inputMode="decimal"
            value={draft.rate}
            onChange={(e) => setDraft({ ...draft, rate: e.target.value })}
            placeholder="8.4750"
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Leave blank and readings record units only. Slabbed tariffs mean this is never exact —
            reconcile against the bill.
          </span>
        </label>
      </div>

      <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={draft.status === 'inactive'}
          onChange={(e) => setDraft({ ...draft, status: e.target.checked ? 'inactive' : 'active' })}
          className="h-4 w-4"
        />
        Retired — stops being offered, and keeps every reading it ever took
      </label>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onSave} disabled={busy || draft.name.trim() === ''} className={btnCls}>
          {busy ? 'Saving…' : 'Save meter'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
