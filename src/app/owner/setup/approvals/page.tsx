import { getRestaurant } from '@/server/queries'
import {
  getPreview,
  listApprovals,
  type ApprovalEntity,
  type ApprovalKind,
} from '@/server/approvals-queries'
import ApprovalsClient, { type QueueItem } from '@/components/settings/ApprovalsClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function ApprovalsPage() {
  const restaurant = await getRestaurant()
  const rows = await listApprovals(restaurant.id, false)

  // THE FRESH CHECK IS RUN HERE, at page load, for everything still pending.
  // It is not the authority — merge_items re-runs every guard under a row lock
  // when it applies — but the owner must not be deciding from a snapshot taken
  // days ago, and the DIFFERENCE between the two is itself the finding.
  const items: QueueItem[] = await Promise.all(
    rows.map(async (row): Promise<QueueItem> => {
      if (row.status !== 'pending') return { row, fresh: null, freshError: null }
      try {
        const fresh = await getPreview(
          restaurant.id,
          row.kind as ApprovalKind,
          row.entity_type as ApprovalEntity,
          row.entity_id,
          row.target_entity_id,
        )
        return { row, fresh, freshError: null }
      } catch (e) {
        return { row, fresh: null, freshError: e instanceof Error ? e.message : 'could not be re-checked' }
      }
    }),
  )

  return (
    <div className="mt-4 space-y-4">
      <div>
        <h2 className={pageTitleCls}>Approvals</h2>
        <p className={pageSubCls}>
          An action that leaves a trace needs no permission; an action that leaves none needs approval.
          Discarding and merging are the only two here — a void writes a negative twin, a retirement leaves
          the row, a corrected mark keeps both.
        </p>
      </div>
      <ApprovalsClient items={items} />
    </div>
  )
}
