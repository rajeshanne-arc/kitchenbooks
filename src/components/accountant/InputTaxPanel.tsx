'use client'

// Input tax — what suppliers charged, and THE ONE ASSUMPTION, made
// configurable.
//
// Whether tax paid to a supplier comes back (a credit) or stays spent (a
// cost) is not a fact about the world. It depends on the scheme this
// restaurant is on and the country it is in, and it flips the meaning of
// every figure below. So it is a setting, it is stated on screen in plain
// words either way, and it is changed here rather than assumed in code.
//
// The default is NOT creditable — the conservative reading, because it
// treats the money as spent, which is true until somebody confirms it can
// be reclaimed.
//
// WHAT THIS CARD REFUSES TO PRINT: a net figure. Output less input is a
// filing position — which side is claimable, in which period, under which
// scheme — and this app does not take filing positions. The two numbers sit
// side by side and the sentence beneath says whose call the third one is.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { setInputTaxCreditable } from '@/server/accountant-actions'
import { formatMoneyString, formatPaise } from '@/lib/money'
import Honesty from '@/components/Honesty'
import { cardCls, heroNumCls, sectionHeadCls } from '@/components/ui'
import { toast } from '@/components/Toasts'

export default function InputTaxPanel({
  taxable,
  tax,
  bills,
  outputTaxPaise,
  saleDays,
  setting,
  periodValue,
}: {
  taxable: string
  tax: string
  bills: number
  /** the same total the day table foots to — passed, never re-summed */
  outputTaxPaise: number
  /** how many days that total is made of. Zero makes it the sum of nothing,
   *  which is a different fact from a period that collected no tax. */
  saleDays: number
  /** the raw setting: null means nobody has answered, which is its own fact */
  setting: string | null
  /** the ?period= value to carry forward — a preset key OR a custom range,
   *  which is why it arrives already serialised rather than as a PeriodKey */
  periodValue: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  // 'true' means creditable; ANYTHING else, including never having been
  // asked, means it is a cost. Read once, here, in one place.
  const creditable = setting === 'true'
  const answered = setting !== null

  async function choose(next: boolean) {
    if (busy || (answered && next === creditable)) return
    setBusy(true)
    try {
      const res = await setInputTaxCreditable(next)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast(next ? 'Recorded as a credit' : 'Recorded as a cost', 'ok')
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was changed.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Charged by suppliers</h2>
        <span className="font-mono text-[10px] text-stone-400">purchase_register</span>
      </div>

      {/* Two figures, side by side, and no third one. */}
      <div className="mt-2 grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-rule bg-paper px-3 py-2.5">
          <span className="block text-xs text-stone-500">Collected on sales</span>
          <span className={`${heroNumCls} block text-[21px] text-stone-900`}>
            {formatPaise(outputTaxPaise)}
          </span>
        </div>
        <div className="rounded-xl border border-rule bg-paper px-3 py-2.5">
          <span className="block text-xs text-stone-500">Paid to suppliers</span>
          <span className={`${heroNumCls} block text-[21px] text-stone-900`}>
            {formatMoneyString(tax)}
          </span>
        </div>
      </div>

      {/* The left figure has the same exposure the right one is already
          guarded against: a sum over no rows reads as a confident zero. */}
      {saleDays === 0 && (
        <div className="mt-2">
          <Honesty verdict="no days fetched">
            No day in this period has been fetched from the point of sale, so the figure on the left
            is the sum of nothing at all. It is not a period in which no tax was collected.
          </Honesty>
        </div>
      )}

      <p className="mt-2 text-xs text-stone-500">
        Side by side, and no third figure. One taken from the other is a filing position — which
        side is claimable, in which period, under which scheme — and this app does not take one.
        That subtraction is the accountant&apos;s, made with the rules that apply here.
      </p>

      {bills === 0 ? (
        <div className="mt-3">
          <Honesty verdict="no bills">
            No purchase bill falls in this period, so there is no supplier tax to show. The zero
            above means nothing was entered — not that suppliers charged nothing.
          </Honesty>
        </div>
      ) : (
        <p className="mt-2 text-xs text-stone-500">
          From {bills} {bills === 1 ? 'bill' : 'bills'} totalling {formatMoneyString(taxable)}{' '}
          before tax.{' '}
          <Link
            href={`/accounts/registers/purchase?period=${periodValue}`}
            className="underline underline-offset-2 hover:text-stone-700"
          >
            The purchase register
          </Link>{' '}
          lists them one by one.
        </p>
      )}

      {/* The assumption, asked as a question rather than made in code. */}
      <div className="mt-3 rounded-xl border border-amber-300 bg-field p-3">
        <span className="text-[15px] font-medium text-stone-900">
          Does this restaurant get the supplier tax back?
        </span>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {[
            { v: false, label: 'No — it is a cost' },
            { v: true, label: 'Yes — it is a credit' },
          ].map((o) => (
            <button
              key={String(o.v)}
              type="button"
              disabled={busy}
              aria-pressed={answered && creditable === o.v}
              onClick={() => void choose(o.v)}
              className={`min-h-[44px] rounded-xl border px-3 text-sm font-medium transition-colors disabled:opacity-50 ${
                answered && creditable === o.v
                  ? 'border-emerald-700 bg-emerald-700 text-white'
                  : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <p className="mt-2 text-xs text-stone-600">
          {creditable ? (
            <>
              <span className="font-medium">Set as a credit.</span> The tax suppliers charge is
              treated as reclaimable against the tax collected on sales, so it is not part of what
              the food cost.
            </>
          ) : (
            <>
              {/* unanswered is not the same as answered "no" — the reading is
                  the same, the standing behind it is not */}
              <span className="font-medium">
                {answered ? 'Set as a cost.' : 'Being read as a cost.'}
              </span>{' '}
              The tax suppliers charge is treated as spent — part of what the food cost, not
              something claimed back later.
            </>
          )}{' '}
          Schemes differ, and countries differ more; this is a setting about this restaurant, not a
          rule about the world. It applies to every period, not only the one on screen.
        </p>
      </div>

      {!answered && (
        <div className="mt-3">
          <Honesty verdict="not answered yet">
            Nobody has said which way this restaurant is treated, so it is being read the careful
            way — as a cost. That assumes the money is gone, which stays true until someone
            confirms it can be claimed back. Answer it above and the reading stops being an
            assumption.
          </Honesty>
        </div>
      )}
    </section>
  )
}
