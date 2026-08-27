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
          Words somebody typed and nobody has approved wait in Approvals.
        </p>
      </header>
      <div className="space-y-4">
        {/* THE PENDING QUEUE MOVED TO OWNER › APPROVALS. It was never
            configuration: somebody typed a word and is waiting on a decision,
            and it sat here where nobody looks. Mounted twice it would be two
            doors to one screen, which this repo treats as duplication by
            definition — so this page is the vocabulary, and what is waiting
            lives with everything else that is waiting. */}
        <ListsEditor initialOptions={options} />
      </div>
    </>
  )
}
