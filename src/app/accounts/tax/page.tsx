// Tax — the working, not the filing.
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
import { getGstDays, getInputTax, listWithholdings } from '@/server/register-queries'
import { getSettingValue } from '@/server/settings'
import { todayIST } from '@/server/store-queries'
import { isPeriodKey, resolvePeriod, type PeriodKey } from '@/lib/period'
import { decimalStringToPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import PeriodControl from '@/components/dashboard/PeriodControl'
import OutputTax from '@/components/accountant/OutputTax'
import InputTaxPanel from '@/components/accountant/InputTaxPanel'
import WithholdingsPanel from '@/components/accountant/WithholdingsPanel'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const { period: periodParam } = await searchParams
  const periodKey: PeriodKey = isPeriodKey(periodParam) ? periodParam : 'this-month'
  const today = todayIST()
  const period = resolvePeriod(periodKey, today)

  const restaurant = await getRestaurant()
  // one fan-out, not four awaits — the pool is shared with the group layout
  const [days, input, creditableSetting, withholdings] = await Promise.all([
    getGstDays(restaurant.id, period.from, period.to),
    getInputTax(restaurant.id, period.from, period.to),
    getSettingValue(restaurant.id, 'input_tax_creditable'),
    listWithholdings(restaurant.id),
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

      <div className="pb-4">
        <PeriodControl active={periodKey} basePath="/accounts/tax" />
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
          periodKey={periodKey}
        />

        <WithholdingsPanel rows={withholdings} today={today} />
      </div>

      <p className="mt-3 text-center text-xs text-stone-400">
        Three logs and no verdict. What is owed, to whom, in which period and under which scheme is
        the accountant&apos;s call — this screen exists so that call is made over real figures.
      </p>
    </>
  )
}
