import ChipRow from '@/components/ChipRow'
import { chipsOf } from '@/lib/tabs'
import { getRestaurant } from '@/server/queries'
import { countPendingSuggestions } from '@/server/settings'

// THE BADGE IS WHY THIS TAB GETS OPENED. Four of the five chips are true
// configuration — set once and forgotten — but Lists holds an APPROVAL QUEUE:
// a category somebody typed into a form lands here as a pending suggestion
// waiting on the owner. That is an ongoing task, and a tab full of settings is
// otherwise a place nobody visits. Silent at zero, like every other badge in
// this app: a "0" is a thing to read and dismiss every time.
export default async function OwnerSetupLayout({ children }: { children: React.ReactNode }) {
  const restaurant = await getRestaurant()
  const pending = await countPendingSuggestions(restaurant.id)
  return (
    <>
      <ChipRow base="/owner/setup" chips={chipsOf('owner', 'setup')} badges={{ lists: pending }} />
      {children}
    </>
  )
}
