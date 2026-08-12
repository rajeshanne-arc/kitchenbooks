// The runs, and the draft that becomes the next one.
//
// THREE HANDS, and the split is the whole control: the manager marks
// attendance, the accountant prepares the run, the owner approves it. This
// screen is the accountant's half — everything below the list is computed on
// the way past and stored only when Prepare is pressed.
//
// The period lives in the URL rather than in the form, because the draft is a
// SERVER read: changing the month must re-run the pay law in the database, not
// adjust anything on screen.
import { getRestaurant } from '@/server/queries'
import { getPayrollDraft, listPayrollRuns } from '@/server/payroll-queries'
import { todayIST } from '@/server/store-queries'
import PayrollRunsList from '@/components/accountant/PayrollRunsList'
import PrepareRun from '@/components/accountant/PrepareRun'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A regex is not a calendar: '2026-02-31' passes one and is out of range in
 *  the other, so a mistyped or stale URL would reach Postgres as a broken
 *  date and take the page down with it. Round-trip it and fall back to the
 *  offer instead. */
function isDate(s: string | undefined): s is string {
  if (s === undefined || !DATE_RE.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}

/** Last month, offered as the starting point — the month an accountant is
 *  almost always running. Offered, never assumed: both dates stay editable
 *  and the draft is worked out again for whatever is picked. The Close screen
 *  makes the same offer for the same reason. */
function lastMonth(today: string): { from: string; to: string } {
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const y = month === 1 ? year - 1 : year
  const m = month === 1 ? 12 : month - 1
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const mm = String(m).padStart(2, '0')
  return { from: `${y}-${mm}-01`, to: `${y}-${mm}-${String(last).padStart(2, '0')}` }
}

export default async function PayrollRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>
}) {
  const { from: fromParam, to: toParam } = await searchParams
  const offered = lastMonth(todayIST())
  const from = isDate(fromParam) ? fromParam : offered.from
  const to = isDate(toParam) ? toParam : offered.to

  const restaurant = await getRestaurant()
  // A backwards period would have the draft dividing by a negative day count,
  // so it is not asked — the screen says so instead.
  const [runs, draft] = await Promise.all([
    listPayrollRuns(restaurant.id),
    to < from ? Promise.resolve([]) : getPayrollDraft(restaurant.id, from, to),
  ])

  // preparePayrollRun refuses a period another live run already covers. Saying
  // so BEFORE the draft is typed into is the same rule as the freeze warning:
  // a refusal after a month of overtime has been keyed in arrives too late.
  const clash =
    runs.find((r) => r.status !== 'cancelled' && r.period_start <= to && r.period_end >= from) ??
    null

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Payroll runs</h1>
        <p className={pageSubCls}>
          {restaurant.name} — worked out from attendance, frozen when prepared, approved by an owner
          before anybody is paid.
        </p>
      </header>

      <div className="space-y-4">
        <section className={cardCls}>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Runs</h2>
            <span className="font-mono text-[10px] text-stone-400">payroll_runs</span>
          </div>
          {runs.length === 0 ? (
            <p className="mt-1.5 text-sm text-stone-700">
              No run has been prepared yet. That is the ordinary starting point — payroll begins the
              first month somebody works one out below.
            </p>
          ) : (
            <div className="mt-2">
              <PayrollRunsList runs={runs} />
            </div>
          )}
        </section>

        {/* Keyed on the loaded period: a new draft arrives as a new form
            rather than as new props on a component holding the old month's
            typing. */}
        <PrepareRun key={`${from}:${to}`} draft={draft} loadedFrom={from} loadedTo={to} clash={clash} />
      </div>

      <p className="mt-3 text-center text-xs text-stone-400">
        This app records what was withheld and what was paid. It computes no statutory rate and
        files nothing with anybody.
      </p>
    </>
  )
}
