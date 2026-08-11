'use client'

// The partners master. Not a list — a list row can hold a name and nothing
// else, and the number that matters here is agreed_commission_pct: what they
// SAID they would take. Every settlement is then measured against it, and the
// dashboard can say "took 26.4% against 24% agreed" instead of just showing
// a deduction and trusting it.
//
// Retire, never delete: a retired partner keeps every settlement it ever had.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Partner } from '@/lib/types'
import { createPartner, updatePartner } from '@/server/cashier-actions'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'

const blank = { name: '', kind: '', agreedCommissionPct: '', status: 'active' as const }

export default function PartnersClient({ partners }: { partners: Partner[] }) {
  const router = useRouter()
  const [form, setForm] = useState<{
    name: string
    kind: string
    agreedCommissionPct: string
    status: 'active' | 'inactive'
  }>(blank)
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = !busy && form.name.trim() !== '' && form.kind.trim() !== ''

  function startEdit(p: Partner) {
    setEditing(p.id)
    setForm({
      name: p.name,
      kind: p.kind,
      agreedCommissionPct: p.agreed_commission_pct ?? '',
      status: p.status,
    })
    setError(null)
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    try {
      const res = editing === null ? await createPartner(form) : await updatePartner(editing, form)
      if (res.ok) {
        toast(editing === null ? `${res.partner.name} added` : `${res.partner.name} saved`)
        setForm(blank)
        setEditing(null)
        router.refresh()
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const missingPct = partners.filter((p) => p.status === 'active' && p.agreed_commission_pct === null)

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>{editing === null ? 'Add a partner' : 'Edit partner'}</h2>
          {editing !== null && (
            <button
              type="button"
              onClick={() => {
                setEditing(null)
                setForm(blank)
                setError(null)
              }}
              className="text-xs font-medium text-stone-500 hover:text-stone-800"
            >
              cancel
            </button>
          )}
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <label className="block">
            <span className={fieldLabelCls}>Name</span>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="Swiggy"
              className={inputCls}
              maxLength={80}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Kind</span>
            <input
              value={form.kind}
              onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
              placeholder="Delivery"
              className={inputCls}
              maxLength={40}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Agreed commission (%)</span>
            <input
              value={form.agreedCommissionPct}
              onChange={(e) =>
                setForm((f) => ({ ...f, agreedCommissionPct: e.target.value.replace(/[^\d.]/g, '') }))
              }
              inputMode="decimal"
              placeholder="24"
              className={`${numCls} w-full text-right font-mono tabular-nums`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Status</span>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as 'active' | 'inactive' }))}
              className={selectCls}
            >
              <option value="active">Active</option>
              <option value="inactive">Retired</option>
            </select>
          </label>
        </div>
        <p className="mt-2 text-xs text-stone-500">
          The agreed percentage is what the gap card measures their actual deduction against. Without it the
          settlement still records, but nobody can say whether they overcharged.
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
        >
          {busy ? 'Saving…' : editing === null ? 'Add partner' : 'Save partner'}
        </button>
      </section>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Partners</h2>
          <span className="font-mono text-[10px] text-stone-400">partners</span>
        </div>
        {missingPct.length > 0 && (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            {missingPct.map((p) => p.name).join(', ')} {missingPct.length === 1 ? 'has' : 'have'} no agreed
            commission on file, so the gap card cannot check what they took.
          </p>
        )}
        {partners.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            No partners yet. Add Swiggy, Zomato and anyone else who sells on your behalf.
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className={dataTableCls}>
              <thead>
                <tr>
                  <th className={thCls}>Partner</th>
                  <th className={thCls}>Kind</th>
                  <th className={thNumCls}>Agreed</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>
                    <span className="sr-only">Edit</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p) => (
                  <tr key={p.id} className={`${trCls} ${p.status === 'inactive' ? 'opacity-60' : ''}`}>
                    <td className={`${tdCls} font-medium`}>{p.name}</td>
                    <td className={`${tdCls} text-stone-600`}>{p.kind}</td>
                    <td className={tdNumCls}>
                      {p.agreed_commission_pct === null ? (
                        <span className="font-sans text-xs text-amber-800">not set</span>
                      ) : (
                        `${p.agreed_commission_pct}%`
                      )}
                    </td>
                    <td className={`${tdCls} text-stone-500`}>
                      {p.status === 'active' ? 'Active' : 'Retired'}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="min-h-[40px] rounded-lg border border-rule px-2.5 text-xs font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700"
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-stone-400">
          Retire, never delete — a retired partner keeps every settlement it ever had.
        </p>
      </section>
    </div>
  )
}
