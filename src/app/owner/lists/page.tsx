// LAW 2 — lists, not free text. Every categorical field in the app reads one
// of these; add here once and every form offers it. Retire, never delete.
import { getRestaurant } from '@/server/queries'
import { getAllListOptions } from '@/server/settings'
import ListsEditor from '@/components/settings/ListsEditor'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ListsPage() {
  const restaurant = await getRestaurant()
  const options = await getAllListOptions(restaurant.id)
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Lists</h1>
        <p className={pageSubCls}>
          {restaurant.name} — every dropdown in the app reads one of these. Free text survives only in notes.
        </p>
      </header>
      <ListsEditor initialOptions={options} />
    </>
  )
}
