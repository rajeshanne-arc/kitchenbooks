'use client'

// The staff identifier block — bank, statutory, personal.
//
// A LIST THAT OPENS, not forty long forms stacked. Eleven fields per person
// expanded all at once is unreadable on a phone, so a row states only who
// they are and whether there is any way to pay them; the editor is opened
// for the one person being dealt with and nobody else.
//
// WHAT THIS SCREEN DOES NOT DO: check a format, compute a rate, or file
// anything. PAN, UAN, PF and ESIC are this country's words and they are the
// column names, so they are the labels — but a checksum rule or a placeholder
// example would bake one country into a field that is only ever recorded as
// typed. A blank field is the ordinary case and is never styled as an error.

import { useState } from 'react'
import PersonLink from '@/components/labour/PersonLink'
import { useRouter } from 'next/navigation'
import type { StaffIdentity, UpdateStaffIdentityInput } from '@/lib/types'
import { updateStaffIdentity } from '@/server/payroll-actions'
import { formatMoneyString } from '@/lib/money'
import { FormGroup, Wide } from '@/components/books/FormGroup'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  btnGhostCls,
  cardCls,
  codeCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  selectCls,
} from '@/components/ui'

/** exactly what the database CHECK accepts — '' clears the column */
const PAY_MODES: { value: '' | 'account' | 'cash'; label: string }[] = [
  { value: '', label: '— not set —' },
  { value: 'account', label: 'Into an account' },
  { value: 'cash', label: 'Cash in hand' },
]

const txt = (s: string | null): string => s ?? ''

/** Payable at all: an account number or a UPI id. A bank name on its own
 *  sends money nowhere. */
const payable = (p: StaffIdentity): boolean => txt(p.account_no) !== '' || txt(p.upi_id) !== ''

/** There is a way to pay them. Cash in hand is an ANSWER, not a blank — a
 *  person paid from the drawer needs no account, and marking them doubtful
 *  for not having one invents a gap that nobody has to close. */
const settled = (p: StaffIdentity): boolean => payable(p) || p.pay_mode === 'cash'

/** What the row says on the right: whether there is a way to pay them, never
 *  what it is. An account number is not a thing to leave lying on a list. */
const marker = (p: StaffIdentity): { label: string; cls: string } => {
  if (p.employment_type === 'contract') return { label: 'vendor-billed', cls: 'text-stone-400' }
  if (payable(p)) return { label: 'details on file', cls: 'text-stone-400' }
  if (p.pay_mode === 'cash') return { label: 'cash in hand', cls: 'text-stone-400' }
  return { label: 'no bank details', cls: 'text-amber-700' }
}

/** Everything the editor seeds from. Changed server data remounts the editor
 *  rather than leaving it holding the figures it mounted with — the same
 *  fault that made the issue form's autofill land nowhere. */
const seed = (p: StaffIdentity): string =>
  [
    p.bank_name, p.account_no, p.ifsc, p.upi_id, p.pan, p.uan,
    p.pf_number, p.esic_number, p.dob, p.gender, p.pay_mode,
    p.aadhaar, p.address,
  ].join('|')

