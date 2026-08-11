import { getRestaurant } from '@/server/queries'
import { sql } from '@/lib/db'
import DepartmentsClient from '@/components/settings/DepartmentsClient'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import type { DepartmentRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Departments ARE sections. One table: the same row codes a dish (CH-001),
// receives an issue and posts a staff member. That is why a rename lands
// everywhere at once with nothing else to update — and why the code cannot
// move. The counts on each row say what already depends on it.

export default async function DepartmentsPage() {
  const restaurant = await getRestaurant()
  const rows = await sql<DepartmentRow[]>`
    select s.id, s.code, s.name, s.dept_group, s.sort_order, s.status,
           (select count(*)::int from issues i where i.section_id = s.id) as issues,
           (select count(*)::int from recipes r where r.section_id = s.id) as dishes,
           (select count(*)::int from staff st where st.section_id = s.id) as staff
    from sections s
    where s.restaurant_id = ${restaurant.id}
    order by array_position(array['Management','Support','Kitchen','Service','Bar'], s.dept_group) asc,
             s.sort_order asc`

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Departments</h1>
        <p className={pageSubCls}>
          {restaurant.name} — one list, used by dish codes, issues and staff postings alike
        </p>
      </header>
      <DepartmentsClient rows={rows} />
    </>
  )
}
