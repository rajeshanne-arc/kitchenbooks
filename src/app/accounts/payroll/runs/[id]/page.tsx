// ONE RUN — what was decided, who decided it, and what can still be done.
//
// The lines are read-only here and that is not a screen making a rule: there
// is no UPDATE grant on any amount in payroll_lines. A run is a decision, and
// a decision that can be quietly edited afterwards is not one.
//
// The Approve button is OWNER-ONLY, and it is only rendered for an owner —
// LAW 1, a role never sees a control it cannot use. The server refuses anyone
// else by name regardless, because a server action is a public endpoint.
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getPayrollLines, getPayrollRun } from '@/server/payroll-queries'
import { listMoneyAccounts } from '@/server/accounts-queries'
import { getSessionUser } from '@/server/current-user'
import { getList } from '@/server/settings'
import { todayIST } from '@/server/store-queries'
import { canAccess } from '@/lib/roles'
import type { MoneyAccount } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import Honesty from '@/components/Honesty'
import PayrollLinesTable from '@/components/accountant/PayrollLinesTable'
import RunActions from '@/components/accountant/RunActions'
import RunStatus from '@/components/accountant/RunStatus'
import {
  cardCls,
  docNoCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
} from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function PayrollRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()

  const [restaurant, user] = await Promise.all([getRestaurant(), getSessionUser()])
  const run = await getPayrollRun(restaurant.id, id)
  if (!run) notFound()

  // the account and the mode are asked for only where they are asked for —
  // an approved run waiting to be paid
  const paying = run.status === 'approved'
  const [lines, accounts, modes] = await Promise.all([
    getPayrollLines(run.id),
    paying ? listMoneyAccounts(restaurant.id) : Promise.resolve<MoneyAccount[]>([]),
    paying ? getList(restaurant.id, 'payment_mode') : Promise.resolve<string[]>([]),
  ])

  const isOwner = user?.role === 'owner'
  const canOpenRegisters = user !== null && canAccess(user.role, '/accounts/registers')
  const paidOn = lines.find((l) => l.paid_on !== null)?.paid_on ?? null

  return (
    <>
      <Link
        href="/accounts/payroll/runs"
        className="mb-3 inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
      >
        ← Payroll runs
      </Link>

      <header className="pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className={pageTitleCls}>
            {fmtDate(run.period_start)} — {fmtDate(run.period_end)}
          </h1>
          <RunStatus status={run.status} />
        </div>
        <p className={pageSubCls}>
          {run.doc_no !== null && (
            <>
              <span className={docNoCls}>{run.doc_no}</span> ·{' '}
            </>
          )}
          prepared by {run.prepared_by ?? '—'} on {fmtDateTime(run.prepared_at)}
        </p>
        <p className="mt-0.5 text-sm text-stone-500">
          {run.approved_by === null
            ? 'Not approved yet — an owner signs a run off before it can be paid.'
            : `Approved by ${run.approved_by}${
                run.approved_at === null ? '' : ` on ${fmtDateTime(run.approved_at)}`
              }`}
          {paidOn !== null && ` · paid ${fmtDate(paidOn)}`}
        </p>
      </header>

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Net payable</h2>
            <span className="font-mono text-[10px] text-stone-400">payroll_lines</span>
          </div>
          {lines.length === 0 ? (
            <Honesty level="alarm" verdict="no lines">
              This run holds no lines at all, which should not be possible — a run with nobody in it
              is not a run. Nothing here can be totalled, and a total over no rows is not zero.
            </Honesty>
          ) : (
            <>
              <p className={`mt-1 text-[30px] ${heroNumCls} text-stone-900`}>
                {formatMoneyString(run.net_total)}
              </p>
              <p className="mt-0.5 text-sm text-stone-500">
                across {lines.length} {lines.length === 1 ? 'person' : 'people'} — earnings plus
                overtime, less advance recovered, other deductions and withholding
              </p>
            </>
          )}
          {run.note !== null && (
            <p className="mt-3 border-t border-rule-soft pt-2 text-sm text-stone-700">{run.note}</p>
          )}
        </section>

        <RunActions
          runId={run.id}
          status={run.status}
          accounts={accounts}
          modes={modes}
          today={todayIST()}
          canApprove={isOwner}
        />

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>The lines</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            Read-only, and not by convention: no amount on a payroll line can be updated — the
            database grants no such right. A run is a decision. What is wrong is fixed by cancelling
            the run and preparing another, and both stay on the record.
          </p>
          <div className="mt-2">
            <PayrollLinesTable lines={lines} />
          </div>
        </section>

        {/* Migration 0016 made a PAID run reach money_movements, so the
            honesty strip that used to sit here is gone rather than reworded:
            the gap it described no longer exists. */}
        {run.status === 'paid' && canOpenRegisters && (
          <p className="text-center text-xs text-stone-500">
            Paid, so every line is on the{' '}
            <Link href="/accounts/registers/wages" className="underline underline-offset-2">
              wages register
            </Link>{' '}
            and in the balance of the account it was paid from.
          </p>
        )}

        <p className="text-center text-xs text-stone-400">
          This app records what was withheld and what was paid. It computes no statutory rate, files
          nothing with anybody, and moves no money.
        </p>
      </div>
    </>
  )
}
