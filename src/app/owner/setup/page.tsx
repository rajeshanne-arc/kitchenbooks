import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { chipsOf } from '@/lib/tabs'

export const dynamic = 'force-dynamic'

// THE ONE CHIP PARENT THAT CANNOT RE-EXPORT ITS FIRST CHILD.
//
// Every other chip parent in the app renders its first chip directly — that is
// the rule, and a gate holds it, because a redirect there cost a round trip to
// be told where to go. This row is different: it is the first in the app that
// SPANS A ROLE BOUNDARY. The owner can open all five chips, the manager only
// Lists and Settings, the accountant only Money accounts and Meters — and
// manager and accountant have NO chip in common. There is no first child that
// is right for all three, so a fixed one would send somebody to /denied.
//
// In practice nobody arrives here: TabStrip is handed a per-role destination
// (see badgesFor), so the tab itself points straight at the chip its reader
// can open. This is the fallback for a typed URL or an old bookmark, and it
// resolves the same way rather than guessing.
export default async function OwnerSetupPage() {
  const user = await getSessionUser()
  if (user === null) redirect('/login')
  const first = chipsOf('owner', 'setup').find((c) => canAccess(user.role, `/owner/setup/${c.key}`))
  // The matrix admits nobody to /owner/setup who can open none of it, so this
  // is unreachable — and it fails closed rather than rendering an empty shell.
  redirect(first === undefined ? '/denied' : `/owner/setup/${first.key}`)
}
