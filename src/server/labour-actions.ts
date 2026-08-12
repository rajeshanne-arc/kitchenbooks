'use server'

// Write side of labour. Staff are masters (code E### is permanent, granted
// columns editable, retire-never-delete). Attendance is an EVENT stream:
// INSERT-only — a correction is a new row for the same day, and the
// attendance_current view decides which row is effective. The database
// refuses updates on both fronts regardless.

import { z } from 'zod'
import { sql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { enteredBy } from '@/server/current-user'
import { getDaySheet, getStaffDetail } from '@/server/labour-queries'
import type {
  AttendanceStatus,
  SaveAttendanceResult,
  StaffInput,
  StaffMutationResult,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

class LabourError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof LabourError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('labour action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

function assertRealDate(s: string, label: string) {
  const d = new Date(`${s}T00:00:00Z`)
  if (!DATE_RE.test(s) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) {
    throw new LabourError(`${label} is not a real calendar date`)
  }
  const year = Number(s.slice(0, 4))
  if (year < 2000 || year > 2100) throw new LabourError(`${label} is out of range`)
}

const StaffSchema = z.object({
  name: z.string().trim().min(1).max(120),
  designation: z.string().trim().max(80),
  sectionId: z.union([z.literal(''), z.string().regex(UUID)]),
  grade: z.union([z.literal(''), z.enum(['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7'])]),
  employmentType: z.enum(['full_time', 'trainee', 'contract']),
  baseSalary: z.union([z.literal(''), z.string().regex(/^\d{1,7}(\.\d{1,2})?$/)]),
  payMode: z.union([z.literal(''), z.enum(['account', 'cash'])]),
  joined: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  leftDate: z.union([z.literal(''), z.string().regex(DATE_RE)]),
  reportsTo: z.union([z.literal(''), z.string().regex(UUID)]),
  phone: z.string().trim().max(20),
  status: z.enum(['active', 'inactive']),
})

async function validateStaffRefs(rid: string, input: z.infer<typeof StaffSchema>, selfId: string | null) {
  if (input.joined !== '') assertRealDate(input.joined, 'Joined date')
  if (input.leftDate !== '') assertRealDate(input.leftDate, 'Left date')
  if (input.sectionId !== '') {
    const sec = await sql<{ id: string }[]>`
      select id from sections where id = ${input.sectionId} and restaurant_id = ${rid} and status = 'active'`
    if (!sec[0]) throw new LabourError('Section not found')
  }
  if (input.reportsTo !== '') {
    if (selfId !== null && input.reportsTo === selfId) throw new LabourError('Someone cannot report to themselves')
    const mgr = await sql<{ id: string }[]>`
      select id from staff where id = ${input.reportsTo} and restaurant_id = ${rid}`
    if (!mgr[0]) throw new LabourError('Reports-to person not found')
  }
}

export async function createStaff(raw: StaffInput): Promise<StaffMutationResult> {
  try {
    const input = StaffSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await validateStaffRefs(rid, input, null)

    const created = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      // E### — flat series, zero-padded, permanent.
      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(nullif(substring(code from 2), '')::int), 0) + 1 as next
        from staff
        where restaurant_id = ${rid} and code ~ '^E[0-9]+$'`
      const code = `E${String(next).padStart(3, '0')}`
      const [row] = await tx<{ id: string }[]>`
        insert into staff (restaurant_id, code, name, designation, section_id, grade, employment_type,
                           base_salary, pay_mode, joined, reports_to, phone, status)
        values (${rid}, ${code}, ${input.name}, ${input.designation === '' ? null : input.designation},
                ${input.sectionId === '' ? null : input.sectionId},
                ${input.grade === '' ? null : input.grade},
                ${input.employmentType},
                ${input.baseSalary === '' ? null : input.baseSalary}::numeric,
                ${input.payMode === '' ? null : input.payMode},
                ${input.joined === '' ? null : input.joined}::date,
                ${input.reportsTo === '' ? null : input.reportsTo},
                ${input.phone === '' ? null : input.phone},
                ${input.status})
        returning id`
      return row
    })

    const staff = await getStaffDetail(rid, created.id)
    if (!staff) throw new LabourError('Could not verify the save — staff row missing after commit')
    return { ok: true, staff }
  } catch (e) {
    return fail(e)
  }
}

export async function updateStaff(id: string, raw: StaffInput): Promise<StaffMutationResult> {
  try {
    if (!UUID.test(id)) throw new LabourError('Malformed staff id')
    const input = StaffSchema.parse(raw)
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    await validateStaffRefs(rid, input, id)

    // Only the column-granted fields ever appear in this SET — code never does.
    const updated = await sql<{ id: string }[]>`
      update staff set
        name = ${input.name},
        designation = ${input.designation === '' ? null : input.designation},
        section_id = ${input.sectionId === '' ? null : input.sectionId},
        grade = ${input.grade === '' ? null : input.grade},
        employment_type = ${input.employmentType},
        base_salary = ${input.baseSalary === '' ? null : input.baseSalary}::numeric,
        pay_mode = ${input.payMode === '' ? null : input.payMode},
        joined = ${input.joined === '' ? null : input.joined}::date,
        left_date = ${input.leftDate === '' ? null : input.leftDate}::date,
        reports_to = ${input.reportsTo === '' ? null : input.reportsTo},
        phone = ${input.phone === '' ? null : input.phone},
        status = ${input.status}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new LabourError('Staff member not found — nothing was changed')

    const staff = await getStaffDetail(rid, id)
    if (!staff) throw new LabourError('Could not read the staff member back after saving')
    return { ok: true, staff }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------- attendance

const MarksSchema = z.object({
  date: z.string().regex(DATE_RE),
  marks: z
    .array(
      z.object({
        staffId: z.string().regex(UUID),
        status: z.enum(['present', 'half', 'off', 'leave', 'absent']),
      }),
    )
    .min(1)
    .max(200),
})

export async function saveAttendance(raw: {
  date: string
  marks: { staffId: string; status: AttendanceStatus }[]
}): Promise<SaveAttendanceResult> {
  try {
    const input = MarksSchema.parse(raw)
    assertRealDate(input.date, 'Attendance date')
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const by = await enteredBy()

    const inserted = await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      const staffIds = [...new Set(input.marks.map((m) => m.staffId))]
      if (staffIds.length !== input.marks.length) throw new LabourError('Duplicate staff in one save')
      const known = await tx<{ id: string }[]>`
        select id from staff where restaurant_id = ${rid} and status = 'active' and id = any(${staffIds})`
      if (known.length !== staffIds.length) throw new LabourError('Someone on the sheet is not an active staff member')

      // A row is only worth inserting when it changes the effective status —
      // that keeps "corrected" meaning corrected, not re-saved.
      const current = await tx<{ staff_id: string; status: AttendanceStatus }[]>`
        select staff_id, status from attendance_current
        where restaurant_id = ${rid} and att_date = ${input.date}::date and staff_id = any(${staffIds})`
      const effective = new Map(current.map((c) => [c.staff_id, c.status]))
      const toInsert = input.marks.filter((m) => effective.get(m.staffId) !== m.status)
      if (toInsert.length === 0) return 0

      const rows = toInsert.map((m) => ({
        restaurant_id: rid,
        att_date: input.date,
        staff_id: m.staffId,
        status: m.status,
        entered_by: by,
      }))
      await tx`insert into attendance ${tx(rows, 'restaurant_id', 'att_date', 'staff_id', 'status', 'entered_by')}`
      return rows.length
    })

    const sheet = await getDaySheet(rid, input.date)
    return { ok: true, inserted, sheet }
  } catch (e) {
    return fail(e)
  }
}
