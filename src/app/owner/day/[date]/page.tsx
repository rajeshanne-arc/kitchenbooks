import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { businessToday } from '@/server/business-day'
import {
  getDayChannels,
  getDayEvidence,
  getDayHours,
  getDayLabour,
  getDaySummary,
  listDayDates,
} from '@/server/day-queries'
import DateLink from '@/components/dashboard/DateLink'
import { decimalStringToPaise, formatMoneyString, formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { HourlyLine } from '@/components/dashboard/Charts'
import Unassessed from '@/components/dashboard/Unassessed'
import Honesty from '@/components/Honesty'
import { cardCls, heroNumCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// THE OWNER DAY SHEET — a flash report, and a standard restaurant artifact.
//
// What makes a good one is not what is on it but that it FITS ON A PAGE, LOOKS
// IDENTICAL EVERY DAY so the eye learns where to look, and answers "did
// yesterday go well" in fifteen seconds. The order below is fixed and is never
// re-sorted by what happens to be interesting today — that is the owner
// dashboard's job, which ranks by what is most wrong because it is triage
// across many subjects. This is one subject, read the same way every morning.
//
// WHAT THE PEERS DO NOT DO. Restaurant365, MarketMan and URY all render ZEROS
// where data is missing, so a day with no bills entered reads as a day with no
// food cost and the ratio looks superb. Every card here declares its
// precondition and says CANNOT BE ASSESSED instead. A flash report is read
// fast, and a fast reader believes a number.
//
// ISSUED IS NOT CONSUMED, and the page says ISSUED. True consumption is
// opening + issued − closing, and a closing exists only if the chef filed one
// that night. A daily food cost built on issues alone is noise wearing a
// percentage — so the ratio appears only where a closing exists.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

const money = (v: string | null | undefined) => (v === null || v === undefined ? '—' : formatMoneyString(v))
const paise = (v: string | null | undefined) => (v === null || v === undefined ? 0 : decimalStringToPaise(v))

function Card({ title, source, children }: { title: string; source: string; children: React.ReactNode }) {
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

function Figure({ label, value, tone = '', sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
      <div className={`${heroNumCls} mt-0.5 text-xl ${tone === '' ? 'text-stone-900' : tone}`}>{value}</div>
      {sub !== undefined && <div className="text-[11px] text-stone-400">{sub}</div>}
    </div>
  )
}

/** A ratio is stated only when its numerator AND denominator are both real.
 *  Everything on this page that divides goes through here. */
function Ratio({
  label,
  pct,
  needs,
  why,
  tone,
}: {
  label: string
  pct: number | null
  needs: string
  why: string
  tone?: (p: number) => string
}) {
  return (
    <div className="rounded-xl border border-rule bg-cell p-3">
      <div className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</div>
      {pct === null ? (
        <div className="mt-1.5">
          <Unassessed needs={needs}>{why}</Unassessed>
        </div>
      ) : (
        <div className={`${heroNumCls} mt-0.5 text-3xl ${tone?.(pct) ?? 'text-stone-900'}`}>{pct.toFixed(1)}%</div>
      )}
    </div>
  )
}

export default async function DaySheetPage({ params }: { params: Promise<{ date: string }> }) {
  const { date } = await params
  if (!DATE_RE.test(date)) notFound()
  const restaurant = await getRestaurant()
  const today = await businessToday()

  const [day, ev, channels, hours, labour, dates] = await Promise.all([
    getDaySummary(restaurant.id, date),
    getDayEvidence(restaurant.id, date),
    getDayChannels(restaurant.id, date),
    getDayHours(restaurant.id, date),
    getDayLabour(restaurant.id, date),
    listDayDates(restaurant.id, 30),
  ])
  // A FLASH REPORT IS READ EVERY MORNING, so the neighbouring days are one tap
  // away. `dates` is newest first, so the NEXT day is the earlier index.
  const at = dates.indexOf(date)
  const newer = at > 0 ? dates[at - 1] : null
  const older = at >= 0 && at < dates.length - 1 ? dates[at + 1] : null

  const dow = new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })
  const isToday = date === today
  const revenuePaise = paise(day?.revenue)
  const salesReal = ev.fetches > 0 && (day?.orders ?? 0) > 0

  // THE THREE RATIOS ARE THE POINT OF THE PAGE. Everything above them is
  // inputs, and each is null unless BOTH sides are real.
  //
  // Food cost needs a CLOSING, not just issues — see the file header. Labour
  // needs marks AND sales. Prime cost needs both of the others.
  const closingsIn = ev.closable_sections > 0 && day !== null && day.sections_closed >= ev.closable_sections
  const consumed = closingsIn ? paise(day.issued_net) : null
  const foodPct = consumed !== null && revenuePaise > 0 ? (consumed / revenuePaise) * 100 : null
  const labourPaise = ev.marks > 0 ? paise(day?.labour) : null
  const labourPct = labourPaise !== null && revenuePaise > 0 ? (labourPaise / revenuePaise) * 100 : null
  const primePct = foodPct !== null && labourPct !== null ? foodPct + labourPct : null

  const busiest = hours.reduce<(typeof hours)[number] | null>(
    (best, h) => (best === null || decimalStringToPaise(h.revenue) > decimalStringToPaise(best.revenue) ? h : best),
    null,
  )
  const hourLabel = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`)

  return (
    <>
      <header className="pb-4">
        <Link href="/owner" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
          ← Owner
        </Link>
        <div className="mt-2 flex flex-wrap items-baseline gap-x-3">
          <h1 className={pageTitleCls}>{fmtDate(date)}</h1>
          <span className="flex gap-2 text-sm">
            {older !== null && (
              <DateLink date={older} className="font-medium text-stone-500">
                ← {fmtDate(older)}
              </DateLink>
            )}
            {newer !== null && (
              <DateLink date={newer} className="font-medium text-stone-500">
                {fmtDate(newer)} →
              </DateLink>
            )}
          </span>
        </div>
        <p className={pageSubCls}>
          {dow} · {restaurant.name}
          {isToday && <span className="ml-1 font-medium text-amber-800">· the day so far, not a closed day</span>}
        </p>
        {salesReal ? (
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Figure label="Revenue" value={money(day?.revenue)} />
            <Figure label="Orders" value={String(day?.orders ?? 0)} />
            <Figure
              label="Covers"
              value={String(day?.covers ?? 0)}
              sub={day?.per_cover === null || day?.per_cover === undefined ? undefined : `${money(day.per_cover)}/cover`}
            />
          </div>
        ) : (
          <div className="mt-3">
            <Unassessed needs="no POS day fetched">
              Nothing has been fetched from Petpooja for {fmtDate(date)}, so there is no day to report. Everything
              below that divides by sales stays blank until there is.
            </Unassessed>
          </div>
        )}
      </header>

      <div className="space-y-4">
        <Card title="Money in" source="sales_current · sales_by_hour">
          {!salesReal ? (
            <Unassessed needs="no POS day fetched">Fetch the day under Sales → Books → Fetch.</Unassessed>
          ) : (
            <>
              <ul className="divide-y divide-rule-soft">
                {channels.map((c) => (
                  <li key={c.channel} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                    <span className="text-stone-900">
                      {c.channel}
                      <span className="ml-1.5 text-[11px] text-stone-400">
                        {c.orders} {c.orders === 1 ? 'order' : 'orders'}
                      </span>
                    </span>
                    <span className="font-mono tabular-nums text-stone-900">{money(c.revenue)}</span>
                  </li>
                ))}
              </ul>
              {paise(day?.off_book) !== 0 && (
                <p className="mt-2 text-[13px] text-stone-600">
                  Off-book {money(day?.off_book)} · other income {money(day?.other_income)} — outside the POS.
                </p>
              )}
              {hours.length > 0 && (
                <div className="mt-3">
                  <HourlyLine points={hours} />
                  {busiest !== null && (
                    <p className="mt-1.5 text-[13px] text-stone-600">
                      Busiest hour {hourLabel(busiest.hour)} — {money(busiest.revenue)} across {busiest.orders}{' '}
                      {busiest.orders === 1 ? 'order' : 'orders'}.
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </Card>

        <Card title="Money out" source="day_summary">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Figure
              label="Purchases"
              value={ev.bills === 0 ? '—' : money(day?.purchases)}
              sub={ev.bills === 0 ? 'no bill entered' : `${ev.bills} ${ev.bills === 1 ? 'bill' : 'bills'}`}
            />
            <Figure
              label="Issued"
              value={ev.issues === 0 ? '—' : money(day?.issued_net)}
              sub={ev.issues === 0 ? 'no issue recorded' : 'stock out of the store'}
            />
            <Figure
              label="Wasted"
              value={
                ev.store_losses + ev.kitchen_losses === 0
                  ? '—'
                  : formatPaise(paise(day?.store_wastage) + paise(day?.kitchen_wastage))
              }
              sub={
                ev.store_losses + ev.kitchen_losses === 0
                  ? 'nothing written off'
                  : `${ev.store_losses} store · ${ev.kitchen_losses} kitchen`
              }
            />
            <Figure
              label="Wages"
              value={ev.marks === 0 ? '—' : money(day?.labour)}
              sub={ev.marks === 0 ? 'nobody marked' : `${ev.marks} of ${ev.roster} marked`}
            />
          </div>

          {/* ISSUED IS NOT CONSUMED — said where the number is, not in a
              footnote nobody reads. */}
          {ev.issues > 0 && (
            <p className="mt-3 text-[13px] leading-snug text-stone-500">
              Issued is stock that <em>left the store</em>, not food that was eaten. A kitchen draws ten kilos on
              Monday and cooks it over three days — consumption is opening + issued − closing, and the closing is
              filed at night.
            </p>
          )}

          {(ev.bills === 0 || ev.issues === 0 || ev.marks === 0) && (
            <div className="mt-3">
              <Honesty
                verdict="the cost side is thin"
                meter={{
                  filled: [ev.bills > 0, ev.issues > 0, ev.marks > 0, day !== null && day.sections_closed > 0].filter(
                    Boolean,
                  ).length,
                  total: 4,
                  unit: 'cost inputs present',
                }}
              >
                {[
                  ev.bills === 0 && 'no bill was entered',
                  ev.issues === 0 && 'nothing was issued from the store',
                  ev.marks === 0 && `nobody was marked on the roster (${ev.roster} active)`,
                  day !== null && day.sections_closed === 0 && 'no department filed a closing',
                ]
                  .filter(Boolean)
                  .join(', ')}
                . Those are not zeroes — they are entries nobody made, and every ratio below refuses rather than
                dividing by them.
              </Honesty>
            </div>
          )}
        </Card>

        {/* ── THE THREE RATIOS — the point of the page ─────────────────── */}
        <Card title="The three ratios" source="day_summary">
          <div className="grid gap-3 sm:grid-cols-3">
            <Ratio
              label="Food cost"
              pct={foodPct}
              tone={(p) => (p > 40 ? 'text-red-700' : p > 35 ? 'text-doubt' : 'text-stone-900')}
              needs={
                !salesReal
                  ? 'no sales'
                  : ev.closable_sections === 0
                    ? 'no closable department'
                    : (day?.sections_closed ?? 0) === 0
                      ? 'no closing filed'
                      : 'closings incomplete'
              }
              why={
                !salesReal
                  ? 'There is no revenue to divide into.'
                  : (day?.sections_closed ?? 0) < ev.closable_sections
                    ? `${day?.sections_closed ?? 0} of ${ev.closable_sections} departments filed a closing. Consumption is opening + issued − closing; without every closing the subtraction is missing a term, and issues alone are not consumption.`
                    : 'Consumption needs a closing, and none was filed.'
              }
            />
            <Ratio
              label="Labour"
              pct={labourPct}
              tone={(p) => (p > 35 ? 'text-red-700' : p > 25 ? 'text-doubt' : 'text-stone-900')}
              needs={!salesReal ? 'no sales' : 'nobody marked'}
              why={
                !salesReal
                  ? 'There is no revenue to divide into.'
                  : `No attendance was marked for this day, and ${ev.roster} people are on the roster. The wage bill is not zero; it is unrecorded.`
              }
            />
            <Ratio
              label="Prime cost"
              pct={primePct}
              tone={(p) => (p > 65 ? 'text-red-700' : p > 60 ? 'text-doubt' : 'text-stone-900')}
              needs="food or labour missing"
              why="Prime cost is food plus labour. It is stated only when both of them are, because the sum of a real number and a missing one is not a smaller number."
            />
          </div>
          {ev.no_salary > 0 && ev.marks > 0 && (
            <div className="mt-3">
              <Honesty verdict="wages understate" compact>
                {ev.no_salary} active {ev.no_salary === 1 ? 'person has' : 'people have'} no salary on record, so they
                contribute nothing to the wage bill above and the labour ratio reads lower than the truth.
              </Honesty>
            </div>
          )}
        </Card>

        <Card title="Collected for others" source="gst_service_by_day">
          {!salesReal ? (
            <Unassessed needs="no POS day fetched">Nothing was rung up, so nothing was collected.</Unassessed>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <Figure
                  label="GST"
                  value={money(day?.gst_collected)}
                  sub={day?.effective_gst_pct === null ? undefined : `${day?.effective_gst_pct}% effective`}
                />
                <Figure label="Service charge" value={money(day?.service_charge)} />
              </div>
              <p className="mt-2 text-[13px] leading-snug text-stone-500">
                Neither is revenue. GST belongs to the government and the service charge to the staff fund — they pass
                through the till and out again, and counting them as takings overstates every ratio above.
              </p>
            </>
          )}
        </Card>

        <Card title="Cash" source="day_close_ladder">
          {!day?.day_closed ? (
            <div className="space-y-2">
              <Honesty level="alarm" verdict="not closed">
                {fmtDate(date)} has no cash close. POS cash for the day was {money(day?.cash_revenue)}, and until
                somebody counts the drawer there is nothing to compare it against — a shortage belongs to the day it
                happened, and an unclosed day cannot show one.
              </Honesty>
              <Link
                href="/sales/record/close"
                className="inline-block text-sm font-semibold text-emerald-800 underline underline-offset-2"
              >
                Close a day →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Figure label="POS cash" value={money(day.cash_revenue)} />
              <Figure label="Expected" value={money(day.expected_cash)} />
              <Figure label="Counted" value={money(day.cash_counted)} />
              <Figure
                label="Difference"
                value={money(day.difference)}
                tone={paise(day.difference) === 0 ? 'text-emerald-700' : 'text-red-700'}
              />
            </div>
          )}
        </Card>

        {labour.length > 0 && (
          <Card title="Wages by department" source="labour_cost_daily">
            <ul className="divide-y divide-rule-soft">
              {labour.map((l) => (
                <li key={l.section_name ?? '—'} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="text-stone-900">
                    {l.section_name ?? 'Unassigned'}
                    <span className="ml-1.5 text-[11px] text-stone-400">
                      {l.worked_heads} worked
                      {l.absent_heads > 0 && ` · ${l.absent_heads} absent`}
                      {Number(l.extra_hours) > 0 && ` · ${l.extra_hours}h extra`}
                    </span>
                  </span>
                  <span className="font-mono tabular-nums text-stone-900">{money(l.labour_cost)}</span>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {/* THE RANGE GRAIN, one tap away. day_summary summed over a period IS
            the owner dashboard; one row of it is this page — so the list of
            days is the same view at the other grain, and every date is a
            door. Owner-only surface, so DateLink is legal here. */}
        {dates.length > 1 && (
          <Card title="Other days" source="day_summary">
            <div className="flex flex-wrap gap-x-3 gap-y-1.5">
              {dates.map((d) => (
                <DateLink
                  key={d}
                  date={d}
                  className={
                    d === date
                      ? 'font-mono text-[12px] font-semibold text-stone-900'
                      : 'font-mono text-[12px] text-stone-500'
                  }
                >
                  {d.slice(8, 10)}/{d.slice(5, 7)}
                </DateLink>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-stone-400">
              The same view a period at a time is the owner dashboard — one control, two grains.
            </p>
          </Card>
        )}
      </div>
    </>
  )
}
