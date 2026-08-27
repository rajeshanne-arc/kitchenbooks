import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'
import { getRestaurant } from '@/server/queries'

// THE BADGE IS WHY THIS TAB GETS OPENED. Four of the five chips are true
// configuration — set once and forgotten — but Lists holds an APPROVAL QUEUE:
// a category somebody typed into a form lands here as a pending suggestion
// waiting on the owner. That is an ongoing task, and a tab full of settings is
// otherwise a place nobody visits. Silent at zero, like every other badge in
// this app: a "0" is a thing to read and dismiss every time.
export default async function OwnerSetupLayout({ children }: { children: React.ReactNode }) {
  const restaurant = await getRestaurant()
  return (
    <>
      {/* NO BADGE HERE ANY MORE. The pending queue moved to Owner › Approvals,
          so a count on Lists would summon somebody to a screen that no longer
          holds it — everything under Setup is configuration again. */}
      <ChipRow base="/owner/setup" chips={chipsOf('owner', 'setup')} />
      {children}
    </>
  )
}
