// The accountant group. LAW 3: the tab strip is resolved once here and every
// screen in the group renders beneath it.
import GroupTabs from '@/components/GroupTabs'

export default function AccountsGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-6 sm:px-6">
      <GroupTabs group="accounts" />
      {children}
    </main>
  )
}
