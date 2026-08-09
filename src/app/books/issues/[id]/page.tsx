import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getIssue, getIssueLines, getIssueVoidedBy } from '@/server/store-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { ReversalBadge, VoidedBadge } from '@/components/books/Badges'
import VoidIssue from '@/components/store/VoidIssue'
import { cardCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function IssueDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const issue = await getIssue(restaurant.id, id)
  if (!issue) notFound()

  const [lines, voidedBy] = await Promise.all([
    getIssueLines(issue.id),
    issue.is_voided ? getIssueVoidedBy(issue.id) : Promise.resolve(null),
  ])

  return (
    <div className="mt-4 space-y-4">
      <Link href="/books/store" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Store log
      </Link>

      {issue.is_voided && voidedBy !== null && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This issue was voided —{' '}
          <Link href={`/books/issues/${voidedBy.id}`} className="font-medium underline">
            its reversal
          </Link>{' '}
          cancels it. Stock and section totals already reflect that.
        </div>
      )}
      {issue.is_reversal && issue.reverses_id !== null && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
          Reversal — inserted to cancel{' '}
          <Link href={`/books/issues/${issue.reverses_id}`} className="font-medium underline">
            the original issue
          </Link>
          . Unit costs are copied from it exactly.
        </div>
      )}

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">Issue to {issue.section_name}</h2>
              {issue.is_voided && <VoidedBadge />}
              {issue.is_reversal && <ReversalBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              {fmtDate(issue.issue_date)} · <span className="font-mono">{issue.section_code}</span>
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              entered by {issue.entered_by ?? '—'} · {fmtDateTime(issue.created_at)}
            </p>
          </div>
        </div>

        <div className="mt-4 border-t border-stone-100 pt-3">
          <h3 className={sectionHeadCls}>Lines</h3>
          <ul className="mt-1 divide-y divide-stone-100">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <Link href={`/books/items/${l.item_id}`} className="group flex items-center gap-2">
                    <code className="rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium text-stone-700">
                      {l.item_code}
                    </code>
                    <span className="truncate text-[15px] text-stone-900 group-hover:underline">{l.item_name}</span>
                  </Link>
                  <p className="mt-0.5 text-xs text-stone-500">
                    {l.qty} {l.purchase_unit} × {formatMoneyString(l.unit_cost)} (snapshotted cost)
                  </p>
                </div>
                <span className="shrink-0 font-semibold tabular-nums text-stone-900">
                  {formatMoneyString(l.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between border-t border-stone-100 pt-3">
          <span className="text-sm font-medium text-stone-500">Total value</span>
          <span className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
            {formatMoneyString(issue.total_value)}
          </span>
        </div>
      </section>

      {!issue.is_reversal && !issue.is_voided && (
        <VoidIssue
          issueId={issue.id}
          sectionName={issue.section_name}
          totalValue={issue.total_value}
          issueDate={issue.issue_date}
        />
      )}
    </div>
  )
}
