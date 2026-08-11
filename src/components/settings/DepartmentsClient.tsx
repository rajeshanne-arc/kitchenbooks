'use client'

// The departments editor.
//
// THE NAME IS EDITABLE, THE CODE IS NOT, and the reason is on screen: dish
// codes (CH-001) and every issue ever made carry the code. Renaming
// "Chinese" to "Asian" is a label change that lands in three places at once
// because sections is one table; renaming CH would orphan every dish.
//
// Retire, never delete — a retired department keeps its history and stops
// appearing in pickers.

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DepartmentRow } from '@/lib/types'
import { createDepartment, updateDepartment } from '@/server/settings-actions'
import {
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  numCls,
  sectionHeadCls,
  selectCls,
  tdCls,
  tdCodeCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'
import { toast } from '@/components/Toasts'

const GROUPS = ['Management', 'Support', 'Kitchen', 'Service', 'Bar'] as const

export default function DepartmentsClient({ rows }: { rows: DepartmentRow[] }) {
  const router = useRouter()
  // Two tabs on dept_kind. Both lists are the same table and the same
  // editing rules — the split is only so a chef looking for Tandoori does
  // not scroll past Security to reach it.
  const [kind, setKind] = useState<'kitchen' | 'operational'>('kitchen')
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState({ name: '', sortOrder: '', status: 'active' as 'active' | 'inactive' })
  const [adding, setAdding] = useState(false)
  const [neu, setNeu] = useState({
    name: '',
    code: '',
    deptGroup: 'Kitchen' as (typeof GROUPS)[number],
    codesDishes: false,
    sortOrder: '',
    status: 'active' as 'active' | 'inactive',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveEdit(id: string) {
    setBusy(true)
    setError(null)
    try {
      const res = await updateDepartment(id, draft)
      if (res.ok) {
        toast('Department saved — the new name shows on dishes, issues and postings')
        setEditing(null)
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  async function saveNew() {
    setBusy(true)
    setError(null)
    try {
      const res = await createDepartment({ ...neu, deptKind: kind })
      if (res.ok) {
        toast(`${neu.name} added`)
        setNeu({ name: '', code: '', deptGroup: 'Kitchen', codesDishes: false, sortOrder: '', status: 'active' })
        setAdding(false)
        router.refresh()
      } else setError(res.error)
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  const shown = rows.filter((r) => r.dept_kind === kind)
  const counts = {
    kitchen: rows.filter((r) => r.dept_kind === 'kitchen').length,
    operational: rows.filter((r) => r.dept_kind === 'operational').length,
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2" role="group" aria-label="Department kind">
        {(
          [
            { k: 'kitchen' as const, label: 'Kitchen', hint: 'these cook' },
            { k: 'operational' as const, label: 'Operational', hint: 'these do not' },
          ]
        ).map((t) => (
          <button
            key={t.k}
            type="button"
            aria-pressed={kind === t.k}
            onClick={() => setKind(t.k)}
            className={`rounded-xl border px-3.5 py-2 text-left transition-colors ${
              kind === t.k
                ? 'border-emerald-700 bg-emerald-700 text-white'
                : 'border-rule bg-cell text-stone-700 hover:border-emerald-400'
            }`}
          >
            <span className="block text-sm font-semibold">
              {t.label}
              <span className={`ml-1.5 font-mono text-xs ${kind === t.k ? 'text-emerald-100' : 'text-stone-400'}`}>
                {counts[t.k]}
              </span>
            </span>
            <span className={`block text-[11px] ${kind === t.k ? 'text-emerald-100' : 'text-stone-500'}`}>
              {t.hint}
            </span>
          </button>
        ))}
      </div>

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>
            {kind === 'kitchen' ? 'Kitchen departments' : 'Operational departments'}
          </h2>
          <button
            type="button"
            onClick={() => setAdding((a) => !a)}
            className="text-xs font-medium text-emerald-700 hover:underline"
          >
            {adding ? 'cancel' : '＋ add a department'}
          </button>
        </div>

        {adding && (
          <div className="mt-3 rounded-xl border border-rule bg-stone-50 p-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <label className="block">
                <span className={fieldLabelCls}>Name</span>
                <input
                  value={neu.name}
                  onChange={(e) => setNeu((n) => ({ ...n, name: e.target.value }))}
                  className={inputCls}
                  maxLength={60}
                />
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Code</span>
                <input
                  value={neu.code}
                  onChange={(e) => setNeu((n) => ({ ...n, code: e.target.value.toUpperCase().slice(0, 4) }))}
                  placeholder="CH"
                  className={`${inputCls} font-mono uppercase`}
                />
                <span className="mt-1 block text-xs text-stone-500">Permanent once saved.</span>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Group</span>
                <select
                  value={neu.deptGroup}
                  onChange={(e) =>
                    setNeu((n) => ({ ...n, deptGroup: e.target.value as (typeof GROUPS)[number] }))
                  }
                  className={selectCls}
                >
                  {GROUPS.map((g) => (
                    <option key={g} value={g}>
                      {g}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabelCls}>Order</span>
                <input
                  value={neu.sortOrder}
                  onChange={(e) => setNeu((n) => ({ ...n, sortOrder: e.target.value.replace(/\D/g, '') }))}
                  placeholder="last"
                  className={`${numCls} w-full text-right font-mono tabular-nums`}
                />
              </label>
            </div>
            {kind === 'kitchen' && (
              <label className="mt-3 flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={neu.codesDishes}
                  onChange={(e) => setNeu((n) => ({ ...n, codesDishes: e.target.checked }))}
                  className="mt-0.5 h-4 w-4 accent-emerald-700"
                />
                <span className="text-xs text-stone-700">
                  Dishes can be coded to this department.{' '}
                  <span className="text-stone-500">
                    Only tick it for a department that cooks — the code becomes part of every dish code and
                    cannot be moved afterwards.
                  </span>
                </span>
              </label>
            )}

            <button
              type="button"
              onClick={saveNew}
              disabled={busy || neu.name.trim() === '' || neu.code.trim().length < 2}
              className="mt-3 w-full rounded-xl bg-emerald-700 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
            >
              {busy ? 'Saving…' : 'Add department'}
            </button>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-sm text-red-800">
            {error}
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className={dataTableCls}>
            <thead>
              <tr>
                <th className={thCls}>Department</th>
                <th className={thCls}>Code</th>
                <th className={thCls}>Group</th>
                <th className={thNumCls}>Dishes</th>
                <th className={thNumCls}>Issues</th>
                <th className={thNumCls}>Staff</th>
                <th className={thCls}>Status</th>
                <th className={thCls}>
                  <span className="sr-only">Edit</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) =>
                editing === r.id ? (
                  <tr key={r.id} className="h-12 bg-amber-50/40">
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      <input
                        value={draft.name}
                        onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                        className={`${numCls} w-full`}
                        maxLength={60}
                        aria-label="Department name"
                      />
                    </td>
                    <td className={tdCodeCls}>{r.code}</td>
                    <td className={`${tdCls} text-stone-500`}>{r.dept_group}</td>
                    <td className={tdNumCls}>{r.dishes}</td>
                    <td className={tdNumCls}>{r.issues}</td>
                    <td className={tdNumCls}>{r.staff}</td>
                    <td className="border-b border-rule-soft px-1 py-1.5">
                      <select
                        value={draft.status}
                        onChange={(e) =>
                          setDraft((d) => ({ ...d, status: e.target.value as 'active' | 'inactive' }))
                        }
                        className={selectCls}
                        aria-label="Status"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Retired</option>
                      </select>
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <button
                        type="button"
                        onClick={() => void saveEdit(r.id)}
                        disabled={busy || draft.name.trim() === ''}
                        className="min-h-[40px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:bg-stone-300"
                      >
                        Save
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={r.id} className={`${trCls} ${r.status === 'inactive' ? 'opacity-60' : ''}`}>
                    <td className={`${tdCls} font-medium`}>{r.name}</td>
                    <td className={tdCodeCls}>{r.code}</td>
                    <td className={`${tdCls} text-stone-500`}>{r.dept_group}</td>
                    <td className={tdNumCls}>{r.dishes}</td>
                    <td className={tdNumCls}>{r.issues}</td>
                    <td className={tdNumCls}>{r.staff}</td>
                    <td className={`${tdCls} text-stone-500`}>
                      {r.status === 'active' ? 'Active' : 'Retired'}
                    </td>
                    <td className={`${tdCls} text-right`}>
                      <button
                        type="button"
                        onClick={() => {
                          setEditing(r.id)
                          setDraft({ name: r.name, sortOrder: String(r.sort_order), status: r.status })
                          setError(null)
                        }}
                        className="min-h-[40px] rounded-lg border border-rule px-2.5 text-xs font-medium text-stone-600 hover:border-emerald-400 hover:text-emerald-700"
                      >
                        Rename
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-xs text-stone-500">
          The <span className="font-medium">name</span> is a label and can change freely — it lands on dishes,
          issues and staff postings at once, because they all read this one row. The{' '}
          <span className="font-medium">code</span> cannot: every dish code (CH-001) and every issue ever made
          carries it.
        </p>
      </section>
    </div>
  )
}
