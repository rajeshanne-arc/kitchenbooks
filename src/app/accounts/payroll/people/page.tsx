// The staff identifier block. It lives under Payroll because it exists for
// payroll: a run that is approved still has to reach somebody's account.
//
// OWNER AND ACCOUNTANT ONLY. The matrix keeps everyone else out of
// /accounts, and updateStaffIdentity re-checks the role anyway — a server
// action is a public endpoint, and the route gate is not the check.
import { getRestaurant } from '@/server/queries'
import { listStaffIdentities } from '@/server/payroll-queries'
import PeopleClient from '@/components/accountant/PeopleClient'
import SalaryStructures from '@/components/accountant/SalaryStructures'
import { listSalaryStructures } from '@/server/salary-queries'
import { listStatutoryConfigs } from '@/server/statutory-queries'
import StatutoryConfig from '@/components/accountant/StatutoryConfig'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'

export const dynamic = 'force-dynamic'

export default async function PayrollPeoplePage() {
  const restaurant = await getRestaurant()
  const [staff, structures, statutory] = await Promise.all([listStaffIdentities(restaurant.id), listSalaryStructures(restaurant.id), listStatutoryConfigs(restaurant.id)])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>People</h1>
        <p className={pageSubCls}>
          {restaurant.name} — bank, statutory and personal details, held so that wages can be paid.
        </p>
        <p className="mt-1.5 text-xs text-stone-500">
          Only an owner or the accountant can open this screen: the manager marks attendance and has
          no reason to hold anybody&rsquo;s bank account number or date of birth.
        </p>
      </header>
      <PeopleClient staff={staff} />
      <SalaryStructures staff={staff} />
      <StatutoryConfig rows={statutory} />
      {structures.length > 0 && <section className="mt-4 rounded-2xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="font-display text-lg font-bold text-stone-900">Salary history</h2><ul className="mt-2 divide-y divide-rule-soft">{structures.map((s) => <li key={s.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span>{s.staff_name} · effective {s.effective_from}{s.note && ` · ${s.note}`}</span><span className="font-mono">{formatMoneyString(s.base_salary)}</span></li>)}</ul></section>}
    </>
  )
}
