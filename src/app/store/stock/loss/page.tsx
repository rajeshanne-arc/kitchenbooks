import WastageEntry from '@/components/store/WastageEntry'
import { getRestaurant } from '@/server/queries'
import { getList } from '@/server/settings'
import { issueContext } from '@/server/store-queries'
import NothingIssued from '@/components/stock/NothingIssued'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function WastagePage() {
  const restaurant = await getRestaurant()
  const [reasons, ctx] = await Promise.all([
    getList(restaurant.id, 'waste_reason'),
    issueContext(restaurant.id),
  ])
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Record wastage</h1>
        <p className={pageSubCls}>{restaurant.name} store</p>
      </header>
      {/* THE SAME FACT, THE LOSS TAIL. Above the form for the same reason it
          sits above the value card on On hand: it qualifies what follows. */}
      {!ctx.issued && ctx.since !== null && (
        <NothingIssued tail="loss" since={ctx.since} bills={ctx.bills} />
      )}
      <div className="mt-4">
        <WastageEntry reasons={reasons} />
      </div>
    </>
  )
}
