// WHAT THE OWNER ROUTED TO THE PERSON READING THIS SCREEN.
//
// The mirror of MyQueriesPanel, and built to the same law: it renders NOTHING
// when nothing is waiting. A permanent "Routed to you: 0" is a thing to read
// and dismiss every morning, and absence says the same more quietly.
//
// IT IS THE READER THE BADGE NEEDS. `awaiting_me` counts what is waiting on a
// role and the tab strip sums it; a badge whose destination does not mention
// the thing it counted is the fault this file records for the Setup badge
// sending a manager to Lists to find nothing. So the badge sends them here,
// and here says what it counted.
//
// IT DOES NOT ACT, AND THAT IS DELIBERATE RATHER THAN UNFINISHED. Nothing can
// reach this state until the owner has a routing screen — `routePayment` is
// the only thing that sets `assigned_to` to the accountant or the store, and
// it has no screen yet. A form built now would be a form no state could reach,
// which is worse than none. The panel is correct the day routing ships, and a
// gate proves it with a rolled-back fixture rather than waiting for one.
import { getSessionUser } from '@/server/current-user'
import { getRestaurant } from '@/server/queries'
import { listAwaiting } from '@/server/approvals-queries'
import { formatMoneyString } from '@/lib/money'
import { fmtDateTime } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'

export default async function AwaitingPanel() {
  const user = await getSessionUser()
  if (!user) return null
  const restaurant = await getRestaurant()
  // Payments only. This panel is mounted on payment screens, and an owner
  // standing on one should not be shown a discard request they cannot act on
  // from here — the Approvals page is where those live.
  const rows = (await listAwaiting(restaurant.id, user.role)).filter((r) => r.kind === 'payment')
  if (rows.length === 0) return null

  return (
    <section className={`${cardCls} mb-4 border-amber-300`}>
      <h2 className={sectionHeadCls}>Routed to you</h2>
      <ul className="mt-2 divide-y divide-rule-soft">
        {rows.map((r) => (
          <li key={r.id} className="py-2.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-stone-900">{r.from_name ?? 'a vendor'}</span>
              {r.amount !== null && (
                <span className="font-mono font-semibold text-stone-900">{formatMoneyString(r.amount)}</span>
              )}
              {/* THE OWNER'S CHOICE, NOT THE ASKER'S. suggested_mode is what
                  the person who raised it expected; routed_mode is what the
                  owner decided, and the two are allowed to differ. */}
              {r.routed_mode !== null && <span className="text-sm text-stone-600">by {r.routed_mode}</span>}
              <span className="ml-auto text-xs text-stone-400">
                {r.requested_by ?? 'someone'} · {fmtDateTime(r.requested_at)}
              </span>
            </div>
            <p className="mt-1 text-[13px] text-stone-600">“{r.reason}”</p>
            {r.last_note !== null && r.last_action !== 'raised' && (
              <p className="mt-0.5 text-[13px] text-stone-500">
                {r.last_by ?? 'the owner'}: “{r.last_note}”
              </p>
            )}
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[13px] text-stone-500">
        Approved, and none of it has moved. Recording the payment against the request — which is what
        closes it — arrives with the payment screen; paying one of these the ordinary way would leave the
        request open and the money out twice.
      </p>
    </section>
  )
}
