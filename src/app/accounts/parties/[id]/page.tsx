// One vendor's statement. The document a vendor asks for by name: who they
// are, what they were owed at the start, everything that moved, and what is
// owed at the end.
//
// Two queries, not one. The second reads everything BEFORE the period and is
// summed into the brought-forward line — without it the running balance would
// start at the vendor's all-time opening figure while showing only this
// period's bills, and print a closing balance that is short by every bill in
// between. A running balance is arithmetic on stated figures; it is only that
// if all the stated figures are in it.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getVendorDetail } from '@/server/books-queries'
import { getVendorStatement } from '@/server/register-queries'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { RetiredBadge } from '@/components/books/Badges'
import PeriodControl from '@/components/dashboard/PeriodControl'
import PrintButton from '@/components/accountant/PrintButton'
import StatementTable from '@/components/accountant/StatementTable'
import { cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

/** older than any bill this restaurant will ever hold — the floor of "before" */
const LEDGER_FLOOR = '1900-01-01'

/** the day before an ISO date, so "before the period" ends where the period starts */
function dayBefore(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default async function VendorStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ period?: string }>
}) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const { period: periodParam } = await searchParams
  const today = await businessToday()
  // ONE front door for ?period=, so preset/custom precedence is decided in
  // one place rather than in twelve hand-written ternaries.
  const periodToday = today
  const periodReq = readPeriodParam(periodParam, periodToday)
  const period = resolvePeriod(periodReq.param, periodToday)

  const restaurant = await getRestaurant()
  const vendor = await getVendorDetail(restaurant.id, id)
  if (!vendor) notFound()

  const [rows, before] = await Promise.all([
    getVendorStatement(restaurant.id, id, period.from, period.to),
    getVendorStatement(restaurant.id, id, LEDGER_FLOOR, dayBefore(period.from)),
  ])

  const opening = decimalStringToPaise(vendor.opening_balance)
  const priorNet = before.reduce(
    (a, r) => a + decimalStringToPaise(r.debit) - decimalStringToPaise(r.credit),
    0,
  )
  const broughtForward = opening + priorNet
  // "brought forward" and "opening" are different claims: one says movements
  // happened before this period, the other says none did.
  const carried = before.length > 0
  const closing =
    broughtForward +
    rows.reduce((a, r) => a + decimalStringToPaise(r.debit) - decimalStringToPaise(r.credit), 0)

  // The statement stops where the period does. When that is not today, the
  // vendor's balance now is a different number and the screen says both
  // rather than letting the closing figure be read as current.
  const stopsShort = period.to < today

  return (
    <>
      <Link
        href="/accounts/parties"
        className="mb-3 inline-block text-sm font-medium text-stone-500 hover:text-stone-800 print:hidden"
      >
        ← Parties
      </Link>

      {/* The header a vendor reads off the paper. The column is called gstin
          because that is what the schema calls it; the LABEL is "Tax ID",
          which is true of an ABN and an EIN as well as a GSTIN. */}
      <header className="pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={pageTitleCls}>{vendor.name}</h1>
          {vendor.status === 'inactive' && <RetiredBadge />}
        </div>
        <p className={pageSubCls}>
          <span className="font-mono">{vendor.code}</span> · {vendor.category_name}
          {vendor.gstin !== null && (
            <>
              {' '}
              · Tax ID <span className="font-mono">{vendor.gstin}</span>
            </>
          )}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          Statement for {restaurant.name} — {fmtDate(period.from)} to {fmtDate(period.to)}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2 pb-4 print:hidden">
        <PeriodControl period={period} error={periodReq.error} basePath={`/accounts/parties/${id}`} />
        <PrintButton label="Print statement" />
      </div>

      <section className={cardCls}>
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Balance as at {fmtDate(period.to)}</h2>
          <span className="font-mono text-[10px] text-stone-400">vendor_statement</span>
        </div>
        <p
          className={`mt-1 text-[30px] ${heroNumCls} ${
            closing < 0 ? 'text-emerald-700' : 'text-stone-900'
          }`}
        >
          {formatPaise(closing)}
        </p>
        <p className="mt-1 text-sm text-stone-500">
          {closing < 0
            ? 'Negative: they hold more of our money than we have billed against — an advance, or a payment entered twice.'
            : 'What we owe them at the end of this period. Debits are their bills, credits are our payments.'}
        </p>
        {stopsShort && (
          <p className="mt-1.5 text-xs text-stone-500">
            This statement stops at {fmtDate(period.to)}. Their balance today is{' '}
            <span className="font-mono tabular-nums">{formatMoneyString(vendor.balance)}</span>.
          </p>
        )}
      </section>

      <section className={`${cardCls} mt-4`}>
        {rows.length === 0 ? (
          <p className="text-sm text-stone-700">
            Nothing moved on this account between {fmtDate(period.from)} and {fmtDate(period.to)} —
            no bill was raised and no payment was made. The{' '}
            {carried ? 'balance brought forward' : 'opening balance'},{' '}
            <span className="font-mono tabular-nums">{formatPaise(broughtForward)}</span>, is
            therefore also the closing balance. An empty period is a real answer.
          </p>
        ) : (
          <StatementTable
            rows={rows}
            broughtForward={broughtForward}
            carried={carried}
            from={period.from}
          />
        )}
      </section>

      <p className="mt-3 text-center text-xs text-stone-400">
        Every line here is an event that was entered once and never edited; a correction is its own
        reversing line, which is why a bill can appear twice with opposite signs.
      </p>
    </>
  )
}
