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
    { key: 'indent', href: '/kitchen/indent', label: 'Indent' },
    {
      // Production and closing are the same person at the same moment, so
      // they are one tab. Today's production pre-fills tonight's closing.
      key: 'shift',
      href: '/kitchen/shift',
      label: 'End of shift',
      chips: [
        { key: 'production', label: 'Production' },
        { key: 'closing', label: 'Closing' },
      ],
    },
    { key: 'loss', href: '/kitchen/loss', label: 'Loss' },
    { key: 'recipes', href: '/kitchen/recipes', label: 'Recipes' },
    { key: 'books', href: '/kitchen/books', label: 'Books' },
  ],
  store: [
    {
      key: 'receive',
      href: '/store/receive',
      label: 'Receive',
      chips: [
        { key: 'purchase', label: 'Purchase' },
        { key: 'pay', label: 'Pay vendor' },
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
    { key: 'close', href: '/sales', label: 'Day close' },
    {
      key: 'record',
      href: '/sales/record',
      label: 'Record',
      chips: [
        { key: 'voucher', label: 'Voucher' },
        { key: 'income', label: 'Other income' },
        { key: 'offbook', label: 'Off-book' },
        { key: 'nonrevenue', label: 'Non-revenue' },
        { key: 'due', label: 'Due' },
      ],
    },
    { key: 'settlements', href: '/sales/settlements', label: 'Settlements' },
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
      // contract_bills and casual_labour are real tables with no form yet —
      // their chips arrive in Phase B, beside the corrected sheet forms.
      chips: [{ key: 'expense', label: 'Expense' }],
    },
    { key: 'books', href: '/staff/books', label: 'Books' },
  ],
  owner: [
    { key: 'dashboard', href: '/owner', label: 'Dashboard' },
    { key: 'pnl', href: '/owner/pnl', label: 'P&L' },
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

/** The chips of a tab, for the settings editor and the chip row alike. */
export const chipsOf = (group: TabGroup, tabKey: string): ChipDef[] =>
  TAB_DEFAULTS[group].find((t) => t.key === tabKey)?.chips ?? []
