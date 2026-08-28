// Every pre-Phase-A URL still resolves. Phones have these bookmarked and
// WhatsApp threads are full of them, so they redirect permanently into the
// caller's own group rather than 404ing. Two of them are role-aware: stock
// and sections are mounted in two groups, and /books itself means "my books".
import { canAccess, type Role } from '@/lib/roles'

const FIXED: [from: string, to: string][] = [
  ['/books/sales/mapping', '/sales/books/sales/mapping'],
  ['/books/food-cost', '/kitchen/books/food-cost'],
  // Approvals was a Setup chip for one commit before it earned a tab of its
  // own. Short-lived, but a bookmark does not care how long a URL existed.
  ['/owner/setup/approvals', '/owner/approvals'],
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
  ['/books/users', '/owner/setup/users'],
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
  ['/settings', '/owner/setup/settings'],
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
  ['/books/sections', '/kitchen/books/sections'],
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
  // OWNER: NINE TABS TO FOUR. Five masters moved under Setup and storage
  // locations moved to the store, where the person who walks the shelves can
  // set the order they are walked in.
  ['/owner/accounts', '/owner/setup/accounts'],
  ['/owner/meters', '/owner/setup/meters'],
  ['/owner/users', '/owner/setup/users'],
  ['/owner/lists', '/owner/setup/lists'],
  ['/owner/settings', '/owner/setup/settings'],
  ['/owner/locations', '/store/masters/locations'],
]

/** Every retired URL, for the gate that proves each one still lands somewhere
 *  live. DERIVED, never hand-copied: smoke:phase-a used to keep its own list of
 *  51 beside this one of 57, which is a drift that only shows up as a bookmark
 *  404 on somebody's phone. The two role-aware prefixes are added by the gate,
 *  since they are resolved in code rather than listed here. */
export const RETIRED_URLS: string[] = FIXED.map(([from]) => from)

/** The Phase-A home of a retired URL, for this role. Null when nothing maps. */
export function legacyTarget(pathname: string, role: Role): string | null {
  const clean = pathname.replace(/\/+$/, '') || '/'

  // role-aware: mounted in more than one group
  if (clean === '/books/stock' || clean.startsWith('/books/stock/')) {
    return canAccess(role, '/store/stock') ? '/store/stock' : '/kitchen/books/stock'
  }
  // SECTIONS IS NO LONGER ROLE-AWARE, because it is no longer mounted twice.
  // SectionsView had a staff mount and a kitchen mount; the simplification pass
  // dropped the staff one and left this branch pointing its fallback at
  // /staff/books/sections — which is itself retired. So a store, cashier or
  // accountant bookmark chained through TWO redirects, invisibly, until the
  // gate started asserting that a retired URL never lands on another one.
  //
  // It is a plain FIXED entry now. A role that cannot open the kitchen books
  // lands on /denied naming who to ask, which is what happened before as well
  // — one hop later.
  // THREE RETIRED URLS WHOSE TARGET HAS NO INDEX, dead since Phase A and found
  // the day smoke:phase-a started DERIVING its list from FIXED instead of
  // keeping a hand-copy of 51 beside this file's 57.
  //
  // Each maps to a route that exists only as `[id]` or `[date]`, so the prefix
  // rules below send a SPECIFIC bookmark somewhere real — /books/wastage/<id>
  // still resolves — and sent a bare one to a 404. A person arriving with no
  // id in mind wants the list, which is a different screen in each case.
  const BARE: Record<string, string> = {
    // the photographs block and the button that takes them both live on Recipes
    '/books/snapshots': '/kitchen/recipes',
    // "the store's day, in one log" — issues and wastage, newest first
    '/books/wastage': '/store/books/log',
    '/books/issues': '/store/books/log',
    // BILLS MERGED INTO PURCHASES, and the LIST is the only half that moved.
    // /store/books/bills/<id> — the document — did not, and seven references
    // across five files depend on it. So these are BARE entries, exact-match:
    // the FIXED loop below prefix-matches, so an entry there would rewrite
    // /books/bills/<id> to /store/books/purchases/<id>, which does not exist.
    // The FIXED ['/books/bills', '/store/books/bills'] pair stays for exactly
    // that reason and still carries a bookmarked document through.
    '/books/bills': '/store/books/purchases',
    '/store/books/bills': '/store/books/purchases',
  }
  if (BARE[clean] !== undefined) return BARE[clean]

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

export const LEGACY_PREFIXES = ['/owner/accounts', '/owner/meters', '/owner/users', '/owner/lists', '/owner/settings', '/owner/locations', '/staff/money-out/expense', '/sales/record/close', '/store/reorder', '/store/count', '/store/loss', '/store/books/stock', '/books', '/bill', '/issue', '/wastage', '/cash', '/attendance', '/expenses', '/dashboard', '/pnl', '/settings', '/store/payment']
