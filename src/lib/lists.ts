// LAW 2 — lists, not free text. Every categorical field reads from
// list_options; free text survives only in notes and descriptions. These
// are the managed keys (seeded by migration groups_indents_production_
// lists_pnl); the Lists screen edits their values — add, reorder, retire,
// never delete.

export type ListKey =
  | 'waste_reason'
  | 'voucher_category'
  | 'payment_mode'
  | 'other_income_item'
  | 'partner'
  | 'non_revenue_reason'
  | 'expense_category'

export const LIST_KEYS: { key: ListKey; name: string; usedBy: string }[] = [
  { key: 'waste_reason', name: 'Wastage reasons', usedBy: 'store wastage · kitchen wastage' },
  { key: 'voucher_category', name: 'Voucher categories', usedBy: 'cash vouchers' },
  { key: 'payment_mode', name: 'Payment modes', usedBy: 'vendor payments · off-book · expenses' },
  { key: 'other_income_item', name: 'Other income items', usedBy: 'other income (oil, scrap…)' },
  { key: 'partner', name: 'Partners', usedBy: 'settlements (Swiggy, Zomato…)' },
  { key: 'non_revenue_reason', name: 'Non-revenue reasons', usedBy: 'giveaways / staff meals' },
  { key: 'expense_category', name: 'Expense categories', usedBy: 'expenses' },
]

export const ALL_LIST_KEYS: ListKey[] = LIST_KEYS.map((k) => k.key)

export type ListOptionRow = {
  id: string
  list_key: string
  value: string
  sort_order: number
  status: 'active' | 'inactive'
}
