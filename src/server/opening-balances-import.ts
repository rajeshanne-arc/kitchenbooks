'use server'
import { z } from 'zod'
import { parseCsv } from '@/lib/csv'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { postJournalEntryTx } from '@/server/journal'
const HEADERS = ['effective_date', 'account_code', 'debit', 'credit', 'note']
const DATE = /^\d{4}-\d{2}-\d{2}$/
const MONEY = /^\d{1,12}(\.\d{1,2})?$/
async function authorized() { const user = await getSessionUser(); if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can import opening balances'); return user }
export async function previewOpeningBalances(raw: { csv: string }): Promise<{ ok: true; date: string; count: number; total: string } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw); await authorized(); const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 balance rows')
    const header = rows[0].map((x) => x.trim().toLowerCase()); if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const parsed = rows.slice(1).map((r, i) => { if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length); const [date, code, debit, credit, note] = r.map((x) => x.trim()); if (!DATE.test(date) || !code || code.length > 20 || !MONEY.test(debit) || !MONEY.test(credit) || Number(debit) < 0 || Number(credit) < 0 || (Number(debit) === 0) === (Number(credit) === 0) || note.length > 300) throw new Error('Row ' + (i + 2) + ': balance fields are invalid'); return { date, code: code.toUpperCase(), debit, credit } })
    if (new Set(parsed.map((x) => x.date)).size !== 1) throw new Error('One opening-balance import must contain exactly one date')
    const debit = parsed.reduce((sum, x) => sum + Number(x.debit), 0); const credit = parsed.reduce((sum, x) => sum + Number(x.credit), 0); if (Math.round(debit * 100) !== Math.round(credit * 100)) throw new Error('Debits and credits must balance exactly; no balancing account is guessed')
    const rid = (await getRestaurant()).id; const accounts = await tsql<{ code: string }[]>`select code from accounting_accounts where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.code)}::text[]) and status = 'active'`; const known = new Set(accounts.map((x) => x.code.toUpperCase())); for (const [i, row] of parsed.entries()) if (!known.has(row.code)) throw new Error('Row ' + (i + 2) + ': active account code not found: ' + row.code)
    return { ok: true, date: parsed[0].date, count: parsed.length, total: debit.toFixed(2) }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Opening-balance preview failed — nothing was written' } }
}
export async function importOpeningBalances(raw: { csv: string }): Promise<{ ok: true; batchId: string; count: number } | { ok: false; error: string }> {
  try {
    const input = z.object({ csv: z.string().trim().min(1).max(500_000) }).parse(raw)
    const user = await getSessionUser()
    if (!user || !['accountant', 'owner'].includes(user.role)) throw new Error('Only an accountant or owner can import opening balances')
    const rows = parseCsv(input.csv)
    if (rows.length < 2 || rows.length > 501) throw new Error('CSV must contain a header and between 1 and 500 balance rows')
    const header = rows[0].map((x) => x.trim().toLowerCase())
    if (header.length !== HEADERS.length || header.some((x, i) => x !== HEADERS[i])) throw new Error('Use exactly these columns: ' + HEADERS.join(','))
    const parsed = rows.slice(1).map((r, i) => {
      if (r.length !== HEADERS.length) throw new Error('Row ' + (i + 2) + ' has ' + r.length + ' columns; expected ' + HEADERS.length)
      const [date, code, debit, credit, note] = r.map((x) => x.trim())
      if (!DATE.test(date) || !code || code.length > 20) throw new Error('Row ' + (i + 2) + ': effective_date and account_code are required')
      if (!MONEY.test(debit) || !MONEY.test(credit) || Number(debit) < 0 || Number(credit) < 0 || (Number(debit) === 0) === (Number(credit) === 0)) throw new Error('Row ' + (i + 2) + ': enter exactly one positive debit or credit')
      if (note.length > 300) throw new Error('Row ' + (i + 2) + ': note is too long')
      return { date, code: code.toUpperCase(), debit, credit, note }
    })
    const dates = new Set(parsed.map((x) => x.date)); if (dates.size !== 1) throw new Error('One opening-balance import must contain exactly one date')
    const debit = parsed.reduce((sum, x) => sum + Number(x.debit), 0); const credit = parsed.reduce((sum, x) => sum + Number(x.credit), 0)
    if (Math.round(debit * 100) !== Math.round(credit * 100)) throw new Error('Debits and credits must balance exactly; no balancing account is guessed')
    const rid = (await getRestaurant()).id
    const accounts = await tsql<{ id: string; code: string; name: string }[]>`select id, code, name from accounting_accounts where restaurant_id = ${rid} and code = any(${parsed.map((x) => x.code)}::text[]) and status = 'active'`
    const byCode = new Map(accounts.map((x) => [x.code.toUpperCase(), x]))
    const lines = parsed.map((x, i) => { const account = byCode.get(x.code); if (!account) throw new Error('Row ' + (i + 2) + ': active account code not found: ' + x.code); return { accountId: account.id, debit: x.debit, credit: x.credit, description: x.note || account.name } })
    const batchId = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const [batch] = await tx<{ id: string }[]>`insert into opening_balance_batches (restaurant_id, effective_date, note, entered_by) values (${rid}, ${parsed[0].date}, ${'CSV opening-balance import'}, ${user.username}) returning id`
      const evidence = lines.map((line) => ({ restaurant_id: rid, batch_id: batch.id, account_id: line.accountId, debit: line.debit, credit: line.credit }))
      await tx`insert into opening_balance_batch_lines ${tx(evidence, 'restaurant_id', 'batch_id', 'account_id', 'debit', 'credit')}`
      const journalId = await postJournalEntryTx(tx, rid, { date: parsed[0].date, sourceType: 'opening_balance', sourceId: batch.id, memo: 'Opening balances', postedBy: user.username, lines })
      await tx`update opening_balance_batches set journal_entry_id = ${journalId} where restaurant_id = ${rid} and id = ${batch.id}`
      return batch.id
    })
    return { ok: true, batchId, count: lines.length }
  } catch (error) { return { ok: false, error: error instanceof z.ZodError ? 'CSV input is invalid' : error instanceof Error ? error.message : 'Opening-balance import failed — nothing was written' } }
}
export const openingBalancesImportContract = async () => 'CSV columns: effective_date,account_code,debit,credit,note. One date per file; debits and credits must balance exactly. No balancing account is guessed.'
