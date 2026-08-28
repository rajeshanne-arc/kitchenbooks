// THE ONE FRONT DOOR for every `?view=` on every screen.
//
// A dozen toggles means a dozen chances to write the ternary differently —
// which is the argument that made `readPeriodParam` a single function after
// twelve hand-written copies of `isPeriodKey(v) ? v : 'this-month'`.
//
// AN UNRECOGNISED VALUE FALLS BACK, never throws. A pasted URL with a typo, or
// a link from a version of the app where the option was called something else,
// must show the page rather than a 500. The default is the honest answer to
// "we do not know what you meant".

/** Narrow a URL param to one of a known set. */
export function readOneOf<T extends string>(
  v: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  return v !== undefined && (allowed as readonly string[]).includes(v) ? (v as T) : fallback
}

/**
 * The option lists, in one place, so a screen and its gate cannot disagree
 * about what the toggle offers. Each is `[default, ...rest]` — the default
 * writes no param, so a clean URL means "unchanged".
 */
export const VIEW_KEYS = {
  /** Purchase orders: the queue of what is still somebody's job, against the
   *  whole record. "Open" is the working list — a draft nobody sent and an
   *  order nobody has delivered are both waiting on a person. */
  orders: ['open', 'all'],
  /** On hand: grouping hides the biggest holdings, which is a real question */
  stock: ['by-category', 'by-value'],
  /** Reorder: the trip is the unit of work; urgency is the risk */
  reorder: ['by-vendor', 'by-urgency'],
  /** Recipes: a chef working on gravies wants only gravies */
  recipeKind: ['all', 'dishes', 'subs'],
  /** Recipes: "what is in Chinese" vs "what is expensive" */
  recipeOrder: ['by-section', 'by-food-cost'],
  /** Purchases: ONE ledger at three grains, not two reports. Bills and Daily
   *  purchases were the same rows — a vendor delivers once a day, so 323
   *  August bills grouped to 301 day-vendor rows: 7% fewer rows in exchange
   *  for the document number, the vendor's bill number, the line count and
   *  the link. That is the register with information taken out. */
  purchases: ['by-bill', 'by-day', 'by-vendor'],
  /** Sales books: one dataset, three questions */
  sales: ['by-day', 'by-hour', 'by-item'],
  /** Mapping: reviewing what was already mapped is a real task */
  mapping: ['unmapped', 'mapped'],
  /** Parties: dues filter balance <> 0, so a live party at zero is invisible */
  parties: ['owed', 'settled', 'all'],
  /** Registers: line by line, or totalled by party */
  register: ['detail', 'summary'],
  /** Attendance: today's sheet, or who is absent most */
  attendance: ['this-day', 'this-period'],
  /** Employees: the roster, or where the wage bill actually sits */
  employees: ['by-department', 'by-salary'],
  /** Payroll: "what is waiting on me" */
  payroll: ['all', 'draft', 'approved', 'paid'],
  /** Activity: "what did Haseeb do" vs "every void this week" */
  activity: ['by-time', 'by-person', 'by-type'],
  /** Money as rupees or as a share of sales — see src/lib/share.ts */
  units: ['rupees', 'percent'],
} as const

export type ViewKeys = typeof VIEW_KEYS
export type ViewOf<K extends keyof ViewKeys> = ViewKeys[K][number]

/** Read a param against one of the lists above, defaulting to its first entry. */
export function readView<K extends keyof ViewKeys>(key: K, v: string | undefined): ViewOf<K> {
  const allowed = VIEW_KEYS[key] as readonly ViewOf<K>[]
  return readOneOf(v, allowed, allowed[0])
}
