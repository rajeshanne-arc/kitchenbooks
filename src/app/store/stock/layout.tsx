// STOCK — one tab, four views: On hand | Reorder | Count | Loss.
//
// These were four top-level tabs. They are one question asked four ways —
// what is on the shelf, what has run down, what the shelf actually held when
// somebody looked, and what was thrown away — so they belong behind one door
// with the day's answer on top.
//
// PROMOTING STOCK IS THE POINT. `stock_on_hand` carries the loudest sentence
// in the app — "more issued than purchased on record — a bill is probably
// missing" — and it was two taps deep inside Books. It is now the store
// manager's third tab, so that warning is read daily rather than found.
//
// Nothing here is a new source of truth: every view reads stock_on_hand,
// reorder_due, count_variances and the wastage tables exactly as before.
import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'

export default function StoreStockLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <ChipRow base="/store/stock" chips={chipsOf('store', 'stock')} />
      {children}
    </>
  )
}
