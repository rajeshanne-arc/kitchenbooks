// A FIGURE BESIDE THE ONE IT IS BEING COMPARED WITH — and the two reasons it
// often cannot be.
//
// EVERY FAILURE MODE HERE IS A PLAUSIBLE-LOOKING WRONG NUMBER. A percentage
// against a month nobody was entering reads exactly like a percentage against a
// month somebody was; a baseline window off by three days renders perfectly.
// None of them announces itself, which is why both gates are structural rather
// than advisory.

import Honesty from '@/components/Honesty'
import { formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import type { Baseline } from '@/lib/period'
import { baselineTooThin, cannotAssess } from '@/lib/compare'

export type CompareInput = {
  baseline: Baseline
  /** current window */
  now: number
  nowDays: number
  /** baseline window */
  then: number
  thenDays: number
  /** ALL-TIME first entry for THIS measure — read per measure at query time,
   *  never a constant. Purchases began 5 Jun, issues 28 Aug, wastage has not
   *  begun; they do not start together and never will. */
  firstEntry: string | null
  /** what the measure is called in a sentence */
  noun: string
}

export default function Compare({ baseline, now, nowDays, then, thenDays, firstEntry, noun }: CompareInput) {
  if (baseline.kind === 'none') return null

  // ── GATE 1 · THE BOOKS DID NOT EXIST ────────────────────────────────────
  // Not "there is nothing to compare" but "there could not have been". A zero
  // baseline drawn from a window that predates the first entry would read as a
  // collapse to nothing, or an infinite rise from it.
  if (cannotAssess(baseline, firstEntry)) {
    return (
      <Honesty verdict="cannot be assessed" compact>
        {firstEntry === null
          ? `No ${noun} has ever been recorded, so there is nothing to compare against.`
          : `The books do not go back that far — the first ${noun} on record is ${fmtDate(firstEntry)}, and this baseline starts ${fmtDate(baseline.from)}.`}{' '}
        No figure is shown rather than a fall from a window nobody was entering.
      </Honesty>
    )
  }

  // ── GATE 2 · THE BASELINE IS TOO THIN ───────────────────────────────────
  // ONE-SIDED, DELIBERATELY. Only the BASELINE is tested: a thin CURRENT period
  // is NEWS — something stopped — and gating it would hide the finding. Both
  // absolute figures and both day counts are shown; only the PERCENTAGE is
  // withheld, because that is the only part the thinness makes meaningless.
  const thin = baselineTooThin(thenDays, nowDays)
  const pct = then === 0 ? null : ((now - then) / then) * 100

  return (
    <div className="mt-2 border-t border-rule-soft pt-2">
      <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
        <span className="text-stone-500">vs {baseline.label}</span>
        <span className="font-mono tabular-nums text-stone-700">{formatPaise(then)}</span>
        {!thin && pct !== null && (
          // Sign printed, and colour only agreeing with it — never carrying the
          // meaning alone.
          <span className={`font-mono tabular-nums ${now >= then ? 'text-emerald-800' : 'text-red-700'}`}>
            {now >= then ? '+' : ''}
            {pct.toFixed(1)}%
          </span>
        )}
        <span className="ml-auto font-mono text-[11px] text-stone-400">
          {nowDays} vs {thenDays} active {thenDays === 1 && nowDays === 1 ? 'day' : 'days'}
        </span>
      </div>

      {/* A BASELINE THAT NETS TO ZERO HAS NO RATIO, and a blank where a
          percentage usually sits reads as "unchanged" rather than as
          "undivisible". Said in words, the same law as every other gap. */}
      {!thin && pct === null && (
        <div className="mt-1.5">
          <Honesty verdict="no ratio" compact>
            The baseline window nets to nothing, so there is no percentage to take against it — every change from
            zero is infinite. The two figures are above.
          </Honesty>
        </div>
      )}

      {thin && (
        <div className="mt-1.5">
          <Honesty verdict="baseline too thin" compact>
            {thenDays === 0
              ? `Nothing was entered in the baseline window at all`
              : `The baseline carries ${thenDays} ${thenDays === 1 ? 'day' : 'days'} of entries against ${nowDays}`}
            , so a percentage between them would measure how much was written down, not how much was bought.
            Both figures are above; the percentage is withheld until the baseline fills in — which it does on
            its own, with nothing to switch off.
          </Honesty>
        </div>
      )}
    </div>
  )
}
