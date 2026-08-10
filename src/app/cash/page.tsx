import { getMasters, getRestaurant } from '@/server/queries'
import { getClosePrefill, getOwnerNames, getVoucherCategories } from '@/server/cash-queries'
import { todayIST } from '@/server/store-queries'
import DayClose from '@/components/cash/DayClose'
import VoucherForm from '@/components/cash/VoucherForm'
import OtherIncomeForm from '@/components/cash/OtherIncomeForm'

export const dynamic = 'force-dynamic'

export default async function CashPage() {
  const restaurant = await getRestaurant()
  const today = todayIST()
  const [prefill, ownerNames, categories, { units }] = await Promise.all([
    getClosePrefill(restaurant.id, today),
    getOwnerNames(restaurant.id),
    getVoucherCategories(restaurant.id),
    getMasters(),
  ])

  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <header className="pb-5">
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">Cash</h1>
        <p className="mt-0.5 text-sm text-stone-400">{restaurant.name} — the cashier’s day</p>
      </header>
      <div className="space-y-4">
        <DayClose defaultDate={today} initialPrefill={prefill} />
        <VoucherForm ownerNames={ownerNames} categories={categories} />
        <OtherIncomeForm units={units} />
      </div>
    </main>
  )
}
