'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createStaff, updateStaff } from '@/server/labour-actions'
import SaveAck, { type Missing } from '@/components/SaveAck'
import type {
  DeptGroup,
  Section,
  StaffIdentity,
  StaffInput,
  StaffRow,
  UpdateStaffIdentityInput,
} from '@/lib/types'
import { parseDecimal } from '@/lib/money'
import { cardCls, fieldLabelCls, inputCls, sectionHeadCls, selectCls } from '@/components/ui'
import { LockedField } from '@/components/books/Locked'

const DEPT_ORDER: DeptGroup[] = ['Management', 'Support', 'Kitchen', 'Service', 'Bar']
const GRADES = ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7']

export default function StaffForm({
  existing,
  identity,
  canEditIdentity,
  sections,
  people,
}: {
  existing: StaffRow | null
  /** null for a manager AND for a new person — see canEditIdentity */
  identity: StaffIdentity | null
  /** OWNER (and accountant) ONLY. The block is not rendered for anyone else
   *  and — the part that matters — the page does not fetch it either, so a
   *  manager's payload never carries an account number. The server refuses a
   *  non-empty block by name regardless: a hidden field is not a check. */
  canEditIdentity: boolean
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
  const [saved, setSaved] = useState<StaffRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [idf, setIdf] = useState<UpdateStaffIdentityInput>(seedIdentity(identity))
  const router = useRouter()
  const setId =
    <K extends keyof UpdateStaffIdentityInput>(k: K) =>
    (v: string) => {
      setIdf((p) => ({ ...p, [k]: v }))
      setSaved(null)
    }

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
    ...(canEditIdentity ? { identity: idf } : {}),
  }

  /** Reset for the next person. Nothing carries: a roster is not a batch of
   *  near-identical rows, and a department or a grade left over from the last
   *  hire is exactly the kind of default that files somebody in the wrong
   *  place. */
  function resetForNext() {
    setName('')
    setDesignation('')
    setSectionId('')
    setGrade('')
    setEmploymentType('full_time')
    setBaseSalary('')
    setPayMode('')
    setJoined('')
    setReportsTo('')
    setPhone('')
    setIdf(seedIdentity(null))
  }

  async function save() {
    if (!canSave) return
    setBusy(true)
    setError(null)
    setSaved(null)
    try {
      const res = existing === null ? await createStaff(input) : await updateStaff(existing.id, input)
      if (res.ok) {
        // STAY HERE, on both paths. A new hire used to throw the form back to
        // the roster list, so adding three people at induction meant finding
        // the Add link twice more — and the CODE, which is assigned inside the
        // save transaction and is permanent, flashed past in a toast.
        setSaved(res.staff)
        if (existing === null) resetForNext()
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

  return (
    <div className="mt-4 space-y-4">
      {saved !== null && (
        <SaveAck
          onDismiss={() => setSaved(null)}
          headline={
            <>
              <span className="font-mono">{saved.code}</span> · {saved.name}
              {existing === null ? ' is on the roster' : ' saved'}
            </>
          }
          sub={
            <>
              {saved.section_name ?? 'no department'}
              {saved.grade !== null && ` · ${saved.grade}`} · {EMPLOYMENT_LABEL[saved.employment_type]}
              {existing === null && ' · the code is permanent — a move is one field, never a new identity'}
            </>
          }
          missing={missingFor(saved)}
          actions={
            existing === null ? [{ href: `/staff/people/employees/${saved.code}`, label: 'Open their record' }] : undefined
          }
        />
      )}
      <section className={cardCls}>
        <div className="flex items-center justify-between">
          <h3 className={sectionHeadCls}>{existing === null ? 'New staff member' : 'Details'}</h3>
        </div>
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={fieldLabelCls}>Name</span>
              <input value={name} onChange={(e) => { setName(e.target.value); setSaved(null) }} className={inputCls} />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Designation</span>
              <input
                value={designation}
                onChange={(e) => { setDesignation(e.target.value); setSaved(null) }}
                placeholder="Cook, Steward…"
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Section</span>
              <select
                value={sectionId}
                onChange={(e) => { setSectionId(e.target.value); setSaved(null) }}
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
              <select value={grade} onChange={(e) => { setGrade(e.target.value); setSaved(null) }} className={selectCls}>
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
                onChange={(e) => { setEmploymentType(e.target.value as typeof employmentType); setSaved(null) }}
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
                  onChange={(e) => { setBaseSalary(e.target.value.replace(/[^\d.]/g, '')); setSaved(null) }}
                  placeholder="—"
                  className={`${inputCls} pl-7`}
                />
              </div>
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Pay mode</span>
              <select value={payMode} onChange={(e) => { setPayMode(e.target.value); setSaved(null) }} className={selectCls}>
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
                onChange={(e) => { setJoined(e.target.value); setSaved(null) }}
                className={inputCls}
              />
            </label>
            <label className="block">
              <span className={fieldLabelCls}>Reports to</span>
              <select
                value={reportsTo}
                onChange={(e) => { setReportsTo(e.target.value); setSaved(null) }}
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
                onChange={(e) => { setPhone(e.target.value); setSaved(null) }}
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
                    onChange={(e) => { setStatus(e.target.value as 'active' | 'inactive'); setSaved(null) }}
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
                    onChange={(e) => { setLeftDate(e.target.value); setSaved(null) }}
                    className={inputCls}
                  />
                </label>
              </>
            )}
          </div>
          {/* THE NOTE THAT USED TO SIT HERE WAS STALE BY THREE PHASES. It said
              "ID and bank details arrive with the login phase" — written in
              phase 5, when there was no login and RLS was off, and correct
              then: the form must not ask for what the app cannot protect.
              Migration 0014 added all ten columns once real auth existed and
              nobody came back for the sentence. */}
          {canEditIdentity ? (
            <IdentityBlock f={idf} set={setId} />
          ) : (
            <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500">
              Bank, PAN and date of birth are held by the owner and the accountant, on{' '}
              <span className="font-medium">Accounts → Payroll → People</span>. Nothing here asks for them, and this
              screen never loads them.
            </p>
          )}
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

const EMPLOYMENT_LABEL: Record<string, string> = {
  full_time: 'full time',
  trainee: 'trainee',
  contract: 'contract — billed by their vendor',
}

const seedIdentity = (i: StaffIdentity | null): UpdateStaffIdentityInput => ({
  bankName: i?.bank_name ?? '',
  accountNo: i?.account_no ?? '',
  ifsc: i?.ifsc ?? '',
  upiId: i?.upi_id ?? '',
  pan: i?.pan ?? '',
  uan: i?.uan ?? '',
  pfNumber: i?.pf_number ?? '',
  esicNumber: i?.esic_number ?? '',
  dob: i?.dob ?? '',
  gender: i?.gender ?? '',
  payMode: i?.pay_mode ?? '',
})

/**
 * WHAT IS STILL MISSING ABOUT A PERSON, and each line is a figure somewhere
 * else that goes quietly wrong without it.
 *
 * No department: labour_cost_by_section files their marks under the loud '—'
 * row and no department carries their cost. No salary: they contribute
 * nothing to labour cost, so the wage bill understates by however much they
 * actually earn — which is `no_salary_set` on the staff dashboard, said here
 * at the moment somebody could type it. Contract staff are excluded from
 * both by design and so are excluded from the warning.
 */
function missingFor(s: StaffRow): Missing[] | undefined {
  if (s.employment_type === 'contract') return undefined
  const gaps: Missing[] = []
  if (s.section_id === null) {
    gaps.push({
      verdict: 'no department',
      text: 'Attendance for them lands in the unassigned row rather than against a kitchen, so no department carries their cost and the roster shows them last and loud.',
    })
  }
  if (s.base_salary === null) {
    gaps.push({
      verdict: 'no salary',
      text: 'They contribute nothing to labour cost, so every wage figure that includes them understates by whatever they actually earn — and a payroll run cannot work out what they are owed.',
    })
  }
  return gaps.length > 0 ? gaps : undefined
}

/**
 * Bank, statutory, personal. Owner and accountant only — see the server: a
 * non-empty block from anyone else is refused by name.
 *
 * NOTHING HERE VALIDATES A FORMAT, masks a field, or offers a fixed list of
 * genders. The labels are this country's words because they are the column
 * names; a checksum or a placeholder would bake one country into a field
 * that is only ever recorded as typed.
 */
function IdentityBlock({
  f,
  set,
}: {
  f: UpdateStaffIdentityInput
  set: <K extends keyof UpdateStaffIdentityInput>(k: K) => (v: string) => void
}) {
  const field = (label: string, k: keyof UpdateStaffIdentityInput, max: number) => (
    <label className="block">
      <span className={fieldLabelCls}>{label}</span>
      <input value={f[k]} onChange={(e) => set(k)(e.target.value)} maxLength={max} autoComplete="off" className={inputCls} />
    </label>
  )
  return (
    <div className="rounded-xl border border-rule bg-stone-50 p-3">
      <h4 className={sectionHeadCls}>Bank &amp; ID</h4>
      <p className="mt-1 text-xs text-stone-500">
        Owner and accountant only. Asked here, at the start, because a field nobody fills on the way past is a field
        nobody ever fills — and a payroll run with no account number pays nobody.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {field('Bank name', 'bankName', 80)}
        {field('Account number', 'accountNo', 40)}
        {field('IFSC', 'ifsc', 20)}
        {field('UPI id', 'upiId', 80)}
        {field('PAN', 'pan', 20)}
        {field('UAN', 'uan', 20)}
        {field('PF number', 'pfNumber', 40)}
        {field('ESIC number', 'esicNumber', 40)}
        <label className="block">
          <span className={fieldLabelCls}>Date of birth</span>
          <input type="date" value={f.dob} onChange={(e) => set('dob')(e.target.value)} className={inputCls} />
        </label>
        {field('Gender', 'gender', 20)}
      </div>
    </div>
  )
}
