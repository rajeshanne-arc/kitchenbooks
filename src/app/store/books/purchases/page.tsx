import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listBills } from '@/server/books-queries'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { readView } from '@/lib/views'
import { businessToday } from '@/server/business-day'
import PeriodControl from '@/components/dashboard/PeriodControl'
import ViewToggle from '@/components/ViewToggle'
import FilterInput from '@/components/books/FilterInput'
import BillList from '@/components/books/BillList'
import { ByDay, ByVendor, type DayGroup, type VendorGroup } from '@/components/books/PurchaseGroups'
import { SalesLine } from '@/components/dashboard/Charts'
import Honesty from '@/components/Honesty'
import { cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

/**
 * THE PURCHASE REGISTER — one ledger, three grains.
 *
 * Bills and Daily purchases were the same rows. A vendor delivers once a day,
 * so 323 August bills grouped to 301 day-vendor rows: 7% fewer rows, and in
 * exchange the document number, the vendor's own bill number, the line count
 * and the link to the document all went away. That is the register with
 * information taken out, at 93% of the length — and the duplication rule that
 * retired /store/books/stock was simply never applied to it.
 *
 * THE OLD "BY DAY AND VENDOR" CROSS PRODUCT IS DELETED. It was the bug: it
 * answered neither question. By day is 26 rows for August, not 301.
 *
 * PERIOD-SCOPED THROUGHOUT. Bills was all-time and Daily purchases was
 * period-scoped, which is why neither reconciled to the dashboard's Goods in
 * card — the header line here is that reconciliation, and it is asserted.
 */

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

/** Bills below this are the long tail somebody may want to consolidate. */
const SMALL_BILL_PAISE = 100_000

export default async function PurchasesPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; view?: string; q?: string; day?: string; vendor?: string }>
}) {
  const { period: periodParam, view, q = '', day, vendor } = await searchParams
  const periodToday = await businessToday()
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)
  const grain = readView('purchases', view)
  const restaurant = await getRestaurant()

  // ONE QUERY SERVES ALL THREE GRAINS and both expansions. bill_total is two
  // decimal places, so decimalStringToPaise is lossless and the sums below are
  // exact INTEGER arithmetic — this is not the paise fault, which is summing
  // values already rounded away from a longer number.
  const bills = await listBills(restaurant.id, { from: period.from, to: period.to }, q)
  const paiseOf = (b: (typeof bills)[number]) => decimalStringToPaise(b.bill_total)
  const total = bills.reduce((n, b) => n + paiseOf(b), 0)

  const dayMap = new Map<string, { paise: number; bills: number; vendors: Set<string> }>()
  const vendorMap = new Map<string, { name: string; paise: number; bills: number }>()
  for (const b of bills) {
    const d = dayMap.get(b.bill_date) ?? { paise: 0, bills: 0, vendors: new Set<string>() }
    d.paise += paiseOf(b)
    d.bills += 1
    d.vendors.add(b.vendor_code)
    dayMap.set(b.bill_date, d)

    const v = vendorMap.get(b.vendor_code) ?? { name: b.vendor_name, paise: 0, bills: 0 }
    v.paise += paiseOf(b)
    v.bills += 1
    vendorMap.set(b.vendor_code, v)
  }

  const days: DayGroup[] = [...dayMap.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, d]) => ({ key, bills: d.bills, vendors: d.vendors.size, paise: d.paise }))
  const chartDays = [...dayMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))

  const vendors: VendorGroup[] = [...vendorMap.entries()]
    .sort((a, b) => b[1].paise - a[1].paise || a[0].localeCompare(b[0]))
    .map(([code, v]) => ({
      key: code,
      code,
      name: v.name,
      bills: v.bills,
      paise: v.paise,
      share: total === 0 ? 0 : (v.paise / total) * 100,
    }))

  // CONCENTRATION — the vendor that CROSSES 80% is INCLUDED. The test is on
  // the running total BEFORE each vendor: while less than 80% of spend has
  // been accounted for, this vendor is still part of accounting for it.
  // Excluding it would report a set that does not actually reach 80%.
  let running = 0
  let topN = 0
  for (const v of vendors) {
    if (running < total * 0.8) topN += 1
    running += v.paise
  }
  const small = bills.filter((b) => paiseOf(b) < SMALL_BILL_PAISE && paiseOf(b) > 0)
  const smallPaise = small.reduce((n, b) => n + paiseOf(b), 0)

  // ONE OPEN GROUP AT A TIME, in the URL — an opened day is shareable, and it
  // behaves like every other filter here. Component state would be neither.
  const base = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams()
    if (periodParam !== undefined && periodParam !== '') p.set('period', periodParam)
    if (view !== undefined && view !== '') p.set('view', view)
    if (q !== '') p.set('q', q)
    for (const [k, val] of Object.entries(extra)) if (val !== null) p.set(k, val)
    const qs = p.toString()
    return qs === '' ? '/store/books/purchases' : `/store/books/purchases?${qs}`
  }

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Purchases</h1>
        <p className={pageSubCls}>
          {restaurant.name} — {period.label}
        </p>
      </header>

      <div className="pb-2">
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath="/store/books/purchases" />
      </div>
      <FilterInput placeholder="Vendor, bill number, or an item on the bill…" />

      {/* THE HEADER LINE IS THE RECONCILIATION this page has never had. Daily
          purchases had no total row at all and Bills had no total anywhere, so
          neither could be held up against the dashboard's Goods in card —
          which reads exactly these rows. Asserted exact, in paise. */}
      <section className={`${cardCls} mt-4`}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span className="text-sm text-stone-600">
            {bills.length} {plural(bills.length, 'bill')} · {days.length} {plural(days.length, 'day')} ·{' '}
            {vendors.length} {plural(vendors.length, 'vendor')}
            {q !== '' && <span className="text-stone-400"> · matching “{q}”</span>}
          </span>
          <span className={`${heroNumCls} text-stone-900`}>{formatPaise(total)}</span>
        </div>
      </section>

      <div className="mt-3">
        <ViewToggle
          param="view"
          value={grain}
          defaultValue="by-bill"
          label="Grain"
          options={[
            { value: 'by-bill', label: 'By bill' },
            { value: 'by-day', label: 'By day' },
            { value: 'by-vendor', label: 'By vendor' },
          ]}
        />
      </div>

      {bills.length === 0 ? (
        <section className={`${cardCls} mt-3`}>
          <h2 className={sectionHeadCls}>{q === '' ? 'No bills' : 'Nothing matches'}</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            {q === ''
              ? 'Nothing was bought in this period.'
              : `No bill in this period names “${q}” — by vendor, bill number or item.`}
          </p>
          {q === '' && (
            <Link
              href="/store/receive/purchase"
              className="mt-4 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Enter a bill
            </Link>
          )}
        </section>
      ) : grain === 'by-bill' ? (
        <section className={`${cardCls} mt-3`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>The register</h2>
            <span className="font-mono text-[10px] text-stone-400">bills</span>
          </div>
          {/* EVERY BILL, no cap. The 300 that used to sit in the query hid
              thirty of these with no line saying so. */}
          <div className="mt-2">
            <BillList bills={bills} />
          </div>
        </section>
      ) : grain === 'by-day' ? (
        <div className="mt-3 space-y-4">
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Spend by day</h2>
              <span className="font-mono text-[10px] text-stone-400">purchases</span>
            </div>
            {chartDays.length > 1 && (
              <div className="mt-2">
                <SalesLine
                  points={chartDays.map(([d, v]) => ({ date: d, revenue: (v.paise / 100).toFixed(2), orders: 0 }))}
                />
              </div>
            )}
            <ByDay groups={days} bills={bills} open={day ?? null} hrefFor={(d) => base({ day: d, vendor: null })} />
          </section>
        </div>
      ) : (
        <div className="mt-3 space-y-4">
          {/* THE READING. Informational and amber, never an alarm — nothing
              here is wrong. Concentration is what a store manager can act on:
              it names how few relationships the money actually runs through. */}
          {total > 0 && (
            <Honesty verdict="what the spend is shaped like">
              {topN} of {vendors.length} {plural(vendors.length, 'vendor')} carry 80% of {formatPaise(total)}.
              {small.length > 0 && (
                <>
                  {' '}
                  {small.length} {plural(small.length, 'bill')} came to under ₹1,000, {formatPaise(smallPaise)} in
                  total — small drops are the ones worth consolidating into a single trip.
                </>
              )}
            </Honesty>
          )}
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-2">
              <h2 className={sectionHeadCls}>Spend by vendor</h2>
              <span className="font-mono text-[10px] text-stone-400">purchases</span>
            </div>
            {/* EVERY VENDOR, NO TAIL. A <Rest> row naming its value is right
                for a top-8 preview beside a chart; here the tail would have
                been "26 other vendors · ₹7,34,635.79 · 41.3%" — the largest
                single line on the screen, and the one thing a reader most
                needs opened. 31 rows fit, so there is nothing to hide. */}
            <ByVendor
              groups={vendors}
              bills={bills}
              open={vendor ?? null}
              hrefFor={(v) => base({ vendor: v, day: null })}
            />
          </section>
        </div>
      )}
    </>
  )
}
