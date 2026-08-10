import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { monthStartIST, todayIST } from '@/server/store-queries'
import { getSectionCosts } from '@/server/labour-queries'
import { getFoodCost } from '@/server/kitchen-queries'
import {
  getMissingCloses,
  getOwed,
  getStaffCard,
  getStockAlarms,
  getUnknownStatusCount,
  getUnmappedSummary,
  getWasteMonth,
  getYesterday,
} from '@/server/dashboard-queries'
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

function Card({
  title,
  source,
  href,
  children,
  alert,
}: {
  title: string
  source: string
  href: string
  children: React.ReactNode
  alert?: boolean
}) {
  return (
    <Link
      href={href}
      className={`${cardCls} block hover:border-emerald-400 ${alert ? 'border-red-300 bg-red-50/50' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`text-xs font-semibold uppercase tracking-wide ${alert ? 'text-red-700' : 'text-stone-500'}`}>
          {title}
        </h2>
        <span className="text-[10px] text-stone-400">{source} →</span>
      </div>
      <div className="mt-2">{children}</div>
    </Link>
  )
}

const monthLabel = (monthStart: string) =>
  new Date(`${monthStart}T00:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })

export default async function DashboardPage() {
  const restaurant = await getRestaurant()
  const user = await getSessionUser()
  const monthStart = monthStartIST()
  const today = todayIST()
  const [yesterday, sections, foodCost, owed, unmapped, waste, alarms, unknownCount, missing, staff] =
    await Promise.all([
      getYesterday(restaurant.id),
      getSectionCosts(restaurant.id, monthStart),
      getFoodCost(restaurant.id, monthStart),
      getOwed(restaurant.id),
      getUnmappedSummary(restaurant.id),
      getWasteMonth(restaurant.id, monthStart),
      getStockAlarms(restaurant.id),
      getUnknownStatusCount(restaurant.id),
      getMissingCloses(restaurant.id),
      getStaffCard(restaurant.id, today),
    ])

  const diffPaise = yesterday.difference === null ? null : decimalStringToPaise(yesterday.difference)
  const sectionRows = sections
    .filter((s) => decimalStringToPaise(s.sales) !== 0 || decimalStringToPaise(s.total_cost) !== 0)
    .slice(0, 6)
  const fcRows = foodCost.filter((f) => f.has_activity)
  const wasteTotal = decimalStringToPaise(waste.storeValue) + decimalStringToPaise(waste.kitchenValue)

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-4">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{restaurant.name}</h1>
        <p className="mt-0.5 text-sm text-stone-400">the owner’s ten questions · {monthLabel(monthStart)}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        {/* 1 — yesterday */}
        <Card title="Yesterday" source="sales_by_day · day_close_ladder" href="/books/sales">
          {yesterday.sales === null ? (
            <p className="text-sm text-stone-500">No fetch for {fmtDate(yesterday.date)} yet — fetch it under Sales.</p>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-stone-900">
                {formatMoneyString(yesterday.sales.revenue)}
              </p>
              <p className="mt-0.5 text-sm text-stone-600">
                {yesterday.sales.orders} orders · {yesterday.sales.covers} covers
              </p>
              <p className="mt-1 text-sm">
                {yesterday.difference === null ? (
                  <span className="font-medium text-amber-800">day not closed yet</span>
                ) : diffPaise === 0 ? (
                  <span className="font-medium text-emerald-700">cash squared exactly</span>
                ) : (
                  <span className="font-bold text-red-700">
                    cash difference {formatMoneyString(yesterday.difference)}
                  </span>
                )}
              </p>
            </>
          )}
        </Card>

        {/* 2 — month by section */}
        <Card title="This month by section" source="section_costs" href="/books/sections">
          {sectionRows.length === 0 ? (
            <p className="text-sm text-stone-500">Nothing earned or spent yet this month.</p>
          ) : (
            <ul className="space-y-1">
              {sectionRows.map((s) => {
                const neg = decimalStringToPaise(s.margin) < 0
                return (
                  <li key={s.section_code} className="flex items-center justify-between gap-2 text-sm tabular-nums">
                    <span className="truncate text-stone-700">{s.section_name}</span>
                    <span className="shrink-0 text-stone-500">
                      {formatMoneyString(s.sales)} − {formatMoneyString(s.total_cost)} ={' '}
                      <span className={neg ? 'font-semibold text-red-700' : 'font-semibold text-stone-900'}>
                        {formatMoneyString(s.margin)}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        {/* 3 — food cost % */}
        <Card title="Food cost % by section" source="section_food_cost" href="/books/food-cost">
          {fcRows.length === 0 ? (
            <p className="text-sm text-stone-500">No issues this month yet.</p>
          ) : (
            <ul className="space-y-1">
              {fcRows.map((f) => (
                <li key={f.section_code} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate text-stone-700">{f.section_name}</span>
                  {f.consumed_total === null ? (
                    <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      pending closing
                    </span>
                  ) : f.food_cost_pct === null ? (
                    <span className="tabular-nums text-stone-500">{formatMoneyString(f.consumed_total)} · no sales</span>
                  ) : (
                    <span
                      className={`font-bold tabular-nums ${Number(f.food_cost_pct) > 40 ? 'text-red-700' : 'text-emerald-700'}`}
                    >
                      {f.food_cost_pct}%
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 4 — owed */}
        <Card title="Owed" source="vendor_dues · owners_owed" href="/books/vendors">
          <p className="text-sm text-stone-600">
            To vendors:{' '}
            <span className="text-lg font-bold tabular-nums text-stone-900">{formatMoneyString(owed.vendorTotal)}</span>
          </p>
          {owed.vendors.map((v) => (
            <p key={v.name} className="mt-0.5 truncate text-xs tabular-nums text-stone-500">
              {v.name} · {formatMoneyString(v.balance)}
            </p>
          ))}
          {owed.owners.length > 0 && (
            <p className="mt-1.5 text-sm text-stone-600">
              To owners:{' '}
              {owed.owners.map((o) => (
                <span key={o.person} className="mr-2 font-medium tabular-nums text-amber-800">
                  {o.person} {formatMoneyString(o.balance)}
                </span>
              ))}
            </p>
          )}
        </Card>

        {/* 5 — unmapped: an ACTION card */}
        <Card
          title="Unmapped POS revenue"
          source="unmapped_pos_items"
          href="/books/sales/mapping"
          alert={unmapped.items > 0}
        >
          {unmapped.items === 0 ? (
            <p className="text-sm font-medium text-emerald-700">Everything sold is mapped. ✓</p>
          ) : (
            <>
              <p className="text-2xl font-bold tabular-nums text-red-700">{formatMoneyString(unmapped.revenue)}</p>
              <p className="mt-0.5 text-sm text-red-800">
                across {unmapped.items} POS item{unmapped.items === 1 ? '' : 's'} no dish claims —{' '}
                <span className="font-semibold underline">map them now</span>; the top rows are half the money.
              </p>
            </>
          )}
        </Card>

        {/* 6 — waste */}
        <Card title="Waste this month" source="wastage · kitchen_wastage" href="/books/store">
          <p className="text-2xl font-bold tabular-nums text-stone-900">
            {formatMoneyString(((wasteTotal) / 100).toFixed(2))}
          </p>
          <p className="mt-0.5 text-xs tabular-nums text-stone-500">
            store {formatMoneyString(waste.storeValue)} · kitchen {formatMoneyString(waste.kitchenValue)}
          </p>
          {waste.reasons.length > 0 && (
            <p className="mt-1 truncate text-xs text-stone-500">
              top: {waste.reasons.map((r) => `${r.reason} ${formatMoneyString(r.value)}`).join(' · ')}
            </p>
          )}
        </Card>

        {/* 7 — stock alarms */}
        <Card title="Stock alarms" source="stock_on_hand" href="/books/stock" alert={alarms.length > 0}>
          {alarms.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">No negative stock. ✓</p>
          ) : (
            <ul className="space-y-0.5">
              {alarms.map((a) => (
                <li key={a.code} className="text-sm font-semibold tabular-nums text-red-700">
                  {a.name}: {a.on_hand_qty} {a.purchase_unit} — a bill is probably missing
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* 8 — unknown POS statuses */}
        <Card title="Unknown POS statuses" source="sales_current" href="/books/sales" alert={unknownCount > 0}>
          {unknownCount === 0 ? (
            <p className="text-sm font-medium text-emerald-700">Zero — as it must be. ✓</p>
          ) : (
            <p className="text-lg font-bold text-red-700">
              {unknownCount} order{unknownCount === 1 ? '' : 's'} with a status this app does not know — not banked;
              look at them.
            </p>
          )}
        </Card>

        {/* 9 — days not closed */}
        <Card title="Days not closed" source="missing_closes" href="/cash" alert={missing.length > 0}>
          {missing.length === 0 ? (
            <p className="text-sm font-medium text-emerald-700">Every sales day has its close. ✓</p>
          ) : (
            <p className="text-sm font-semibold text-red-700">{missing.map((d) => fmtDate(d)).join(' · ')}</p>
          )}
        </Card>

        {/* 10 — staff */}
        <Card title="Staff" source="staff · attendance_current" href="/attendance">
          <p className="text-sm text-stone-600">
            {staff.activeStaff} active ·{' '}
            {staff.unassigned > 0 ? (
              <span className="font-semibold text-red-700">{staff.unassigned} without a section</span>
            ) : (
              <span className="text-emerald-700">all assigned</span>
            )}
          </p>
          <p className="mt-1 text-sm">
            {staff.markedToday >= staff.markable && staff.markable > 0 ? (
              <span className="font-medium text-emerald-700">today’s attendance done ✓</span>
            ) : (
              <span className="font-medium text-amber-800">
                attendance today: {staff.markedToday} / {staff.markable} marked
              </span>
            )}
          </p>
        </Card>
      </div>

      {user?.role === 'owner' && (
        <Link
          href="/pnl"
          className="mt-3 flex items-center justify-between rounded-2xl border border-emerald-700 bg-emerald-700 p-4 text-white shadow-sm hover:bg-emerald-800"
        >
          <span className="text-[15px] font-semibold">P&amp;L — the month, added up</span>
          <span>→</span>
        </Link>
      )}

      <p className="mt-4 text-xs text-stone-400">
        Every card reads a named view and clicks through to its source — no chart lives here for its own sake.
      </p>
    </main>
  )
}
