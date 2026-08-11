// The store group. LAW 3: the tab strip is resolved once here — settings-ordered,
// settings-labelled, hide/show honoured, matrix-filtered — and every screen in
// the group renders beneath it.
import GroupTabs from '@/components/GroupTabs'

export default function StoreGroupLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-10 pt-6 sm:px-6">
      <GroupTabs group="store" />
      {children}
    </main>
  )
}
