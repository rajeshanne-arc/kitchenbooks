// The honesty strip — the thing this app is remembered by.
//
// Every number in KitchenBooks that rests on data which has not all arrived
// says so, in the same voice, in the same shape, everywhere: a hatched cream
// band (hatching is how a drawing says "provisional"), a micro-caps verdict,
// one plain sentence, and — where the gap is countable — a meter made of
// literal spreadsheet cells: filled ones are the truth that is in, blank ones
// are the truth still owed.
//
// The rule this component exists to keep: a screen may say "pending closing"
// or it may say a number, never a confident wrong number. If you find
// yourself computing a figure to fill a gap, use this instead.

import Link from 'next/link'

export type HonestyLevel = 'pending' | 'alarm'

const TONE = {
  pending: {
    band: 'hatch border-amber-300',
    verdict: 'text-amber-800',
    body: 'text-amber-900',
    action: 'text-amber-800 hover:text-amber-900',
    mark: 'hatch border-amber-400',
  },
  alarm: {
    band: 'hatch-alarm border-red-300',
    verdict: 'text-red-800',
    body: 'text-red-900',
    action: 'text-red-800 hover:text-red-900',
    mark: 'hatch-alarm border-red-400',
  },
} as const

/** A cell awaiting entry — the emblem of the whole idea, at 11px. */
function CellMark({ level }: { level: HonestyLevel }) {
  return <span aria-hidden className={`h-[11px] w-[11px] shrink-0 rounded-[2px] border ${TONE[level].mark}`} />
}

/**
 * How much of the truth is in. Caps at twelve cells so a forty-item gap still
 * fits a phone; past that the cells are proportional and the count beside them
 * stays exact.
 */
export function Meter({
  filled,
  total,
  unit,
  level = 'pending',
}: {
  filled: number
  total: number
  unit: string
  level?: HonestyLevel
}) {
  if (total <= 0) return null
  const cells = Math.min(total, 12)
  const lit = Math.round((Math.max(0, Math.min(filled, total)) / total) * cells)
  return (
    <span className="flex items-center gap-[3px]" role="img" aria-label={`${filled} of ${total} ${unit}`}>
      {Array.from({ length: cells }, (_, i) => (
        <span
          key={i}
          aria-hidden
          style={{ animationDelay: `${i * 40}ms` }}
          className={`cell-in h-[10px] w-[10px] rounded-[1.5px] border ${
            i < lit ? 'border-emerald-800 bg-emerald-700' : 'border-amber-400 bg-white'
          }`}
        />
      ))}
      <span className={`ml-1.5 font-mono text-[11px] tabular-nums ${TONE[level].verdict}`}>
        {filled}/{total}
      </span>
    </span>
  )
}

/**
 * The strip. `verdict` is the micro-caps word — keep it to one or two: what
 * kind of doubt this is. `children` is the sentence, in the interface's voice,
 * saying what is missing and what it costs the reader.
 */
export default function Honesty({
  level = 'pending',
  verdict,
  meter,
  action,
  compact = false,
  children,
}: {
  level?: HonestyLevel
  verdict: string
  meter?: { filled: number; total: number; unit: string }
  action?: { href: string; label: string }
  compact?: boolean
  children: React.ReactNode
}) {
  const tone = TONE[level]
  return (
    <div
      role="note"
      className={`rounded-xl border ${tone.band} ${compact ? 'px-2.5 py-2' : 'px-3.5 py-3'}`}
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <CellMark level={level} />
        <span className={`font-display text-[10.5px] font-semibold uppercase tracking-[0.12em] ${tone.verdict}`}>
          {verdict}
        </span>
        {meter !== undefined && (
          <span className="ml-auto shrink-0">
            <Meter {...meter} level={level} />
          </span>
        )}
      </div>
      <p className={`mt-1.5 text-[13px] leading-snug ${tone.body}`}>{children}</p>
      {action !== undefined && (
        <Link
          href={action.href}
          className={`mt-1.5 inline-block text-[13px] font-semibold underline underline-offset-2 ${tone.action}`}
        >
          {action.label} →
        </Link>
      )}
    </div>
  )
}

/**
 * The strip's inline sibling, for a row in a list where a whole band would
 * shout. Same hatch, same ink.
 */
export function HonestyPill({
  level = 'pending',
  children,
}: {
  level?: HonestyLevel
  children: React.ReactNode
}) {
  const tone = TONE[level]
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone.band} ${tone.verdict}`}
    >
      <CellMark level={level} />
      {children}
    </span>
  )
}

/**
 * A figure that is standing on incomplete ground, hatched underneath, so the
 * doubt survives even when the sentence is scrolled off. Always pair it with a
 * strip or a pill that says what is missing — the hatch alone is a hint, not
 * an explanation.
 */
export function Doubted({
  level = 'pending',
  title,
  children,
}: {
  level?: HonestyLevel
  title: string
  children: React.ReactNode
}) {
  return (
    <span className={level === 'alarm' ? 'doubted-alarm' : 'doubted'} title={title}>
      {children}
    </span>
  )
}
