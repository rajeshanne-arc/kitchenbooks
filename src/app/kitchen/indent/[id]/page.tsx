// One indent: what was ASKED, what was GIVEN, and the gap between them.
// The gap is the point — it is never hidden. Store accounts can open this
// page too; the issue side of the story is theirs.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getIndentDetail, getIndentFulfilment, getKitchenSections } from '@/server/kitchen-queries'
import { getList } from '@/server/settings'
import CancelIndent from '@/components/kitchen/CancelIndent'
import IndentEdit from '@/components/kitchen/IndentEdit'
import Honesty from '@/components/Honesty'
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
import { tsql } from '@/lib/db'
import type { Section } from '@/lib/types'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import GapCell from '@/components/kitchen/GapCell'

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
  // tsql, never bare sql — see the departments page: a bare statement under
  // RLS announces no tenant and raises 22P02 rather than returning nothing.
  const returnedRows = await tsql<{ item_code: string; qty: string }[]>`
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

  // THE FREEZE, decided here and never on the client. A request is editable
  // only while it is still only a request: open, and with no issue carrying
  // its id. `issues` is exactly "the rows whose indent_id is this one", so a
  // voided issue freezes it too — the trip out really happened. The save
  // re-checks this inside its own transaction; this decides what is drawn.
  const answered = issues.length > 0
  const editable = indent.status === 'open' && !answered
  // read only for an editable request — a frozen one has no form to fill
  const [kitchenSections, sessions]: [Section[], string[]] = editable
    ? await Promise.all([getKitchenSections(restaurant.id), getList(restaurant.id, 'session')])
    : [[], []]
  // an indent asks the STORE for stock, so only departments stock can reach
  // are offered. The save refuses the rest whatever is posted — this is so the
  // form cannot offer a department its own save would turn away.
  const sections = kitchenSections.filter((s) => s.receives_stock)

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
          {fmtDate(indent.indent_date)} · {indent.session} · asked {fmtDateTime(indent.created_at)}
          {indent.entered_by !== null && <> · by {indent.entered_by}</>}
        </p>
        {indent.note !== null && <p className="mt-1 text-sm text-stone-600">“{indent.note}”</p>}
      </header>

      <div className="space-y-4">
        {/* A request is a description of what the kitchen wants, and while
            nobody has acted on it, changing that description is honest
            editing. The moment it is answered it stops being editable — and
            the screen says which of those two it is, in words. */}
        {editable ? (
          <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-sm font-medium text-amber-900">
                Waiting for the store to issue — still yours to change.
              </span>
              <CancelIndent indentId={indent.id} />
            </div>
            <div className="mt-3">
              <IndentEdit indent={indent} lines={detail.lines} sections={sections} sessions={sessions} />
            </div>
          </div>
        ) : answered ? (
          <Honesty verdict="answered" action={{ href: '/kitchen/indent', label: 'Raise a new request' }}>
            An issue has been made against this request, so what was asked can no longer be changed: it is
            half of a comparison now, and editing it would leave the gap below measuring nothing. Anything
            still needed is a new indent.
          </Honesty>
        ) : indent.status === 'cancelled' ? (
          <Honesty verdict="cancelled" action={{ href: '/kitchen/indent', label: 'Raise a new request' }}>
            This request was cancelled. It stays on record rather than being edited back to life — raise a
            new indent for whatever the department still wants.
          </Honesty>
        ) : (
          <Honesty verdict={indent.status}>
            This request is {indent.status}, and only an open request nobody has answered can be edited.
          </Honesty>
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
                  const returned = returnedByItem[f.item_code] ?? 0
                  return (
                    <tr key={f.item_code} className={trCls}>
                      <td className={tdCls}>{f.item_name}</td>
                      <td className={tdNumCls}>{f.qty_requested}</td>
                      <td className={`${tdNumCls} ${f.qty_given === null ? 'text-stone-400' : ''}`}>
                        {f.qty_given ?? 'cancelled'}
                      </td>
                      <td className={`${tdCls} text-right`}>
                        <GapCell gap={f.gap} unit={f.purchase_unit} status={indent.status} />
                      </td>
                      <td className={`${tdNumCls} ${returned > 0 ? 'text-stone-900' : 'text-stone-400'}`}>
                        {returned > 0 ? returned : '—'}
                      </td>
                      <td className={`${tdCls} text-stone-500`}>{f.purchase_unit}</td>
                      <td className={`${tdCls} text-right`}>
                        {canOpenIssues && Number(f.qty_given ?? 0) > 0 && (
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
            The gap is stated in words because a signed number asks you to remember which way round it
            goes. Nothing in the column means the two agreed. A cancelled indent shows no gap at all —
            a request nobody was going to fill has no shortage. Returned counts stock this department
            sent back since the indent was raised, matched by item; a return is not tied to one
            indent, so read it as context rather than as this document&apos;s own line.
          </p>
        </section>
      </div>
    </>
  )
}
