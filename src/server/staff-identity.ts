import 'server-only'
import { z } from 'zod'
import type postgres from 'postgres'
import type { UpdateStaffIdentityInput } from '@/lib/types'

// THE IDENTIFIER BLOCK, IN ONE PLACE.
//
// Bank, statutory, personal — eleven columns that two screens write: the
// accountant's /accounts/payroll/people, and the owner's half of the staff
// form. Two write paths to one set of columns is exactly how they drift, so
// the schema, the emptiness test and the SET list live here and both actions
// import them.
//
// It is deliberately NOT a 'use server' file. Everything exported from one of
// those becomes a client-callable endpoint, and `assertIdentityActor` is a
// guard rather than an action — the same reason `assertAccount` lives outside
// accounts-actions.
//
// NOTHING HERE VALIDATES A FORMAT. PAN, UAN, PF and ESIC are this country's
// words and they are the column names, so they are the labels — but a
// checksum, a placeholder or a fixed list of genders would bake one country
// into a field that is only ever recorded as typed.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export const IdentitySchema = z.object({
  bankName: z.string().trim().max(80),
  accountNo: z.string().trim().max(40),
  ifsc: z.string().trim().max(20),
  upiId: z.string().trim().max(80),
  pan: z.string().trim().max(20),
  uan: z.string().trim().max(20),
  pfNumber: z.string().trim().max(40),
  esicNumber: z.string().trim().max(40),
  dob: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  gender: z.string().trim().max(20),
  payMode: z.union([z.literal(''), z.enum(['account', 'cash'])]),
  aadhaar: z.string().trim().max(20),
  address: z.string().trim().max(300),
})

export type Identity = z.infer<typeof IdentitySchema>

export const BLANK_IDENTITY: UpdateStaffIdentityInput = {
  bankName: '',
  accountNo: '',
  ifsc: '',
  upiId: '',
  pan: '',
  uan: '',
  pfNumber: '',
  esicNumber: '',
  dob: '',
  gender: '',
  payMode: '',
  aadhaar: '',
  address: '',
}

/** Every field blank. A manager's form submits this and nothing is written,
 *  so the role check only fires when somebody is actually recording an
 *  identifier — a blank block is not an attempt. */
export const identityIsEmpty = (i: Identity): boolean => Object.values(i).every((v) => v === '')

const orNull = (s: string) => (s === '' ? null : s)

/**
 * The SET list, once. Takes the handle so it can run inside the same
 * transaction as a staff INSERT — a person and their bank details commit or
 * roll back together, never half.
 */
export async function writeIdentity(tx: postgres.TransactionSql, staffId: string, rid: string, i: Identity): Promise<boolean> {
  const rows = await tx<{ id: string }[]>`
    update staff set
      bank_name = ${orNull(i.bankName)},
      account_no = ${orNull(i.accountNo)},
      ifsc = ${orNull(i.ifsc)},
      upi_id = ${orNull(i.upiId)},
      pan = ${orNull(i.pan)},
      uan = ${orNull(i.uan)},
      pf_number = ${orNull(i.pfNumber)},
      esic_number = ${orNull(i.esicNumber)},
      dob = ${i.dob === '' ? null : i.dob}::date,
      gender = ${orNull(i.gender)},
      pay_mode = ${orNull(i.payMode)},
      aadhaar = ${orNull(i.aadhaar)},
      address = ${orNull(i.address)}
    where id = ${staffId} and restaurant_id = ${rid}
    returning id`
  return rows.length > 0
}
