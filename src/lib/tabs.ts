// LAW 3 — tabbed entry. Each role group is a tab strip; the ORDER and
// LABELS come from settings (key 'tabs.<group>', JSON array of
// {key, label?}), edited on the Settings screen. These hardcoded defaults
// are the fallback and the key registry: a settings row can reorder or
// relabel tabs, never invent a route. Unknown keys are dropped, missing
// keys are appended in default order — a new tab ships visible even under
// an old saved setting.

export type TabGroup = 'kitchen' | 'cashier' | 'store' | 'staff'

export type TabDef = { key: string; href: string; label: string }

export const TAB_GROUPS: TabGroup[] = ['kitchen', 'cashier', 'store', 'staff']

export const TAB_GROUP_NAMES: Record<TabGroup, string> = {
  kitchen: 'Kitchen (chef)',
  cashier: 'Cash (cashier)',
  store: 'Store',
  staff: 'Staff (manager)',
}

export const TAB_DEFAULTS: Record<TabGroup, TabDef[]> = {
  kitchen: [
    { key: 'dashboard', href: '/kitchen', label: 'Dashboard' },
    { key: 'recipes', href: '/books/recipes', label: 'Recipes' },
    { key: 'indent', href: '/kitchen/indent', label: 'Indent' },
    { key: 'production', href: '/kitchen/production', label: 'Production' },
    { key: 'wastage', href: '/kitchen/wastage', label: 'Wastage' },
    { key: 'closing', href: '/kitchen/closing', label: 'Closing' },
  ],
  cashier: [
    { key: 'close', href: '/cash', label: 'Day close' },
    { key: 'vouchers', href: '/cash/vouchers', label: 'Vouchers' },
    { key: 'settlements', href: '/cash/settlements', label: 'Settlements' },
    { key: 'offbook', href: '/cash/off-book', label: 'Off-book' },
    { key: 'income', href: '/cash/other-income', label: 'Other income' },
    { key: 'nonrevenue', href: '/cash/non-revenue', label: 'Non-revenue' },
    { key: 'dues', href: '/cash/dues', label: 'Dues' },
    { key: 'fetch', href: '/cash/fetch', label: 'Fetch day' },
  ],
  store: [
    { key: 'purchase', href: '/bill', label: 'Purchase' },
    { key: 'payment', href: '/store/payment', label: 'Payment' },
    { key: 'issue', href: '/issue', label: 'Issue' },
    { key: 'wastage', href: '/wastage', label: 'Wastage' },
    { key: 'vendors', href: '/books/vendors', label: 'Vendors' },
    { key: 'items', href: '/books/items', label: 'Items' },
  ],
  staff: [
    { key: 'employees', href: '/books/staff', label: 'Employees' },
    { key: 'attendance', href: '/attendance', label: 'Attendance' },
    { key: 'expenses', href: '/expenses', label: 'Expenses' },
  ],
}

/** Merge a stored 'tabs.<group>' setting into the default tab list.
 * Accepts the raw settings value (JSON text or null); malformed input
 * falls back to the defaults wholesale — a broken setting never blanks a
 * tab strip. */
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
  const out: TabDef[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const key = (entry as { key?: unknown }).key
    if (typeof key !== 'string') continue
    const def = byKey.get(key)
    if (!def || out.some((t) => t.key === key)) continue
    const label = (entry as { label?: unknown }).label
    const cleaned = typeof label === 'string' ? label.trim().slice(0, 24) : ''
    out.push({ ...def, label: cleaned === '' ? def.label : cleaned })
  }
  for (const def of defaults) if (!out.some((t) => t.key === def.key)) out.push(def)
  return out
}
