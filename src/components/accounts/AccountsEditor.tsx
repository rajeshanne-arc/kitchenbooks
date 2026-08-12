'use client'

// The money-account master. Every form where money moves points at this
// list, so the words here are the words the books will speak for years.
//
// SEED NOTHING. The empty state is the normal first screen, not an error:
// Rajesh names his own — "Drawer", "ICICI current", "Paytm". A shipped
// guess would be wrong in every restaurant and wrong differently in every
// country. KIND is a shape (cash / bank / wallet / card settlement /
// owner / other), never a brand, which is what makes this sellable
// outside the country it was written in.
//
// Retire, never delete: a retired account stops being offered and keeps
// every rupee that ever moved through it.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AccountBalanceRow, MoneyAccount, MoneyAccountKind, SaveMoneyAccountInput } from '@/lib/types'
import { createMoneyAccount, updateMoneyAccount } from '@/server/accounts-actions'
import { formatMoneyString } from '@/lib/money'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  fieldLabelCls,
  inputCls,
  moneyCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'
import { LockedField } from '@/components/books/Locked'
import { toast } from '@/components/Toasts'

const KIND_LABEL: Record<MoneyAccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank',
  wallet: 'Wallet',
  card_settlement: 'Card settlement',
  owner: 'Owner',
  other: 'Other',
}

// What each shape MEANS, so the picker is a decision and not a guess.
const KIND_BLURB: Record<MoneyAccountKind, string> = {
  cash: 'money you can hold — the drawer, a petty box',
  bank: 'a current or savings account',
  wallet: 'UPI and wallet balances',
  card_settlement: 'what the card machine pays in, days later',
  owner: 'an owner paying from their own pocket',
  other: 'anything the five above do not fit',
}

const ORDER: MoneyAccountKind[] = ['cash', 'bank', 'wallet', 'card_settlement', 'owner', 'other']

const blank = (): SaveMoneyAccountInput => ({
  name: '',
  kind: 'cash',
  identifier: '',
  openingBalance: '',
  openingDate: '',
  sortOrder: '',
  status: 'active',
})

const toDraft = (a: MoneyAccount): SaveMoneyAccountInput => ({
  name: a.name,
  kind: a.kind,
  identifier: a.identifier ?? '',
  openingBalance: a.opening_balance,
  openingDate: a.opening_date ?? '',
  sortOrder: String(a.sort_order),
  status: a.status,
})

