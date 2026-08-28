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

export type TabGroup = 'kitchen' | 'store' | 'sales' | 'staff' | 'owner' | 'accounts'

/** A chip is one small form inside a tab, addressed as `${tab.href}/${key}`.
 *
 *  `separatorBefore` draws a rule to its left. It exists for exactly one
 *  distinction and should stay rare: the chips before it ADD ROWS, and the one
 *  after it changes what every number in the app MEANS. A line says that
 *  without needing a sentence.
 */
export type ChipDef = { key: string; label: string; separatorBefore?: boolean }

export type TabDef = { key: string; href: string; label: string; chips?: ChipDef[] }

export const TAB_GROUPS: TabGroup[] = ['kitchen', 'store', 'sales', 'staff', 'owner', 'accounts']

export const TAB_GROUP_NAMES: Record<TabGroup, string> = {
  kitchen: 'Kitchen (chef)',
  store: 'Store',
  sales: 'Sales (cashier)',
  staff: 'Staff (manager)',
  owner: 'Owner',
  accounts: 'Accounts (accountant)',
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
    // ISSUE BEFORE RECEIVE, deliberately. A store manager issues several
    // times a day and receives once, so FREQUENCY sets the order — not the
    // sequence in which goods physically arrive. The old order described the
    // warehouse; this one describes the job.
    { key: 'issue', href: '/store/issue', label: 'Issue' },
    {
      // PURCHASING, NOT RECEIVE. The tab holds order, receive, pay and return
      // — the vendor relationship end to end — and only one of those four is
      // receiving. It was named after one of its own children, which is the
      // same fault as a group named after a person rather than a subject.
      // Every accounting system on earth calls this Purchasing.
      //
      // THE URL MOVED WITH THE LABEL. A tab labelled Purchasing living at
      // /store/receive is a trap for whoever reads it next.
      key: 'purchasing',
      href: '/store/purchasing',
      label: 'Purchasing',
      // THE CHIPS SHORTEN because the tab already establishes the vendor:
      // "Pay vendor" under Purchasing says vendor twice.
      chips: [
        { key: 'receive', label: 'Receive' },
        // ORDERS SECOND, and this was argued rather than picked. Rajesh asked
        // for it first; second is the recommendation, and he overrules it if
        // he disagrees. The reason is the frequency rule that ordered the tab
        // strip itself — bills outnumber orders 330 to 4, and Receive is what
        // somebody standing at the door with a bill needs. Ahead of Pay and
        // Returns, though, because an order is the start of the sequence and
        // the other two are its tail.
        { key: 'orders', label: 'Orders' },
        { key: 'pay', label: 'Pay' },
        // goods going BACK, with the credit note that follows them
        { key: 'returns', label: 'Returns' },
      ],
    },
    {
      // STOCK absorbed Reorder, Count and Loss. Four tabs asking one
      // question from four sides became one tab with four views, and the
      // badge on it fires for any of three problems — see badgesFor().
      //
      // LOSS IS THE ONE THAT NEEDED AN ARGUMENT. Wastage is chronically
      // under-recorded in every restaurant precisely because it is
      // uncomfortable, so burying it costs real data. It is only acceptable
      // here because the store dashboard carries a Wastage quick tile: the
      // one-click path survives on the landing page and this is merely the
      // second route. `smoke:phase-a` asserts that tile exists — if it ever
      // goes, this stops being safe and Loss comes back out as a tab.
      key: 'stock',
      href: '/store/stock',
      label: 'Stock',
      chips: [
        { key: 'on-hand', label: 'On hand' },
        { key: 'reorder', label: 'Reorder' },
        { key: 'count', label: 'Count' },
        { key: 'loss', label: 'Loss' },
      ],
    },
    {
      key: 'masters',
      href: '/store/masters',
      label: 'Masters',
      chips: [
        { key: 'vendors', label: 'Vendors' },
        { key: 'items', label: 'Items' },
        // LOCATIONS IS A STORE MASTER, NOT AN OWNER SETTING. The store manager
        // places the items and walks the shelves, so he is the one who knows
        // whether the freezer comes before the dry store — and the walking
        // order is the whole point of the row. An owner setting it would be
        // setting the order for a walk he does not do. It also belongs beside
        // Items because an item POINTS at a location: the two are edited in
        // the same sitting.
        { key: 'locations', label: 'Locations' },
      ],
    },
    { key: 'books', href: '/store/books', label: 'Books' },
  ],
  sales: [
    // Dashboard ABSORBED Daily sale — both were READING the same day, and
    // the daily table is still in Books. Record stays its own door because
    // it is WRITING, and the cashier's nightly task must not sit behind a
    // dashboard.
    { key: 'dashboard', href: '/sales', label: 'Dashboard' },
    {
      // DAY CLOSE COMES BACK OUT, and the earlier merge was wrong. It is the
      // cashier's nightly ritual with a hard chain — no day closes before the
      // one before it — and it was sitting as one of six chips beside a ₹200
      // voucher. THE DECIDING ARGUMENT IS THE BADGE: a tab can carry
      // "3 days unclosed" and a chip cannot, which is the same reasoning that
      // moved the reorder badge onto Stock.
      //
      // It also fixes a live oddity: /sales/record renders Voucher while the
      // chip row marked the FIRST chip active, so the parent URL showed
      // Voucher with "Day close" highlighted.
      key: 'close',
      href: '/sales/close',
      label: 'Day close',
    },
    {
      // What is left is what the sentence "things the POS does not know about"
      // actually covers — which is why they belong together.
      key: 'record',
      href: '/sales/record',
      label: 'Other entries',
      chips: [
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
    { key: 'partners', href: '/sales/partners', label: 'Delivery partners' },
    { key: 'catering', href: '/sales/catering', label: 'Catering' },
    { key: 'books', href: '/sales/books', label: 'Books' },
  ],
  // A GROUP IS A SUBJECT, NOT A PERSON. Staff was "the manager's stuff", which
  // is how Expenses came to sit beside Attendance — and once one thing lands by
  // ROLE instead of by SUBJECT, the group's name stops describing its contents.
  //
  // The subject here is PEOPLE. Contract bills and casual labour stay: they are
  // people you pay who are not on payroll, and pnl_monthly already counts all
  // three as labour — wages, contract_vendors, casual_labour. Rent, electricity
  // and licences are overheads on a different P&L line, so EXPENSES LEAVES.
  staff: [
    { key: 'dashboard', href: '/staff', label: 'Dashboard' },
    // Employees and Attendance were chips of a "People" tab inside a group
    // already called Staff. One level of "people" was enough.
    { key: 'employees', href: '/staff/people/employees', label: 'Employees' },
    { key: 'attendance', href: '/staff/people/attendance', label: 'Attendance' },
    {
      key: 'moneyout',
      href: '/staff/money-out',
      label: 'Contract & casual',
      chips: [
        { key: 'contract', label: 'Contract bill' },
        { key: 'casual', label: 'Casual labour' },
      ],
    },
  ],
  // NINE TABS TO FOUR. The group mixed two kinds of thing: Dashboard, P&L and
  // Activity are READ — opened often, scanned fast — while Money accounts,
  // Meters, Users, Lists and Settings are CONFIGURED ONCE and forgotten. Nine
  // top-level tabs where five were rarely-visited masters made the three that
  // matter one third of the strip.
  owner: [
    { key: 'dashboard', href: '/owner', label: 'Dashboard' },
    { key: 'pnl', href: '/owner/pnl', label: 'P&L' },
    // POSITIONED BY READING ORDER, NOT URGENCY — the badge does the summoning,
    // so this need not sit second to be found. Dashboard is NOW, P&L is the
    // PERIOD, Approvals is WHAT NEEDS ME, Activity is WHAT HAPPENED. A tab
    // ordered by how alarming it might be is a strip that means something
    // different on a bad day.
    { key: 'approvals', href: '/owner/approvals', label: 'Approvals' },
    { key: 'activity', href: '/owner/activity', label: 'Activity' },
    {
      // THE BADGE IS WHAT STOPS THIS BEING A PLACE NOBODY OPENS. One thing
      // inside is not configuration at all: Lists has an APPROVAL QUEUE. A
      // category somebody typed lands as a pending suggestion waiting on the
      // owner, which is an ongoing task rather than a setup step. So Setup
      // carries a count when suggestions are pending and is silent otherwise,
      // and Lists carries the same count inside — the Stock mechanism exactly.
      key: 'setup',
      href: '/owner/setup',
      label: 'Setup',
      chips: [
        { key: 'accounts', label: 'Money accounts' },
        { key: 'meters', label: 'Meters' },
        { key: 'users', label: 'Users' },
        { key: 'lists', label: 'Lists' },
        // WHOSE NAME IS ON THE DOCUMENT, and what it looks like. Not Settings:
        // that screen changes what every number MEANS, and this changes
        // nothing at all about the books — it is the restaurant's own identity
        // as a vendor sees it on a purchase order.
        { key: 'letterhead', label: 'Letterhead' },
        // SETTINGS LAST, AFTER A DIVIDER. The four before it ADD ROWS — an
        // account, a meter, a user, a list value. This one changes what every
        // number MEANS: which day a sale belongs to, whether input tax is a
        // cost, when the financial year starts, how long a standard day is.
        //
        // It does NOT get its own tab, deliberately: that would make the three
        // tabs actually read three of five rather than three of four, in order
        // to surface the thing touched least. tabs.owner is settings-driven,
        // so promoting it later is one config change if it turns out to be
        // hunted for.
        { key: 'settings', label: 'Settings', separatorBefore: true },
      ],
    },
  ],
  // The accountant's group. Review comes first and always will: their
  // screen is a QUEUE, not a form — what is incomplete, what needs asking
  // about, what is ready to close. The remaining tabs (registers, parties,
  // tax, money, export) land with the rest of the accountant phase.
  // THE SPLIT IS LEGIBLE NOW: Registers, Parties and Cash & bank are for
  // READING; Payments, Payroll and Close are for WRITING.
  accounts: [
    { key: 'review', href: '/accounts', label: 'Review' },
    {
      // PAYMENTS is where money LEAVES on the accountant's say-so, and it is
      // where Expenses lands — beside bank payments and tax deposits rather
      // than beside Attendance. Coherent rather than a dumping ground: the
      // accountant already owns every non-drawer money movement, and the
      // drawer law already says till cash is a voucher, so a cash repair was
      // never the manager's to record anyway.
      key: 'payments',
      href: '/accounts/payments',
      label: 'Payments',
      chips: [
        { key: 'expense', label: 'Expense' },
        { key: 'pay', label: 'Pay a vendor' },
        { key: 'deposit', label: 'Tax deposit' },
      ],
    },
    {
      key: 'registers',
      href: '/accounts/registers',
      label: 'Registers',
      // Seven registers, one shape. An accountant already knows what each of
      // these words means; the app's job is to put the rows under them.
      chips: [
        { key: 'purchase', label: 'Purchase' },
        { key: 'sales', label: 'Sales' },
        { key: 'payment', label: 'Payment' },
        { key: 'expense', label: 'Expense' },
        { key: 'cash', label: 'Cash' },
        { key: 'bank', label: 'Bank' },
        { key: 'wages', label: 'Wages' },
        // Tax IS a register — output from the POS, input from the bills.
        // Export folded in too: every register downloads itself, which is
        // closer to the rows than a screen listing seven links to them.
        { key: 'tax', label: 'Tax' },
      ],
    },
    { key: 'parties', href: '/accounts/parties', label: 'Parties' },
    // "Money" beside "Payments" told nobody which was which. This one is
    // where the money SITS; the other is where it goes.
    { key: 'money', href: '/accounts/money', label: 'Cash & bank' },
    // PAYROLL sits between Cash & bank and Close because that is its moment: the
    // month's wages are worked out after the money is reconciled and before
    // the period is shut.
    {
      key: 'payroll',
      href: '/accounts/payroll',
      label: 'Payroll',
      chips: [
        { key: 'runs', label: 'Runs' },
        { key: 'advances', label: 'Advances' },
        { key: 'people', label: 'People' },
      ],
    },
    { key: 'close', href: '/accounts/close', label: 'Close' },
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

/**
 * Where a BADGED tab should land, keyed by tab key — overriding its own href.
 *
 * The Stock badge fires for three different problems and must open the one it
 * is complaining about: negative stock, then unaccepted counts, then reorder.
 * Sending a manager to a fixed default while the book says minus four kilos
 * would make the badge a decoration.
 *
 * The KEY and the tab's own URL are still not settings-editable; this is a
 * server-computed destination for one render, not a second registry.
 */
export type TabHrefs = Partial<Record<string, string>>

/** Counts painted on tabs, keyed by tab key. A tab with no entry, or a
 *  count of zero, wears NO badge — a "0" is a thing to read and dismiss
 *  every time, where absence is silence. */
export type TabBadges = Partial<Record<string, number>>

/** The chips of a tab, for the settings editor and the chip row alike. */
export const chipsOf = (group: TabGroup, tabKey: string): ChipDef[] =>
  TAB_DEFAULTS[group].find((t) => t.key === tabKey)?.chips ?? []
