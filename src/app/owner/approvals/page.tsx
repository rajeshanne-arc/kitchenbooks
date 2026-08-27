import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import {
  getPreview,
  getWaiting,
  type ApprovalEntity,
  type ApprovalKind,
} from '@/server/approvals-queries'
import { getListSuggestions } from '@/server/settings'
import ApprovalsClient, { type QueueItem } from '@/components/settings/ApprovalsClient'
import SuggestionsQueue from '@/components/settings/SuggestionsQueue'
import { cardCls, codeCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const restaurant = await getRestaurant()
  const [waiting, suggestions] = await Promise.all([
    getWaiting(restaurant.id),
    getListSuggestions(restaurant.id),
  ])

  // The fresh check, run now, for everything still pending. Not the authority
  // — merge_items re-runs every guard under a row lock — but the owner must
  // not decide from a snapshot taken days ago, and the DIFFERENCE between the
  // two is itself the finding.
  const items: QueueItem[] = await Promise.all(
    waiting.approvals.map(async (row): Promise<QueueItem> => {
      try {
        const fresh = await getPreview(
          restaurant.id,
          row.kind as ApprovalKind,
          row.entity_type as ApprovalEntity,
          row.entity_id,
          row.target_entity_id,
        )
        return { row, fresh, freshError: null }
      } catch (e) {
        return { row, fresh: null, freshError: e instanceof Error ? e.message : 'could not be re-checked' }
      }
    }),
  )

  const nothing = waiting.total === 0

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h1 className={pageTitleCls}>Approvals</h1>
        <p className={pageSubCls}>
          {nothing
            ? 'Everything that needs you, in one place.'
            : `${waiting.total} thing${waiting.total === 1 ? '' : 's'} waiting on you.`}
        </p>
      </div>

      {/* EMPTY IS THE NORMAL STATE, and it must READ like one.
          Four empty sections with four zeroes would turn a page somebody is
          pleased to find empty into four things to check and dismiss. So an
          empty queue is one sentence and nothing else — the same law as every
          badge in the app being silent at zero, applied to a whole screen. */}
      {nothing ? (
        <section className={cardCls}>
          <h2 className="font-display text-lg font-semibold text-emerald-800">Nothing is waiting on you.</h2>
          <p className="mt-1.5 text-sm text-stone-600">
            No discards or merges to decide, no words anybody has typed that need adding to a list, no
            payroll run prepared and unapproved, no closed month anybody has asked to reopen. This page is
            meant to be empty; when it is not, the tab carries a count.
          </p>
        </section>
      ) : (
        <>
          {items.length > 0 && <ApprovalsClient items={items} />}

          {/* A POINTER, NEVER A COPY. Approving payroll means seeing the whole
              run — the people, the days, the withholdings, the account each
              line will be paid from. A row rendered inline here would invite a
              decision made on a total, which is the one way to approve a
              payroll badly. So this says enough to recognise it and links, and
              carries nothing you could approve from. */}
          {waiting.payrollRuns.length > 0 && (
            <section className={cardCls}>
              <h2 className={sectionHeadCls}>Payroll waiting to be approved</h2>
              <ul className="mt-2 divide-y divide-rule-soft">
                {waiting.payrollRuns.map((r) => (
                  <li key={r.id} className="py-2.5">
                    <Link
                      href={`/accounts/payroll/runs/${r.id}`}
                      className="flex flex-wrap items-baseline gap-x-2 hover:underline"
                    >
                      {r.doc_no !== null && <span className={codeCls}>{r.doc_no}</span>}
                      <span className="font-medium text-stone-900">
                        {fmtDate(r.period_start)} – {fmtDate(r.period_end)}
                      </span>
                      <span className="text-sm text-stone-500">
                        {r.lines} {r.lines === 1 ? 'person' : 'people'} ·{' '}
                        {formatMoneyString(r.total)}
                        {r.prepared_by !== null && ` · prepared by ${r.prepared_by}`}
                      </span>
                      <span className="ml-auto text-sm font-semibold text-emerald-800">Open the run →</span>
                    </Link>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[13px] text-stone-500">
                Approved on its own page, not from here — the figures are the decision, and a total is not
                enough to make it on.
              </p>
            </section>
          )}

          {suggestions.length > 0 && <SuggestionsQueue rows={suggestions} />}
        </>
      )}

      {/* WHAT STAYS OUT, AND WHY — said on the page rather than only in a file
          nobody working here reads. The absence of voids from an approvals
          screen is exactly the kind of thing somebody "fixes" later. */}
      <section className={cardCls}>
        <h2 className={sectionHeadCls}>What never comes here</h2>
        <p className="mt-2 text-sm text-stone-600">
          An action that leaves a trace needs no permission; an action that leaves none needs approval. That
          is the whole rule, and it keeps this list short.
        </p>
        <ul className="mt-2.5 space-y-1.5 text-sm text-stone-600">
          <li>
            <span className="font-medium text-stone-800">Voids</span> — a void writes a negative twin, so
            both the entry and its cancellation stay on the record.
          </li>
          <li>
            <span className="font-medium text-stone-800">Retirements</span> — a retired item or vendor keeps
            its row and its whole history; it simply stops being offered.
          </li>
          <li>
            <span className="font-medium text-stone-800">Attendance corrections</span> — a new mark never
            replaces the old one; the view picks the latest and both remain.
          </li>
          <li>
            <span className="font-medium text-stone-800">Price warnings</span> — a warning must never stand
            between somebody and receiving goods that are already at the door.
          </li>
          <li>
            <span className="font-medium text-stone-800">Settings</span> — already yours alone, so there is
            nobody to approve for.
          </li>
        </ul>
        <p className="mt-2.5 text-[13px] text-stone-500">
          Putting a correction behind an approval is how a correction stops happening: the person who
          noticed cannot wait, so they leave the number wrong instead.
        </p>
      </section>

    </div>
  )
}