export default function AccountsEditor({
  initialAccounts,
  balances,
}: {
  initialAccounts: MoneyAccount[]
  balances: AccountBalanceRow[]
}) {
  const router = useRouter()
  const [accounts, setAccounts] = useState(initialAccounts)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<SaveMoneyAccountInput>(blank)
  const [adding, setAdding] = useState(initialAccounts.length === 0)
  const [busy, setBusy] = useState(false)

  const balanceOf = (id: string) => balances.find((b) => b.account_id === id) ?? null

  async function save() {
    if (busy || draft.name.trim() === '') return
    setBusy(true)
    try {
      const res = editing === null ? await createMoneyAccount(draft) : await updateMoneyAccount(editing, draft)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      setAccounts((prev) => {
        const rest = prev.filter((a) => a.id !== res.account.id)
        return [...rest, res.account].sort(
          (a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name),
        )
      })
      toast(editing === null ? `${res.account.name} added` : `${res.account.name} saved`, 'ok')
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

  function startEdit(a: MoneyAccount) {
    setEditing(a.id)
    setAdding(false)
    setDraft(toDraft(a))
  }

  function startAdd() {
    setEditing(null)
    setAdding(true)
    setDraft(blank())
  }

  const groups = ORDER.map((k) => ({ kind: k, rows: accounts.filter((a) => a.kind === k) })).filter(
    (g) => g.rows.length > 0,
  )

  return (
    <div className="space-y-4">
      {accounts.length === 0 && !adding && (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>No accounts yet</h2>
          <p className="mt-1.5 text-sm text-stone-700">
            Name the places money actually sits — the drawer it is counted from, each bank account, each
            wallet. Every money form asks which one, and refuses to guess.
          </p>
          <button type="button" onClick={startAdd} className={`${btnCls} mt-3`}>
            Add the first account
          </button>
        </section>
      )}

      {groups.map((g) => (
        <section key={g.kind} className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>{KIND_LABEL[g.kind]}</h2>
            <span className="text-xs text-stone-400">{KIND_BLURB[g.kind]}</span>
          </div>
          <ul className="mt-2 divide-y divide-rule-soft">
            {g.rows.map((a) => {
              const bal = balanceOf(a.id)
              const retired = a.status === 'inactive'
              return (
                <li key={a.id} className="py-2">
                  {editing === a.id ? (
                    <Fields
                      draft={draft}
                      setDraft={setDraft}
                      lockedKind={a.kind}
                      busy={busy}
                      onSave={() => void save()}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEdit(a)}
                      className="flex min-h-[40px] w-full items-center justify-between gap-3 text-left"
                    >
                      <span className="min-w-0">
                        <span
                          className={`block truncate text-sm ${retired ? 'text-stone-400 line-through' : 'text-stone-900'}`}
                        >
                          {a.name}
                        </span>
                        {a.identifier !== null && (
                          <span className="block truncate font-mono text-[11px] text-stone-500">
                            {a.identifier}
                          </span>
                        )}
                      </span>
                      {/* account_balances covers ACTIVE accounts only, so a
                          retired one says "retired" rather than a dash that
                          would read as "no money ever moved here". */}
                      <span className="shrink-0 text-right">
                        {retired ? (
                          <span className="block text-[11px] text-stone-400">retired</span>
                        ) : (
                          <>
                            <span className={`block text-sm ${moneyCls} text-stone-900`}>
                              {bal === null ? '—' : formatMoneyString(bal.balance)}
                            </span>
                            <span className="block text-[11px] text-stone-400">
                              {bal === null || bal.last_move === null ? 'no movement' : `to ${bal.last_move}`}
                            </span>
                          </>
                        )}
                      </span>
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {adding ? (
        <section className={cardCls}>
          <h2 className={sectionHeadCls}>New account</h2>
          <div className="mt-2">
            <Fields
              draft={draft}
              setDraft={setDraft}
              lockedKind={null}
              busy={busy}
              onSave={() => void save()}
              onCancel={() => setAdding(false)}
            />
          </div>
        </section>
      ) : (
        accounts.length > 0 && (
          <button type="button" onClick={startAdd} className={btnGhostCls}>
            Add an account
          </button>
        )
      )}

      <p className="text-center text-xs text-stone-400">
        Retire, never delete — a retired account stops being offered and keeps everything that moved
        through it.
      </p>
    </div>
  )
}

function Fields({
  draft,
  setDraft,
  lockedKind,
  busy,
  onSave,
  onCancel,
}: {
  draft: SaveMoneyAccountInput
  setDraft: (d: SaveMoneyAccountInput) => void
  /** non-null while editing: kind is locked, and the screen says why */
  lockedKind: MoneyAccountKind | null
  busy: boolean
  onSave: () => void
  onCancel: () => void
}) {
  const set = <K extends keyof SaveMoneyAccountInput>(k: K, v: SaveMoneyAccountInput[K]) =>
    setDraft({ ...draft, [k]: v })

  return (
    <div className="space-y-3">
      <label className="block">
        <span className={fieldLabelCls}>Name</span>
        <input
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Drawer, ICICI current, Paytm"
          maxLength={80}
          className={inputCls}
        />
      </label>

      {lockedKind === null ? (
        <label className="block">
          <span className={fieldLabelCls}>Kind</span>
          <select
            value={draft.kind}
            onChange={(e) => set('kind', e.target.value as MoneyAccountKind)}
            className={selectCls}
          >
            {ORDER.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]} — {KIND_BLURB[k]}
              </option>
            ))}
          </select>
        </label>
      ) : (
        // Locked with its reason, never hidden — the same treatment vendor
        // code and category get. Kind is what every register groups by, so
        // re-typing a bank as cash would rewrite which column its whole
        // history sits in.
        <LockedField
          label="Kind"
          value={KIND_LABEL[lockedKind]}
          reason="Every register groups by kind, so changing it would move this account's whole history into another column. Retire it and open a new one instead."
        />
      )}

      <label className="block">
        <span className={fieldLabelCls}>Identifier (optional)</span>
        <input
          value={draft.identifier}
          onChange={(e) => set('identifier', e.target.value)}
          placeholder="last four digits, UPI handle"
          maxLength={80}
          className={inputCls}
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Opening balance</span>
          <input
            value={draft.openingBalance}
            onChange={(e) => set('openingBalance', e.target.value)}
            inputMode="decimal"
            placeholder="0.00"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>As on</span>
          <input
            type="date"
            value={draft.openingDate}
            onChange={(e) => set('openingDate', e.target.value)}
            className={inputCls}
          />
        </label>
      </div>
      <p className="text-xs text-stone-500">
        The opening balance is what sat here before this app started counting. Leave it blank if the
        account starts at nothing.
      </p>

      <div className="grid grid-cols-2 gap-3">
        <label className="block">
          <span className={fieldLabelCls}>Order</span>
          <input
            value={draft.sortOrder}
            onChange={(e) => set('sortOrder', e.target.value)}
            inputMode="numeric"
            placeholder="auto"
            className={inputCls}
          />
        </label>
        <label className="block">
          <span className={fieldLabelCls}>Status</span>
          <select
            value={draft.status}
            onChange={(e) => set('status', e.target.value as 'active' | 'inactive')}
            className={selectCls}
          >
            <option value="active">Active</option>
            <option value="inactive">Retired</option>
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button type="button" disabled={busy || draft.name.trim() === ''} onClick={onSave} className={btnCls}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button type="button" disabled={busy} onClick={onCancel} className={btnGhostCls}>
          Cancel
        </button>
      </div>
    </div>
  )
}
