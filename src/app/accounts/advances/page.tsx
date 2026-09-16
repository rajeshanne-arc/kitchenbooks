// MONEY THAT HAS GONE OUT AND HAS NOT COME BACK.
//
// Three shapes of one question — a salary advance, a loan, a vendor holding an
// overpayment — and one total: what is owed back to the business.
//
// THE EMPTY STATE IS THE MOST IMPORTANT SENTENCE ON THIS PAGE, and it is not
// "nobody owes anything". `staff_owes` reads from `staff_advances`, which is
// EMPTY on this restaurant — while a staff member is, in fact, ₹1,00,000 down.
// An advance nobody entered is invisible to every view over it, so a quiet
// ledger means nothing has been RECORDED, which is a different claim from
// nothing being owed and the only one this page can support.
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import {
  getAdvancesLedger,
  listStaffOwed,
  listVendorCredit,
  type StaffOwed,
  type VendorCredit,
} from '@/server/advances-queries'
import { creditAge, exposureText, loanProgress, monthLabel } from '@/lib/advances'
import Honesty from '@/components/Honesty'
import PersonLink from '@/components/labour/PersonLink'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls, codeCls, moneyCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function AdvancesPage() {
  const restaurant = await getRestaurant()
  const today = await businessToday()
  const [ledger, staff, credit] = await Promise.all([
    getAdvancesLedger(restaurant.id),
    listStaffOwed(restaurant.id),
    listVendorCredit(restaurant.id, today),
  ])

  // THE SPLIT IS THE VIEW'S. These read the kinds it emits rather than
  // re-deciding what counts as a loan, which is the rule it already holds.
  const byKind = (k: string) => ledger.filter((l) => l.kind === k)
  const advances = byKind('salary advance')
  const loans = byKind('loan')
  const credits = byKind('vendor credit')
  const total = ledger.reduce((n, l) => n + Number(l.amount), 0)

  const owedBy = new Map<string, StaffOwed>(staff.map((s) => [s.code, s]))
  const creditBy = new Map<string, VendorCredit>(credit.map((v) => [v.code, v]))

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Advances</h1>
        <p className={pageSubCls}>
          {restaurant.name} — money that has gone out and has not come back.
        </p>
      </header>

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Owed back to the business</h2>
            <span className="font-mono text-[10px] text-stone-400">advances_ledger</span>
          </div>
          <p className={`${moneyCls} mt-1 text-3xl`}>{formatMoneyString(String(total))}</p>
          <p className="mt-1 text-xs text-stone-500">
            {ledger.length === 0
              ? 'across nothing recorded'
              : `across ${ledger.length} ${ledger.length === 1 ? 'entry' : 'entries'} — ${advances.length} salary advance(s), ${loans.length} loan(s), ${credits.length} vendor credit(s)`}
          </p>

          {/* NOTHING RECORDED IS NOT NOTHING OWED, and on this restaurant the
              difference is ₹1,00,000. An advance handed over and never entered
              is invisible to every view over staff_advances — so a zero here
              is a fact about the BOOKS, and saying otherwise would be the
              confident zero this app exists to refuse. */}
          {staff.length === 0 && (
            <div className="mt-3">
              <Honesty verdict="nothing recorded, which is not nothing owed">
                No staff advance has ever been entered, so this total covers vendor credit only. An
                advance handed over and not recorded is invisible here — the books cannot show what
                nobody wrote down. Record one on a cash voucher, or ask for it under Approvals.
              </Honesty>
            </div>
          )}
        </section>

        <Section
          title="Salary advances"
          caption="Repaid out of the next payroll, in full."
          empty="No salary advance is on the books."
          rows={advances}
        >
          {(l) => {
            const s = owedBy.get(l.subject_code)
            const exposure = exposureText(l.exposure)
            return (
              <>
                {exposure !== null && <span className="text-amber-700">{exposure}</span>}
                {s !== undefined && Number(s.recovered) > 0 && (
                  <span> · {formatMoneyString(s.recovered)} recovered so far</span>
                )}
                {s !== undefined && s.staff_status !== 'active' && (
                  <span className="font-semibold text-red-700"> · retired and still owing</span>
                )}
              </>
            )
          }}
        </Section>

        <Section
          title="Loans"
          caption="An advance with an instalment and an end date. No interest is charged."
          empty="No loan is on the books."
          rows={loans}
        >
          {(l) => {
            const s = owedBy.get(l.subject_code)
            if (s === undefined) {
              return <span className="text-red-800">this loan’s detail did not read — that is a failed lookup, not a loan with no schedule</span>
            }
            const p = loanProgress(s, today)
            if (!p.known) return <span>{formatMoneyString(s.outstanding)} left — {p.why}</span>
            return (
              <>
                <span>
                  {p.paid} of {p.total} · {formatMoneyString(p.left)} left
                  {p.ends !== null && <> · ends {monthLabel(p.ends)}</>}
                </span>
                {/* A MONTH SKIPPED IS WHAT expected_end EXISTS TO SHOW. The
                    total still comes down eventually; the schedule is what
                    slips, and nothing else on the page would say so. */}
                {p.behind > 0 && (
                  <span className="font-semibold text-amber-700">
                    {' '}
                    · {p.behind} instalment{p.behind === 1 ? '' : 's'} not taken — it will end later than{' '}
                    {p.ends === null ? 'planned' : monthLabel(p.ends)}
                  </span>
                )}
              </>
            )
          }}
        </Section>

        <Section
          title="Vendor credit"
          caption="We have paid them more than they billed. It comes back as goods, or it has to be asked for."
          empty="No vendor is holding our money."
          rows={credits}
        >
          {(l) => {
            const v = creditBy.get(l.subject_code)
            if (v === undefined) {
              return <span className="text-red-800">this vendor’s detail did not read — a failed lookup, not a vendor with no history</span>
            }
            const age = creditAge(v.days_since_bill)
            return (
              <span className={age.stale ? 'font-semibold text-amber-700' : undefined}>
                {age.text}
                {v.last_bill !== null && <span className="text-stone-400"> · {fmtDate(v.last_bill)}</span>}
              </span>
            )
          }}
        </Section>
      </div>
    </>
  )
}

function Section({
  title,
  caption,
  empty,
  rows,
  children,
}: {
  title: string
  caption: string
  empty: string
  rows: { kind: string; subject_code: string; subject: string; amount: string; exposure: string | null }[]
  children: (l: { kind: string; subject_code: string; subject: string; amount: string; exposure: string | null }) => React.ReactNode
}) {
  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>{title}</h2>
      <p className="mt-0.5 text-xs text-stone-500">{caption}</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">{empty}</p>
      ) : (
        <ul className="mt-2 divide-y divide-rule-soft">
          {rows.map((l) => (
            <li key={`${l.kind}:${l.subject_code}`} className="py-2.5">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-sm">
                  <span className={codeCls}>{l.subject_code}</span>{' '}
                  {/* A PERSON'S NAME IS A DOOR; a vendor code is not one this
                      reader can open — the accountant is denied /store. */}
                  {l.kind === 'vendor credit' ? (
                    <span className="text-stone-900">{l.subject}</span>
                  ) : (
                    <PersonLink code={l.subject_code} name={l.subject} />
                  )}
                </span>
                <span className={`${moneyCls} shrink-0 text-sm`}>{formatMoneyString(l.amount)}</span>
              </div>
              <p className="mt-0.5 text-xs text-stone-500">{children(l)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
