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

import Link from 'next/link'
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
  manageHref = null,
}: {
  accounts: MoneyAccount[]
  value: string
  onChange: (id: string) => void
  label?: string
  hint?: string
  /** false only where no money actually moved — an unsettled bank block */
  required?: boolean
  /** where THIS viewer may go to create accounts, or null if they may not.
   *  Passed in rather than decided here: the matrix is server-side, and a
   *  link nobody can open is worse than no link. */
  manageHref?: string | null
}) {
  // THE EMPTY STATE IS A ROUTE OUT, not a refusal.
  //
  // Nine forms refuse a blank account, and on the day this shipped the list
  // was empty in every restaurant using it. A person who cannot save and is
  // not told why concludes the app is broken — and they are not wrong to,
  // because a refusal with no next step IS broken. So this names the thing
  // that is missing, who creates it, and exactly where.
  //
  // The link is a PROP and never a literal here: /owner/accounts is open to
  // the owner and the accountant only, and a cashier shown a link they
  // cannot open is the invisibility law broken in the smallest possible way.
  if (accounts.length === 0) {
    return (
      <label className="block">
        <span className={fieldLabelCls}>{label}</span>
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
          <p className="font-medium">No money accounts yet — this cannot be saved.</p>
          <p className="mt-1">
            Somebody names them once: the till, each bank account, each wallet. An owner does it under
            Owner → Money accounts, and the accountant can from Accounts → Money. Until one exists the
            books have nowhere to put this.
          </p>
          {manageHref !== null && (
            <Link
              href={manageHref}
              className="mt-1.5 inline-block font-semibold underline underline-offset-2 hover:text-amber-950"
            >
              Set them up now
            </Link>
          )}
        </div>
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
