// Every pre-Phase-A URL still resolves. Phones have these bookmarked and
// WhatsApp threads are full of them, so they redirect permanently into the
// caller's own group rather than 404ing. Two of them are role-aware: stock
// and sections are mounted in two groups, and /books itself means "my books".
import { canAccess, type Role } from '@/lib/roles'

const FIXED: [from: string, to: string][] = [
  ['/books/sales/mapping', '/sales/books/sales/mapping'],
  ['/books/food-cost', '/kitchen/books/food-cost'],
  ['/books/snapshots', '/owner/snapshots'],
  ['/books/recipes', '/kitchen/recipes'],
  ['/books/vendors', '/store/masters/vendors'],
  ['/books/wastage', '/store/books/wastage'],
  ['/books/issues', '/store/books/issues'],
  // Chained through the restructure: /store/count is itself retired now, and a
  // retired URL must land on a LIVE route, never on a second redirect.
  ['/books/counts', '/store/stock/count'],
  ['/books/items', '/store/masters/items'],
  ['/books/bills', '/store/books/bills'],
  ['/books/store', '/store/books/log'],
  ['/books/staff', '/staff/people/employees'],
  ['/books/users', '/owner/users'],
  ['/books/sales', '/sales/books/sales'],
  ['/books/cash', '/sales/books/cash'],
  ['/store/payment', '/store/receive/pay'],
  ['/cash/other-income', '/sales/record/income'],
  ['/cash/non-revenue', '/sales/record/nonrevenue'],
  ['/cash/settlements', '/sales/partners'],
  ['/sales/settlements', '/sales/partners'],
  ['/cash/vouchers', '/sales/record/voucher'],
  ['/cash/off-book', '/sales/record/offbook'],
  ['/cash/fetch', '/sales/books/fetch'],
  ['/cash/dues', '/sales/record/due'],
  ['/kitchen/closing', '/kitchen/shift/closing'],
  ['/kitchen/shift/production', '/kitchen/production'],
  ['/kitchen/wastage', '/kitchen/shift/loss'],
  ['/kitchen/loss', '/kitchen/shift/loss'],
  ['/attendance', '/staff/people/attendance'],
  // Expenses left the staff group for Accounts → Payments: rent and power are
  // overheads, a different P&L line from wages. Retargeted rather than left to
  // chain — a retired URL must land on a LIVE route, never on a second redirect.
  ['/expenses', '/accounts/payments/expense'],
  ['/dashboard', '/owner'],
  ['/settings', '/owner/settings'],
  ['/pnl', '/owner/pnl'],
  ['/bill', '/store/receive/purchase'],
  ['/issue', '/store/issue'],
  ['/wastage', '/store/stock/loss'],
  // /cash WAS the day close, and the day close now lives inside Record.
  ['/cash', '/sales/close'],
  // REGROUPING: a group is a SUBJECT, not a person. Two moves, two bookmarks
  // that still land somewhere true.
  //
  // /staff/people is NOT here, and must not be. Its target would live UNDER
  // it, and this matcher rewrites a prefix by APPENDING the remainder — so
  // /staff/people → /staff/people/employees would send the live
  // /staff/people/employees to /staff/people/employees/employees. It stays a
  // real route instead, rendering Employees the way it always did.
  ['/staff/money-out/expense', '/accounts/payments/expense'],
  ['/sales/record/close', '/sales/close'],
  // Simplification pass: two tabs folded and two duplicate mounts dropped.
  // Phones have these bookmarked, so they still land somewhere true.
  ['/accounts/tax', '/accounts/registers/tax'],
  ['/accounts/export', '/accounts/registers/purchase'],
  ['/staff/books/sections', '/kitchen/books/sections'],
  ['/staff/books', '/kitchen/books/sections'],
  // STORE RESTRUCTURE: eight tabs to six. Reorder, Count and Loss stopped
  // being top-level tabs and became views inside Stock, and Stock came out of
  // Books to be a tab of its own. Every old URL still lands on the right
  // VIEW, not merely the right tab — a bookmark that opens the wrong screen
  // is barely better than a 404.
  ['/store/reorder', '/store/stock/reorder'],
  ['/store/count', '/store/stock/count'],
  ['/store/loss', '/store/stock/loss'],
  ['/store/books/stock', '/store/stock'],
]

/** The Phase-A home of a retired URL, for this role. Null when nothing maps. */
export function legacyTarget(pathname: string, role: Role): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/'

  // role-aware: mounted in more than one group
  if (clean === '/books/stock' || clean.startsWith('/books/stock/')) {
    return canAccess(role, '/store/stock') ? '/store/stock' : '/kitchen/books/stock'
  }
  if (clean === '/books/sections' || clean.startsWith('/books/sections/')) {
    return canAccess(role, '/kitchen/books/sections') ? '/kitchen/books/sections' : '/staff/books/sections'
  }
  if (clean === '/books') {
    for (const g of ['/store/books', '/kitchen/books', '/sales/books', '/staff/books']) {
      if (canAccess(role, g)) return g
    }
    return '/'
  }

  for (const [from, to] of FIXED) {
    if (clean === from) return to
    if (clean.startsWith(`${from}/`)) return to + clean.slice(from.length)
  }
  return null
}

export const LEGACY_PREFIXES = ['/staff/money-out/expense', '/sales/record/close', '/store/reorder', '/store/count', '/store/loss', '/store/books/stock', '/books', '/bill', '/issue', '/wastage', '/cash', '/attendance', '/expenses', '/dashboard', '/pnl', '/settings', '/store/payment']