function IdentityEditor({ person, onDone }: { person: StaffIdentity; onDone: () => void }) {
  const router = useRouter()
  const initial: UpdateStaffIdentityInput = {
    bankName: txt(person.bank_name),
    accountNo: txt(person.account_no),
    ifsc: txt(person.ifsc),
    upiId: txt(person.upi_id),
    pan: txt(person.pan),
    uan: txt(person.uan),
    pfNumber: txt(person.pf_number),
    esicNumber: txt(person.esic_number),
    dob: txt(person.dob),
    gender: txt(person.gender),
    payMode: txt(person.pay_mode),
    aadhaar: txt(person.aadhaar),
    address: txt(person.address),
  }
  const [f, setF] = useState<UpdateStaffIdentityInput>(initial)
  const [busy, setBusy] = useState(false)

  const set =
    <K extends keyof UpdateStaffIdentityInput>(k: K) =>
    (v: string) =>
      setF((p) => ({ ...p, [k]: v }))
  const dirty = (Object.keys(initial) as (keyof UpdateStaffIdentityInput)[]).some(
    (k) => f[k].trim() !== initial[k].trim(),
  )

  async function save() {
    if (busy || !dirty) return
    setBusy(true)
    try {
      const res = await updateStaffIdentity(person.id, f)
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast(`${person.name} saved`, 'ok')
      onDone()
      router.refresh()
    } catch {
      toast('Could not reach the server — nothing was saved.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-rule bg-stone-50 p-3">
      {/* what payroll knows about them already, and cannot be changed here */}
      <p className="text-xs text-stone-500">
        {person.employment_type === 'contract'
          ? 'Contract — billed by their vendor, so they never appear on a payroll run.'
          : person.base_salary === null
            ? 'No base salary on record — a run cannot work out what they earned. It is set with the staff record, not here.'
            : `Base salary ${formatMoneyString(person.base_salary)} — set with the staff record, not here.`}
      </p>

      <div className="mt-3 space-y-4">
        <FormGroup title="Banking" hint="Where wages go when they are paid to an account.">
          <label className="block">
            <span className={fieldLabelCls}>Bank name</span>
            <input
              value={f.bankName}
              onChange={(e) => set('bankName')(e.target.value)}
              maxLength={80}
              autoComplete="off"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Account number</span>
            <input
              value={f.accountNo}
              onChange={(e) => set('accountNo')(e.target.value)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>IFSC</span>
            <input
              value={f.ifsc}
              onChange={(e) => set('ifsc')(e.target.value)}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
            <span className="mt-1 block text-xs text-stone-400">
              the bank&rsquo;s routing code — recorded as typed, not checked
            </span>
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Pay mode</span>
            <select
              value={f.payMode}
              onChange={(e) => set('payMode')(e.target.value)}
              className={selectCls}
            >
              {PAY_MODES.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          <Wide>
            <label className="block">
              <span className={fieldLabelCls}>UPI</span>
              <input
                value={f.upiId}
                onChange={(e) => set('upiId')(e.target.value)}
                maxLength={80}
                autoComplete="off"
                spellCheck={false}
                className={inputCls}
              />
            </label>
          </Wide>
        </FormGroup>

        <FormGroup
          title="Statutory"
          hint="Recorded as typed. Nothing here is checked, computed from, or filed with anybody — the rate and the filing are the accountant's."
        >
          <label className="block">
            <span className={fieldLabelCls}>PAN</span>
            <input
              value={f.pan}
              onChange={(e) => set('pan')(e.target.value)}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>UAN</span>
            <input
              value={f.uan}
              onChange={(e) => set('uan')(e.target.value)}
              maxLength={20}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>PF number</span>
            <input
              value={f.pfNumber}
              onChange={(e) => set('pfNumber')(e.target.value)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>ESIC number</span>
            <input
              value={f.esicNumber}
              onChange={(e) => set('esicNumber')(e.target.value)}
              maxLength={40}
              autoComplete="off"
              spellCheck={false}
              className={`${inputCls} font-mono`}
            />
          </label>
        </FormGroup>

        <FormGroup title="Personal">
          <label className="block">
            <span className={fieldLabelCls}>Date of birth</span>
            <input
              type="date"
              value={f.dob}
              onChange={(e) => set('dob')(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            {/* free text in the database, and a two-option dropdown would be
                both less honest and less portable than a field */}
            <span className={fieldLabelCls}>Gender</span>
            <input
              value={f.gender}
              onChange={(e) => set('gender')(e.target.value)}
              maxLength={20}
              autoComplete="off"
              className={inputCls}
            />
            <span className="mt-1 block text-xs text-stone-400">as they state it</span>
          </label>
        </FormGroup>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy || !dirty} onClick={() => void save()} className={btnCls}>
          {busy ? 'Saving…' : 'Save details'}
        </button>
        <button type="button" onClick={onDone} className={btnGhostCls}>
          Close
        </button>
        {!dirty && !busy && <span className="text-xs text-stone-400">nothing changed yet</span>}
      </div>
    </div>
  )
}

export default function PeopleClient({ staff }: { staff: StaffIdentity[] }) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [q, setQ] = useState('')

  if (staff.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-stone-300 bg-paper px-6 py-10 text-center">
        <p className="text-lg font-semibold text-stone-900">Nobody on the roster yet.</p>
        <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
          Staff arrive with the corrected master — nothing here is seeded from a file. The moment
          somebody is on the roster, their bank and statutory details are entered on this screen.
        </p>
      </div>
    )
  }

  const needle = q.trim().toLowerCase()
  const shown =
    needle === ''
      ? staff
      : staff.filter((p) =>
          `${p.code} ${p.name} ${txt(p.section_name)} ${txt(p.designation)}`.toLowerCase().includes(needle),
        )

  // the population a wage is ever worked out for. Contract staff are billed by
  // their vendor and the run query excludes them, so counting them here would
  // report a gap that no payroll will ever have.
  const onRun = staff.filter((p) => p.employment_type !== 'contract')
  const contract = staff.length - onRun.length
  const ready = onRun.filter(settled).length
  const missing = onRun.length - ready
  // set to be paid into an account with nothing to pay into: a contradiction
  // already in the data, not a gap somebody has yet to reach
  const unpayable = onRun.filter((p) => p.pay_mode === 'account' && !payable(p))

  return (
    <div className="space-y-4">
      {missing > 0 && (
        <Honesty
          verdict="no way to pay them"
          meter={{ filled: ready, total: onRun.length, unit: 'people there is a way to pay' }}
        >
          {missing} of {onRun.length} have neither an account number nor a UPI id on file, and are
          not marked as paid cash in hand. A run can still be prepared and approved for them — it is
          the paying that has nowhere to go.
          {contract > 0 &&
            ` ${contract === 1 ? 'One contract person is' : `${contract} contract people are`} not counted: they are billed by their vendor and never appear on a run.`}
        </Honesty>
      )}

      {unpayable.length > 0 && (
        <Honesty level="alarm" verdict="pay mode says account">
          {unpayable.length === 1
            ? `${unpayable[0].name} is set to be paid into an account and has no account number on file.`
            : `${unpayable.length} people are set to be paid into an account and have no account number on file.`}{' '}
          Either the details or the pay mode is wrong; nothing here can tell which.
        </Honesty>
      )}

      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h2 className={sectionHeadCls}>Roster</h2>
          <span className="font-mono text-[10px] text-stone-400">
            {shown.length === staff.length ? `${staff.length}` : `${shown.length}/${staff.length}`}
          </span>
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Filter by name, code or department"
          maxLength={60}
          className={`${inputCls} mt-2`}
        />

        {shown.length === 0 ? (
          <p className="mt-3 text-sm text-stone-500">Nobody matches “{q.trim()}”.</p>
        ) : (
          <ul className="mt-1 divide-y divide-rule-soft">
            {shown.map((p) => {
              const open = openId === p.id
              const m = marker(p)
              return (
                <li key={p.id} className="py-2.5">
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenId(open ? null : p.id)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className={codeCls}>{p.code}</span>
                        <span className="truncate text-[15px] font-medium text-stone-900">
                          <PersonLink code={p.code} name={p.name} />
                        </span>
                      </span>
                      {/* department and job, and nothing personal: a date of
                          birth is not a thing to leave on a scannable list */}
                      <span className="mt-0.5 block truncate text-xs text-stone-500">
                        {p.section_name ?? 'no department'}
                        {p.designation !== null && ` · ${p.designation}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-2">
                      <span className={`text-xs ${m.cls}`}>{m.label}</span>
                      <span aria-hidden className="text-stone-400">
                        {open ? '▴' : '▾'}
                      </span>
                    </span>
                  </button>
                  {open && (
                    <IdentityEditor
                      key={seed(p)}
                      person={p}
                      onDone={() => setOpenId(null)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
