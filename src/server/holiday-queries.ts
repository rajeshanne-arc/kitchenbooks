import 'server-only'
import { tsql } from '@/lib/db'
export type HolidayRow = { id: string; holiday_date: string; name: string; paid: boolean; entered_by: string }
/** @scope now */
export async function listHolidays(restaurantId: string): Promise<HolidayRow[]> {
  return tsql<HolidayRow[]>`select id, holiday_date::text as holiday_date, name, paid, entered_by from staff_holidays where restaurant_id = ${restaurantId} order by holiday_date desc`
}
