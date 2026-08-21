// STORAGE LOCATIONS — the master, beside Lists.
//
// A master rather than a `list_options` key, because items POINT AT a row:
// a rename must follow them, and nothing can point at a list value. Same
// reasoning that moved partners out of that table.
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { listLocations } from '@/server/locations-queries'
import { countUnplacedItems } from '@/server/store-queries'
import LocationsEditor from '@/components/settings/LocationsEditor'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function LocationsPage() {
  const restaurant = await getRestaurant()
  const [locations, placement, user] = await Promise.all([
    listLocations(restaurant.id),
    countUnplacedItems(restaurant.id),
    getSessionUser(),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Storage locations</h1>
        <p className={pageSubCls}>
          {restaurant.name} — where stock sits, in the order somebody walks past it
        </p>
      </header>
      <LocationsEditor
        initial={locations}
        unplaced={placement.unplaced}
        totalItems={placement.total}
        // A PROP, never a literal: /store/masters/items is store, manager and
        // owner, and this screen is manager and owner — so the link is painted
        // only for a reader who can open it.
        itemsHref={user !== null && canAccess(user.role, '/store/masters/items') ? '/store/masters/items' : null}
      />
    </>
  )
}
