'use client'

// The dashboard's charts. Four forms, each chosen by the job the data does —
// there is deliberately no generic <Chart> that takes a `type` prop, because
// picking the form IS the design decision and hiding it behind a string is how
// dashboards end up with a pie of two slices.
//
// COLOUR. Every value is a CSS custom property from globals.css — the app has
// no second palette for charts, and a literal hex here would be a bug the
// smoke gate catches. The legend still means what it means: emerald is the
// worked-out figure, gold is doubt, red is wrong or missing.
//
// RED AND GREEN CANNOT CARRY MEANING ALONE. Measured with the palette
// validator, emerald-700 against red-600 separates by ΔE 4.2 under deuteranopia
// — indistinguishable. The palette is Rajesh's sheet and does not change, so
// every diverging chart here encodes the same fact THREE ways: which side of
// the zero baseline the bar sits on, the sign printed in the label, and the
// colour last. A reader who sees no colour at all still reads it correctly.
//
// Grid and axes are solid hairlines one shade off the surface; text wears text
// tokens, never the series colour; no chart has two y-scales.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatPaise } from '@/lib/money'
import { fmtDate } from '@/lib/format'

const INK = 'var(--color-stone-500)'
const RULE = 'var(--color-stone-200)'
const GREEN = 'var(--color-emerald-700)'
const RED = 'var(--color-red-600)'
const GOLD = 'var(--color-amber-400)'
const SURFACE = 'var(--color-cell)'

const axisTick = { fill: INK, fontSize: 11 }

/** Rupee axis ticks: compact so they never collide, full precision in tooltips. */
const rupeeTick = (v: number) => {
  const abs = Math.abs(v)
  if (abs >= 1e7) return `₹${(v / 1e7).toFixed(abs >= 1e8 ? 0 : 1)}Cr`
  if (abs >= 1e5) return `₹${(v / 1e5).toFixed(abs >= 1e6 ? 0 : 1)}L`
  if (abs >= 1000) return `₹${Math.round(v / 1000)}k`
  return `₹${Math.round(v)}`
}

const rupees = (v: number) => formatPaise(Math.round(v * 100))

// Recharts hands label formatters a RenderableText, so these take the widest
// type and coerce — the data behind them is always numeric.
const labelMoney = (v: unknown) => rupees(Number(v))
const labelSignedMoney = (v: unknown) => {
  const n = Number(v)
  return `${n > 0 ? '+' : ''}${rupees(n)}`
}
const labelPct = (v: unknown) => `${Number(v)}%`

function TipBox({ title, rows }: { title: string; rows: { label: string; value: string }[] }) {
  return (
    <div className="rounded-lg border border-rule bg-cell px-2.5 py-2 text-xs shadow-sm">
      <p className="font-medium text-stone-900">{title}</p>
      {rows.map((r) => (
        <p key={r.label} className="mt-0.5 text-stone-600">
          {r.label} <span className="font-mono tabular-nums text-stone-900">{r.value}</span>
        </p>
      ))}
    </div>
  )
}

/* ─────────────────────────── the sales line ─────────────────────────────
   Trend over time, one series — so one hue and no legend box; the card
   title names it. Days with no fetch are absent from the data, and the line
   simply does not travel through them. */

