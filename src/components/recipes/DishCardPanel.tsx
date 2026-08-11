'use client'

// The dish card, in the shape of Rajesh's Recipes sheet.
//
// THE DIVISION THE CARD IS BUILT AROUND: inputs are what a human decides,
// answers are what dish_costs works out. Every figure in the answers block
// is the VIEW's — nothing here recomputes one, so a rate change on a bill
// moves the card with no re-cost step.
//
// FLAG vs COLOUR are two different questions and the card keeps both:
//   the FIGURE is coloured absolutely — amber over 35%, red over 40% —
//     because a dish at 44% is expensive whatever it is;
//   the FLAG compares against THAT COURSE's target, because 30% is fine
//     for a main and poor for a beverage.
// A dish can therefore read amber and still flag OK, and that is the point:
// "expensive" and "off target" are not the same finding.
//
// CHECK is neither. It means the dish costs zero — a broken link, an
// ingredient with no bill behind it — and it is a repair job, not a cheap
// dish. It is never reported as good news.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DishCard, SaveDishCardInput } from '@/lib/types'
import { updateDishCard } from '@/server/recipes-actions'
import { formatMoneyString } from '@/lib/money'
import {
  cardCls,
  fieldLabelCls,
  heroNumCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'

const DIETS = ['Veg', 'Non-veg', 'Egg', 'Vegan']

/** The absolute reading: is this dish expensive, whatever it is? */
function figureTone(pct: number | null): string {
  if (pct === null) return 'text-stone-400'
  if (pct > 40) return 'text-red-700'
  if (pct > 35) return 'text-amber-800'
  return 'text-stone-900'
}

/** The relative reading: is it off ITS course's target? */
function flagChip(flag: string | null): { cls: string; label: string; hint: string } | null {
  if (flag === null) return null
  if (flag === 'CHECK') {
    return {
      cls: 'border-red-300 bg-red-50 text-red-800',
      label: 'CHECK',
      hint: 'This dish costs nothing, which no dish does — an ingredient has no cost behind it.',
    }
  }
  if (flag === 'HIGH') {
    return {
      cls: 'border-amber-300 bg-amber-50 text-amber-900',
      label: 'HIGH',
      hint: 'Above the target for this course.',
    }
  }
  return {
    cls: 'border-emerald-300 bg-emerald-50 text-emerald-800',
    label: flag,
    hint: 'At or under the target for this course.',
  }
}

function Answer({
  label,
  value,
  tone = 'text-stone-900',
  sub,
}: {
  label: string
  value: string
  tone?: string
  sub?: string
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">{label}</div>
      <div className={`font-mono text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
      {sub !== undefined && <div className="text-[11px] text-stone-500">{sub}</div>}
    </div>
  )
}

export default function DishCardPanel({
  card,
  media,
  courses,
}: {
  card: DishCard
  media: { photo_url: string | null; video_url: string | null }
  courses: { course: string; target_pct: string }[]
}) {
  const router = useRouter()
  const [f, setF] = useState<SaveDishCardInput>({
    posCode: card.pos_code ?? '',
    course: card.course ?? '',
    diet: card.diet ?? '',
    photoUrl: media.photo_url ?? '',
    videoUrl: media.video_url ?? '',
    portions: card.portions ?? '',
    portionSize: card.portion_size ?? '',
    portionUnit: card.portion_unit ?? '',
    overheadPct: card.overhead_pct ?? '',
    sellingPrice: card.selling_price ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof SaveDishCardInput>(k: K, v: SaveDishCardInput[K]) =>
    setF((s) => ({ ...s, [k]: v }))

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const res = await updateDishCard(card.recipe_id, f)
      if (res.ok) {
        toast('Card saved')
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const pct = card.food_cost_pct === null ? null : Number(card.food_cost_pct)
  const flag = flagChip(card.flag)
  const noPortions = card.portions === null || Number(card.portions) <= 0

  return (
    <div className="space-y-4">
      {/* header strip */}
      <section className={cardCls}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            {card.section_name}
          </span>
          {card.pos_code !== null && (
            <span className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] text-stone-600">
              POS {card.pos_code}
            </span>
          )}
          {card.course !== null && <span className="text-xs text-stone-600">{card.course}</span>}
          {card.diet !== null && (
            <span className="rounded-full border border-rule px-2 py-0.5 text-[11px] text-stone-600">
              {card.diet}
            </span>
          )}
          <span className="ml-auto flex gap-3">
            {media.photo_url !== null && (
              <a
                href={media.photo_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                photo ↗
              </a>
            )}
            {media.video_url !== null && (
              <a
                href={media.video_url}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-emerald-700 hover:underline"
              >
                video ↗
              </a>
            )}
          </span>
        </div>
      </section>

      {/* batch cost — the sum of the lines above */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionHeadCls}>Batch cost — ingredients</h3>
          <span className="font-mono text-[10px] text-stone-400">dish_costs</span>
        </div>
        <p className={`mt-1 text-[30px] ${heroNumCls} text-stone-900`}>{formatMoneyString(card.dish_cost)}</p>
        <p className="text-xs text-stone-500">
          what the whole batch costs in ingredients, with each line&apos;s yield already applied
        </p>
        {card.uncosted_lines > 0 && (
          <div className="mt-2">
            <Honesty level="alarm" verdict="incomplete" compact>
              {card.uncosted_lines} ingredient{card.uncosted_lines === 1 ? '' : 's'} here{' '}
              {card.uncosted_lines === 1 ? 'has' : 'have'} no cost on record, so this batch cost is lower than
              the truth. Enter their purchase bills.
            </Honesty>
          </div>
        )}
      </section>

      {/* inputs — what a human decides */}
      <section className={cardCls}>
        <h3 className={sectionHeadCls}>Inputs</h3>
        <p className="mt-0.5 text-xs text-stone-500">Yours to set. The answers below follow from them.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className={fieldLabelCls}>Portions</span>
            <input
              value={f.portions}
              onChange={(e) => set('portions', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Portion size</span>
            <input
              value={f.portionSize}
              onChange={(e) => set('portionSize', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Unit</span>
            <input
              value={f.portionUnit}
              onChange={(e) => set('portionUnit', e.target.value)}
              placeholder="g, ml, pc"
              className={inputCls}
              maxLength={20}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Overhead %</span>
            <input
              value={f.overheadPct}
              onChange={(e) => set('overheadPct', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
            <span className="mt-1 block text-xs text-stone-500">labour and fuel — your figure</span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Sell ₹</span>
            <input
              value={f.sellingPrice}
              onChange={(e) => set('sellingPrice', e.target.value.replace(/[^\d.]/g, ''))}
              inputMode="decimal"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>POS code</span>
            <input
              value={f.posCode}
              onChange={(e) => set('posCode', e.target.value)}
              className={`${inputCls} font-mono`}
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Course</span>
            <select value={f.course} onChange={(e) => set('course', e.target.value)} className={selectCls}>
              <option value="">—</option>
              {courses.map((c) => (
                <option key={c.course} value={c.course}>
                  {c.course} — target {c.target_pct}%
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Diet</span>
            <select value={f.diet} onChange={(e) => set('diet', e.target.value)} className={selectCls}>
              <option value="">—</option>
              {DIETS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Photo link</span>
            <input
              value={f.photoUrl}
              onChange={(e) => set('photoUrl', e.target.value)}
              placeholder="https://…"
              className={inputCls}
              maxLength={500}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className={fieldLabelCls}>Video link</span>
            <input
              value={f.videoUrl}
              onChange={(e) => set('videoUrl', e.target.value)}
              placeholder="https://…"
              className={inputCls}
              maxLength={500}
            />
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
        >
          {busy ? 'Saving…' : 'Save card'}
        </button>
      </section>

      {/* answers — what the view works out */}
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionHeadCls}>Answers</h3>
          {flag !== null && (
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold ${flag.cls}`} title={flag.hint}>
              {flag.label}
            </span>
          )}
        </div>

        {noPortions ? (
          <div className="mt-2">
            <Honesty verdict="no portions" compact>
              A batch cost divided by nothing is nothing. Set how many portions this batch makes and every
              figure below appears.
            </Honesty>
          </div>
        ) : (
          <>
            <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Answer
                label="Ingredients / portion"
                value={card.cost_per_portion === null ? '—' : formatMoneyString(card.cost_per_portion)}
              />
              <Answer
                label="Food cost %"
                value={pct === null ? '—' : `${pct.toFixed(1)}%`}
                tone={figureTone(pct)}
                sub={card.target_pct === null ? 'no course target' : `target ${card.target_pct}%`}
              />
              <Answer
                label="Loaded / portion"
                value={card.loaded_per_portion === null ? '—' : formatMoneyString(card.loaded_per_portion)}
                sub={f.overheadPct === '' ? 'no overhead set' : `with ${f.overheadPct}% overhead`}
              />
              <Answer
                label="Margin / portion"
                value={card.margin_per_portion === null ? '—' : formatMoneyString(card.margin_per_portion)}
                tone={
                  card.margin_per_portion !== null && Number(card.margin_per_portion) < 0
                    ? 'text-red-700'
                    : 'text-stone-900'
                }
                sub={card.selling_price === null ? 'no selling price' : undefined}
              />
            </div>

            {flag !== null && <p className="mt-3 text-xs text-stone-600">{flag.hint}</p>}

            <p className="mt-3 border-t border-rule-soft pt-2 text-xs text-stone-500">
              <span className="font-medium">Food cost % is ingredients only</span> — it does not include the
              overhead. That is deliberate: overhead is a figure you set for pricing, and folding a manual
              number into the ratio you judge the kitchen by would make the kitchen answer for your estimate.
              The figure is coloured on its own merits (amber over 35%, red over 40%); the flag beside it asks
              the different question of whether it beats this course&apos;s target.
            </p>
          </>
        )}
      </section>
    </div>
  )
}
