// Tax — the working, not the filing. It sits among the REGISTERS because
// that is what it is: output from the point of sale, input from the bills,
// both as rows in a period.
//
// The framing that came with it from the sales books, and it is doing real
// work: GST belongs to the government and service charge belongs to the
// staff. NEITHER IS REVENUE — both pass through the till on their way
// somewhere else, and a screen that lets either read as income has already
// lost the argument.
//
// Phase C's rule in one screen: capture the SHAPE, configure the rules.
// Nothing here knows what a rate ought to be, in which country, under which
// scheme. It totals what the point of sale collected, totals what suppliers
// charged, and logs what was held back from a payment. It stops there. The
// last step — netting one against the other — is a filing position, and a
// filing position is signed by a human, not printed by an app.
//
// The one assumption this page cannot avoid (is supplier tax a credit or a
// cost?) is therefore a SETTING, read here and stated on screen either way.
import { getRestaurant } from '@/server/queries'
import { getGstDays, getInputTax } from '@/server/register-queries'
import { getSettingValue } from '@/server/settings'
import { periodParamValue, readPeriodParam, resolvePeriod } from '@/lib/period'
import { decimalStringToPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import PeriodControl from '@/components/dashboard/PeriodControl'
import OutputTax from '@/components/accountant/OutputTax'
import InputTaxPanel from '@/components/accountant/InputTaxPanel'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const today = await businessToday()
  // ONE front door for ?period=, so preset/custom precedence is decided in
  // one place rather than in twelve hand-written ternaries.
  const periodToday = today
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)

  const restaurant = await getRestaurant()
  // one fan-out, not four awaits — the pool is shared with the group layout
  const [days, input, creditableSetting] = await Promise.all([
    getGstDays(restaurant.id, period.from, period.to),
    getInputTax(restaurant.id, period.from, period.to),
    getSettingValue(restaurant.id, 'input_tax_creditable'),
  ])

  // The only arithmetic on this page: adding up columns it was handed. The
  // totals are worked out once, here, so the table foot and the figure the
  // input-tax card sits beside can never be two different sums.
  const totals = {
    sale: days.reduce((a, d) => a + decimalStringToPaise(d.food_bev), 0),
    tax: days.reduce((a, d) => a + decimalStringToPaise(d.gst_collected), 0),
    service: days.reduce((a, d) => a + decimalStringToPaise(d.service_charge), 0),
    container: days.reduce((a, d) => a + decimalStringToPaise(d.container), 0),
  }

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Tax</h1>
        <p className={pageSubCls}>
          {restaurant.name} — {fmtDate(period.from)} to {fmtDate(period.to)}. The working, not the
          filing.
        </p>
      </header>

      <p className="mb-4 rounded-xl border border-rule bg-stone-50 px-3 py-2 text-sm text-stone-700">
        GST belongs to the government. Service charge belongs to the staff. Neither is revenue — both pass
        through the till on their way somewhere else.
      </p>

      <div className="pb-4">
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath="/accounts/registers/tax" />
      </div>

      <div className="space-y-4">
        <OutputTax days={days} totals={totals} from={period.from} to={period.to} />

        <InputTaxPanel
          taxable={input.taxable}
          tax={input.tax}
          bills={input.bills}
          outputTaxPaise={totals.tax}
          saleDays={days.length}
          setting={creditableSetting}
          periodValue={periodParamValue(periodReq.param)}
        />

        {/* Withholdings moved to Payments → Tax deposit. Marking a challan
            deposited names an account and moves real money today, which makes
            it a payment; a register is for reading. Mounting the panel here as
            well would be the second mount of one component. */}
      </div>

      <p className="mt-3 text-center text-xs text-stone-400">
        Three logs and no verdict. What is owed, to whom, in which period and under which scheme is
        the accountant&apos;s call — this screen exists so that call is made over real figures.
      </p>
    </>
  )
}
