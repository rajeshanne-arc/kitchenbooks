import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getPayrollLines, getPayrollRun } from '@/server/payroll-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls } from '@/components/ui'
import PrintButton from '@/components/accountant/PrintButton'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A printable payslip is derived only from frozen payroll_lines. It is a
 * presentation of the run, never a second payroll calculation or write. */
export default async function PayslipsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const run = await getPayrollRun(restaurant.id, id)
  if (!run) notFound()
  const lines = await getPayrollLines(run.id)
  return <main className="mx-auto max-w-4xl">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div><Link href={`/accounts/payroll/runs/${id}`} className="text-sm text-stone-500 hover:text-stone-800">← Payroll run</Link><h1 className={`${pageTitleCls} mt-2`}>Payslips</h1><p className={pageSubCls}>{restaurant.name} · {fmtDate(run.period_start)} — {fmtDate(run.period_end)} · {run.status === 'paid' ? 'paid' : 'preview'}</p></div>
      <span className="flex gap-2"><a href={`/api/accounts/payroll-export?run=${id}`} className="rounded-xl border border-stone-300 px-3 py-2 text-sm font-medium">Export CSV</a><PrintButton label="Print payslips" /></span>
    </div>
    <div className="space-y-4">{lines.map((line) => <article key={line.id} className={`${cardCls} break-inside-avoid`}><div className="flex items-start justify-between border-b border-rule-soft pb-3"><div><h2 className="font-display text-xl font-bold text-stone-900">{restaurant.name}</h2><p className="text-sm text-stone-600">Salary statement · {fmtDate(run.period_start)} to {fmtDate(run.period_end)}</p></div><span className="font-mono text-xs text-stone-500">{run.doc_no ?? 'RUN'}</span></div><div className="mt-3 grid grid-cols-2 gap-2 text-sm"><div><span className="text-stone-500">Employee</span><div className="font-medium">{line.staff_name}</div></div><div><span className="text-stone-500">Employee code</span><div className="font-mono">{line.staff_code}</div></div><div><span className="text-stone-500">Days paid</span><div>{line.days_paid} / {line.days_in_period}</div></div><div><span className="text-stone-500">Payment date</span><div>{line.paid_on ? fmtDate(line.paid_on) : 'Not paid'}</div></div></div><dl className="mt-4 divide-y divide-rule-soft border-y border-rule-soft text-sm"><div className="flex justify-between py-2"><dt>Earned</dt><dd className="font-mono">{formatMoneyString(line.earned)}</dd></div><div className="flex justify-between py-2"><dt>Overtime</dt><dd className="font-mono">{formatMoneyString(line.overtime)}</dd></div><div className="flex justify-between py-2 text-stone-600"><dt>Advance recovered</dt><dd className="font-mono">−{formatMoneyString(line.advance_recovered)}</dd></div><div className="flex justify-between py-2 text-stone-600"><dt>Other deduction</dt><dd className="font-mono">−{formatMoneyString(line.other_deduction)}</dd></div><div className="flex justify-between py-2 text-stone-600"><dt>Withholding</dt><dd className="font-mono">−{formatMoneyString(line.withholding)}</dd></div><div className="flex justify-between py-3 text-base font-bold"><dt>Net payable</dt><dd className="font-mono">{formatMoneyString(line.net_payable)}</dd></div></dl><p className="mt-3 text-xs text-stone-500">This statement records the amounts approved in the payroll run. Statutory rates and filings are not computed by KitchenBooks.</p></article>)}</div>
  </main>
}
