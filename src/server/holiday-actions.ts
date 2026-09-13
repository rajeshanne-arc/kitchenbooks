'use server'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'

const DATE = /^\d{4}-\d{2}-\d{2}$/
class HolidayError extends Error {}
/** @scope now */
export async function saveHoliday(raw: { date: string; name: string; paid: boolean }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = z.object({ date: z.string().regex(DATE), name: z.string().trim().min(1).max(120), paid: z.boolean() }).parse(raw)
    const d = new Date(`${input.date}T00:00:00Z`); if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== input.date) throw new HolidayError('Holiday date is not a real calendar date')
    const user = await getSessionUser(); if (!user || !['manager', 'owner'].includes(user.role)) throw new HolidayError('Only a manager or owner can maintain the holiday calendar')
    const rid = (await getRestaurant()).id
    await tsql`insert into staff_holidays (restaurant_id, holiday_date, name, paid, entered_by) values (${rid}, ${input.date}::date, ${input.name}, ${input.paid}, ${user.username})`
    return { ok: true }
  } catch (e) { return { ok: false, error: e instanceof HolidayError ? e.message : e instanceof z.ZodError ? 'Invalid holiday — nothing was saved' : 'A holiday already exists on that date or the save failed' } }
}
