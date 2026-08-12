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
    { href: '/store/books/bills', label: 'Bills' },
    { href: '/store/books/log', label: 'Store log' },
    { href: '/store/books/stock', label: 'Stock' },
    { href: '/store/books/purchases', label: 'Daily purchases' },
    // what the vendor billed and did not deliver, and how each vendor does
    // on that over time — the same question from the line and from the year
    { href: '/store/books/shorts', label: 'Shorts' },
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
