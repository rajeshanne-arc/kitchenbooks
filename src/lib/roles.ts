// The role matrix — pure data, importable from the proxy, server code and
// nav alike. Server-side is the law (proxy + actions); every surface merely
// reflects it. STRICT INVISIBILITY: a role never SEES a link it cannot
// open — nav, group tiles, tabs, chips, quick links. Deep links stay
// server-denied (the denied page names who to ask), but denial is the
// backstop, never the mechanism.
//
// Phase A: each group owns its books. A chef never leaves /kitchen.
//
//   /kitchen  /kitchen/books    chef
//   /store    /store/books      store
//   /sales    /sales/books      cashier
//   /staff    /staff/books      manager
//   /owner                      owner (dashboard is manager+owner)
//
// Phase C adds a sixth: /accounts, the accountant's group. They work from
// home and their screen is a QUEUE — what is incomplete, what needs asking
// about, what is ready to close.

export type Role = 'owner' | 'manager' | 'chef' | 'store' | 'cashier' | 'accountant'

export const ALL_ROLES: Role[] = ['owner', 'manager', 'chef', 'store', 'cashier', 'accountant']

const EVERYONE: Role[] = ALL_ROLES

// First prefix match wins — keep more specific paths above their parents.
const RULES: [prefix: string, roles: Role[]][] = [
  // --- accountant group ------------------------------------------------
  // The accountant works from home and their screen is a QUEUE, not a form.
  // The owner is here too: they own the business, and someone must be able
  // to work the loop when there is no accountant yet.
  ['/accounts', ['accountant', 'owner']],

  // --- owner group ---------------------------------------------------
  ['/owner/users', ['owner']],
  ['/owner/pnl', ['owner']],
  // The money-account master. Every role uses the PICKER; only these two
  // decide what the accounts are called and what they opened at — opening
  // balances are an accountant's write, and this is the one screen that
  // holds them, so they are admitted here rather than given a second copy
  // of the same master under their own group. It is reached from
  // /accounts/money; the owner tab strip filters to it on its own.
  ['/owner/accounts', ['owner', 'accountant']],
  ['/owner/lists', ['manager', 'owner']],
  ['/owner/settings', ['manager', 'owner']],
  ['/owner/snapshots', ['owner']],
  ['/owner', ['manager', 'owner']],

  // --- kitchen group (chef) -------------------------------------------
  // The indent page shows asked-vs-given — the store side of that gap too,
  // and it is the ONLY kitchen path a store account may open.
  ['/kitchen/indent', ['chef', 'store', 'manager', 'owner']],
  ['/kitchen', ['chef', 'manager', 'owner']],

  // --- store group -----------------------------------------------------
  ['/store', ['store', 'manager', 'owner']],

  // --- sales group (cashier) -------------------------------------------
  // THE MAPPING QUEUE ADMITS THE CHEF. It is the one sales path they may
  // open, and it is the right one: the cashier is in Sales every day, but the
  // chef is who knows which POS name is which dish. Every department view in
  // the app is fed from this screen, so widening the door to the person who
  // can actually answer is worth one rule.
  ['/sales/books/sales/mapping', ['cashier', 'chef', 'manager', 'owner']],
  ['/sales', ['cashier', 'manager', 'owner']],

  // --- staff group (manager) -------------------------------------------
  // THE EMPLOYEE PROFILE ADMITS THE ACCOUNTANT. A person is the second unit
  // of accountability in this app and the accountant is the one preparing
  // their pay — reading attendance, runs and advances for somebody is their
  // job. Chef, store and cashier stay out: they have no reason to see
  // anyone's pay.
  //
  // The matrix is prefix-based, so this admits them to the LIST as well,
  // which is right — they already see every person on /accounts/payroll/people
  // and on every run. What it must NOT hand them is the roster's write
  // surfaces, and the rule above keeps them out of /new. Editing an existing
  // person shares the profile's prefix and cannot be split by prefix at all,
  // so the real gate is in the ACTIONS (createStaff/updateStaff, manager and
  // owner) — which is where this repo says a gate belongs anyway, because a
  // form is never the check.
  ['/staff/people/employees/new', ['manager', 'owner']],
  ['/staff/people/employees', ['manager', 'owner', 'accountant']],
  ['/staff', ['manager', 'owner']],

  // --- apis -------------------------------------------------------------
  ['/api/items', ['store', 'chef', 'manager', 'owner']],
  ['/api/vendors', ['store', 'manager', 'owner']],
  ['/api/recipes', ['chef', 'manager', 'owner']],
  ['/api/kitchen', ['chef', 'manager', 'owner']],
  ['/api/indents', ['store', 'chef', 'manager', 'owner']],
  ['/api/cash', ['cashier', 'manager', 'owner']],
  // The CSV download. Gated exactly like the screen it comes from — a
  // download link is the easiest thing in an app to forward onward.
  ['/api/accounts', ['accountant', 'owner']],

  // --- retired URLs -----------------------------------------------------
  // Every pre-Phase-A path still resolves, as a permanent redirect into the
  // caller's own group (see app/(legacy)). They carry no data and decide
  // nothing, so they are open to every signed-in role; the target they land
  // on is matrix-checked like any other page.
  ['/books', EVERYONE],
  ['/bill', EVERYONE],
  ['/issue', EVERYONE],
  ['/wastage', EVERYONE],
  ['/cash', EVERYONE],
  ['/attendance', EVERYONE],
  ['/expenses', EVERYONE],
  ['/dashboard', EVERYONE],
  ['/pnl', EVERYONE],
  ['/settings', EVERYONE],

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
    if (roles.includes('accountant')) return 'This screen belongs to the accountant — ask them, or an owner.'
    if (!roles.includes('chef') && !roles.includes('store') && !roles.includes('cashier')) {
      return 'This screen needs a manager or owner account — ask the manager.'
    }
    const who = roles.filter((r) => r !== 'manager' && r !== 'owner').join(' / ')
    return `This screen belongs to ${who} accounts (managers and owners can open it too) — ask them for what you need.`
  }
  return 'Ask an owner to open this for you.'
}

/** The five groups. Top-level nav is exactly this list, matrix-filtered —
 *  there is no other top-level destination in the app. */
export type Group = { key: string; href: string; label: string; blurb: string }

export const GROUPS: Group[] = [
  { key: 'kitchen', href: '/kitchen', label: 'Kitchen', blurb: 'indents, shift close, losses, recipes' },
  { key: 'store', href: '/store', label: 'Store', blurb: 'goods in, issues out, counts, masters' },
  { key: 'sales', href: '/sales', label: 'Sales', blurb: 'the day close and what came with it' },
  { key: 'staff', href: '/staff', label: 'Staff', blurb: 'people, attendance, money out' },
  { key: 'owner', href: '/owner', label: 'Owner', blurb: 'the whole restaurant, added up' },
  { key: 'accounts', href: '/accounts', label: 'Accounts', blurb: 'the queue: what is asked, what is missing, what can close' },
]

export const groupsFor = (role: Role): Group[] => GROUPS.filter((g) => canAccess(role, g.href))

export type NavLink = { href: string; label: string; activePrefixes: string[] }

export function navFor(role: Role): NavLink[] {
  return groupsFor(role).map((g) => ({ href: g.href, label: g.label, activePrefixes: [g.href] }))
}

/** Where '/' sends this role. A role with exactly one group never sees a
 *  chooser — it lands in its own group. */
export function homeFor(role: Role): string | null {
  const groups = groupsFor(role)
  return groups.length === 1 ? groups[0].href : null
}
