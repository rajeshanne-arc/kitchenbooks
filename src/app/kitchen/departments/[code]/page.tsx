import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import { readPeriodParam, monthLabel, resolvePeriod } from '@/lib/period'
import {
  DEPT_CODE,
  getDepartment,
  getDepartmentByCode,
  getDepartmentById,
  getDepartmentEvidence,
} from '@/server/department-queries'
import { getFoodCost } from '@/server/kitchen-queries'
import { listDishCosts } from '@/server/recipes-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { requires } from '@/lib/precondition'
import PeriodControl from '@/components/dashboard/PeriodControl'
import PartialMonths from '@/components/dashboard/PartialMonths'
import Unassessed from '@/components/dashboard/Unassessed'
import Honesty, { Doubted } from '@/components/Honesty'
import GapCell from '@/components/kitchen/GapCell'
import {
  cardCls,
  codeCls,
  dataTableCls,
  heroNumCls,
  pageSubCls,
  pageTitleCls,
  sectionHeadCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import { UNIT_OPTIONS, type Units } from '@/lib/units'

export const dynamic = 'force-dynamic'

// ONE DEPARTMENT, EVERYTHING ALREADY KNOWN ABOUT IT.
//
// A drill-down, not a new measurement: every figure here was already computed
// by a named view and scattered across seven of them with no page to read them
// together. A CDP runs Chinese, and a department is the only real unit of
// accountability in a kitchen — but until now the only way to ask about one
// was to read seven cross-department reports and filter each by eye.
//
// THE ORDER IS FIXED, AND DELIBERATELY NOT SORTED BY URGENCY. The owner
// dashboard ranks its cards because it is triage across many subjects. This
// page is a story about ONE subject, read in the order somebody asks: is it
// earning, what does it cost, what did it make, what did it lose, did it get
// what it asked for. Reshuffling that per load would mean the page is in a
// different shape every time and nobody learns where anything is. The ranking
// the brief asks for is served instead by the strip at the TOP, which counts
// what cannot be assessed before any card claims anything.
//
// PRECONDITIONS ARE THE DESIGN WORK HERE, not a garnish. Against live data
// almost every card is unassessable — no POS day fetched, no attendance
// marked, nothing produced, nothing closed. Each card therefore declares what
// it rests on and says CANNOT BE ASSESSED rather than reporting a confident
// zero, and the structural cases are separated from the merely-empty ones: a
// department that CAN NEVER have dishes says so, instead of showing an empty
// list that reads as "somebody has not entered this yet".

function money(v: string | null | undefined) {
  return v === null || v === undefined ? '—' : formatMoneyString(v)
}

/** Sum one numeric-string column across the months a period covers.
 *  `section_costs` is read one row per month and summed HERE rather than in
 *  SQL, so a month with no row stays absent instead of arriving as a zero. */
const sumStr = <T extends object>(rows: T[], key: keyof T) =>
  rows.reduce((n, r) => n + Number(r[key] ?? 0), 0).toString()

/** A card, with its own heading and the relation it came from named under it —
 *  the same "say where this came from" habit as every other reporting screen. */
function Card({
  title,
  source,
  children,
}: {
  title: string
  source: string
  children: React.ReactNode
}) {
  return (
    <section className={cardCls}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>{title}</h2>
        <span className="font-mono text-[11px] text-stone-400">{source}</span>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/** A department cannot do this, ever — as opposed to has not done it yet.
 *  Rendered differently from `Unassessed` on purpose: nothing is missing and
 *  nobody owes an entry, so an "cannot be assessed" strip would send a chef
 *  looking for data that cannot exist. */
function NotApplicable({ children }: { children: React.ReactNode }) {
  return <p className="text-[13px] leading-snug text-stone-500">{children}</p>
}

function Figure({ label, value, tone = '' }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`${heroNumCls} mt-0.5 text-xl ${tone === '' ? 'text-stone-900' : tone}`}>{value}</div>
    </div>
  )
}

export default async function DepartmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>
  searchParams: Promise<{ period?: string; units?: string }>
}) {
  const { code: raw } = await params
  const { period: periodParam, units: unitsParam } = await searchParams
  const units = readView('units', unitsParam) as Units
  if (!DEPT_CODE.test(raw)) notFound()

  const restaurant = await getRestaurant()
  const dept = await getDepartment(restaurant.id, raw)
  if (dept === null) notFound()

  // ONE front door for ?period=, so preset/custom precedence is decided in

  // one place rather than in twelve hand-written ternaries.

  const periodToday = await businessToday()

  const periodReq = readPeriodParam(periodParam, periodToday)

  const period = resolvePeriod(periodReq.param, periodToday)

  // Two batched transactions plus the shared readers, rather than ten separate
  // ones: each `tsql` is BEGIN + SET LOCAL + the query + COMMIT, which is three
  // round trips, and this page renders inside a group layout that is already
  // holding connections from a max: 12 pool.
  const [byCode, byId, evidence, foodCostAll, dishesAll] = await Promise.all([
    getDepartmentByCode(restaurant.id, dept.code, period.months, period.from, period.to),
    getDepartmentById(restaurant.id, dept.id, period.from, period.to),
    getDepartmentEvidence(restaurant.id, dept.code, dept.id, period.from, period.to),
    getFoodCost(restaurant.id, period.reportMonth),
    listDishCosts(restaurant.id),
  ])

  // THE SWITCH IS THE CAPABILITY COLUMNS, NOT dept_kind. The brief said the
  // thinner page keys on dept_kind = 'operational', and that is nearly right —
  // but Staff Food and KST are dept_kind = 'kitchen' and CANNOT code dishes,
  // while Store, Accounts, Valet and Security are operational AND cannot
  // receive stock. Reading dept_kind alone would show Staff Food an empty dish
  // list that reads as "nobody has entered these yet". So each card asks the
  // column that actually governs it: codes_dishes, receives_stock, and
  // dept_group for the two that close.
  /** Only Kitchen and Bar produce and close — getFoodCost filters on exactly
   *  that, so an absent row for anybody else means "not a kitchen question",
   *  never "pending closing". Conflating the two would tell a department it
   *  owes a closing it can never file. */
  const cooks =
    dept.status === 'active' && (dept.dept_group === 'Kitchen' || dept.dept_group === 'Bar')
  /** An indent needs BOTH — saveIndent calls assertKitchenSection AND
   *  assertReceivesStock. Housekeeping receives stock and still cannot raise
   *  one, so gating on receives_stock alone would tell it that it "has not
   *  raised an indent", implying it could. */
  const indents = cooks && dept.receives_stock
  /** Sales reach a department only through a dish carrying its code. */
  const canSell = dept.codes_dishes

  /* ── 1. Is it earning? Three legs, each against its own source ─────────── */
  //
  // section_costs COALESCEs every figure to 0 and publishes no honesty column,
  // so its own row cannot tell "₹0 of sales" from "no POS day was ever
  // fetched". Live today it reads sales ₹0, labour ₹0, margin −₹7,498 for
  // South Indian — which on a page titled after a department is an accusation
  // about a named team, and is precisely the fault precondition.ts exists for.
  // A LEG THAT CAN NEVER ARRIVE IS NOT A LEG THAT HAS NOT ARRIVED. The store
  // cannot issue to itself and saveIssue refuses it by name; a department with
  // no dish code can never carry a sale. Reporting either as "cannot be
  // assessed" implies an entry is owed, and it is not.
  const consumed = !dept.receives_stock
    ? null
    : requires(
        evidence.consumption,
        sumStr(byCode.costs, 'consumption'),
        'nothing issued yet',
        `Nothing has moved from the store to ${dept.name} in this period, so there is no consumption to report.`,
      )
  const sales = !canSell
    ? null
    : requires(
        evidence.sales,
        sumStr(byCode.costs, 'sales'),
        evidence.unmappedItems > 0 ? 'POS items not mapped to a dish' : 'no sale attributed here',
        evidence.unmappedItems > 0
          ? `${evidence.unmappedItems} POS ${evidence.unmappedItems === 1 ? 'item is' : 'items are'} mapped to no dish, so no sale reaches any department yet.`
          : `No sale in this period is attributed to a ${dept.code} dish, so there is no revenue figure for ${dept.name}.`,
      )
  const labour = requires(
    evidence.labour,
    sumStr(byCode.labour, 'labour_cost'),
    'no attendance marked',
    `Nobody salaried has been marked present or absent in ${dept.name} for this period, so its wage cost is unknown.`,
  )
  const unsalaried = byCode.labour.reduce((n, r) => n + r.unsalaried_marks, 0)
  // Whichever legs are missing, named together — the strip says all of them
  // rather than the first one, because a reader fixing one and coming back to
  // find another still missing learns to distrust the page.
  const missing = [
    sales === null || sales.assessable ? null : sales.needs,
    labour.assessable ? null : labour.needs,
    consumed === null || consumed.assessable ? null : consumed.needs,
  ].filter((x): x is string => x !== null)
  /** Margin needs all three legs REAL. A leg that can never exist does not make
   *  the margin unassessable — it makes it meaningless, which is a different
   *  sentence, so a department that neither sells nor consumes says so once. */
  const marginPossible = sales !== null && consumed !== null
  const marginReady =
    marginPossible && sales.assessable && consumed.assessable && labour.assessable

  /* ── 2. Food cost ──────────────────────────────────────────────────────── */
  const fc = foodCostAll.find((r) => r.section_code === dept.code) ?? null

  /* ── 5. Indents ────────────────────────────────────────────────────────── */
  const indentDays = [...new Set(byCode.indents.map((r) => r.indent_id))]

  /* ── 7. Dishes ─────────────────────────────────────────────────────────── */
  const dishes = dishesAll.filter((d) => d.section_code === dept.code && d.status === 'active')

  /* ── the page's own honesty, counted BEFORE any card claims anything ────
     COUNTED PER CARD, and a card that cannot apply is not counted. The first
     version counted topics and gated none of them, so a department that can
     never sell and never be issued stock was told six things "cannot be
     answered yet" when four of them can never be answered at all. That is the
     page's own doctrine broken in its own summary. */
  const unassessable: string[] = []
  if (marginPossible && !marginReady) unassessable.push('what it earns')
  if (cooks && (fc === null || !fc.has_activity || fc.food_cost_pct === null)) {
    unassessable.push('food cost')
  }
  if (cooks && byId.shift.length === 0) unassessable.push('what it made and held')
  if (cooks && byId.loss.length === 0) unassessable.push('what it lost')
  if (indents && byCode.indents.length === 0) unassessable.push('what it asked for')
  if (dept.receives_stock && byCode.rhythm.length === 0) unassessable.push('its issue rhythm')
  if (canSell && dishes.length === 0) unassessable.push('its dishes')
  if (byId.staff.length === 0) unassessable.push('its people')

  return (
    <div className="space-y-4">
      <Link
        href="/kitchen/departments"
        className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800"
      >
        ← Departments
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4 pb-1">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={codeCls}>{dept.code}</span>
            <h1 className={pageTitleCls}>{dept.name}</h1>
          </div>
          <p className={pageSubCls}>
            {dept.dept_group}
            {dept.codes_dishes && (
              <>
                {' · '}
                {dept.dishes} {dept.dishes === 1 ? 'dish' : 'dishes'}
              </>
            )}
            {' · '}
            {dept.staff} {dept.staff === 1 ? 'person' : 'people'}
            {dept.status !== 'active' && ' · retired'}
          </p>
        </div>
        <div className="shrink-0 text-right">
          {/* the range in words comes from the control itself now, so every
              one of its twelve mounts states what it covers rather than only
              this one */}
          <PeriodControl
            period={period}
            today={periodToday}
            error={periodReq.error}
            basePath={`/kitchen/departments/${dept.code}`}
          />
        </div>
      </header>

      {/* the monthly cards below (food cost) cover whole months; a range with a
          partial edge says so rather than letting one heading cover two
          different questions */}
      <PartialMonths period={period} />

      {unassessable.length > 0 && (
        <Unassessed
          needs={`${unassessable.length} of 8 ${unassessable.length === 1 ? 'card' : 'cards'} cannot be assessed`}
        >
          Nothing is known yet about {unassessable.join(', ')}. Each card below says so in its own words
          rather than showing a zero — a zero here would read as a measurement.
        </Unassessed>
      )}

      {/* ── 1 ───────────────────────────────────────────────────────────── */}
      <Card title="Is it earning?" source="section_costs">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Figure label="Sales" value={sales !== null && sales.assessable ? money(sales.data) : '—'} />
          <Figure
            label="Consumed"
            value={consumed !== null && consumed.assessable ? money(consumed.data) : '—'}
          />
          <Figure label="Labour" value={labour.assessable ? money(labour.data) : '—'} />
        </div>
        {(sales === null || consumed === null) && (
          <div className="mt-3">
            <NotApplicable>
              {sales === null && consumed === null
                ? `${dept.name} neither sells nor is issued stock — no dish carries its code and the store does not issue to it. Only its wage cost is measurable here.`
                : sales === null
                  ? `No dish carries the ${dept.code} code, so no sale is ever attributed to ${dept.name}. It has a cost and no revenue, by design.`
                  : `${dept.name} is never issued stock, so it consumes nothing the store holds.`}
            </NotApplicable>
          </div>
        )}
        {/* MARGIN IS ARITHMETIC OVER ABSENCES unless all three legs are real.
            Showing it from a COALESCEd zero is how "South Indian costs more
            than it earns" got onto a dashboard over a missing divisor. */}
        {marginReady ? (
          <div className="mt-4 border-t border-rule pt-3">
            <Figure
              label="Margin"
              value={money(sumStr(byCode.costs, 'margin'))}
              tone={Number(sumStr(byCode.costs, 'margin')) < 0 ? 'text-red-700' : 'text-emerald-800'}
            />
          </div>
        ) : marginPossible ? (
          <div className="mt-3">
            <Unassessed needs={missing.join(' · ')}>
              {sales !== null && !sales.assessable && <p>{sales.why}</p>}
              {!labour.assessable && <p>{labour.why}</p>}
              {consumed !== null && !consumed.assessable && <p>{consumed.why}</p>}
              <p className="mt-1">
                Margin is sales minus what was consumed and paid. With any leg missing it would be arithmetic
                over an absence, so no figure is stated.
              </p>
            </Unassessed>
          </div>
        ) : null}
        {/* CONTRACT STAFF ARE NOT A ZERO. labour_cost_by_section excludes them
            by design — they are billed by their vendor — so a department run
            entirely by contract hands would otherwise read a confident ₹0.00
            wage cost made of an exclusion. */}
        {evidence.contractStaff > 0 && (
          <div className="mt-3">
            <Honesty verdict="billed by their vendor" compact>
              {evidence.contractStaff} of the people here {evidence.contractStaff === 1 ? 'is' : 'are'} on
              contract, so their cost is on a contract bill and never in this figure.
            </Honesty>
          </div>
        )}
        {unsalaried > 0 && (
          <div className="mt-3">
            <Honesty verdict="wages incomplete" compact>
              {unsalaried} attendance {unsalaried === 1 ? 'mark counts' : 'marks count'} for somebody with no
              salary on file, so the labour figure is lower than the real one.
            </Honesty>
          </div>
        )}
      </Card>

      {/* ── 2 ───────────────────────────────────────────────────────────── */}
      <Card title="Food cost" source="section_food_cost">
        {!cooks ? (
          <NotApplicable>
            Food cost is a kitchen question. {dept.name} does not sell food, so there is no percentage to
            state — and nothing here is owed or missing.
          </NotApplicable>
        ) : fc === null || !fc.has_activity ? (
          // NOT "PENDING CLOSING" — that verdict names a deliverable that
          // cannot resolve this card. section_food_cost is driven from
          // section_consumption, which ends
          //   where coalesce(iss.v,0) <> 0 or coalesce(ret.v,0) <> 0
          // so a department with no issue and no return can NEVER acquire a
          // row. Telling it to file a closing would send a chef on an errand
          // that provably cannot succeed — and the ₹0.00 issued figure the old
          // branch printed was a coalesce, not a measurement, contradicting the
          // card one inch above which called the same quantity unassessable.
          // has_activity is published for exactly this distinction.
          <Unassessed needs="nothing issued this month">
            Nothing has been issued to {dept.name} in {monthLabel(period.reportMonth)}, so there is nothing to
            close against and no food cost to work out. A closing would not change that.
          </Unassessed>
        ) : fc.consumed_total === null ? (
          // THE PENDING-CLOSING LAW LIVES IN THE VIEW, and this is the only
          // case where a closing is genuinely owed: stock moved, and nobody has
          // said what is left. consumed_total is never filled in here —
          // opening + issued − closing is the view's arithmetic to do.
          <Unassessed needs="pending closing">
            {dept.name} has not said what it still holds at the end of {monthLabel(period.reportMonth)}, so
            what it actually consumed cannot be worked out. Issued is {money(fc.issued_value)}; the closing is
            the other half.
          </Unassessed>
        ) : !canSell ? (
          // Consumption is real and the RATIO is impossible: no dish carries
          // this code, so sales_value is structurally NULL forever. Staff Food
          // and KST are the live cases — both dept_kind 'kitchen'.
          <>
            <Figure label={`Consumed · ${monthLabel(period.reportMonth)}`} value={money(fc.consumed_total)} />
            <div className="mt-3">
              <NotApplicable>
                {dept.name} consumes but does not sell — no dish carries its code — so it has a cost and can
                never have a food cost percentage.
              </NotApplicable>
            </div>
          </>
        ) : fc.food_cost_pct === null ? (
          <Unassessed needs="no sales">
            {dept.name} consumed {money(fc.consumed_total)} in {monthLabel(period.reportMonth)}, but nothing
            has been sold against it, so there is no percentage.
          </Unassessed>
        ) : (
          <>
            <ViewToggle
              param="units"
              value={units}
              options={UNIT_OPTIONS}
              defaultValue={VIEW_KEYS.units[0]}
              label="Show food cost as rupees or as a share of sales"
            />
            <div className="mt-3 flex flex-wrap items-end gap-6">
              {/* THE FIGURE IS COLOURED ABSOLUTELY — a dish or a department at
                  44% is expensive whatever it is. Amber over 35, red over 40. */}
              {/* THE RUPEES SIDE IS THE CONSUMPTION ITSELF, which is real
                  whether or not any sales were ever attributed to this
                  department — and with 94% of revenue unmapped that is most of
                  them. The percent refuses; the money does not have to. */}
              <Figure
                label={
                  units === 'rupees'
                    ? `Consumed · ${monthLabel(period.reportMonth)}`
                    : `Food cost · ${monthLabel(period.reportMonth)}`
                }
                value={units === 'rupees' ? money(fc.consumed_total) : `${Number(fc.food_cost_pct).toFixed(1)}%`}
                tone={
                  Number(fc.food_cost_pct) > 40
                    ? 'text-red-700'
                    : Number(fc.food_cost_pct) > 35
                      ? 'text-amber-800'
                      : 'text-emerald-800'
                }
              />
              <Figure label="Consumed" value={money(fc.consumed_total)} />
              <Figure label="Sold" value={money(fc.sales_value)} />
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Ingredients only — overhead is not in this ratio. Reported for {monthLabel(period.reportMonth)}
              alone; a percentage blended across months would not mean anything.
            </p>
          </>
        )}
      </Card>

      {/* ── 3 ───────────────────────────────────────────────────────────── */}
      <Card title="Made and held" source="productions · kitchen_closing_current">
        {!cooks ? (
          <NotApplicable>
            {dept.name} does not produce and does not file a closing — only kitchen and bar departments do.
          </NotApplicable>
        ) : byId.shift.length === 0 ? (
          <Unassessed needs="nothing made or closed">
            No batch was recorded and no closing filed for {dept.name} in this period.
          </Unassessed>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Day</th>
                  <th className={thNumCls}>Batches</th>
                  <th className={thNumCls}>Produced</th>
                  <th className={thNumCls}>Held at close</th>
                </tr>
              </thead>
              <tbody>
                {byId.shift.map((d) => (
                  <tr key={d.day} className={trCls}>
                    <td className={tdCls}>{fmtDate(d.day)}</td>
                    <td className={tdNumCls}>{d.batches}</td>
                    <td className={tdNumCls}>{money(d.produced)}</td>
                    {/* NULL is not closed. Zero is a real closing — a shelf can
                        genuinely be empty — so the two must not render alike. */}
                    <td className={tdNumCls}>
                      {d.closed === null ? (
                        <span className="text-xs font-normal text-amber-800">not closed</span>
                      ) : (
                        money(d.closed)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── 4 ───────────────────────────────────────────────────────────── */}
      <Card title="Lost, by reason" source="kitchen_wastage">
        {!cooks ? (
          // saveKitchenWastage calls assertKitchenSection, so the seven
          // non-Kitchen/Bar departments CANNOT file one. Offering them "either
          // a clean month or an unrecorded one" invites somebody to go and
          // record what the server would refuse.
          <NotApplicable>
            {dept.name} does not file kitchen losses — only kitchen and bar departments do. Write-offs of
            store stock are recorded as store loss, against the item.
          </NotApplicable>
        ) : byId.loss.length === 0 ? (
          <Unassessed needs="no loss recorded">
            Nothing has been written off in {dept.name} this period. That is either a clean month or an
            unrecorded one, and this page cannot tell the difference.
          </Unassessed>
        ) : (
          <div className="overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Reason</th>
                  <th className={thNumCls}>Times</th>
                  <th className={thNumCls}>Value</th>
                </tr>
              </thead>
              <tbody>
                {byId.loss.map((r) => (
                  <tr key={r.reason} className={trCls}>
                    <td className={`${tdCls} font-medium`}>{r.reason}</td>
                    <td className={tdNumCls}>{r.events}</td>
                    <td className={`${tdNumCls} font-semibold`}>{money(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-stone-500">
              This is why the reason is asked per line rather than per trip — a total says how much, only the
              breakdown says what to fix.
            </p>
          </div>
        )}
      </Card>

      {/* ── 5 ───────────────────────────────────────────────────────────── */}
      <Card title="Did it get what it asked for?" source="indent_fulfilment">
        {!indents ? (
          // BOTH conditions, because saveIndent asserts both — and the two
          // refusals are different sentences, so a reader learns which one
          // applies to them rather than a single vague "cannot".
          <NotApplicable>
            {!dept.receives_stock
              ? `${dept.name} does not receive stock, so it never raises an indent.`
              : `${dept.name} is issued stock directly rather than by indent — only kitchen and bar departments raise one.`}
          </NotApplicable>
        ) : byCode.indents.length === 0 ? (
          <Unassessed needs="nothing asked for">
            {dept.name} has not raised an indent in this period.
          </Unassessed>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Item</th>
                    <th className={thNumCls}>Asked</th>
                    <th className={thNumCls}>Given</th>
                    <th className={thCls}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {byCode.indents.map((r) => (
                    <tr key={`${r.indent_id}:${r.item_code}`} className={trCls}>
                      <td className={tdCls}>
                        <Link
                          href={`/kitchen/indent/${r.indent_id}`}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          {fmtDate(r.indent_date)}
                        </Link>
                        <span className="ml-1.5 text-xs text-stone-400">{r.session}</span>
                      </td>
                      <td className={tdCls}>
                        <span className="font-mono text-[12px] text-stone-500">{r.item_code}</span>{' '}
                        {r.item_name}
                      </td>
                      <td className={tdNumCls}>
                        {r.qty_requested} {r.purchase_unit}
                      </td>
                      {/* NOT COALESCED. A cancelled indent has no given
                          quantity, and a dash coalesced out of NULL reads as
                          zero — "asked and got nothing" — which is the
                          opposite of "nobody was ever going to fill this". */}
                      <td className={tdNumCls}>
                        {r.qty_given === null ? (
                          <span className="text-xs font-normal text-stone-400">cancelled</span>
                        ) : r.status === 'open' ? (
                          <span className="text-xs font-normal text-amber-800">waiting</span>
                        ) : (
                          `${r.qty_given} ${r.purchase_unit}`
                        )}
                      </td>
                      <td className={tdCls}>
                        {/* status matters: the view computes
                            coalesce(qty_given, 0) − qty_requested, so an OPEN
                            request the store has not touched arrives as −5 and
                            would read "Short 5 kg" in red — an accusation for a
                            request nobody has been given the chance to fill. */}
                        <GapCell gap={r.gap} unit={r.purchase_unit} status={r.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-stone-500">
              {indentDays.length} {indentDays.length === 1 ? 'request' : 'requests'} in this period. The gap is
              said in words rather than as a signed number — the view computes given minus asked, so a minus
              sign means short, which is the opposite of how anybody says it out loud.
            </p>
          </>
        )}
      </Card>

      {/* ── 6 ───────────────────────────────────────────────────────────── */}
      <Card title="Daily rhythm" source="issue_frequency">
        {!dept.receives_stock ? (
          <NotApplicable>{dept.name} does not receive stock, so it has no issue rhythm.</NotApplicable>
        ) : byCode.rhythm.length === 0 ? (
          <Unassessed needs="no issues in this period">
            Nothing has been issued to {dept.name} in this period, so there is no rhythm to read.
          </Unassessed>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Day</th>
                    <th className={thNumCls}>Trips</th>
                    <th className={thCls}>Sessions</th>
                  </tr>
                </thead>
                <tbody>
                  {byCode.rhythm.map((r) => (
                    <tr key={r.issue_date} className={trCls}>
                      <td className={tdCls}>{fmtDate(r.issue_date)}</td>
                      <td className={tdNumCls}>
                        {/* A smooth day is one or two trips to the store. Five
                            is a kitchen that did not know what it needed, and
                            it costs the store manager the whole morning. */}
                        {r.issue_count >= 3 ? (
                          <span className="font-semibold text-amber-800">{r.issue_count}</span>
                        ) : (
                          r.issue_count
                        )}
                      </td>
                      <td className={`${tdCls} text-stone-500`}>{r.sessions}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* QUANTIFIED, not merely disclaimed. issue_frequency filters
                reverses_id is null and nothing else, so a voided original is
                still counted; naming the flaw without measuring it leaves the
                reader unable to tell whether it matters. */}
            <p className="mt-2 text-xs text-stone-500">
              Three or more trips in a day is marked.
              {(() => {
                const filed = byCode.rhythm.reduce((n, r) => n + r.issue_count, 0)
                const voided = filed - evidence.liveIssues
                return voided > 0
                  ? ` ${filed} trips are counted here and ${evidence.liveIssues} still stand — ${voided} ${voided === 1 ? 'was' : 'were'} later voided, and this view counts issues FILED.`
                  : ' Counted as issues filed; none of these has been voided.'
              })()}
            </p>
          </>
        )}
      </Card>

      {/* ── 7 ───────────────────────────────────────────────────────────── */}
      <Card title="Dishes" source="dish_costs">
        {!dept.codes_dishes ? (
          // STRUCTURAL, NOT MISSING. codes_dishes is false for every operational
          // unit and for Staff Food and KST too — no dish can EVER carry this
          // code, so an empty list would send a chef looking for data that
          // cannot exist. Same class as the dish picker once offering Security.
          <NotApplicable>
            No dish can be coded to {dept.name} — the department code becomes part of every dish code, and
            this one does not code dishes. Nothing is missing.
          </NotApplicable>
        ) : dishes.length === 0 ? (
          <Unassessed needs="no dish coded here yet">
            No dish carries the {dept.code} code yet.
          </Unassessed>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Dish</th>
                    <th className={thNumCls}>Batch cost</th>
                    <th className={thNumCls}>Per portion</th>
                    <th className={thNumCls}>Food cost</th>
                    <th className={thCls}>Against target</th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map((d) => {
                    const pct = d.food_cost_pct === null ? null : Number(d.food_cost_pct)
                    return (
                      <tr key={d.recipe_id} className={trCls}>
                        <td className={tdCls}>
                          <Link
                            href={`/kitchen/recipes/${d.recipe_id}`}
                            className="font-medium text-emerald-700 hover:underline"
                          >
                            {d.name}
                          </Link>
                          <span className="ml-1.5 font-mono text-[11px] text-stone-400">{d.code}</span>
                        </td>
                        {/* UNCOSTED LINES MAKE THE BATCH COST A FLOOR, NOT A
                            FIGURE. dish_costs prices an ingredient with no bill
                            behind it at 0 and publishes uncosted_lines to say
                            so; printing the total without that turns a
                            half-priced recipe into a confident cheap dish, and
                            the flag can come out green on it. */}
                        <td className={tdNumCls}>
                          {d.uncosted_lines > 0 ? (
                            <Doubted level="pending" title={`${d.uncosted_lines} ingredients have no bill behind them`}>
                              {money(d.dish_cost)}
                            </Doubted>
                          ) : (
                            money(d.dish_cost)
                          )}
                        </td>
                        <td className={tdNumCls}>
                          {d.cost_per_portion === null ? (
                            <span className="text-xs font-normal text-stone-400">no portions set</span>
                          ) : (
                            money(d.cost_per_portion)
                          )}
                        </td>
                        {/* THE FIGURE IS COLOURED ABSOLUTELY; the FLAG beside it
                            compares against this course's target. A dish can
                            read amber and flag OK — two different findings, not
                            a contradiction. */}
                        <td className={tdNumCls}>
                          {pct === null ? (
                            <span className="text-stone-300">—</span>
                          ) : (
                            <span
                              className={
                                pct > 40 ? 'text-red-700' : pct > 35 ? 'text-amber-800' : 'text-stone-900'
                              }
                            >
                              {pct.toFixed(1)}%
                            </span>
                          )}
                        </td>
                        <td className={tdCls}>
                          {/* CHECK is neither OK nor HIGH: the dish costs zero,
                              or has no price, or no portions. A repair job,
                              never a cheap dish. And a NULL target makes the
                              view's comparison NULL and fall through to OK, so
                              OK without a target is not an all-clear. */}
                          {d.uncosted_lines > 0 ? (
                            <span className="text-[13px] text-doubt">understated</span>
                          ) : d.flag === 'CHECK' ? (
                            <span className="text-[13px] font-semibold text-red-700">Check it</span>
                          ) : d.target_pct === null ? (
                            <span className="text-[13px] text-stone-400">no target set</span>
                          ) : d.flag === 'HIGH' ? (
                            <span className="text-[13px] font-semibold text-amber-800">
                              over {Number(d.target_pct).toFixed(0)}%
                            </span>
                          ) : (
                            <span className="text-[13px] text-emerald-800">
                              within {Number(d.target_pct).toFixed(0)}%
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {dishes.some((d) => d.uncosted_lines > 0) && (
              <div className="mt-3">
                <Honesty
                  verdict="costs understated"
                  meter={{
                    filled: dishes.filter((d) => d.uncosted_lines === 0).length,
                    total: dishes.length,
                    unit: 'dishes fully costed',
                  }}
                >
                  {dishes.filter((d) => d.uncosted_lines > 0).length} of these use an ingredient with no bill
                  behind it. Those price at zero, so the batch cost shown is a floor and the percentage beside
                  it is lower than the truth.
                </Honesty>
              </div>
            )}
            {dishes.some((d) => d.flag === 'CHECK') && (
              <div className="mt-3">
                <Honesty level="alarm" verdict="not costable">
                  {dishes.filter((d) => d.flag === 'CHECK').length} of these cannot be costed per portion —
                  a dish with no portions, no selling price or no costed ingredient has no answer to give,
                  and a zero would read as a cheap dish.
                </Honesty>
              </div>
            )}
            <p className="mt-2 text-xs text-stone-500">
              Dish costs are LIVE — they follow the rates on the bills and are not scoped to the period above.
            </p>
          </>
        )}
      </Card>

      {/* ── 8 ───────────────────────────────────────────────────────────── */}
      <Card title="People" source="staff · labour_cost_by_section">
        {byId.staff.length === 0 ? (
          <Unassessed needs="nobody posted here">
            No active staff member names {dept.name} as their department.
          </Unassessed>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thCls}>Code</th>
                    <th className={thCls}>Name</th>
                    <th className={thCls}>Role</th>
                    <th className={thCls}>Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {byId.staff.map((s) => (
                    <tr key={s.id} className={trCls}>
                      <td className={tdCodeCls}>{s.code}</td>
                      <td className={`${tdCls} font-medium`}>{s.name}</td>
                      <td className={`${tdCls} text-stone-500`}>{s.designation ?? '—'}</td>
                      <td className={`${tdCls} text-stone-500`}>{s.grade ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 border-t border-rule pt-3">
              {labour.assessable ? (
                <Figure label="Wage cost for this period" value={money(labour.data)} />
              ) : (
                <Unassessed needs={labour.needs}>{labour.why}</Unassessed>
              )}
            </div>
          </>
        )}
      </Card>
    </div>
  )
}
