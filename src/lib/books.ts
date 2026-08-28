// Each group owns its books. A chef never leaves /kitchen to read a number,
// and the store never goes hunting in someone else's tab. Two views are
// mounted in two groups because two people genuinely need them — the file
// behind them is one file (components/views).
import type { TabGroup } from '@/lib/tabs'

export type BookView = { href: string; label: string }

export const BOOKS: Record<TabGroup, BookView[]> = {
  kitchen: [
    { href: '/kitchen/books/stock', label: 'Stock' },
    { href: '/kitchen/books/food-cost', label: 'Food cost' },
    { href: '/kitchen/books/sections', label: 'By department' },
    { href: '/kitchen/books/suppliers', label: 'Supplier exposure' },
  ],
  store: [
    // BILLS AND DAILY PURCHASES WERE ONE LEDGER, and the duplication rule that
    // retired /store/books/stock — one mount per group — was never applied
    // here. A vendor delivers once a day, so 323 August bills grouped to 301
    // day-vendor rows: 7% fewer rows in exchange for the document number, the
    // vendor's own bill number, the line count and the link to the document.
    // That is the register with information taken out, at 93% of the length.
    // One tab now, three grains behind ?view=; /store/books/bills redirects.
    { href: '/store/books/purchases', label: 'Purchases' },
    { href: '/store/books/log', label: 'Store log' },
    // STOCK MOVED OUT of Books and became a top-level tab with four views.
    // Keeping an entry here would be a second door to the same component in
    // the same group — the duplication test says one mount per group, and the
    // top-level tab is the one that wins. /store/books/stock now redirects.
    //
    // WHAT A VENDOR'S PRICE DID, bill over bill. Beside Purchases because they
    // answer the same question from two sides — what we spent, and what
    // changed underneath it.
    { href: '/store/books/prices', label: 'Price moves' },
    // what the vendor billed and did not deliver, and how each vendor does
    // on that over time — the same question from the line and from the year
    { href: '/store/books/shorts', label: 'Shorts' },
    // BUILT SO A NUMBER HAD SOMEWHERE TO GO. The dashboard's "Paid out" card
    // had no destination — payments live behind a FORM at /store/receive/pay —
    // and a figure linked to a form answers a different question than the one
    // the reader asked.
    { href: '/store/books/payments', label: 'Paid out' },
    { href: '/store/books/vendors', label: 'Vendor performance' },
  ],
  sales: [
    { href: '/sales/books/sales', label: 'Sales' },
    { href: '/sales/books/cash', label: 'Cash' },
    { href: '/sales/books/fetch', label: 'Fetch a day' },
    { href: '/sales/books/gst', label: 'GST & service' },
    { href: '/sales/books/handovers', label: 'Handovers' },
  ],
  // The staff Books tab is GONE: its only entry rendered SectionsView, which
  // the Kitchen group's own Departments tab already shows. One component
  // mounted twice means one mount is duplication by definition.
  staff: [],
  owner: [],
  // The accountant's books ARE the registers, and those land with the rest
  // of the accountant phase. Empty is the honest state until then, not an
  // oversight — /accounts/books does not exist and must not be offered.
  accounts: [],
}
