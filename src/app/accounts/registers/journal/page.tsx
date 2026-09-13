import { getRestaurant } from '@/server/queries'
import { getJournalIntegrity, getTrialBalance } from '@/server/journal'
import Honesty from '@/components/Honesty'
import { cardCls, moneyCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function JournalPage() {
  const restaurant = await getRestaurant()
  const [rows, integrity] = await Promise.all([
    getTrialBalance(restaurant.id),
    getJournalIntegrity(restaurant.id),
  ])
  const debitTotal = rows.reduce((sum, row) => sum + Number(row.debits), 0).toFixed(2)
  const creditTotal = rows.reduce((sum, row) => sum + Number(row.credits), 0).toFixed(2)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Journal</h1>
        <p className={pageSubCls}>
          {restaurant.name} — the posted double-entry record and its trial balance.
        </p>
      </header>

      {integrity.unbalanced_entries > 0 || integrity.lines_without_entry > 0 ? (
        <div className="mb-4">
          <Honesty verdict="STOP — journal integrity issue">
            {integrity.unbalanced_entries} unbalanced entries and {integrity.lines_without_entry} orphan
            lines need investigation before these books can be relied on.
          </Honesty>
        </div>
      ) : null}

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Trial balance</h2>
          <span className="font-mono text-[10px] text-stone-400">{integrity.entries} entries</span>
        </div>
        {rows.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">
            No journal accounts are configured yet. Add the restaurant&apos;s chart of accounts before
            posting source transactions here.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-rule-soft text-xs text-stone-500">
                <tr>
                  <th className="py-2 pr-3">Account</th>
                  <th className="py-2 pr-3">Type</th>
                  <th className="py-2 pr-3 text-right">Debit</th>
                  <th className="py-2 text-right">Credit</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.account_id} className="border-b border-rule-soft last:border-0">
                    <td className="py-2 pr-3">
                      <span className="font-mono text-xs text-stone-500">{row.code}</span> {row.name}
                    </td>
                    <td className="py-2 pr-3 text-stone-500">{row.account_type}</td>
                    <td className={`py-2 pr-3 text-right ${moneyCls}`}>{formatMoneyString(row.debits)}</td>
                    <td className={`py-2 text-right ${moneyCls}`}>{formatMoneyString(row.credits)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-rule-soft font-medium">
                <tr>
                  <td className="py-2" colSpan={2}>Totals</td>
                  <td className={`py-2 pr-3 text-right ${moneyCls}`}>{formatMoneyString(debitTotal)}</td>
                  <td className={`py-2 text-right ${moneyCls}`}>{formatMoneyString(creditTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
