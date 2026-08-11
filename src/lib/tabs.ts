// LAW 3 — tabbed entry, one tab per PERSON AND MOMENT rather than one per
// data shape. The sheets needed 28 tabs because a Sheets tab holds exactly
// one form shape; that constraint is gone. A tab may carry a CHIP ROW, and
// each chip swaps in one small focused form — never one large form with
// conditional fields. One question at a time still rules.
//
// ORDER, LABELS and HIDE/SHOW come from settings key 'tabs.<group>' (JSON
// array of {key, label?, hidden?}), edited by owner/manager in Settings.
// These defaults are the fallback and the KEY REGISTRY: a settings row can
// reorder, relabel or hide a tab, and can never invent a route. Unknown keys
// are dropped, missing keys are appended in default order — a new tab ships
// visible even under an old saved setting. Malformed JSON falls back to the
// defaults wholesale; a broken setting never blanks a strip.
//
// The LABEL is editable, the KEY and the URL never are.

export type TabGroup = 'kitchen' | 'store' | 'sales' | 'staff' | 'owner'

/** A chip is one small form inside a tab, addressed as ?f=<key>. */
export type ChipDef = { key: string; label: string }

export type TabDef = { key: string; href: string; label: string; chips?: ChipDef[] }

export const TAB_GROUPS: TabGroup[] = ['kitchen', 'store', 'sales', 'staff', 'owner']

export const TAB_GROUP_NAMES: Record<TabGroup, string> = {
  kitchen: 'Kitchen (chef)',
  store: 'Store',
  sales: 'Sales (cashier)',
  staff: 'Staff (manager)',
  owner: 'Owner',
}