export function SalesLine({ points }: { points: { date: string; revenue: string; orders: number }[] }) {
  const data = points.map((p) => ({ date: p.date, revenue: Number(p.revenue), orders: p.orders }))
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="date"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: RULE }}
            tickFormatter={(d: string) => d.slice(8, 10)}
            minTickGap={14}
          />
          <YAxis
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={52}
            tickFormatter={rupeeTick}
          />
          <Tooltip
            cursor={{ stroke: RULE, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { date: string; revenue: number; orders: number }
              return (
                <TipBox
                  title={fmtDate(p.date)}
                  rows={[
                    { label: 'revenue', value: rupees(p.revenue) },
                    { label: 'orders', value: String(p.orders) },
                  ]}
                />
              )
            }}
          />
          <Line
            type="monotone"
            dataKey="revenue"
            stroke={GREEN}
            strokeWidth={2}
            dot={{ r: 3, fill: GREEN, stroke: SURFACE, strokeWidth: 2 }}
            activeDot={{ r: 5, fill: GREEN, stroke: SURFACE, strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ────────────────────────── diverging bars ──────────────────────────────
   Above/below a baseline — margin per section, gap per partner. The zero
   line is drawn solid and darker than the grid because it is the thing the
   reader compares against, and the bar's SIDE is the primary encoding. */

export function DivergingBars({
  rows,
  height = 176,
}: {
  rows: { label: string; value: number }[]
  height?: number
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeWidth={1} horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={rupeeTick} />
          <YAxis
            type="category"
            dataKey="label"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            width={92}
          />
          <ReferenceLine x={0} stroke={INK} strokeWidth={1} />
          <Tooltip
            cursor={{ fill: 'var(--color-stone-50)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { label: string; value: number }
              return <TipBox title={p.label} rows={[{ label: '', value: rupees(p.value) }]} />
            }}
          />
          <Bar
            dataKey="value"
            radius={[4, 4, 4, 4]}
            barSize={14}
            isAnimationActive={false}
            // the sign is printed beside every bar — colour is the third
            // encoding, never the only one
            label={{ position: 'right', formatter: labelSignedMoney, fill: INK, fontSize: 11 }}
          >
            {rows.map((r) => (
              <Cell key={r.label} fill={r.value < 0 ? RED : GREEN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ─────────────────────────── magnitude bars ─────────────────────────────
   Compare magnitude, one series, no natural order beyond size — one hue for
   every bar. Colouring each bar darker-where-bigger would double-encode the
   length the chart already shows. */

export function MagnitudeBars({
  rows,
  height = 168,
}: {
  rows: { label: string; value: number }[]
  height?: number
}) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 56, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeWidth={1} horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={rupeeTick} />
          <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={104} />
          <Tooltip
            cursor={{ fill: 'var(--color-stone-50)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { label: string; value: number }
              return <TipBox title={p.label} rows={[{ label: '', value: rupees(p.value) }]} />
            }}
          />
          <Bar
            dataKey="value"
            fill={GREEN}
            radius={[0, 4, 4, 0]}
            barSize={14}
            isAnimationActive={false}
            label={{ position: 'right', formatter: labelMoney, fill: INK, fontSize: 11 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ───────────────────────── food cost against target ─────────────────────
   A ratio against a limit. One series plus a reference line: bars past the
   target turn red AND sit visibly past the rule, so the rule does the work
   colour cannot do for a red-green reader. */

export function TargetBars({ rows, target }: { rows: { label: string; pct: number }[]; target: number }) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 44, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeWidth={1} horizontal={false} />
          <XAxis
            type="number"
            tick={axisTick}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `${v}%`}
          />
          <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={92} />
          <ReferenceLine
            x={target}
            stroke={GOLD}
            strokeWidth={2}
            label={{ value: `target ${target}%`, position: 'top', fill: INK, fontSize: 10 }}
          />
          <Tooltip
            cursor={{ fill: 'var(--color-stone-50)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { label: string; pct: number }
              return <TipBox title={p.label} rows={[{ label: 'food cost', value: `${p.pct}%` }]} />
            }}
          />
          <Bar
            dataKey="pct"
            radius={[0, 4, 4, 0]}
            barSize={14}
            isAnimationActive={false}
            label={{ position: 'right', formatter: labelPct, fill: INK, fontSize: 11 }}
          >
            {rows.map((r) => (
              <Cell key={r.label} fill={r.pct > target ? RED : GREEN} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/* ──────────────────── billed against claimed, two series ────────────────
   The only two-series chart on the page. Emerald (what we billed) against
   gold (what they admit to) separates by ΔE 23.8 under protanopia, which
   passes; gold's contrast against white does not, so both series are
   direct-labelled and the numbers repeat as text under the chart. */

export function BilledVsClaimed({ rows }: { rows: { label: string; billed: number; claimed: number }[] }) {
  return (
    <div className="w-full" style={{ height: Math.max(120, rows.length * 54 + 40) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 60, bottom: 0, left: 0 }} barGap={2}>
          <CartesianGrid stroke={RULE} strokeWidth={1} horizontal={false} />
          <XAxis type="number" tick={axisTick} tickLine={false} axisLine={false} tickFormatter={rupeeTick} />
          <YAxis type="category" dataKey="label" tick={axisTick} tickLine={false} axisLine={false} width={92} />
          <Tooltip
            cursor={{ fill: 'var(--color-stone-50)' }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { label: string; billed: number; claimed: number }
              return (
                <TipBox
                  title={p.label}
                  rows={[
                    { label: 'we billed', value: rupees(p.billed) },
                    { label: 'they claim', value: rupees(p.claimed) },
                    { label: 'gap', value: rupees(p.billed - p.claimed) },
                  ]}
                />
              )
            }}
          />
          <Bar
            dataKey="billed"
            fill={GREEN}
            radius={[0, 4, 4, 0]}
            barSize={12}
            isAnimationActive={false}
            label={{ position: 'right', formatter: labelMoney, fill: INK, fontSize: 10 }}
          />
          <Bar
            dataKey="claimed"
            fill={GOLD}
            radius={[0, 4, 4, 0]}
            barSize={12}
            isAnimationActive={false}
            label={{ position: 'right', formatter: labelMoney, fill: INK, fontSize: 10 }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** The legend for the one chart that has two series. Identity is never
 * carried by colour alone — the swatch sits beside its words. */
export function TwoSeriesLegend() {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-stone-600">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GREEN }} aria-hidden />
        we billed
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-sm" style={{ background: GOLD }} aria-hidden />
        they claim
      </span>
    </div>
  )
}
