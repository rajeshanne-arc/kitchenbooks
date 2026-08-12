'use client'

// Importing a statement is a PASTE, and the paste is checked before it is
// saved.
//
// Typing forty bank rows one field at a time is not bookkeeping, it is
// data entry with a hundred chances to fat-finger a digit — so the whole
// block goes in at once, out of the window the accountant already has open.
// What makes that safe is the PREVIEW: every row is parsed on this screen,
// shown as a table, and totalled against the closing balance the provider
// states, before anything is written. A row that cannot be read is named by
// its NUMBER and the save is held — never dropped quietly, because a
// dropped row is a discrepancy somebody hunts for at midnight.

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MoneyAccount } from '@/lib/types'
import { importStatement } from '@/server/reconciliation-actions'
import { decimalStringToPaise, formatPaise } from '@/lib/money'
import { todayLocal } from '@/lib/format'
import AccountPicker from '@/components/accounts/AccountPicker'
import Honesty from '@/components/Honesty'
import { toast } from '@/components/Toasts'
import {
  btnCls,
  cardCls,
  dataTableCls,
  fieldLabelCls,
  inputCls,
  sectionHeadCls,
  tdCls,
  tdNumCls,
  thCls,
  thNumCls,
  trCls,
} from '@/components/ui'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const SIGNED_MONEY = /^-?\d{1,11}(\.\d{1,2})?$/

/** `row` is the line number in the pasted text, so a refusal names the line
 *  the accountant is looking at. */
type ParsedRow = { row: number; date: string; description: string; reference: string; amount: string }
type Problem = { row: number; text: string }
type Parsed = { rows: ParsedRow[]; problems: Problem[]; skippedHeading: boolean }

/** '2026-02-30' passes the regex and is not a day — and a spreadsheet is
 *  exactly where a date like that comes from. */
function isRealDate(iso: string): boolean {
  if (!DATE_RE.test(iso)) return false
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(`${iso}T00:00:00`)
  return dt.getFullYear() === y && dt.getMonth() + 1 === m && dt.getDate() === d
}

function splitCsv(s: string): string[] {
  const out: string[] = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === ',') {
      out.push(cur)
      cur = ''
    } else cur += c
  }
  out.push(cur)
  return out
}

/** Statements print a negative in three ways and all three mean the same
 *  thing. Nothing here guesses a SIGN that was not printed: an amount with
 *  no marking stays positive, and money out of the account has to say so. */
function cleanAmount(raw: string): string {
  let s = raw.trim().replace(/[₹\s,]/g, '')
  let neg = false
  if (/^\(.*\)$/.test(s)) {
    neg = true
    s = s.slice(1, -1)
  }
  if (s.endsWith('-')) {
    neg = true
    s = s.slice(0, -1)
  }
  if (s.startsWith('+')) s = s.slice(1)
  if (s.startsWith('-')) {
    neg = !neg
    s = s.slice(1)
  }
  if (s === '') return ''
  return neg ? `-${s}` : s
}

function parsePaste(text: string): Parsed {
  const rows: ParsedRow[] = []
  const problems: Problem[] = []
  let skippedHeading = false

  const all = text.split(/\r?\n/)
  // The number REPORTED is the line in the PASTE, blank lines counted: an
  // accountant fixes a row by counting down the block they pasted, and a
  // number that only matches if they also skip the blanks sends them to the
  // wrong line — which is the same wasted midnight the naming was for.
  // `seen` is separate because the heading is the first row with anything on
  // it, wherever the blank lines fall.
  let seen = 0
  for (let i = 0; i < all.length; i++) {
    const raw = all[i]
    if (raw.trim() === '') continue
    const n = i + 1
    seen += 1
    const fields = (raw.includes('\t') ? raw.split('\t') : splitCsv(raw)).map((f) => f.trim())

    // A spreadsheet's own heading row, left out ON SCREEN rather than in
    // silence — the count below says one row was set aside and why.
    if (seen === 1 && !DATE_RE.test(fields[0] ?? '') && /date/i.test(raw)) {
      skippedHeading = true
      continue
    }

    if (fields.length < 2 || fields.length > 4) {
      problems.push({
        row: n,
        text: `has ${fields.length} column${fields.length === 1 ? '' : 's'} — a row is date, description, reference, amount`,
      })
      continue
    }

    const date = fields[0]
    const amount = cleanAmount(fields[fields.length - 1])
    const middle = fields.slice(1, -1)
    const description = middle[0] ?? ''
    const reference = middle[1] ?? ''

    if (!isRealDate(date)) {
      problems.push({ row: n, text: `"${date.slice(0, 24)}" is not a date — dates are YYYY-MM-DD` })
      continue
    }
    if (!SIGNED_MONEY.test(amount)) {
      problems.push({ row: n, text: `"${fields[fields.length - 1].slice(0, 24)}" is not an amount` })
      continue
    }
    rows.push({ row: n, date, description: description.slice(0, 300), reference: reference.slice(0, 120), amount })
  }

  return { rows, problems, skippedHeading }
}