export const TAB_DEFAULTS: Record<TabGroup, TabDef[]> = {
  kitchen: [
    { key: 'dashboard', href: '/kitchen', label: 'Dashboard' },
    // DEPARTMENTS. sections is ONE table — the same row codes a dish,
    // receives an issue and posts a staff member — so a rename here reflects
    // everywhere with nothing else to update. The word in the UI is
    // "department"; the column is still `sections`.
    { key: 'departments', href: '/kitchen/departments', label: 'Departments' },
    { key: 'indent', href: '/kitchen/indent', label: 'Indent' },
    // PRODUCTION SPLIT OUT of end-of-shift. Batches are made through the
    // day; closing happens once at night. Different moments, different tabs
    // — the earlier pairing was wrong.
    { key: 'production', href: '/kitchen/production', label: 'Production' },
    {
      key: 'shift',
      href: '/kitchen/shift',
      label: 'End of shift',
      chips: [
        { key: 'closing', label: 'Closing' },
        { key: 'loss', label: 'Loss' },
      ],
    },
    { key: 'recipes', href: '/kitchen/recipes', label: 'Recipes' },
    { key: 'books', href: '/kitchen/books', label: 'Books' },
  ],
  store: [
    { key: 'dashboard', href: '/store', label: 'Dashboard' },
    {
      key: 'receive',
      href: '/store/receive',
      label: 'Receive',
      chips: [
        { key: 'purchase', label: 'Purchase' },
        { key: 'pay', label: 'Pay vendor' },
      ],
    },
    {
      key: 'reorder',
      href: '/store/reorder',
      label: 'Reorder',
      // Slow-moving sits beside Reorder because they are the same question
      // from opposite ends: what to buy, and what was over-bought.
      chips: [
        { key: 'due', label: 'To reorder' },
        { key: 'slow', label: 'Slow-moving' },
      ],
    },
    { key: 'issue', href: '/store/issue', label: 'Issue' },
    { key: 'loss', href: '/store/loss', label: 'Loss' },
    { key: 'count', href: '/store/count', label: 'Count' },
    {
      key: 'masters',
      href: '/store/masters',
      label: 'Masters',
      chips: [
        { key: 'vendors', label: 'Vendors' },
        { key: 'items', label: 'Items' },
      ],
    },
    { key: 'books', href: '/store/books', label: 'Books' },
  ],
  sales: [
    { key: 'dashboard', href: '/sales', label: 'Dashboard' },
    { key: 'daily', href: '/sales/books/sales', label: 'Daily sale' },
    {
      // DAY CLOSE LIVES HERE NOW. It is a daily money event like the rest of
      // them, and giving it its own tab implied it was a different KIND of
      // thing. It is first because it is the one done every night.
      key: 'record',
      href: '/sales/record',
      label: 'Record',
      chips: [
        { key: 'close', label: 'Day close' },
        { key: 'voucher', label: 'Voucher' },
        { key: 'income', label: 'Other income' },
        { key: 'offbook', label: 'Off-book' },
        { key: 'nonrevenue', label: 'Non-revenue' },
        { key: 'due', label: 'Due' },
      ],
    },
    // PARTNERS is the section and settlements live INSIDE it, because a
    // settlement is something a partner does. They were sibling tabs, which
    // put the master and the thing it governs in two places.
    { key: 'partners', href: '/sales/partners', label: 'Partners' },
    { key: 'catering', href: '/sales/catering', label: 'Catering' },
    { key: 'books', href: '/sales/books', label: 'Books' },
  ],
  staff: [
    {
      key: 'people',
      href: '/staff/people',
      label: 'People',
      chips: [
        { key: 'employees', label: 'Employees' },
        { key: 'attendance', label: 'Attendance' },
      ],
    },
    {
      key: 'moneyout',
      href: '/staff/money-out',
      label: 'Money out',
      chips: [
        { key: 'expense', label: 'Expense' },
        { key: 'contract', label: 'Contract bill' },
        { key: 'casual', label: 'Casual labour' },
      ],
    },
    { key: 'books', href: '/staff/books', label: 'Books' },
  ],
  owner: [
    { key: 'dashboard', href: '/owner', label: 'Dashboard' },
    { key: 'pnl', href: '/owner/pnl', label: 'P&L' },
    { key: 'activity', href: '/owner/activity', label: 'Activity' },
    { key: 'users', href: '/owner/users', label: 'Users' },
    { key: 'lists', href: '/owner/lists', label: 'Lists' },
    { key: 'settings', href: '/owner/settings', label: 'Settings' },
  ],
}

/** Merge a stored 'tabs.<group>' setting into the default tab list. */
export function resolveTabs(group: TabGroup, raw: string | null): TabDef[] {
  const defaults = TAB_DEFAULTS[group]
  if (raw === null || raw.trim() === '') return defaults
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaults
  }
  if (!Array.isArray(parsed)) return defaults
  const byKey = new Map(defaults.map((d) => [d.key, d]))
  const seen = new Set<string>()
  const out: TabDef[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const key = (entry as { key?: unknown }).key
    if (typeof key !== 'string') continue
    const def = byKey.get(key)
    if (!def || seen.has(key)) continue
    seen.add(key)
    if ((entry as { hidden?: unknown }).hidden === true) continue // hidden, not invented away
    const label = (entry as { label?: unknown }).label
    const cleaned = typeof label === 'string' ? label.trim().slice(0, 24) : ''
    out.push({ ...def, label: cleaned === '' ? def.label : cleaned })
  }
  for (const def of defaults) if (!seen.has(def.key)) out.push(def)
  return out
}

/** Counts painted on tabs, keyed by tab key. A tab with no entry, or a
 *  count of zero, wears NO badge — a "0" is a thing to read and dismiss
 *  every time, where absence is silence. */
export type TabBadges = Partial<Record<string, number>>

/** The chips of a tab, for the settings editor and the chip row alike. */
export const chipsOf = (group: TabGroup, tabKey: string): ChipDef[] =>
  TAB_DEFAULTS[group].find((t) => t.key === tabKey)?.chips ?? []
