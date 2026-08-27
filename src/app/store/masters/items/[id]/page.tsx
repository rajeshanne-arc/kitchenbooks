import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getRestaurant, getMasters } from '@/server/queries'
import { getItemDetail, getItemLedger, getItemStock, listActiveVendors } from '@/server/books-queries'
import { listActiveLocations } from '@/server/locations-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import ItemLedger from '@/components/books/ItemLedger'
import { StatusBadge } from '@/components/books/Badges'
import ItemEdit from '@/components/books/ItemEdit'
import MasterActions, { ClosedNote } from '@/components/books/MasterActions'
import { pendingFor, REQUESTERS } from '@/server/approvals-queries'
import { getSessionUser } from '@/server/current-user'
import { cardCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function ItemDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const item = await getItemDetail(restaurant.id, id)
  if (!item) notFound()

  const [{ units }, ledger, stock, vendors, locations, open, user] = await Promise.all([
    getMasters(),
    getItemLedger(restaurant.id, id),
    getItemStock(restaurant.id, id),
    listActiveVendors(restaurant.id),
    listActiveLocations(restaurant.id),
    pendingFor(restaurant.id, id),
    getSessionUser(),
  ])

  return (
    <div className="mt-4 space-y-4">
      <Link href="/store/masters/items" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Items
      </Link>

      <section className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold text-stone-900">{item.name}</h2>
              <StatusBadge status={item.status} />
            </div>
            <p className="mt-0.5 text-sm text-stone-500">
              <span className="font-mono">{item.code}</span> · {item.category_name} · bought per{' '}
              {item.purchase_unit_name}
            </p>
          </div>
          <div className="text-right">
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Rate prefill</div>
            {item.prefill_rate !== null ? (
              <>
                <div className="text-2xl font-bold tabular-nums tracking-tight text-stone-900">
                  {formatMoneyString(item.prefill_rate)}
                </div>
                <div className="mt-0.5 text-xs text-stone-500">
                  {item.last_rate !== null && item.last_rate_date !== null
                    ? `last billed ${fmtDate(item.last_rate_date)}`
                    : 'from opening rate — no bills yet'}
                  {' · item_rates'}
                </div>
              </>
            ) : (
              <div className="text-sm text-stone-400">
                none yet — the first bill sets it
                <br />
                (or seed an opening rate below)
              </div>
            )}
          </div>
        </div>
      </section>

      {/* A CLOSED CODE STAYS RESOLVABLE FOREVER, and this is where it says so:
          looking up HKP-024 tells you it became HKP-015. That is what makes
          closing one safe to do at all — nothing that was ever written down
          becomes unreadable. */}
      <ClosedNote
        status={item.status}
        becameHref={item.merged_into === null ? undefined : `/store/masters/items/${item.merged_into}`}
        becameCode={item.merged_into_code}
        becameName={item.merged_into_name}
      />

      <ItemEdit locations={locations} item={item} units={units} vendors={vendors} />

      <MasterActions
        entity="item"
        row={{ id: item.id, code: item.code, name: item.name, status: item.status }}
        open={open[0] ?? null}
        canRequest={user !== null && REQUESTERS.includes(user.role)}
      />

      {/* THE POSITION AND THE LEDGER. This page used to say what an item IS and
          what it last COST, and nothing about what we HAVE or what HAPPENED —
          so a person clicking a stock figure landed on a page that did not
          mention stock. The Purchase history section that stood here is gone:
          its rows are the Purchase rows of the ledger, and two lists of the
          same bills is how they drift. */}
      <ItemLedger
        rows={ledger.rows}
        total={ledger.total}
        stock={stock}
        unit={item.purchase_unit_name}
      />
    </div>
  )
}
