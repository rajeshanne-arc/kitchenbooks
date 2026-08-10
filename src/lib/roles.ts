// The role matrix — pure data, importable from the proxy, server code and
// nav alike. Server-side is the law (proxy + actions); every surface merely
// reflects it. STRICT INVISIBILITY: a role never SEES a link it cannot
// open — nav, home tiles, Books tabs, group tab strips, quick links. Deep
// links stay server-denied (the denied page names who to ask).
//
//   store:   store group (purchase/payment/issue/wastage) + counts,
//            Books(bills/store log/stock/counts/vendors/items)
//   chef:    kitchen group (indent/production/wastage/closing) + recipes,
//            Books(recipes/stock/sections/food cost)
//   cashier: cash group (close/vouchers/settlements/off-book/other income/
//            non-revenue/dues/fetch), Books(sales/cash)
//   manager: everything below owner + staff group + settings
//   owner:   everything + Users + snapshots + P&L

export type Role = 'owner' | 'manager' | 'chef' | 'store' | 'cashier'

export const ALL_ROLES: Role[] = ['owner', 'manager', 'chef', 'store', 'cashier']

const EVERYONE: Role[] = ALL_ROLES

// First prefix match wins — keep more specific paths above their parents.
const RULES: [prefix: string, roles: Role[]][] = [
  ['/books/users', ['owner']],
  ['/books/snapshots', ['owner']],
  ['/books/bills', ['store', 'manager', 'owner']],
  ['/books/stock', ['store', 'chef', 'manager', 'owner']],
  ['/books/vendors', ['store', 'manager', 'owner']],
  ['/books/items', ['store', 'manager', 'owner']],
  ['/books/counts', ['store', 'manager', 'owner']],
  ['/books/recipes', ['chef', 'manager', 'owner']],
  ['/books/sections', ['chef', 'manager', 'owner']],
  ['/books/food-cost', ['chef', 'manager', 'owner']],
  ['/books/sales', ['cashier', 'manager', 'owner']],
  ['/books/cash', ['cashier', 'manager', 'owner']],
  ['/books/store', ['store', 'manager', 'owner']],
  ['/books/issues', ['store', 'manager', 'owner']],
  ['/books/wastage', ['store', 'manager', 'owner']],
  ['/books/staff', ['manager', 'owner']],
  ['/books', ['manager', 'owner']],
  ['/bill', ['store', 'manager', 'owner']],
  ['/issue', ['store', 'manager', 'owner']],
  ['/wastage', ['store', 'manager', 'owner']],
  ['/store', ['store', 'manager', 'owner']],
  // The indent page shows asked-vs-given — the store side of that gap too.
  ['/kitchen/indent', ['chef', 'store', 'manager', 'owner']],
  ['/kitchen', ['chef', 'manager', 'owner']],
  ['/cash', ['cashier', 'manager', 'owner']],
  ['/attendance', ['manager', 'owner']],
  ['/expenses', ['manager', 'owner']],
  ['/dashboard', ['manager', 'owner']],
  ['/pnl', ['owner']],
  ['/settings', ['manager', 'owner']],
  ['/api/items', ['store', 'chef', 'manager', 'owner']],
  ['/api/vendors', ['store', 'manager', 'owner']],
  ['/api/recipes', ['chef', 'manager', 'owner']],
  ['/api/kitchen', ['chef', 'manager', 'owner']],
  ['/api/indents', ['store', 'chef', 'manager', 'owner']],
  ['/api/cash', ['cashier', 'manager', 'owner']],
  ['/', EVERYONE],
]

/** Fail closed: only '/' itself is everyone's; unknown paths deny for all
 * roles, so a page forgotten in the matrix is loudly dead, never quietly
 * open. */
export function canAccess(role: Role, pathname: string): boolean {
  for (const [prefix, roles] of RULES) {
    const match = prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)
    if (match) return roles.includes(role)
  }
  return false
}

/** A denied route says who to ask, not just "no". */
export function deniedHint(pathname: string): string {
  for (const [prefix, roles] of RULES) {
    const match = prefix === '/' ? pathname === '/' : pathname === prefix || pathname.startsWith(`${prefix}/`)
    if (!match) continue
    if (roles.length === 1 && roles[0] === 'owner') return 'This screen needs an owner account — ask Rajesh.'
    if (!roles.includes('chef') && !roles.includes('store') && !roles.includes('cashier')) {
      return 'This screen needs a manager or owner account — ask the manager.'
    }
    const who = roles.filter((r) => r !== 'manager' && r !== 'owner').join(' / ')
    return `This screen belongs to ${who} accounts (managers and owners can open it too) — ask them for what you need.`
  }
  return 'Ask an owner to open this for you.'
}

/** Top-level nav: one entry per role group, matrix-filtered. `activePrefixes`
 * lights the link for every page of its group, wherever the tab lives. */
export type NavLink = { href: string; label: string; activePrefixes: string[] }

export function navFor(role: Role): NavLink[] {
  const links: NavLink[] = [
    { href: '/bill', label: 'Store', activePrefixes: ['/bill', '/issue', '/wastage', '/store'] },
    { href: '/kitchen', label: 'Kitchen', activePrefixes: ['/kitchen'] },
    { href: '/cash', label: 'Cash', activePrefixes: ['/cash'] },
    { href: '/attendance', label: 'Staff', activePrefixes: ['/attendance', '/expenses'] },
    { href: '/dashboard', label: 'Owner', activePrefixes: ['/dashboard'] },
    { href: '/pnl', label: 'P&L', activePrefixes: ['/pnl'] },
    { href: '/books/bills', label: 'Books', activePrefixes: ['/books'] },
    { href: '/settings', label: '⚙', activePrefixes: ['/settings'] },
  ]
  return links
    .map((l) => (l.href === '/books/bills' ? { ...l, href: booksHomeFor(role) } : l))
    .filter((l) => canAccess(role, l.href))
}

/** The Books tab a role lands on first (their own corner of the books).
 * chef's kitchen nav entry covers /kitchen; their Books opens on recipes. */
export function booksHomeFor(role: Role): string {
  if (role === 'store') return '/books/bills'
  if (role === 'chef') return '/books/recipes'
  if (role === 'cashier') return '/books/sales'
  return '/books/bills'
}

export function booksTabsFor(role: Role): { href: string; label: string }[] {
  const tabs = [
    { href: '/books/bills', label: 'Bills' },
    { href: '/books/sales', label: 'Sales' },
    { href: '/books/cash', label: 'Cash' },
    { href: '/books/recipes', label: 'Recipes' },
    { href: '/books/store', label: 'Store log' },
    { href: '/books/stock', label: 'Stock' },
    { href: '/books/counts', label: 'Counts' },
    { href: '/books/food-cost', label: 'Food cost' },
    { href: '/books/sections', label: 'Sections' },
    { href: '/books/staff', label: 'Staff' },
    { href: '/books/vendors', label: 'Vendors' },
    { href: '/books/items', label: 'Items' },
    { href: '/books/users', label: 'Users' },
  ]
  return tabs.filter((t) => canAccess(role, t.href))
}
