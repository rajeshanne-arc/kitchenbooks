// Parties — who owes whom, both directions on one screen.
//
// Deliberately NOT period-scoped. A debt is not a month: what a vendor is
// owed today is opening plus every bill ever raised minus every payment ever
// made, and slicing that by a period would produce a smaller, friendlier and
// entirely wrong number. The period control belongs on the statement, where
// the question really is "what moved between these two dates".
import { getRestaurant } from '@/server/queries'
import { listVendorsWithDues } from '@/server/books-queries'
import { getAggregatorReceivable } from '@/server/register-queries'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import Honesty from '@/components/Honesty'
import AggregatorTable from '@/components/accountant/AggregatorTable'
import VendorDuesTable from '@/components/accountant/VendorDuesTable'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PartiesPage() {
  const restaurant = await getRestaurant()
  const [dues, receivable] = await Promise.all([
    listVendorsWithDues(restaurant.id),
    getAggregatorReceivable(restaurant.id),
  ])

  const owed = dues.reduce((a, r) => a + decimalStringToPaise(r.balance), 0)
  const neverPaid = dues.filter((r) => r.days_since_payment === null)
  const ratedPartners = receivable.filter((r) => r.agreed_commission_pct !== null)
  const unrated = receivable.filter((r) => r.agreed_commission_pct === null)
  // A partner with no orders on their channel AND no settlement filed has two
  // zeroes and nothing between them. Outstanding is then arithmetically zero
  // and means nothing — the danger being that a column of ₹0.00 reads as
  // "everyone is square" when it is really "nothing has arrived to compare".
  const compared = receivable.filter(
    (r) => decimalStringToPaise(r.gross_billed) !== 0 || r.last_settled !== null,
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Parties</h1>
        <p className={pageSubCls}>
          {restaurant.name} — who owes whom, as it stands today rather than for any one month.
        </p>
      </header>

      <div className="space-y-4">
        {/* ── what we owe ───────────────────────────────────────────────── */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Owed to vendors</h2>
            <span className="font-mono text-[10px] text-stone-400">vendor_dues</span>
          </div>

          {dues.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              No vendor is carrying a balance. That reads two ways and the books cannot tell them
              apart from here: everything has been paid, or the bills have not been entered yet. The
              purchase register is where the difference shows.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                <span className="font-mono font-semibold tabular-nums">{formatPaise(owed)}</span>{' '}
                across {dues.length} {dues.length === 1 ? 'vendor' : 'vendors'}, worst first. Opening
                balances carried in from before the app are already inside these figures.
              </p>
              <div className="mt-3">
                <VendorDuesTable rows={dues} />
              </div>
              {neverPaid.length > 0 && (
                <p className="mt-2 text-xs text-stone-500">
                  {neverPaid.length === 1
                    ? 'One vendor here has never been paid at all'
                    : `${neverPaid.length} vendors here have never been paid at all`}
                  {' '}— a different fact from a vendor last paid a long time ago, and often the sign
                  of a bill entered against the wrong party rather than a debt anyone is chasing.
                </p>
              )}
            </>
          )}
        </section>

        {/* ── what is owed to us ────────────────────────────────────────── */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Owed to us by delivery partners</h2>
            <span className="font-mono text-[10px] text-stone-400">aggregator_receivable</span>
          </div>

          {receivable.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              No delivery partners are on the master yet, so there is nothing to reconcile. Until a
              partner is named on that master, orders on their channel cannot be matched to the
              money they send — a manager adds them under Sales, Partners.
            </p>
          ) : (
            <>
              <p className="mt-1.5 text-sm text-stone-700">
                Everything billed on each partner&apos;s channel against everything they have
                settled, since the beginning. A receivable is not a month, so this section is not
                scoped to one.
              </p>
              {compared.length === 0 && (
                <div className="mt-3">
                  <Honesty
                    verdict="nothing to compare"
                    meter={{
                      filled: compared.length,
                      total: receivable.length,
                      unit: 'partners with something to compare',
                    }}
                  >
                    No orders have been recorded on any partner&apos;s channel and no settlement has
                    been filed, so every figure below is zero for want of anything to put in it —
                    not because the partners are square. These become a real receivable once a
                    day&apos;s sales are fetched and a settlement is entered on the Sales side.
                  </Honesty>
                </div>
              )}
              <div className="mt-3">
                <AggregatorTable rows={receivable} />
              </div>
              {unrated.length > 0 && (
                <div className="mt-3">
                  <Honesty
                    verdict="no agreed rate"
                    meter={{
                      filled: ratedPartners.length,
                      total: receivable.length,
                      unit: 'partners with an agreed rate',
                    }}
                  >
                    {unrated.map((r) => r.partner).join(', ')} {unrated.length === 1 ? 'has' : 'have'}{' '}
                    no agreed commission recorded, so what they actually kept cannot be checked
                    against what they promised. The rate lives on the partner master, under Sales,
                    Partners — until it is filled in, the outstanding figure is all this screen can
                    say about them.
                  </Honesty>
                </div>
              )}
            </>
          )}
        </section>

        {/* ── the third thing an accountant comes here for ──────────────── */}
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Statements</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            Open any vendor above for their statement: balance brought forward, every bill and
            payment in date order, and the balance running down the column. Pick the period there
            and print it: the vendor&apos;s name, code and tax ID head the page, because a vendor
            asks for this on paper and has to be able to tell whose account it is.
          </p>
          {/* the list above is the DUES list, not the vendor master — saying so
              here beats an accountant hunting for a name that is settled */}
          <p className="mt-1.5 text-xs text-stone-500">
            Only vendors carrying a balance are listed above. A vendor who is square has no row
            here — not because their account is missing, but because they are owed nothing today.
          </p>
        </section>
      </div>
    </>
  )
}
