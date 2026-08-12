// LAW 2 — lists, not free text.
//
// NOT here: partners. They were a list_options key once, and a list can hold
// a name and nothing else. A partner carries `kind` and, load-bearing,
// `agreed_commission_pct` — the number the settlement-gap card compares their
// actual deduction against. So partners are a MASTER TABLE with their own
// screen (Sales → Partners), and the settlement form reads that. Adding
// partner names here would build a second, silent vocabulary that the gap
// card cannot join to. Every categorical field reads from
// list_options; free text survives only in notes and descriptions. These
// are the managed keys (seeded by migration groups_indents_production_
// lists_pnl); the Lists screen edits their values — add, reorder, retire,
// never delete.

export type ListKey =
  | 'waste_reason'
  | 'voucher_category'
  | 'payment_mode'
  | 'other_income_item'
  | 'non_revenue_reason'
  | 'expense_category'
  | 'return_reason'
  | 'settlement_deduction'
  | 'session'
  | 'adjustment_reason'

export const LIST_KEYS: { key: ListKey; name: string; usedBy: string }[] = [
  { key: 'waste_reason', name: 'Wastage reasons', usedBy: 'store wastage · kitchen wastage' },
  { key: 'voucher_category', name: 'Voucher categories', usedBy: 'cash vouchers' },
  { key: 'payment_mode', name: 'Payment modes', usedBy: 'vendor payments · off-book · expenses' },
  { key: 'other_income_item', name: 'Other income items', usedBy: 'other income (oil, scrap…)' },
  { key: 'non_revenue_reason', name: 'Non-revenue reasons', usedBy: 'giveaways / staff meals' },
  { key: 'expense_category', name: 'Expense categories', usedBy: 'expenses' },
  { key: 'return_reason', name: 'Return reasons', usedBy: 'stock coming back from a section' },
  { key: 'settlement_deduction', name: 'Settlement deductions', usedBy: 'itemised deductions on a settlement' },
  { key: 'session', name: 'Sessions', usedBy: 'indents and issues — Morning, Evening, Extra, Catering' },
  {
    key: 'adjustment_reason',
    name: 'Adjustment reasons',
    usedBy: 'corrections to the book — accepted counts, opening stock',
  },
]

export const ALL_LIST_KEYS: ListKey[] = LIST_KEYS.map((k) => k.key)

/** A value somebody typed that was not on the list yet. It is ALREADY
 *  saved on the event that used it — this row is the owner's queue, not a
 *  gate the entry had to pass. */
export type ListSuggestionRow = {
  id: string
  list_key: string
  value: string
  suggested_by: string | null
  /** how many times somebody has typed it — the strongest signal it is real */
  seen_count: number
  status: string
  created_at: string
  /** for expense categories only: controllable | occupancy, once decided */
  expense_kind: string | null
}

export type ListOptionRow = {
  id: string
  list_key: string
  value: string
  sort_order: number
  status: 'active' | 'inactive'
}
