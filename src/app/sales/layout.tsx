// The sales group. LAW 3: the tab strip is resolved once here — settings-ordered,
// settings-labelled, hide/show honoured, matrix-filtered — and every screen in
// the group renders beneath it.
import GroupTabs from '@/components/GroupTabs'
import { BusinessDayNote, BusinessDayProvider } from '@/components/BusinessDay'
import { businessDayContext } from '@/server/business-day'

export default async function SalesGroupLayout({ children }: { children: React.ReactNode }) {
  // Resolved ONCE per request here, and handed to every form beneath. A form
  // working the date out from the browser clock is the bug this phase fixes.
  const businessDay = await businessDayContext()
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-6 sm:px-6">
      <GroupTabs group="sales" />
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
