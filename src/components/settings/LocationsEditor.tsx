'use client'

// WHERE STOCK PHYSICALLY SITS — and the order somebody walks past it.
//
// THE ORDER IS THE FEATURE. `sort_order` is walking order, not alphabetical,
// and it is the whole reason the count sheet is faster than the paper it
// replaces: a sheet in any other order sends the counter back and forth across
// the store, and a count that is exhausting is a count that stops happening.
// The screen says that, because "sort order" on its own invites somebody to
// alphabetise it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SaveLocationInput, StorageLocation } from '@/lib/types'
import { createLocation, moveLocation, updateLocation } from '@/server/locations-actions'
import { toast } from '@/components/Toasts'
import Honesty from '@/components/Honesty'
import SaveAck from '@/components/SaveAck'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'

const KINDS = ['ambient', 'chilled', 'frozen', 'other'] as const
type Kind = (typeof KINDS)[number]

const KIND_LABEL: Record<Kind, string> = {
  ambient: 'Ambient',
  chilled: 'Chilled',
  frozen: 'Frozen',
  other: 'Other',
}

// SHAPES, not temperatures or brands — the same reasoning as money-account
// kinds. A cellar, a cool room and a dry store are all somebody's words for
// one of these four.
const KIND_BLURB: Record<Kind, string> = {
  ambient: 'room temperature — a dry store, a shelf, a cupboard',
  chilled: 'a fridge or cool room',
  frozen: 'a freezer',
  other: 'anything the three above do not fit',
}

const blank = (): SaveLocationInput => ({ name: '', kind: 'ambient', note: '', status: 'active' })
const toDraft = (l: StorageLocation): SaveLocationInput => ({
  name: l.name,
  kind: l.kind,
  note: l.note ?? '',
  status: l.status,
})

