import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getWastage, getWastageVoidedBy } from '@/server/store-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate, fmtDateTime } from '@/lib/format'
import { ReversalBadge, VoidedBadge } from '@/components/books/Badges'
import VoidWastage from '@/components/store/VoidWastage'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function WastageDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const w = await getWastage(restaurant.id, id)
  if (!w) notFound()

  const voidedBy = w.is_voided ? await getWastageVoidedBy(w.id) : null

  return (
    <div className="mt-4 space-y-4">
      <Link href="/store/books/log" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Store log
      </Link>

      {w.is_voided && voidedBy !== null && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          This write-off was voided —{' '}
          <Link href={`/store/books/wastage/${voidedBy.id}`} className="font-medium underline">
            its reversal
          </Link>{' '}
          cancels it. Stock already reflects that.
        </div>
      )}
      {w.is_reversal && w.reverses_id !== null && (
        <div className="rounded-xl border border-violet-200 bg-violet-50 p-3 text-sm text-violet-800">
          Reversal — inserted to cancel{' '}
          <Link href={`/store/books/wastage/${w.reverses_id}`} className="font-medium underline">
            the original write-off
          </Link>
          . Same unit cost, copied exactly.
        </div>
      )}

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">Wastage · {w.item_name}</h2>
              {w.is_voided && <VoidedBadge />}
              {w.is_reversal && <ReversalBadge />}
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              {fmtDate(w.waste_date)} · <span className="font-mono">{w.item_code}</span>
            </p>
            <p className="mt-0.5 text-xs text-stone-400">
              entered by {w.entered_by ?? '—'} · {fmtDateTime(w.created_at)}
            </p>
          </div>
        </div>

        <dl className="mt-4 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
          <div className="flex items-center justify-between">
            <dt className="text-stone-500">Quantity</dt>
            <dd className="font-medium tabular-nums text-stone-900">
              {w.qty} {w.purchase_unit}
            </dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-stone-500">Unit cost (snapshotted)</dt>
            <dd className="font-medium tabular-nums text-stone-900">{formatMoneyString(w.unit_cost)}</dd>
          </div>
          <div className="flex items-center justify-between">
            <dt className="text-stone-500">Reason</dt>
            <dd className="font-medium text-stone-900">{w.reason}</dd>
          </div>
          {w.note !== null && (
            <div className="flex items-center justify-between">
              <dt className="text-stone-500">Note</dt>
              <dd className="text-stone-900">{w.note}</dd>
            </div>
          )}
          <div className="flex items-center justify-between border-t border-stone-100 pt-2.5">
            <dt className="font-medium text-stone-500">Value written off</dt>
            <dd
              className={`text-2xl font-bold tabular-nums tracking-tight ${
                w.is_reversal ? 'text-stone-900' : 'text-red-700'
              }`}
            >
              {formatMoneyString(w.value)}
            </dd>
          </div>
        </dl>
      </section>

      {!w.is_reversal && !w.is_voided && (
        <VoidWastage wastageId={w.id} itemName={w.item_name} value={w.value} wasteDate={w.waste_date} />
      )}
    </div>
  )
}
