// One indent: what was ASKED, what was GIVEN, and the gap between them.
// The gap is the point — it is never hidden. Store accounts can open this
// page too; the issue side of the story is theirs.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getIndentDetail } from '@/server/kitchen-queries'
import CancelIndent from '@/components/kitchen/CancelIndent'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'
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
  const { indent, lines, issues, gap } = detail
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
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Asked vs given</h2>
            <span className="text-xs text-stone-400">the gap is information — never hidden</span>
          </div>
          <div className="mt-2 grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] gap-1 border-b border-stone-200 pb-1.5 text-right">
            <span />
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Asked</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Given</span>
            <span className="text-[11px] font-medium uppercase tracking-wide text-stone-400">Gap</span>
          </div>
          <ul className="divide-y divide-rule-soft">
            {gap.map((g) => {
              const gapNum = Number(g.gap)
              return (
                <li key={g.item_id} className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem_4.5rem] items-center gap-1 py-2 text-right">
                  <span className="min-w-0 text-left">
                    <span className="block truncate text-sm text-stone-900">{g.item_name}</span>
                    <span className="block text-xs text-stone-400">{g.purchase_unit}</span>
                  </span>
                  <span className="tabular-nums text-sm text-stone-700">{g.qty_requested ?? '—'}</span>
                  <span className="tabular-nums text-sm text-stone-700">{g.qty_issued ?? '—'}</span>
                  <span
                    className={`tabular-nums text-sm font-semibold ${
                      gapNum === 0 ? 'text-emerald-700' : gapNum < 0 ? 'text-amber-700' : 'text-sky-700'
                    }`}
                  >
                    {gapNum > 0 ? `+${g.gap}` : g.gap}
                  </span>
                </li>
              )
            })}
          </ul>
          <p className="mt-2 text-xs text-stone-400">
            negative gap = given less than asked · positive = given more (or unasked) · from indent_lines vs the
            stamped issues&apos; lines
          </p>
        </section>

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

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>As asked</h2>
          <ul className="mt-1 divide-y divide-rule-soft">
            {lines.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate text-sm text-stone-900">{l.item_name}</span>
                <span className="shrink-0 text-sm text-stone-500">
                  {l.qty_requested} {l.purchase_unit}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </>
  )
}