export default function LocationsEditor({
  initial,
  unplaced,
  totalItems,
  itemsHref,
}: {
  initial: StorageLocation[]
  /** active items with no location — the reason this screen exists */
  unplaced: number
  totalItems: number
  /** a PROP, never a literal: the item master is store/manager/owner and this
   *  screen is manager/owner, so an owner sees the link and nobody who cannot
   *  open it ever does */
  itemsHref: string | null
}) {
  const router = useRouter()
  const [locations, setLocations] = useState(initial)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(initial.length === 0)
  const [draft, setDraft] = useState<SaveLocationInput>(blank)
  const [busy, setBusy] = useState(false)
  const [ack, setAck] = useState<{ headline: string; sub?: string } | null>(null)

  // THE ACKNOWLEDGEMENT IS INLINE, not only a toast: SaveAck scrolls itself
  // into view, and on a phone the button that triggered this is halfway down
  // a list. `sub` says what is still unplaced, because that is the number
  // somebody can act on while they are still on this screen.
  async function run(
    fn: () => Promise<{ ok: true; locations: StorageLocation[] } | { ok: false; error: string }>,
    ok: string,
  ) {
    if (busy) return
    setBusy(true)
    try {
      const res = await fn()
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setLocations(res.locations)
      const placed = res.locations.reduce((n, l) => n + l.item_count, 0)
      setAck({
        headline: ok,
        sub: `${res.locations.filter((l) => l.status === 'active').length} locations in the walk · ${placed} of ${totalItems} items placed`,
      })
      toast(ok, 'ok')
      setEditing(null)
      setAdding(false)
      setDraft(blank())
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was saved.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      {ack !== null && (
        <div className="mb-3">
          <SaveAck headline={ack.headline} sub={ack.sub} onDismiss={() => setAck(null)} />
        </div>
      )}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Storage locations</h2>
        <span className="font-mono text-[11px] text-stone-400">storage_locations</span>
      </div>
      <p className="mt-1.5 text-sm text-stone-600">
        Where stock physically sits. <b>The order is the order somebody walks the store</b> — not alphabetical. The
        count sheet follows it exactly, so getting it right is what makes a count a single lap instead of four.
      </p>

      {unplaced > 0 && (
        <div className="mt-3">
          <Honesty
            verdict="items not placed"
            meter={{ filled: totalItems - unplaced, total: totalItems, unit: 'items placed' }}
            {...(itemsHref === null ? {} : { action: { href: itemsHref, label: 'Place them on the item master' } })}
          >
            {unplaced} of {totalItems} active {unplaced === 1 ? 'item has' : 'items have'} no location, so the count
            sheet groups {unplaced === 1 ? 'it' : 'them'} at the bottom under “Not placed yet”. Nothing is blocked
            until somebody walks the store — and then those are the ones walked past.
          </Honesty>
        </div>
      )}

      <ul className="mt-3 divide-y divide-rule-soft">
        {locations.map((l, i) => (
          <li key={l.id} className="py-2">
            {editing === l.id ? (
              <Fields
                draft={draft}
                setDraft={setDraft}
                busy={busy}
                itemCount={l.item_count}
                onSave={() => void run(() => updateLocation(l.id, draft), `${draft.name} saved`)}
                onCancel={() => setEditing(null)}
              />
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="mr-2 font-mono text-[11px] tabular-nums text-stone-400">{l.sort_order}</span>
                  <span className={l.status === 'inactive' ? 'text-stone-400 line-through' : 'text-stone-900'}>
                    {l.name}
                  </span>
                  <span className="ml-2 text-[11px] text-stone-400">
                    {KIND_LABEL[l.kind as Kind] ?? l.kind} ·{' '}
                    {l.item_count === 0 ? 'nothing placed here' : `${l.item_count} item${l.item_count === 1 ? '' : 's'}`}
                  </span>
                  {l.note !== null && l.note !== '' && (
                    <span className="ml-2 text-[11px] text-stone-400">— {l.note}</span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    disabled={busy || i === 0}
                    onClick={() => void run(() => moveLocation(l.id, 'up'), `${l.name} moved earlier in the walk`)}
                    aria-label={`Move ${l.name} earlier in the walk`}
                    className="min-h-[40px] min-w-[40px] rounded-lg px-2 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={busy || i === locations.length - 1}
                    onClick={() => void run(() => moveLocation(l.id, 'down'), `${l.name} moved later in the walk`)}
                    aria-label={`Move ${l.name} later in the walk`}
                    className="min-h-[40px] min-w-[40px] rounded-lg px-2 text-stone-500 hover:bg-stone-100 disabled:opacity-30"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(l.id)
                      setAdding(false)
                      setDraft(toDraft(l))
                    }}
                    className="ml-1 text-[13px] font-medium text-emerald-800 underline underline-offset-2"
                  >
                    Edit
                  </button>
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      {adding ? (
        <div className="mt-3">
          <Fields
            draft={draft}
            setDraft={setDraft}
            busy={busy}
            itemCount={0}
            onSave={() => void run(() => createLocation(draft), `${draft.name} added, last in the walk`)}
            onCancel={() => setAdding(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setAdding(true)
            setEditing(null)
            setDraft(blank())
          }}
          className={`${btnGhostCls} mt-3`}
        >
          ＋ Add a location
        </button>
      )}
    </section>
  )
}

function Fields({
  draft,
  setDraft,
  busy,
  itemCount,
  onSave,
  onCancel,
}: {
  draft: SaveLocationInput
  setDraft: (d: SaveLocationInput) => void
  busy: boolean
  itemCount: number
  onSave: () => void
  onCancel: () => void
}) {
  return (
    <div className="rounded-xl border border-rule bg-stone-50 p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className={fieldLabelCls}>Name</span>
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder="Dry store, Walk-in, Bar fridge…"
            className={inputCls}
          />
          <span className="mt-1 block text-xs text-stone-500">
            Renaming follows every item placed here — nothing has to be re-pointed.
          </span>
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Kind</span>
          <select
            value={draft.kind}
            onChange={(e) => setDraft({ ...draft, kind: e.target.value })}
            className={selectCls}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-stone-500">{KIND_BLURB[draft.kind as Kind]}</span>
        </label>
      </div>
      <label className="mt-3 block">
        <span className={fieldLabelCls}>Note — optional</span>
        <input
          value={draft.note}
          onChange={(e) => setDraft({ ...draft, note: e.target.value })}
          placeholder="behind the kitchen door, top two shelves…"
          className={inputCls}
          maxLength={300}
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm text-stone-700">
        <input
          type="checkbox"
          checked={draft.status === 'inactive'}
          onChange={(e) => setDraft({ ...draft, status: e.target.checked ? 'inactive' : 'active' })}
          className="h-4 w-4"
        />
        Retired — stops being offered on the item form
      </label>
      {draft.status === 'inactive' && itemCount > 0 && (
        <p className="mt-1.5 text-xs text-red-800">
          {itemCount} {itemCount === 1 ? 'item is' : 'items are'} still placed here. Retiring does not move
          {itemCount === 1 ? ' it' : ' them'} — {itemCount === 1 ? 'it' : 'they'} will show under “Not placed yet”
          on the count sheet until somebody moves {itemCount === 1 ? 'it' : 'them'}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onSave} disabled={busy || draft.name.trim() === ''} className={btnCls}>
          {busy ? 'Saving…' : 'Save location'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="min-h-[44px] rounded-xl px-4 text-sm font-medium text-stone-600 hover:bg-stone-100"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
