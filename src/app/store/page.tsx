import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countItemsWithReorderLevel, countReorderDue, getIssuesBySection, getPaymentsTotal, getPurchaseSeries, getPurchasesByVendor, listOpenIndents } from '@/server/store-queries'
import { getStockAlarms } from '@/server/dashboard-queries'
import { listActiveVendors, listVendorsWithDues } from '@/server/books-queries'
import { listIndents } from '@/server/kitchen-queries'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { requires } from '@/lib/precondition'
import { readPeriodParam, resolvePeriod } from '@/lib/period'
import {
  cardCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import Honesty from '@/components/Honesty'
import { countUnplacedItems } from '@/server/store-queries'
import { countVendorsWithoutPhone } from '@/server/po-queries'
import { getExpiringStock } from '@/server/store-queries'
import { EXPIRING_WITHIN_DAYS, expiryPrompt, expiryState, NO_LOT_TRACKING } from '@/lib/expiry'
import MyQueriesPanel from '@/components/accountant/MyQueriesPanel'
import PeriodControl from '@/components/dashboard/PeriodControl'
import Unassessed, { unassessedToneCls } from '@/components/dashboard/Unassessed'
import GroupDiagnostics from '@/components/dashboard/Diagnostics'
import { MagnitudeBars, SalesLine } from '@/components/dashboard/Charts'
import { businessToday } from '@/server/business-day'

export const dynamic = 'force-dynamic'

/** How many vendors the Goods in table lists before folding the rest into one
 *  named row. The remainder is SHOWN, never dropped — the column has to add up
 *  to the hero above it. */
const VENDOR_ROWS = 8

// The store's own dashboard. Not the owner's questions rephrased — the
// store manager's: what came in, where it went, who is owed, what to buy,
// and what is impossible. Same period control and the same chart rules.
//
// TWO CARDS USED TO CONGRATULATE ON AN EMPTY SET. "Nothing outstanding to any
// vendor" was equally true of a store that owes nobody and one with no vendor
// on its books; "Nothing is waiting" was equally true of a store that has
// filled every request and one nobody has ever asked. Both now declare what
// they rest on. The cards that merely report an absence of ENTRIES — no bills
// this period, nothing issued — are left as they were: they describe the
// record, and make no claim about the world.

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many)

