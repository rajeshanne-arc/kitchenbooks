'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AccountingAccount } from '@/lib/types'
import { createAccountingAccount } from '@/server/accounting-accounts'
import { savePostingMapping, type PostingMapping } from '@/server/accounting-mappings'
import { POSTING_KEYS } from '@/lib/accounting'
import { btnCls, cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import SaveAck from '@/components/SaveAck'
import { toast } from '@/components/Toasts'

const TYPES = ['asset', 'liability', 'equity', 'revenue', 'expense'] as const

const MAPPING_LABEL: Record<(typeof POSTING_KEYS)[number], string> = {
  vendor_payable: 'Vendor payable',
  owner_payable: 'Owner payable',
  sales_revenue: 'Sales revenue',
  other_income_revenue: 'Other income revenue',
  inventory_asset: 'Inventory asset',
  input_tax_asset: 'Input tax asset',
  food_cost: 'Food cost',
  operating_expense: 'Operating expense',
  labour_expense: 'Labour expense',
  withholding_payable: 'Withholding payable',
  staff_advance_asset: 'Staff advance asset',
  payroll_deduction_payable: 'Payroll deduction payable',
  pos_cash_asset: 'POS cash settlement asset',
  pos_upi_asset: 'POS UPI settlement asset',
  pos_card_asset: 'POS card settlement asset',
  pos_delivery_asset: 'POS delivery settlement asset',
  pos_receivable_asset: 'POS receivable asset',
  pos_other_asset: 'POS other settlement asset',
  tax_payable: 'Tax payable',
  staff_fund: 'Staff fund liability',
}

export default function AccountingChartEditor({ initial, mappings }: { initial: AccountingAccount[]; mappings: PostingMapping[] }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [type, setType] = useState<(typeof TYPES)[number]>('expense')
  const [busy, setBusy] = useState(false)
  const [mappingBusy, setMappingBusy] = useState<string | null>(null)
  const [ack, setAck] = useState<string | null>(null)

  async function save() {
    if (busy) return
    setBusy(true)
    const result = await createAccountingAccount({ code, name, type })
    setBusy(false)
    if (!result.ok) return toast(result.error, 'error')
    setAck(`${result.account.code} added`)
    setCode(''); setName(''); setType('expense'); router.refresh()
  }

  async function saveMapping(mappingKey: string, accountId: string) {
    if (accountId === '' || mappingBusy !== null) return
    setMappingBusy(mappingKey)
    const result = await savePostingMapping({ mappingKey, accountId })
    setMappingBusy(null)
    if (!result.ok) return toast(result.error, 'error')
    setAck(`${MAPPING_LABEL[mappingKey as (typeof POSTING_KEYS)[number]]} mapped`)
    router.refresh()
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Chart of accounts</h2>
      <p className="mt-1.5 text-sm text-stone-600">
        These are the accounts used by the journal. Add the restaurant&apos;s own accounts; tax and bank
        treatment is never guessed.
      </p>
      <div className="mt-3 space-y-2">
        {initial.map((account) => (
          <div key={account.id} className="flex items-center justify-between border-b border-rule-soft py-1.5 text-sm">
            <span className={account.status !== 'active' ? 'opacity-60 line-through' : ''}><span className="mr-2 font-mono text-xs text-stone-500">{account.code}</span>{account.name}{account.status !== 'active' && ' · retired'}</span>
            <span className="text-xs text-stone-500">{account.account_type}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label><span className={fieldLabelCls}>Code</span><input className={inputCls} value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. FOOD" /></label>
        <label><span className={fieldLabelCls}>Name</span><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Food cost" /></label>
        <label><span className={fieldLabelCls}>Type</span><select className={selectCls} value={type} onChange={(e) => setType(e.target.value as (typeof TYPES)[number])}>{TYPES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      </div>
      <button type="button" onClick={() => void save()} disabled={busy || code.trim() === '' || name.trim() === ''} className={`${btnCls} mt-3 disabled:opacity-50`}>{busy ? 'Saving…' : 'Add account'}</button>
      <div className="mt-5 border-t border-rule-soft pt-4">
        <h3 className="text-sm font-medium text-stone-900">Posting mappings</h3>
        <p className="mt-1 text-xs text-stone-600">A source workflow stays unposted until its required concept is mapped explicitly.</p>
        <div className="mt-2 space-y-2">
          {POSTING_KEYS.map((key) => {
            const current = mappings.find((mapping) => mapping.mapping_key === key)
            return <label key={key} className="flex items-center justify-between gap-3 text-sm"><span>{MAPPING_LABEL[key]}</span><select className={`${selectCls} max-w-[18rem]`} value={current?.account_id ?? ''} disabled={mappingBusy !== null} onChange={(e) => void saveMapping(key, e.target.value)}><option value="">— not mapped —</option>{initial.filter((account) => account.status === 'active').map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
          })}
        </div>
      </div>
      {ack !== null && <SaveAck headline={ack} sub="The accounting configuration is now active for this restaurant." onDismiss={() => setAck(null)} />}
    </section>
  )
}
