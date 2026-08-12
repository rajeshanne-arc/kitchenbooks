'use client'

// The account picker, on every form where money moves.
//
// NOTHING IS PRESELECTED, and that is the whole point. `account_id` is
// nullable in the database because history predates accounts and must not
// be rewritten — but a blank on a NEW entry is refused server-side by name.
// Defaulting to "the first bank" would be the third time a stand-in answer
// quietly became the recorded truth (issues.session, recipes.output_qty).
//
// Accounts are user-named and grouped by KIND — cash, bank, wallet, card
// settlement, owner, other — which are shapes rather than brands, so this
// works wherever the product is sold.

import type { MoneyAccount, MoneyAccountKind } from '@/lib/types'
import { fieldLabelCls, selectCls } from '@/components/ui'

const KIND_LABEL: Record<MoneyAccountKind, string> = {
  cash: 'Cash',
  bank: 'Bank',
  wallet: 'Wallet',
  card_settlement: 'Card settlement',
  owner: 'Owner',
  other: 'Other',
}

const ORDER: MoneyAccountKind[] = ['cash', 'bank', 'wallet', 'card_settlement', 'owner', 'other']

export default function AccountPicker({
  accounts,
  value,
  onChange,
  label = 'Money account',
  hint,
  required = true,
}: {
  accounts: MoneyAccount[]
  value: string
  onChange: (id: string) => void
  label?: string
  hint?: string
  /** false only where no money actually moved — an unsettled bank block */
  required?: boolean
}) {
  if (accounts.length === 0) {
    return (
      <label className="block">
        <span className={fieldLabelCls}>{label}</span>
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          No money accounts yet. An owner adds them under Owner → Accounts — the drawer, each bank, each
          wallet. Until then the books cannot say where money went.
        </p>
      </label>
    )
  }

  const groups = ORDER.map((k) => ({ kind: k, rows: accounts.filter((a) => a.kind === k) })).filter(
    (g) => g.rows.length > 0,
  )

  return (
    <label className="block">
      <span className={fieldLabelCls}>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
        <option value="">—</option>
        {groups.map((g) => (
          <optgroup key={g.kind} label={KIND_LABEL[g.kind]}>
            {g.rows.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.identifier !== null && ` · ${a.identifier}`}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {hint !== undefined && <span className="mt-1 block text-xs text-stone-500">{hint}</span>}
      {required && value === '' && (
        <span className="mt-1 block text-xs text-stone-600">
          Not assumed — say which account the money moved through.
        </span>
      )}
    </label>
  )
}
