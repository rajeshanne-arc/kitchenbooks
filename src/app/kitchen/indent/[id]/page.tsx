// One indent: what was ASKED, what was GIVEN, and the gap between them.
// The gap is the point — it is never hidden. Store accounts can open this
// page too; the issue side of the story is theirs.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getIndentDetail, getIndentFulfilment } from '@/server/kitchen-queries'
import CancelIndent from '@/components/kitchen/CancelIndent'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
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
import { sql } from '@/lib/db'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, string> = {
  open: 'border-amber-300 bg-amber-50 text-amber-800',
  issued: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  cancelled: 'border-stone-300 bg-stone-100 text-stone-500',
}

function IssueRow({ href, children }: { href: string | null; children: React.ReactNode }) {
  const cls = 'flex items-center justify-between gap-3 py-2.5'
  if (href === null) return <div className={cls}>{children}</div>
  return (
    <Link href={href} className={`${cls} hover:bg-stone-50`}>
      {children}
    </Link>
  )
}

export default async function IndentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const restaurant = await getRestaurant()
  // LAW 1: the store log belongs to store accounts. The chef sees each issue
  // and its value here — that is the gap, and it is never hidden — but not a
  // link into a screen their role cannot open.
  const user = await getSessionUser()
  const canOpenIssues = user !== null && canAccess(user.role, '/store/books/issues')
  const detail = await getIndentDetail(restaurant.id, id)
  if (!detail) notFound()
  const fulfilment = await getIndentFulfilment(restaurant.id, id)
  // Returns are not tied to an indent — they are department-level stock
  // going back. Matched by item since the indent date, and captioned as
  // context rather than presented as this document's own line.
  const returnedRows = await sql<{ item_code: string; qty: string }[]>`
    select it.code as item_code, sum(rl.qty)::text as qty
    from return_lines rl
    join returns r on r.id = rl.return_id
    join items it on it.id = rl.item_id
    where r.restaurant_id = ${restaurant.id}
      and r.section_id = ${detail.indent.section_id}
      and r.return_date >= ${detail.indent.indent_date}::date
    group by it.code`
  const returnedByItem: Record<string, number> = Object.fromEntries(
    returnedRows.map((r) => [r.item_code, Number(r.qty)]),
  )
  const { indent, issues } = detail
  const liveIssues = issues.filter((i) => !i.is_reversal && !i.is_voided)

  return (
    <>
      <header className="pb-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className={pageTitleCls}>
            Indent — {indent.section_name}
          </h1>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_BADGE[indent.status]}`}>
            {indent.status}
          </span>
        </div>
        <p className={pageSubCls}>
          {fmtDate(indent.indent_date)} · asked {fmtDateTime(indent.created_at)}
          {indent.entered_by !== null && <> · by {indent.entered_by}</>}
        </p>
        {indent.note !== null && <p className="mt-1 text-sm text-stone-600">“{indent.note}”</p>}
      </header>

      <div className="space-y-4">
        {indent.status === 'open' && (
          <div className="flex items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <span className="text-sm font-medium text-amber-900">Waiting for the store to issue.</span>
            <CancelIndent indentId={indent.id} />
          </div>
        )}


        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Issues answering this indent</h2>
          {liveIssues.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">
              {indent.status === 'cancelled' ? 'None — the indent was cancelled.' : 'None yet — the store has not issued against it.'}
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-rule-soft">
              {liveIssues.map((i) => (
                <li key={i.id}>
                  <IssueRow href={canOpenIssues ? `/store/books/issues/${i.id}` : null}>
                    <span className="min-w-0">
                      <span className="block text-sm text-stone-900">
                        {fmtDate(i.issue_date)} · {i.line_count} {i.line_count === 1 ? 'item' : 'items'}
                      </span>
                      <span className="block text-xs text-stone-500">{i.entered_by !== null ? `by ${i.entered_by}` : ''}</span>
                    </span>
                    <span className="shrink-0 tabular-nums text-sm font-semibold text-stone-900">
                      {formatMoneyString(i.total_value)}
                    </span>
                  </IssueRow>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ONE TABLE. Request, received and return are three states of one
            document, not three screens — so they are three columns. The GAP
            is the column the screen exists for and is never hidden: a
            kitchen that asked for 5 and got 3 needs to see the 2. */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Asked, given, and the gap</h2>
            <span className="font-mono text-[10px] text-stone-400">indent_fulfilment</span>
          </div>
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Item</th>
                  <th className={thNumCls}>Asked</th>
                  <th className={thNumCls}>Given</th>
                  <th className={thNumCls}>Gap</th>
                  <th className={thNumCls}>Returned</th>
                  <th className={thCls}>Unit</th>
                  <th className={thCls}>
                    <span className="sr-only">Return</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {fulfilment.map((f) => {
                  const gap = Number(f.gap)
                  const returned = returnedByItem[f.item_code] ?? 0
                  return (
                    <tr key={f.item_code} className={trCls}>
                      <td className={tdCls}>{f.item_name}</td>
                      <td className={tdNumCls}>{f.qty_requested}</td>
                      <td className={tdNumCls}>{f.qty_given}</td>
                      <td
                        className={`${tdNumCls} font-semibold ${
                          gap > 0 ? 'text-red-700' : gap < 0 ? 'text-amber-800' : 'text-stone-400'
                        }`}
                      >
                        {gap === 0 ? '—' : gap > 0 ? `−${f.gap}` : `+${Math.abs(gap)}`}
                      </td>
                      <td className={`${tdNumCls} ${returned > 0 ? 'text-stone-900' : 'text-stone-400'}`}>
                        {returned > 0 ? returned : '—'}
                      </td>
                      <td className={`${tdCls} text-stone-500`}>{f.purchase_unit}</td>
                      <td className={`${tdCls} text-right`}>
                        {canOpenIssues && Number(f.qty_given) > 0 && (
                          <Link
                            href="/store/issue"
                            className="text-xs font-medium text-emerald-700 hover:underline"
                          >
                            return →
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-stone-500">
            A gap in red is short — asked for more than was given. Amber is over-issue. Returned counts stock
            this department sent back since the indent was raised, matched by item; a return is not tied to one
            indent, so read it as context rather than as this document&apos;s own line.
          </p>
        </section>
      </div>
    </>
  )
}
