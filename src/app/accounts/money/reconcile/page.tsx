// RECONCILE — the books against what the provider says.
//
// Up to now every figure in this app has been what somebody typed. A
// statement is the first number in the system that came from OUTSIDE it,
// and that is the whole value: two independent records of the same money,
// compared row by row, with the leftovers on either side being the finding.
// Unmatched on the left is money the bank saw and the books never heard of;
// unmatched on the right is money we recorded that never reached the bank.
//
// NOTHING HERE CORRECTS ANYTHING. A statement is imported as a claim, and a
// match records that a human decided which of our rows it was. If the two
// disagree, the fix is an entry made on the screen that owns it — never a
// quiet edit from here.
import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { listStatements } from '@/server/reconciliation-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import Honesty from '@/components/Honesty'
import StatementImport from '@/components/accountant/StatementImport'
import {
  cardCls,
  dataTableCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

const linkCls = 'font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900'

export default async function ReconcilePage() {
  const restaurant = await getRestaurant()
  const [accounts, statements] = await Promise.all([
    listMoneyAccounts(restaurant.id),
    listStatements(restaurant.id),
  ])

  // the test is at the PAISE scale the figure beside it is printed at: a
  // sub-paisa residue that formats as ₹0.00 must not raise an alarm saying
  // the statement does not add up
  const anyOff = statements.some(
    (s) => s.statement_self_check !== null && decimalStringToPaise(s.statement_self_check) !== 0,
  )

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Reconcile</h1>
        <p className={pageSubCls}>
          What the bank, wallet or card provider says, set against what the books hold. The rows
          left over on each side are the answer.
        </p>
        <Link href="/accounts/money" className={`${linkCls} mt-1.5 inline-block text-sm`}>
          ← Money
        </Link>
      </header>

      <div className="space-y-4">
        <StatementImport accounts={accounts} />

        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Statements</h2>
            <span className="font-mono text-[10px] text-stone-400">reconciliation_status</span>
          </div>

          {statements.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              No statement has been imported yet. That is the ordinary starting state and not a
              fault — nothing above this line is wrong because of it. It only means the balances the
              app holds are still what it was told, with nothing outside the app confirming them.
              Paste one above whenever the month&apos;s statement is to hand.
            </p>
          ) : (
            <>
              <div className="mt-2 overflow-x-auto">
                <table className={dataTableCls}>
                  <thead>
                    <tr>
                      <th className={thCls}>Account</th>
                      <th className={thCls}>Period</th>
                      <th className={thNumCls}>Lines</th>
                      <th className={thNumCls}>Matched</th>
                      <th className={thNumCls}>Left</th>
                      <th className={thNumCls}>Lines total</th>
                      <th className={thNumCls}>Adds up</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.map((s) => {
                      const check = s.statement_self_check
                      const off = check !== null && decimalStringToPaise(check) !== 0
                      return (
                        <tr key={s.id} className={trCls}>
                          <td className={tdCls}>{s.account_name}</td>
                          <td className={tdCls}>
                            <Link href={`/accounts/money/reconcile/${s.id}`} className={linkCls}>
                              {fmtDate(s.period_start)} – {fmtDate(s.period_end)}
                            </Link>
                          </td>
                          <td className={tdNumCls}>{s.statement_lines}</td>
                          <td className={tdNumCls}>{s.matched_lines}</td>
                          <td
                            className={`${tdNumCls} ${
                              s.unmatched_lines > 0 ? 'font-semibold text-stone-900' : 'text-stone-400'
                            }`}
                          >
                            {s.unmatched_lines}
                          </td>
                          <td className={tdNumCls}>{formatMoneyString(s.statement_total)}</td>
                          <td className={`${tdNumCls} ${off ? 'text-red-700' : 'text-stone-500'}`}>
                            {check === null ? '—' : off ? formatMoneyString(check) : 'yes'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-stone-500">
                &ldquo;Adds up&rdquo; is the statement against itself — opening plus its own rows
                less closing. A dash means one of the two balances was not entered, so the sum
                cannot be made. Left is what still has nothing against it.
              </p>
            </>
          )}
        </section>

        {anyOff && (
          <Honesty level="alarm" verdict="statement disagrees with itself">
            At least one statement above does not add up on its own terms: its opening balance plus
            its own lines does not land on its closing balance. That is a fact about the statement
            or about how it was pasted — the books have not been consulted for it. Matching against
            such a statement still works, and every count it reports is standing on an incomplete
            list of rows.
          </Honesty>
        )}
      </div>
    </>
  )
}
