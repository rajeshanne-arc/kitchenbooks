// What a query can be ABOUT. A KEY REGISTRY, like tabs.ts — structural, not
// a business list, so it lives in code and a settings row can never invent
// one. (LAW 2 governs categorical BUSINESS values; these are the app's own
// tables, and a made-up key here would point a question at nothing.)
//
// `entity_id` is nullable on purpose: an accountant's question is often
// about a DAY or a whole category rather than one row — "why is Tuesday's
// cash short?" is a real query with no single record behind it.

import type { Role } from '@/lib/roles'

export type QueryEntity = {
  key: string
  label: string
  /** who is usually asked about this — the default, always overridable */
  role: Role
}

export const QUERY_ENTITIES: QueryEntity[] = [
  { key: 'purchase', label: 'A purchase bill', role: 'store' },
  { key: 'payment', label: 'A vendor payment', role: 'store' },
  { key: 'issue', label: 'An issue to a department', role: 'store' },
  { key: 'wastage', label: 'A store loss', role: 'store' },
  { key: 'stock_count', label: 'A stock count', role: 'store' },
  { key: 'cash_voucher', label: 'A cash voucher', role: 'cashier' },
  { key: 'other_income', label: 'Other income', role: 'cashier' },
  { key: 'day_close', label: 'A day close', role: 'cashier' },
  { key: 'off_book_order', label: 'An off-book order', role: 'cashier' },
  { key: 'settlement', label: 'A partner settlement', role: 'cashier' },
  { key: 'sales', label: 'A day of sales', role: 'cashier' },
  { key: 'kitchen_closing', label: 'A kitchen closing', role: 'chef' },
  { key: 'kitchen_wastage', label: 'A kitchen loss', role: 'chef' },
  { key: 'production', label: 'A production batch', role: 'chef' },
  { key: 'expense', label: 'An expense', role: 'manager' },
  { key: 'contract_bill', label: 'A contract bill', role: 'manager' },
  { key: 'casual_labour', label: 'Casual labour', role: 'manager' },
  { key: 'attendance', label: 'Attendance', role: 'manager' },
  { key: 'day', label: 'A whole day', role: 'manager' },
  { key: 'general', label: 'Something else', role: 'owner' },
]

const BY_KEY = new Map(QUERY_ENTITIES.map((e) => [e.key, e]))

export const isQueryEntity = (key: string): boolean => BY_KEY.has(key)

/** An unknown key still renders — as itself. A query raised against a kind
 *  this build does not know about is still a question someone must answer;
 *  hiding it would lose it. */
export const entityLabel = (key: string): string => BY_KEY.get(key)?.label ?? key

export const entityDefaultRole = (key: string): Role => BY_KEY.get(key)?.role ?? 'manager'

/** Who a query may be assigned to. NOT the accountant: they raise questions,
 *  they do not answer them — that is the whole shape of the loop. Mirrors the
 *  CHECK constraint on queries.assigned_role. */
export const ASSIGNABLE_ROLES: Role[] = ['store', 'cashier', 'chef', 'manager', 'owner']
