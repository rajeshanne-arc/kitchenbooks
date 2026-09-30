// The accountant group. LAW 3: the tab strip is resolved once here and every
// screen in the group renders beneath it.
import GroupTabs from '@/components/GroupTabs'
import { BusinessDayNote, BusinessDayProvider } from '@/components/BusinessDay'
import { businessDayContext } from '@/server/business-day'

export default async function AccountsGroupLayout({ children }: { children: React.ReactNode }) {
  // Resolved ONCE per request here, and handed to every form beneath. A form
  // working the date out from the browser clock is the bug this phase fixes.
  const businessDay = await businessDayContext()
  // 4xl, NOT 2xl, AND THE REASON IS TABLES. 672px is a reading measure and a
  // table is not prose: at 2xl the pay queue's 7 columns needed 651px inside
  // 582px of usable width, so the ACTION COLUMN was scrolled out of its own
  // overflow-x-auto — on every viewport, a 1384px desktop included, because a
  // max-width does not care how much room there is. Nothing warns about that:
  // the markup is complete and the button is simply not on screen. 59 tables
  // sit under these six identical layouts, so the fix is here rather than in
  // any of them. Phone behaviour is unchanged — a max-width only caps.
  return (
    <main className="mx-auto w-full max-w-4xl px-4 sm:px-6">
      <GroupTabs group="accounts" />
      <BusinessDayProvider value={businessDay}>
        {/* Said once per group rather than per form: past midnight EVERY date on
            every screen beneath this is a day behind the phone, and a new form
            cannot forget to mention it. Renders nothing the rest of the day. */}
        <BusinessDayNote className="mb-4" />
        {children}
      </BusinessDayProvider>
    </main>
  )
}
