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

// THREE CATEGORICAL HUES, chosen by the validator rather than by eye.
//
// wages / contract / casual are IDENTITIES, not states, so none of them may
// wear a status colour — red would read as "wrong" and gold as "doubt".
// Measured on this palette (emerald-700 · sky-300 · violet-700): CVD
// separation ΔE 25.3 protan, 25.5 tritan; normal vision ΔE 27.1. Both well
// clear of the 8 and 15 floors.
//
// TWO CHECKS THIS PALETTE CANNOT PASS, and they are structural rather than a
// bad pick: every hue in Rajesh's sheet is deliberately muted, so all three
// fail the validator's chroma floor ("reads gray") — no combination of the
// app's tokens passes it, and the palette is the sheet and does not change.
// And sky-300 sits at 2.32:1 against the surface, below 3:1, which OBLIGATES
// visible labels. So every slice is DIRECT-LABELLED and the figures are
// repeated as a table beside the ring: the colour is the last thing carrying
// identity here, never the only one.
const CAT = ['var(--color-emerald-700)', 'var(--color-sky-300)', 'var(--color-violet-700)']

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

/* ────────────────────────── the trading day ─────────────────────────────
   Revenue by hour of the BUSINESS day, which is why the axis runs from the
   cutover rather than from midnight. Two services show up as two humps and
   that shape is the point — a restaurant with one peak and a restaurant with
   two are run differently. */

export function HourlyLine({ points }: { points: { hour: number; revenue: string; orders: number }[] }) {
  const data = points.map((p) => ({ hour: p.hour, revenue: Number(p.revenue), orders: p.orders }))
  const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={RULE} strokeWidth={1} vertical={false} />
          <XAxis
            dataKey="hour"
            tick={axisTick}
            tickLine={false}
            axisLine={{ stroke: RULE }}
            tickFormatter={hourLabel}
            minTickGap={10}
          />
          <YAxis tick={axisTick} tickLine={false} axisLine={false} width={52} tickFormatter={rupeeTick} />
          <Tooltip
            cursor={{ stroke: RULE, strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as { hour: number; revenue: number; orders: number }
              return (
                <TipBox
                  title={`${hourLabel(p.hour)}–${hourLabel((p.hour + 1) % 24)}`}
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
            dot={{ r: 2.5, fill: GREEN, stroke: SURFACE, strokeWidth: 1.5 }}
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

/* ────────────────────────── the labour split ────────────────────────────
   PART TO WHOLE, three slices — the one shape a ring is genuinely good at,
   and the reason there is no generic <Chart type="pie"> to reach for.

   A RING, not a pie: the hole holds the total, which is the figure a manager
   actually reads first, and it stops the eye trying to compare slice areas.
   Segments are separated by a surface-coloured gap, so the boundary survives
   even if the colours do not. */

export function LabourSplit({
  parts,
}: {
  parts: { label: string; value: number }[]
}) {
  const total = parts.reduce((n, p) => n + p.value, 0)
  if (total <= 0) return null
  const R = 54
  const C = 2 * Math.PI * R
  // A PREFIX SUM, not a counter mutated inside map — the offset of a segment
  // is the sum of every fraction before it, which is a property of the data
  // rather than of the order the renderer happens to walk it in.
  const arcs = parts.map((p, i) => {
    const frac = p.value / total
    const before = parts.slice(0, i).reduce((n, q) => n + q.value, 0) / total
    return { ...p, frac, colour: CAT[i % CAT.length], dash: frac * C, offset: before * C }
  })
  return (
    <div className="flex flex-wrap items-center gap-5">
      <svg viewBox="0 0 140 140" className="h-[140px] w-[140px] shrink-0" role="img" aria-label="Labour split">
        <g transform="rotate(-90 70 70)">
          {arcs.map((a) => (
            <circle
              key={a.label}
              cx="70"
              cy="70"
              r={R}
              fill="none"
              stroke={a.colour}
              strokeWidth="18"
              /* a 2px surface gap between segments — the separator that does
                 not depend on telling two muted hues apart */
              strokeDasharray={`${Math.max(a.dash - 2, 0)} ${C - Math.max(a.dash - 2, 0)}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </g>
        <text x="70" y="66" textAnchor="middle" className="fill-stone-500 text-[9px] uppercase tracking-wide">
          total
        </text>
        <text x="70" y="82" textAnchor="middle" className="fill-stone-900 text-[13px] font-semibold tabular-nums">
          {rupees(total)}
        </text>
      </svg>
      {/* THE TABLE IS NOT DECORATION. sky-300 falls below 3:1 against the
          surface, and the validator's contrast warning obligates visible
          labels or a table view — it is not dismissable. */}
      <ul className="min-w-[11rem] flex-1 space-y-1.5">
        {arcs.map((a) => (
          <li key={a.label} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ background: a.colour }}
              />
              <span className="truncate text-stone-700">{a.label}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="font-mono tabular-nums text-stone-900">{rupees(a.value)}</span>
              <span className="ml-1.5 font-mono text-[11px] tabular-nums text-stone-500">
                {Math.round(a.frac * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
