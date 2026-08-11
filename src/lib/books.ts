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
    { href: '/kitchen/books/sections', label: 'Sections' },
  ],
  store: [
    { href: '/store/books/bills', label: 'Bills' },
    { href: '/store/books/log', label: 'Store log' },
    { href: '/store/books/stock', label: 'Stock' },
  ],
  sales: [
    { href: '/sales/books/sales', label: 'Sales' },
    { href: '/sales/books/cash', label: 'Cash' },
    { href: '/sales/books/fetch', label: 'Fetch a day' },
  ],
  staff: [{ href: '/staff/books/sections', label: 'Sections' }],
  owner: [],
}
