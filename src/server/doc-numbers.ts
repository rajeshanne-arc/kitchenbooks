// Document numbers — the handle an accountant asks about a record by.
//
// `next_doc_no(restaurant, type, fy)` is a SECURITY DEFINER function that
// bumps `doc_sequences` with an upsert and returns TYPE-FY-0001. It is
// gapless because the increment and the read are one statement, and it must
// be called INSIDE the same transaction as the insert it numbers: if the
// insert rolls back, so does the number, and the series stays unbroken.
// Calling it before `sql.begin` would burn a number on every failed save.
//
// A VOID KEEPS ITS NUMBER and the reversal takes its own. Nothing is ever
// reused and nothing is ever renumbered — a document number is what a
// question refers to months later ("what was PAY-2627-0018?"), so it has to
// mean one thing forever, including when that one thing was a mistake.

import 'server-only'
import type postgres from 'postgres'
import { fyLabel, parseFyStartMonth } from '@/lib/fy'

/** The eight series. PUR purchases · PAY vendor payments · EXP expenses ·
 *  VCH cash vouchers · CON contract bills · CAS casual labour ·
 *  ADV staff advances · RUN payroll runs. */
export type DocType = 'PUR' | 'PAY' | 'EXP' | 'VCH' | 'CON' | 'CAS' | 'ADV' | 'RUN'

export const DOC_TYPES: DocType[] = ['PUR', 'PAY', 'EXP', 'VCH', 'CON', 'CAS', 'ADV', 'RUN']

/** What each prefix means, for a register legend or a tooltip. */
export const DOC_TYPE_NAMES: Record<DocType, string> = {
  PUR: 'Purchase',
  PAY: 'Vendor payment',
  EXP: 'Expense',
  VCH: 'Cash voucher',
  CON: 'Contract bill',
  CAS: 'Casual labour',
  ADV: 'Staff advance',
  RUN: 'Payroll run',
}

/**
 * The next number in `type`'s series for the financial year `dateISO` falls
 * in. Takes the transaction, never the pool: the number and the row it
 * belongs to live or die together.
 *
 * The FY start month is read on the SAME connection rather than through
 * `getSettingValue`, which would check out a second connection while this
 * transaction holds one — the shape that deadlocked the pool once already.
 */
export async function nextDocNo(
  tx: postgres.TransactionSql,
  restaurantId: string,
  type: DocType,
  dateISO: string,
): Promise<string> {
  const [setting] = await tx<{ value: string }[]>`
    select value from settings
    where restaurant_id = ${restaurantId} and key = 'fy_start_month'`
  const fy = fyLabel(dateISO, parseFyStartMonth(setting?.value ?? null))
  const [row] = await tx<{ next_doc_no: string }[]>`
    select next_doc_no(${restaurantId}, ${type}, ${fy}) as next_doc_no`
  if (!row?.next_doc_no) throw new Error(`could not allocate a ${type} document number`)
  return row.next_doc_no
}
