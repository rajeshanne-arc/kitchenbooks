// The accountant's home. A QUEUE, not a form: what is incomplete, what is
// being asked, and what is ready to close.
//
// books_completeness is rendered VERBATIM — the view owns both the wording
// and the severity, so this page can never quietly soften what it says.
import { getRestaurant } from '@/server/queries'
import {
  getBooksCompleteness,
  listOpenQueries,
  listQueries,
} from '@/server/accountant-queries'
import { countUnaccountedMovements } from '@/server/accounts-queries'
import QueueClient from '@/components/accountant/QueueClient'
import Honesty from '@/components/Honesty'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const TONE: Record<string, 'alarm' | 'pending'> = {
  'STOPS THE SUM': 'alarm',
  'MAKES IT DOUBTFUL': 'pending',
  NOTED: 'pending',
}

export default async function AccountsReviewPage() {
  const restaurant = await getRestaurant()
  const [completeness, open, all, unaccounted] = await Promise.all([
    getBooksCompleteness(restaurant.id),
    listOpenQueries(restaurant.id),
    listQueries(restaurant.id, 40),
    countUnaccountedMovements(restaurant.id),
  ])

  const resolved = all.filter((q) => q.status === 'resolved').slice(0, 10)

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Review</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what is incomplete, what needs asking about, what is ready to close.
        </p>
      </header>

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>The books, as they stand</h2>
            <span className="font-mono text-[10px] text-stone-400">books_completeness</span>
          </div>
          {completeness.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              Nothing is missing that the books can see. That is not the same as everything being
              entered — it is everything the app knows how to look for.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {completeness.map((row) => (
                <li key={`${row.severity}-${row.what}`}>
                  <Honesty level={TONE[row.severity] ?? 'pending'} verdict={row.severity} compact>
                    {row.what} — {row.n}
                  </Honesty>
                </li>
              ))}
            </ul>
          )}
          {unaccounted > 0 && (
            <p className="mt-2 text-xs text-stone-500">
              The unaccounted movements are entries made before accounts existed. They still count in
              the P&amp;L; they simply cannot be placed in any one account&apos;s balance.
            </p>
          )}
        </section>

        <QueueClient open={open} recent={resolved} />
      </div>
    </>
  )
}
