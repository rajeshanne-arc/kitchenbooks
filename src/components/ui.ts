// The shared vocabulary. One sheet, one set of cells: change a class here and
// every screen changes with it. The colour legend lives in app/globals.css —
// cream is where you type, white is what the app worked out, grey is locked.

/** base input without a width — pair with w-full or a fixed width at the call site */
export const numCls =
  'rounded-lg border border-amber-300 bg-field px-3 py-2 text-[15px] text-stone-900 placeholder:text-stone-400 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25'

export const inputCls = `w-full ${numCls}`

export const selectCls =
  'w-full rounded-lg border border-amber-300 bg-field px-2.5 py-2 text-[15px] text-stone-900 focus:border-emerald-700 focus:outline-none focus:ring-2 focus:ring-emerald-700/25'

/** a cell the app worked out — white, hairline-ruled, no drop shadow (a sheet has none) */
export const cardCls = 'rounded-2xl border border-rule bg-cell p-4 sm:p-5'

export const fieldLabelCls = 'mb-1 block text-xs font-medium text-stone-500'

export const sectionHeadCls =
  'font-display text-[11px] font-semibold uppercase tracking-[0.09em] text-stone-500'

/** page furniture */
export const pageTitleCls =
  'font-display text-[26px] font-bold leading-none tracking-[-0.02em] text-stone-900'

export const pageSubCls = 'mt-1.5 text-sm text-stone-500'

/** money and counts: mono in columns so the rupees line up, display face when a
 *  figure is the whole point of the screen */
export const moneyCls = 'font-mono tabular-nums'

/** Colour is deliberately NOT baked in — a hero figure is black, red or green
 *  depending on what it says, and appending a second text-* class would be a
 *  coin flip on stylesheet order. Always pass one. */
export const heroNumCls = 'font-display font-bold tabular-nums tracking-[-0.02em]'

/** the codes are the spine of the product — V-PLT-01, CH-001, E014 */
export const codeCls =
  'rounded bg-stone-100 px-1.5 py-0.5 font-mono text-[11px] font-medium tracking-tight text-stone-600'

/** a document number — PAY-2627-0018. Quieter than a master code because it
 *  is a reference, not an identity: nobody names a vendor by it, but every
 *  question an accountant asks starts with one. */
export const docNoCls = 'font-mono text-[11px] tabular-nums tracking-tight text-stone-400'

/** actions. 44px minimum, always says what it does. */
export const btnCls =
  'rounded-xl bg-emerald-700 px-4 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-emerald-800 active:bg-emerald-900 disabled:cursor-not-allowed disabled:bg-stone-200 disabled:text-stone-500'

export const btnGhostCls =
  'rounded-xl border border-rule bg-cell px-4 py-2.5 text-[15px] font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50'

/** table furniture — a header band and true hairline gridlines */
export const theadCls =
  'bg-stone-100 font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500'

export const gridRowsCls = 'divide-y divide-rule-soft'

/* ── data tables ────────────────────────────────────────────────────────
   A column drifts when the header and the body are styled in two places
   with two sets of padding. These pair up: thCls with tdCls, thNumCls with
   tdNumCls, same horizontal padding on both, so a heading always sits over
   its own column. Numbers are right-aligned and tabular-figured so the
   rupees and the decimal points line up down the column; words are left.
   Row height is fixed rather than content-derived, so a row with a wrapped
   note does not stand taller than its neighbours. */

export const dataTableCls = 'w-full border-collapse text-sm'

/** header cell — words */
export const thCls =
  'border-b border-rule px-3 py-2 text-left align-bottom font-display text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500'

/** header cell — numbers. Right-aligned to sit over its column's digits. */
export const thNumCls = `${thCls} text-right`

/** body cell — words */
export const tdCls = 'border-b border-rule-soft px-3 py-2 align-middle text-stone-900'

/** body cell — numbers: mono, tabular, right-aligned */
export const tdNumCls = `${tdCls} text-right font-mono tabular-nums`

/** body cell — a code (V-PLT-01, CH-001, E014): mono, left, muted */
export const tdCodeCls = `${tdCls} font-mono text-[12px] text-stone-500`

/** put on <tr> so every row is the same height regardless of its content */
export const trCls = 'h-11 hover:bg-stone-50'
