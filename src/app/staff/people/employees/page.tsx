import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { DEPT_ORDER, listRoster } from '@/server/labour-queries'
import { formatMoneyString } from '@/lib/money'
import { RetiredBadge } from '@/components/books/Badges'
import type { StaffRow } from '@/lib/types'
import ViewToggle from '@/components/ViewToggle'
import { readView, VIEW_KEYS } from '@/lib/views'
import Honesty from '@/components/Honesty'

export const dynamic = 'force-dynamic'

function Band({ title, loud, note, rows }: { title: string; loud?: boolean; note?: string; rows: StaffRow[] }) {
  if (rows.length === 0) return null
  return (
    <div>
      <div className={loud ? 'rounded-lg border border-red-200 bg-red-50 px-3 py-2' : ''}>
        <h2
          className={`text-xs font-semibold uppercase tracking-wide ${loud ? 'text-red-700' : 'text-stone-500'}`}
        >
          {title} <span className="ml-1 font-normal normal-case tracking-normal">· {rows.length}</span>
        </h2>
        {note !== undefined && <p className="mt-0.5 text-xs text-red-700">{note}</p>}
      </div>
      <ul className="mt-1 divide-y divide-rule-soft">
        {rows.map((p) => (
          <li key={p.id}>
            <Link
              href={`/staff/people/employees/${p.code}`}
              className={`flex items-center justify-between gap-3 rounded-lg px-2 py-3 hover:bg-stone-50 ${
                p.status === 'inactive' ? 'opacity-60' : ''
              }`}
            >
              <span className="min-w-0">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-[15px] font-medium text-stone-900">{p.name}</span>
                  {p.grade !== null && (
                    <span className="rounded-full border border-stone-200 bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold text-stone-600">
                      {p.grade}
                    </span>
                  )}
                  {p.status === 'inactive' && <RetiredBadge />}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">
                  <span className="font-mono">{p.code}</span>
                  {p.designation !== null && <> · {p.designation}</>}
                  {p.section_name !== null && <> · {p.section_name}</>}
                </span>
              </span>
              <span className="shrink-0 text-right">
                {p.employment_type === 'contract' ? (
                  <span className="text-xs font-medium text-stone-500">contract — vendor-billed</span>
                ) : p.base_salary !== null ? (
                  <span className="text-[15px] font-semibold tabular-nums text-stone-900">
                    {formatMoneyString(p.base_salary)}
                    <span className="text-xs font-normal text-stone-400">/mo</span>
                  </span>
                ) : (
                  <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                    no salary set
                  </span>
                )}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

const VIEWS = [
  { value: 'by-department' as const, label: 'By department', hint: 'The roster order — computed, and the same every morning so a marker keeps their place.' },
  { value: 'by-salary' as const, label: 'By salary', hint: 'Where the wage bill actually sits. Anyone with no salary set sorts last, because that is a gap in the record and not a zero wage.' },
]

export default async function StaffPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>
}) {
  const view = readView('employees', (await searchParams).view)
  const restaurant = await getRestaurant()
  const [user, roster] = await Promise.all([getSessionUser(), listRoster(restaurant.id, view)])
  // LAW 1. The accountant reads this list — a person is who they are preparing
  // pay for — but adding somebody to the roster is the manager's job, so they
  // must not SEE the button. One source: the matrix, never a role comparison
  // written out here.
  const mayAdd = user !== null && canAccess(user.role, '/staff/people/employees/new')
  const assigned = roster.filter((p) => p.section_id !== null)
  const unassigned = roster.filter((p) => p.section_id === null)

  const noSalary = roster.filter((r) => r.base_salary === null).length

  return (
    <section className="mt-4 space-y-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-stone-500">
          {roster.length === 0
            ? ''
            : view === 'by-salary'
              ? `${roster.length} people, biggest salary first.`
              : `${roster.length} people, ordered by department, section, grade — never renumbered.`}
        </p>
        {mayAdd && (
          <Link
            href="/staff/people/employees/new"
            className="shrink-0 rounded-xl bg-emerald-700 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-800"
          >
            ＋ Add staff
          </Link>
        )}
      </div>

      <ViewToggle
        param="view"
        value={view}
        options={VIEWS}
        defaultValue={VIEW_KEYS.employees[0]}
        label="How to order the roster"
      />

      {view === 'by-salary' && noSalary > 0 && (
        <Honesty verdict="salary unset" compact>
          {noSalary} of {roster.length} {noSalary === 1 ? 'person has' : 'people have'} no salary on record, so they
          sort last here and contribute nothing to any wage bill. That is a gap in the record, not a zero wage.
        </Honesty>
      )}

      {roster.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white/60 px-6 py-12 text-center">
          <p className="text-lg font-semibold text-stone-900">No staff on the books yet.</p>
          <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
            Add people one by one — bulk import arrives when Rajesh provides the corrected staff master (the Labour
            sheet supersedes every earlier extract).
          </p>
          {mayAdd && (
            <Link
              href="/staff/people/employees/new"
              className="mt-5 inline-block rounded-xl bg-emerald-700 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-800"
            >
              Add the first person
            </Link>
          )}
        </div>
      ) : (
        <>
          {DEPT_ORDER.map((g) => (
            <Band key={g} title={g} rows={assigned.filter((p) => p.dept_group === g)} />
          ))}
          <Band
            title="Unassigned"
            loud
            note="no section — this person's cost lands nowhere until assigned."
            rows={unassigned}
          />
        </>
      )}
    </section>
  )
}
