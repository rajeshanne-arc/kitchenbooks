// ADVANCES — money lent against wages not yet earned.
//
// It is the one part of payroll that moves money on the day it is recorded,
// and the only part that reaches the cash and bank registers: money_movements
// reads staff_advances. A payroll run does not, which is why this screen says
// so where the money is entered rather than leaving it to be discovered while
// reconciling.
//
// The list leads and the form follows. What somebody already owes is the
// context for lending them more, so it is on screen before the amount box is.
import { getRestaurant } from '@/server/queries'
import { getOutstandingAdvances, listStaffIdentities } from '@/server/payroll-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { decimalStringToPaise } from '@/lib/money'
import AdvanceForm from '@/components/accountant/AdvanceForm'
import AdvancesTable from '@/components/accountant/AdvancesTable'
import Honesty from '@/components/Honesty'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function AdvancesPage() {
  const restaurant = await getRestaurant()
  // one fan-out, not three awaits — the pool is shared with the group layout
  const [outstanding, staff, accounts] = await Promise.all([
    getOutstandingAdvances(restaurant.id),
    listStaffIdentities(restaurant.id),
    listMoneyAccounts(restaurant.id),
  ])

  // NARROWED HERE, on the server. listStaffIdentities carries bank account
  // numbers, PAN, UAN and dates of birth; nothing on this screen needs them,
  // so nothing on this screen is sent them.
  //
  // employment_type is the one exception, and it earns its place: a payroll
  // run excludes contract staff, so an advance to one can never be recovered
  // by the only mechanism that recovers advances. The form has to be able to
  // say that before the money leaves, not after.
  const people = staff.map((s) => ({
    id: s.id,
    code: s.code,
    name: s.name,
    contract: s.employment_type === 'contract',
  }))

  // recovered more than was ever lent: money taken out of wages that was not
  // owed. Loud, never smoothed to zero.
  const overRecovered = outstanding.filter((r) => decimalStringToPaise(r.outstanding) < 0)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Advances</h1>
        <p className={pageSubCls}>
          {restaurant.name} — money lent against wages not yet earned, and what is still owed on it.
        </p>
      </header>

      <div className="space-y-4">
        {/* No meter: this is not truth still arriving, it is a figure that is
            wrong. The count belongs in the sentence. */}
        {overRecovered.length > 0 && (
          <Honesty level="alarm" verdict="recovered beyond the loan">
            {overRecovered.length === 1
              ? 'One person has had more recovered than was ever lent to them. '
              : `${overRecovered.length} people have had more recovered than was ever lent to them. `}
            Either an advance was never entered or a recovery was frozen onto a run twice — a
            balance below zero is not money the restaurant is owed, it is a wage deduction nobody
            owed. A frozen line cannot be edited: the correction is to cancel that run and prepare
            another, and both stay on the record.
          </Honesty>
        )}

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Still owed</h2>
            <span className="font-mono text-[10px] text-stone-400">
              staff_advances − payroll_lines
            </span>
          </div>

          {outstanding.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              Nobody owes anything. That is the ordinary state, not an empty screen waiting to be
              filled — a person appears here the first time money is lent against their wages, and
              drops off when the last of it has been recovered on a payroll run.
            </p>
          ) : (
            <>
              <div className="mt-2">
                <AdvancesTable rows={outstanding} />
              </div>
              <p className="mt-2 text-xs text-stone-500">
                Everything advanced, less every recovery already frozen onto a payroll run. A run
                counts from the moment it is prepared, before anybody has been paid — cancelling it
                releases the recovery again. Everyone who owes is here, including anyone who has
                since left: a balance does not clear because a person did.
              </p>
            </>
          )}
        </section>

        <AdvanceForm people={people} outstanding={outstanding} accounts={accounts} />
      </div>
    </>
  )
}
