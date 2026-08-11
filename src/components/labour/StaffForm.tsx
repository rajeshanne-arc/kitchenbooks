'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStaff, updateStaff } from '@/server/labour-actions'
import type { DeptGroup, Section, StaffInput, StaffRow } from '@/lib/types'
import { parseDecimal } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from '@/components/books/Locked'

const DEPT_ORDER: DeptGroup[] = ['Management', 'Support', 'Kitchen', 'Service', 'Bar']
const GRADES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']

export default function StaffForm({
  existing,
  sections,
  people,
}: {
  existing: StaffRow | null
  sections: Section[]
  people: { id: string; code: string; name: string }[]
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [designation, setDesignation] = useState(existing?.designation ?? '')
  const [sectionId, setSectionId] = useState(existing?.section_id ?? '')
  const [grade, setGrade] = useState(existing?.grade ?? '')
  const [employmentType, setEmploymentType] = useState<'full_time' | 'trainee' | 'contract'>(
    existing?.employment_type ?? 'full_time',
  )
  const [baseSalary, setBaseSalary] = useState(existing?.base_salary ?? '')
  const [payMode, setPayMode] = useState(existing?.pay_mode ?? '')
  const [joined, setJoined] = useState(existing?.joined ?? '')
  const [leftDate, setLeftDate] = useState(existing?.left_date ?? '')
  const [reportsTo, setReportsTo] = useState(existing?.reports_to ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [status, setStatus] = useState<'active' | 'inactive'>(existing?.status ?? 'active')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()

  const salaryOk = baseSalary.trim() === '' || parseDecimal(baseSalary.trim(), 2, 7) !== null
  const canSave = !busy && name.trim() !== '' && salaryOk

  const input: StaffInput = {
    name: name.trim(),
    designation: designation.trim(),
    sectionId,
    grade,
    employmentType,
    baseSalary: baseSalary.trim(),
    payMode,
    joined,
    leftDate,
    reportsTo,
    phone: phone.trim(),
    status,
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const res = existing === null ? await createStaff(input) : await updateStaff(existing.id, input)
      if (res.ok) {
        if (existing === null) {
          router.push('/staff/people/employees')
        } else {
          setSaved(true)
          router.refresh()
        }
      } else {
        setError(res.error)
      }
    } catch {
      setError('Could not reach the server — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 space-y-4">
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h3 className={sectionHeadCls}>{existing === null ? 'New staff member' : 'Details'}</h3>
          {saved && <span className="text-xs font-medium text-emerald-700">Saved ✓</span>}
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} className={inputCls} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Designation</span>
              <input
                value={designation}
                onChange={(e) => { setDesignation(e.target.value); setSaved(false) }}
                placeholder="Cook, Steward…"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Section</span>
              <select
                value={sectionId}
                onChange={(e) => { setSectionId(e.target.value); setSaved(false) }}
                className={selectCls}
              >
                <option value="">— Unassigned</option>
                {DEPT_ORDER.map((g) => (
                  <optgroup key={g} label={g}>
                    {sections
                      .filter((s) => s.dept_group === g)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Grade</span>
              <select value={grade} onChange={(e) => { setGrade(e.target.value); setSaved(false) }} className={selectCls}>
                <option value="">—</option>
                {GRADES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Employment type</span>
              <select
                value={employmentType}
                onChange={(e) => { setEmploymentType(e.target.value as typeof employmentType); setSaved(false) }}
                className={selectCls}
              >
                <option value="full_time">Full-time</option>
                <option value="trainee">Trainee</option>
                <option value="contract">Contract</option>
              </select>
              {employmentType === 'contract' && (
                <span className="mt-1 block rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800">
                  billed by their vendor — excluded from labour cost
                </span>
              )}
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Base salary (monthly)</span>
              <div className="relative">
                <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-stone-400">
                  ₹
                </span>
                <input
                  inputMode="decimal"
                  value={baseSalary}
                  onChange={(e) => { setBaseSalary(e.target.value.replace(/[^\d.]/g, '')); setSaved(false) }}
                  placeholder="—"
                  className={`${inputCls} pl-7`}
                />
              </div>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Pay mode</span>
              <select value={payMode} onChange={(e) => { setPayMode(e.target.value); setSaved(false) }} className={selectCls}>
                <option value="">—</option>
                <option value="account">Account</option>
                <option value="cash">Cash</option>
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Joined</span>
              <input
                type="date"
                value={joined}
                onChange={(e) => { setJoined(e.target.value); setSaved(false) }}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Reports to</span>
              <select
                value={reportsTo}
                onChange={(e) => { setReportsTo(e.target.value); setSaved(false) }}
                className={selectCls}
              >
                <option value="">—</option>
                {people
                  .filter((p) => p.id !== existing?.id)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.code}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Phone</span>
              <input
                inputMode="tel"
                value={phone}
                onChange={(e) => { setPhone(e.target.value); setSaved(false) }}
                placeholder="optional"
                className={inputCls}
              />
            </label>
            {existing !== null && (
              <>
                <label className="block">
                  <span className={fieldLabelCls}>Status</span>
                  <select
                    value={status}
                    onChange={(e) => { setStatus(e.target.value as 'active' | 'inactive'); setSaved(false) }}
                    className={selectCls}
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Retired (inactive)</option>
                  </select>
                  <span className="mt-1 block text-xs text-stone-500">retire, never delete — history stays</span>
                </label>
                <label className="block">
                  <span className={fieldLabelCls}>Left date</span>
                  <input
                    type="date"
                    value={leftDate}
                    onChange={(e) => { setLeftDate(e.target.value); setSaved(false) }}
                    className={inputCls}
                  />
                </label>
              </>
            )}
          </div>
          <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
            ID and bank details arrive with the login phase.
          </p>
        </div>
      </section>

      {error && (
        <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      <button
        type="button"
        onClick={save}
        disabled={!canSave}
        className="w-full rounded-xl bg-emerald-700 py-3 text-[15px] font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
      >
        {busy ? 'Saving…' : existing === null ? 'Add to the roster' : 'Save details'}
      </button>

      {existing !== null && (
        <div className="grid gap-2 sm:grid-cols-2">
          <LockedField
            label="Code"
            value={existing.code}
            reason="Permanent ID — a move is one field, never a new identity."
          />
          <LockedField
            label="Identity & bank"
            value="not collected"
            reason="No such columns exist until real auth — the form does not collect what the database refuses."
          />
        </div>
      )}
    </div>
  )
}