export default async function StoreHome({
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
  const [
    openIndents,
    purchases,
    issuesBySection,
    paymentsTotal,
    byVendor,
    dues,
    alarms,
    reorderCount,
    itemsWithLevel,
  ] = await Promise.all([
    listOpenIndents(restaurant.id),
    getPurchaseSeries(restaurant.id, period.from, period.to),
    getIssuesBySection(restaurant.id, period.from, period.to),
    getPaymentsTotal(restaurant.id, period.from, period.to),
    getPurchasesByVendor(restaurant.id, period.from, period.to),
    listVendorsWithDues(restaurant.id),
    getStockAlarms(restaurant.id),
    countReorderDue(restaurant.id),
    countItemsWithReorderLevel(restaurant.id),
  ])

  // A SECOND BATCH ON PURPOSE. The pool is 12 and the group layout is
  // checking out connections alongside this page — ten at once is already the
  // most this screen may safely ask for. These two only decide whether the
  // cards above are answerable, so they can wait a round trip.
  const [vendors, anyIndent, placement, phones, expiring] = await Promise.all([
    listActiveVendors(restaurant.id),
    listIndents(restaurant.id, 1),
    countUnplacedItems(restaurant.id),
    countVendorsWithoutPhone(restaurant.id),
    getExpiringStock(restaurant.id, today, EXPIRING_WITHIN_DAYS),
  ])

  const purchaseTotal = purchases.reduce((n, p) => n + decimalStringToPaise(p.total), 0)
  // The by-vendor table sits under the Goods in hero and its column must add up
  // to it. Every vendor is fetched; the screen shows the largest few and names
  // the remainder, so nothing is dropped silently.
  const byVendorTotal = byVendor.reduce((n, v) => n + decimalStringToPaise(v.total), 0)
  const byVendorRest = {
    count: Math.max(0, byVendor.length - VENDOR_ROWS),
    paise: byVendor.slice(VENDOR_ROWS).reduce((n, v) => n + decimalStringToPaise(v.total), 0),
  }
  const issueTotal = issuesBySection.reduce((n, s) => n + decimalStringToPaise(s.value), 0)
  const duesTotal = dues.reduce((n, d) => n + decimalStringToPaise(d.balance), 0)

  // vendor_dues only lists non-zero balances, so an empty list is either a
  // store that owes nobody or a store with nobody to owe.
  const owed = requires(
    vendors.length > 0,
    dues,
    'no vendors yet',
    'No vendor is on the books, so nothing could be outstanding to one. That is an empty ledger, not a settled one.',
  )

  // open_indents only lists what is still open. Zero open is a cleared queue
  // ONLY if a queue exists; before the first indent it is an unused feature.
  const waiting = requires(
    anyIndent.length > 0,
    openIndents,
    'no request ever made',
    'No kitchen has ever filed an indent, so nothing can be waiting on the store. Nobody has asked yet — it is not that every ask has been met.',
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Store</h1>
        <p className={pageSubCls}>
          {period.label} · {fmtDate(period.from)} — {fmtDate(period.to)}
        </p>
      </header>

      {/* What the accountant is asking THIS role, on the screen they already
          open every morning. Renders nothing when nothing is asked. */}
      <div className="pb-4">
        <MyQueriesPanel />
      </div>

      {/* ── BAND 1 · NEEDS YOU NOW ────────────────────────────────────────
          THE PERIOD CONTROL COMES FIRST, above everything it scopes. It was
          rendering BELOW three period-scoped cards, so the page answered for a
          window the reader had not yet been shown — the single most visible
          defect on it. */}
      <div className="pb-4">
        <PeriodControl period={period} today={periodToday} error={periodReq.error} basePath="/store" />
      </div>

      {/* what needs doing right now, above everything measured */}
      {(openIndents.length > 0 || alarms.length > 0 || reorderCount > 0) && (
        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          {alarms.length > 0 && (
            <Link
              href="/store/stock/on-hand"
              className={`${cardCls} block border-red-300 bg-red-50/50 hover:border-red-400`}
            >
              <h2 className={`${sectionHeadCls} text-red-700`}>Negative stock</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-red-700`}>{alarms.length}</p>
              <p className="text-xs text-red-800">
                issued more than ever bought — a bill is missing
              </p>
            </Link>
          )}
          {/* AN ALERT CARRYING AN ACTION BEATS ONE CARRYING INFORMATION.
              "Chicken is below par" is a fact; "Chicken is below par — raise
              an order" is a decision. The tile said the fact and led to a
              list; Raise PO now exists, so the action half is real and the
              tile names it. The destination is unchanged — the list is where
              the per-vendor Raise PO buttons live, and picking WHICH vendor is
              a decision the tile cannot make. */}
          {reorderCount > 0 && (
            <Link href="/store/stock/reorder" className={`${cardCls} block border-amber-300 bg-amber-50/40`}>
              <h2 className={sectionHeadCls}>To reorder</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-amber-900`}>{reorderCount}</p>
              <p className="text-xs text-amber-900">at or below their reorder level</p>
              <p className="mt-1.5 text-xs font-semibold text-emerald-700">Raise a purchase order →</p>
            </Link>
          )}
          {openIndents.length > 0 && (
            <Link href="/store/issue" className={`${cardCls} block border-amber-300 bg-amber-50/40`}>
              <h2 className={sectionHeadCls}>Open indents</h2>
              <p className={`mt-1 text-[26px] ${heroNumCls} text-amber-900`}>{openIndents.length}</p>
              <p className="text-xs text-amber-900">kitchens waiting to be issued</p>
            </Link>
          )}
        </div>
      )}

      {/* THE WASTAGE QUICK TILE — and it is load-bearing, not decoration.
          Loss stopped being a top-level tab and became a view inside Stock.
          Wastage is chronically under-recorded in every restaurant precisely
          because it is uncomfortable, so an extra tap costs real data. This
          keeps the one-click path on the landing page, which is the only
          reason burying the tab is acceptable at all.

          UNCONDITIONAL, unlike the alarm tiles above: those appear when
          something is wrong, and this is a door that must always be open.
          `smoke:phase-a` asserts it is here — if it ever goes, Loss comes
          back out as a tab. */}
      <Link
        href="/store/stock/loss"
        className={`${cardCls} mb-4 flex items-baseline justify-between gap-3 border-rule bg-field hover:border-stone-400`}
      >
        <span>
          <h2 className={sectionHeadCls}>Record a loss</h2>
          <p className="mt-1 text-xs text-stone-600">
            Spoiled, broken, thrown away. Easier to write down now than to explain later.
          </p>
        </span>
        <span aria-hidden className="shrink-0 text-sm text-stone-400">
          &rarr;
        </span>
      </Link>

      {/* ── BAND 2 · WHAT HAPPENED ─────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2">
        {/* goods in */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Goods in</h2>
            <span className="font-mono text-[10px] text-stone-400">purchases</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {purchases.length === 0
              ? 'No bills entered for this period.'
              : `${formatPaise(purchaseTotal)} across ${purchases.length} ${plural(purchases.length, 'day')}.`}
          </p>
          {purchases.length === 1 ? (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(purchases[0].total)}
            </p>
          ) : (
            purchases.length > 1 && (
              <div className="mt-2">
                <SalesLine points={purchases.map((p) => ({ date: p.date, revenue: p.total, orders: 0 }))} />
              </div>
            )
          )}

          {/* WHO IT CAME FROM — under the number it breaks down.
              This table was under PAID OUT, headed "Bought from", contradicting
              a payments hero of ₹5,10,307 with roughly ₹15 lakh of purchases.
              It was in the wrong card, not badly labelled, so it moved rather
              than being relabelled.
              THE COLUMN ADDS UP TO THE HERO EXACTLY. Only the largest few are
              listed and the rest are folded into ONE NAMED ROW rather than
              dropped — a top-N that does not say what it left out reads as all
              of it, and this query used to stop at eight of thirty-one. */}
          {byVendor.length > 0 && (
            <div className="mt-3 overflow-x-auto border-t border-rule-soft pt-2">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Bought from</th>
                    <th className={thNumCls}>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {byVendor.slice(0, VENDOR_ROWS).map((v) => (
                    <tr key={v.vendor} className={trCls}>
                      <td className={tdCls}>{v.vendor}</td>
                      <td className={tdNumCls}>{formatMoneyString(v.total)}</td>
                    </tr>
                  ))}
                  {byVendorRest.count > 0 && (
                    <tr className={trCls}>
                      <td className={`${tdCls} text-stone-500`}>
                        {byVendorRest.count} other {plural(byVendorRest.count, 'vendor')}
                      </td>
                      <td className={`${tdNumCls} text-stone-500`}>{formatPaise(byVendorRest.paise)}</td>
                    </tr>
                  )}
                  <tr className={trCls}>
                    <td className={`${tdCls} font-semibold`}>All vendors</td>
                    <td className={`${tdNumCls} font-semibold`}>{formatPaise(byVendorTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* ONE CARD, NOT TWO. This and ConsumptionByDept reported the same
            fact from the same source and both said nothing was issued, six
            hundred pixels apart. This one keeps the grid position and the
            magnitude bars; the other is gone.
            DEPARTMENT, NOT SECTION — the app says department everywhere else,
            and `section` is the column name leaking into the interface. */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Stock out, by department</h2>
            <span className="font-mono text-[10px] text-stone-400">issue_lines</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {issuesBySection.length === 0
              ? 'Nothing issued in this period.'
              : `${formatPaise(issueTotal)} left the store for ${issuesBySection.length} ${plural(
                  issuesBySection.length,
                  'department',
                )}.`}
          </p>
          {issuesBySection.length > 0 && (
            <div className="mt-2">
              <MagnitudeBars
                rows={issuesBySection
                  .slice(0, 6)
                  .map((s) => ({ label: s.section, value: decimalStringToPaise(s.value) / 100 }))}
                height={Math.max(110, Math.min(issuesBySection.length, 6) * 28 + 40)}
              />
            </div>
          )}
        </section>

        {/* vendor dues */}
        <section className={`${cardCls} ${owed.assessable ? '' : unassessedToneCls}`}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Outstanding to vendors</h2>
            <span className="font-mono text-[10px] text-stone-400">vendor_dues</span>
          </div>
          {!owed.assessable ? (
            <>
              <p className="mt-1.5 text-sm text-stone-600">{owed.why}</p>
              <div className="mt-2">
                <Unassessed needs={owed.needs} />
              </div>
              <Link
                href="/store/masters/vendors/new"
                className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
              >
                add a vendor →
              </Link>
            </>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                {owed.data.length === 0
                  ? 'Nothing outstanding to any vendor.'
                  : `${formatPaise(duesTotal)} owed across ${owed.data.length} ${plural(owed.data.length, 'vendor')}.`}
              </p>
              {owed.data.length > 0 && (
                <>
                  <div className="mt-2">
                    <MagnitudeBars
                      rows={owed.data
                        .slice(0, 6)
                        .map((d) => ({ label: d.name, value: decimalStringToPaise(d.balance) / 100 }))}
                      height={Math.max(110, Math.min(owed.data.length, 6) * 28 + 40)}
                    />
                  </div>
                  <Link
                    href="/store/receive/pay"
                    className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline"
                  >
                    pay a vendor →
                  </Link>
                </>
              )}
            </>
          )}
        </section>

        {/* payments out */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-2">
            <h2 className={sectionHeadCls}>Paid out</h2>
            <span className="font-mono text-[10px] text-stone-400">payments</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            {paymentsTotal.count === 0
              ? 'No vendor payments recorded in this period.'
              : `${formatMoneyString(paymentsTotal.total)} in ${paymentsTotal.count} ${plural(
                  paymentsTotal.count,
                  'payment',
                )}.`}
          </p>
          {paymentsTotal.count > 0 && (
            <p className={`mt-1 text-[26px] ${heroNumCls} text-stone-900`}>
              {formatMoneyString(paymentsTotal.total)}
            </p>
          )}
        </section>
      </div>

      {/* DATED DELIVERIES OF THINGS STILL ON THE BOOK.
          THE LIMITATION IS THE FEATURE, and it is on the screen in these
          terms: there is no LOT tracking. Stock is a running quantity, so the
          app knows the restaurant holds 4 litres and cannot know whether they
          are the ones bought on the 5th. Every line here is therefore a PROMPT
          to go and look at a date, never a claim about what is on the shelf.
          Say it the other way round and the card is wrong twice and then
          ignored forever. */}
      {expiring.length > 0 && (
        <section className={`${cardCls} mt-3`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Dates worth checking</h2>
            <span className="font-mono text-[11px] text-stone-400">expiring_stock</span>
          </div>
          <ul className="mt-2 space-y-2">
            {expiring.slice(0, 8).map((e, i) => {
              const state = expiryState(e.expiry_date, today)
              return (
                <li key={`${e.item_id}-${e.bill_date}-${i}`} className="flex items-start gap-2 text-[13px]">
                  <span
                    aria-hidden
                    className={`mt-[3px] h-[11px] w-[11px] shrink-0 rounded-[2px] border ${
                      state === 'expired' ? 'border-red-700 bg-red-600' : 'border-amber-500 bg-amber-300'
                    }`}
                  />
                  <span className={state === 'expired' ? 'text-red-800' : 'text-stone-700'}>
                    {expiryPrompt({
                      itemName: e.name,
                      billDate: e.bill_date,
                      expiryDate: e.expiry_date,
                      onHand: e.on_hand_qty,
                      unit: e.purchase_unit,
                      today,
                      fmtDate,
                    })}
                  </span>
                </li>
              )
            })}
          </ul>
          {expiring.length > 8 && (
            <p className="mt-2 text-xs text-stone-500">and {expiring.length - 8} more.</p>
          )}
          <div className="mt-3">
            <Honesty verdict="a prompt, not a fact">
              {NO_LOT_TRACKING} Full batch tracking is what a pharmacy needs; a kitchen turning fresh produce
              in days does not, and building it would put a date on every issue line for the rest of time.
            </Honesty>
          </div>
        </section>
      )}

      {/* ── BAND 3 · WHAT IS MISSING ──────────────────────────────────────
          READINESS — things that are empty until somebody does them. An empty
          list here is never evidence that all is well; it is evidence nobody
          has been asked.
          ORDERED BY WHAT THEY BLOCK, not by the order they were written. 357
          of 358 items carry no storage location, which blocks the count sheet
          ENTIRELY — every one of them lands under "Not placed yet", which on a
          real walk means walked past. A vendor with no phone blocks nothing
          until somebody raises a purchase order. So placement leads. */}
      {/* The books' own diagnostics, routed here because the store is where a
          bill number is typed and where a vendor's tax registration is
          editable. The accountant still sees both on Review; this is the same
          fact reaching the desk that can clear it. ADJACENT to "Still to set
          up" because they answer one question — what is not done — and six
          hundred pixels apart they read as two unrelated complaints. */}
      <div className="mt-3">
        <GroupDiagnostics
          restaurantId={restaurant.id}
          group="store"
          extra={{
            'Purchases with no bill number': {
              action: { href: '/store/books/bills', label: 'The bills log' },
            },
            'Active vendors with no tax registration recorded': {
              action: { href: '/store/masters/vendors', label: 'Vendors' },
            },
          }}
        />
      </div>

      {(placement.unplaced > 0 || phones.without > 0 || (reorderCount === 0 && itemsWithLevel === 0)) && (
        <section className={`${cardCls} mt-3`}>
          <h2 className={sectionHeadCls}>Still to set up</h2>
          <div className="mt-2 space-y-2">
            {reorderCount === 0 && itemsWithLevel === 0 && (
              <Honesty verdict="no reorder levels" compact>
                No item carries a reorder level, so nothing can ever appear on the Reorder tab. That list is empty
                because the question has not been asked — not because the store is full. Set levels under Masters →
                Items.
              </Honesty>
            )}
            {/* PLACE YOUR ITEMS. Nothing is blocked by this until the first
                physical count — and then an unplaced item is one the sheet
                cannot put on anybody's route, so it gets walked past. */}
            {placement.unplaced > 0 && (
              <Honesty
                verdict="items not placed"
                meter={{
                  filled: placement.total - placement.unplaced,
                  total: placement.total,
                  unit: 'items placed',
                }}
                action={{ href: '/store/masters/items', label: 'Place them on the item master' }}
              >
                {placement.unplaced} of {placement.total} active{' '}
                {placement.unplaced === 1 ? 'item has' : 'items have'} no storage location. The count sheet walks the
                store in location order, so {placement.unplaced === 1 ? 'it lands' : 'they land'} at the bottom under
                “Not placed yet” — which on a real walk means walked past. Nothing else is affected until somebody
                counts.
              </Honesty>
            )}
            {/* NOWHERE TO SEND AN ORDER. A purchase order can be written and
                printed without a phone number and cannot be sent, so this
                blocks nothing until the day somebody raises one — and then it
                blocks the only thing that mattered. */}
            {phones.without > 0 && (
              <Honesty
                verdict="vendors unreachable"
                level={phones.without === phones.total ? 'alarm' : 'pending'}
                meter={{
                  filled: phones.total - phones.without,
                  total: phones.total,
                  unit: 'vendors reachable',
                }}
                action={{ href: '/store/masters/vendors', label: 'Add numbers on the vendor master' }}
              >
                {phones.without} of {phones.total} active{' '}
                {phones.without === 1 ? 'vendor has' : 'vendors have'} no phone number, so a purchase order to{' '}
                {phones.without === 1 ? 'them' : 'any of them'} can be written and printed but never sent. A
                purchase order with nowhere to send it is a PDF.
              </Honesty>
            )}
          </div>
        </section>
      )}

      {/* WHAT IS ACTUALLY OUTSTANDING — open indents nobody has filled.
          This replaced a per-department checklist that could never be
          honestly completed: a zero beside Bakery could not tell "took
          nothing today" from "nobody wrote it down", so the only way to
          finish it was to issue stock to a department that did not want
          any. A list that cannot be completed is a list people stop
          reading. An open indent is a real request, from a real person,
          that is finite and can actually be cleared. */}
      <section className={`${cardCls} mt-3 ${waiting.assessable ? '' : unassessedToneCls}`}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Requests waiting to be filled</h2>
          <span className="text-xs text-stone-400">open_indents</span>
        </div>
        {!waiting.assessable ? (
          <>
            <p className="mt-1.5 text-sm text-stone-600">{waiting.why}</p>
            <div className="mt-2">
              <Unassessed needs={waiting.needs} />
            </div>
          </>
        ) : waiting.data.length === 0 ? (
          <p className="mt-1.5 text-sm text-stone-700">
            Nothing is waiting. The kitchens have asked for nothing the store has not already given.
          </p>
        ) : (
          <>
            <div className="mt-2 overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Department</th>
                    <th className={thCls}>Session</th>
                    <th className={thCls}>Asked</th>
                    <th className={thNumCls}>Items</th>
                    <th className={thCls}>
                      <span className="sr-only">Fill</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {waiting.data.map((i) => (
                    <tr key={i.id} className={trCls}>
                      <td className={tdCls}>{i.section_name}</td>
                      <td className={`${tdCls} text-stone-600`}>{i.session}</td>
                      <td className={`${tdCls} text-stone-500`}>
                        {fmtDate(i.indent_date)}
                        {i.entered_by !== null && ` · ${i.entered_by}`}
                      </td>
                      <td className={tdNumCls}>{i.line_count}</td>
                      <td className={`${tdCls} text-right`}>
                        <Link
                          href={`/store/issue?indent=${i.id}`}
                          className="text-xs font-medium text-emerald-700 hover:underline"
                        >
                          fill it →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-stone-400">
              Each one is a request a kitchen made and is waiting on. Filling it stamps the issue
              against the indent, which is what makes the asked-versus-given gap mean anything.
            </p>
          </>
        )}
      </section>
    </>
  )
}