export default function StatementImport({ accounts }: { accounts: MoneyAccount[] }) {
  const router = useRouter()
  const [accountId, setAccountId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState(todayLocal())
  const [opening, setOpening] = useState('')
  const [closing, setClosing] = useState('')
  const [note, setNote] = useState('')
  const [paste, setPaste] = useState('')
  const [busy, setBusy] = useState(false)

  const parsed = useMemo(() => parsePaste(paste), [paste])

  const totalPaise = parsed.rows.reduce((a, r) => a + decimalStringToPaise(r.amount), 0)
  const openingClean = cleanAmount(opening)
  const closingClean = cleanAmount(closing)
  const openingOk = openingClean !== '' && SIGNED_MONEY.test(openingClean)
  const closingOk = closingClean !== '' && SIGNED_MONEY.test(closingClean)
  // opening + lines − closing, the same arithmetic reconciliation_status will
  // do once this is saved — stated here so a bad paste is caught before it
  // becomes a row.
  const selfCheck =
    openingOk && closingOk
      ? decimalStringToPaise(openingClean) + totalPaise - decimalStringToPaise(closingClean)
      : null

  // A save button that is off and does not say why is the worst of both —
  // the work is refused and the refusal is silent. One sentence, always.
  const blocker =
    accountId === ''
      ? 'Say which account this statement is for — it is not assumed.'
      : !isRealDate(periodStart) || !isRealDate(periodEnd)
        ? 'Give the period the statement covers.'
        : periodEnd < periodStart
          ? 'The period ends before it starts.'
          : opening.trim() !== '' && !openingOk
            ? 'The opening balance is not a plain amount — digits, at most two decimals.'
            : closing.trim() !== '' && !closingOk
              ? 'The closing balance is not a plain amount — digits, at most two decimals.'
              : parsed.rows.length === 0
                ? 'Paste the statement rows.'
                : parsed.problems.length > 0
                  ? 'Fix the rows named above — nothing goes in while one cannot be read.'
                  : null

  const canSave = !busy && blocker === null

  async function save() {
    if (!canSave) return
    setBusy(true)
    try {
      const res = await importStatement({
        accountId,
        periodStart,
        periodEnd,
        openingBalance: openingOk ? openingClean : '',
        closingBalance: closingOk ? closingClean : '',
        note: note.trim(),
        lines: parsed.rows.map((r) => ({
          date: r.date,
          description: r.description,
          reference: r.reference,
          amount: r.amount,
        })),
      })
      if (!res.ok) {
        toast(res.error, 'error')
        return
      }
      toast(`${parsed.rows.length} lines imported`, 'ok')
      router.push(`/accounts/money/reconcile/${res.statementId}`)
    } catch {
      toast('Could not reach the server — nothing was imported.', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={cardCls}>
      <h2 className={sectionHeadCls}>Import a statement</h2>
      <p className="mt-1 text-xs text-stone-500">
        A period on one account, the opening and closing balance the provider states, and its rows
        pasted in. Nothing here changes a payment or a balance — it records what the provider says,
        so the two lists can be put side by side.
      </p>

      <div className="mt-3 space-y-3">
        <AccountPicker
          accounts={accounts}
          value={accountId}
          onChange={setAccountId}
          label="Which account"
          hint="the bank, wallet or card settlement account this statement belongs to"
        />

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Period from</span>
            <input
              type="date"
              value={periodStart}
              onChange={(e) => setPeriodStart(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>to</span>
            <input
              type="date"
              value={periodEnd}
              onChange={(e) => setPeriodEnd(e.target.value)}
              className={inputCls}
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={fieldLabelCls}>Opening balance</span>
            <input
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              inputMode="decimal"
              placeholder="what the statement opens at"
              className={inputCls}
            />
          </label>
          <label className="block">
            <span className={fieldLabelCls}>Closing balance</span>
            <input
              value={closing}
              onChange={(e) => setClosing(e.target.value)}
              inputMode="decimal"
              placeholder="what it closes at"
              className={inputCls}
            />
          </label>
        </div>

        <label className="block">
          <span className={fieldLabelCls}>Note (optional)</span>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="where this came from — downloaded PDF, printed page, e-mailed CSV"
            className={inputCls}
          />
        </label>

        <label className="block">
          <span className={fieldLabelCls}>Paste the rows</span>
          <textarea
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
            rows={7}
            spellCheck={false}
            placeholder={'2026-07-03, NEFT SHARMA VEG, N1234, -4500\n2026-07-04, UPI ZOMATO, , 18320.50'}
            className={`${inputCls} font-mono text-[13px] leading-relaxed`}
          />
          <span className="mt-1 block text-xs text-stone-500">
            One row per line, separated by commas or tabs:{' '}
            <span className="font-mono">date, description, reference, amount</span>. Dates are
            YYYY-MM-DD. The amount is SIGNED — money out of the account is negative; brackets and a
            trailing minus are read as negative too.
          </span>
        </label>
      </div>

      {(parsed.rows.length > 0 || parsed.problems.length > 0) && (
        <div className="mt-4 border-t border-rule-soft pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className={sectionHeadCls}>Preview</h3>
            <span className="text-xs text-stone-500">
              {parsed.rows.length} row{parsed.rows.length === 1 ? '' : 's'} read
              {parsed.problems.length > 0 && `, ${parsed.problems.length} not read`}
              {parsed.skippedHeading && ', heading row set aside'}
            </span>
          </div>

          {parsed.problems.length > 0 && (
            <div className="mt-2">
              <Honesty level="alarm" verdict="unreadable rows">
                Nothing is imported while a row cannot be read — a statement that goes in with rows
                missing looks reconciled and is not. Fix these in the paste:
                <span className="mt-1.5 block space-y-0.5">
                  {parsed.problems.slice(0, 8).map((p) => (
                    <span key={p.row} className="block font-mono text-[12px]">
                      row {p.row} {p.text}
                    </span>
                  ))}
                  {parsed.problems.length > 8 && (
                    <span className="block text-[12px]">
                      …and {parsed.problems.length - 8} more.
                    </span>
                  )}
                </span>
              </Honesty>
            </div>
          )}

          {parsed.rows.length > 0 && (
            <div className="mt-2 max-h-72 overflow-y-auto overflow-x-auto">
              <table className={dataTableCls}>
                <thead>
                  <tr>
                    <th className={thNumCls}>Line</th>
                    <th className={thCls}>Date</th>
                    <th className={thCls}>Description</th>
                    <th className={thCls}>Reference</th>
                    <th className={thNumCls}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {parsed.rows.map((r) => (
                    <tr key={r.row} className={trCls}>
                      <td className={`${tdNumCls} text-stone-400`}>{r.row}</td>
                      <td className={`${tdCls} whitespace-nowrap font-mono text-[12px]`}>{r.date}</td>
                      <td className={tdCls}>{r.description || <span className="text-stone-400">—</span>}</td>
                      <td className={`${tdCls} font-mono text-[12px] text-stone-500`}>
                        {r.reference || <span className="text-stone-400">—</span>}
                      </td>
                      <td
                        className={`${tdNumCls} ${
                          decimalStringToPaise(r.amount) < 0 ? 'text-red-700' : 'text-stone-900'
                        }`}
                      >
                        {formatPaise(decimalStringToPaise(r.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-stone-500">Rows</dt>
              <dd className="font-mono tabular-nums text-stone-900">{parsed.rows.length}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">They add to</dt>
              <dd className="font-mono tabular-nums text-stone-900">{formatPaise(totalPaise)}</dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Opening</dt>
              <dd className="font-mono tabular-nums text-stone-900">
                {openingOk ? formatPaise(decimalStringToPaise(openingClean)) : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-stone-500">Closing</dt>
              <dd className="font-mono tabular-nums text-stone-900">
                {closingOk ? formatPaise(decimalStringToPaise(closingClean)) : '—'}
              </dd>
            </div>
          </dl>

          <div className="mt-3">
            {selfCheck === null ? (
              <Honesty verdict="cannot check">
                The statement&apos;s own arithmetic is opening plus its rows less closing. Without
                both balances that sum cannot be made, so a paste with a row missing or doubled
                would go in unnoticed. The lines still import; the check simply is not available.
              </Honesty>
            ) : selfCheck !== 0 ? (
              <Honesty level="alarm" verdict="does not add up">
                Opening plus these rows less closing leaves{' '}
                <span className="font-mono tabular-nums">{formatPaise(selfCheck)}</span>. That is a
                fact about the paste or about the statement — not about the books, which have not
                been consulted yet. Usually it means a row was missed, doubled, or a sign is the
                wrong way round. It can still be imported, and it will keep saying this.
              </Honesty>
            ) : (
              <p className="text-sm text-emerald-800">
                Opening plus these rows lands exactly on the closing balance — the paste is whole.
              </p>
            )}
          </div>
        </div>
      )}

      <button type="button" disabled={!canSave} onClick={() => void save()} className={`${btnCls} mt-4`}>
        {busy ? 'Importing…' : `Import ${parsed.rows.length} line${parsed.rows.length === 1 ? '' : 's'}`}
      </button>
      {blocker !== null && <p className="mt-1.5 text-xs text-stone-600">{blocker}</p>}
    </section>
  )
}
