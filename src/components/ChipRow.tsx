// A chip row sits under a consolidated tab and swaps in ONE small focused
// form. It is deliberately not a single large form with conditional fields:
// one question at a time still rules. Each chip is a real URL, so a form can
// be bookmarked, linked to and returned to.
//
// MATRIX-FILTERED, LIKE EVERY OTHER SURFACE. LAW 1 names nav, home tiles,
// Books tabs, group tab strips and quick links; chips were absent from that
// list only because no chip row had ever crossed a role line. Setup is the
// first that does — the owner sees five, the manager two, the accountant two
// others — so the row asks the matrix rather than trusting each layout to
// remember. The filtering happens HERE, on the server, so a denied chip is
// never sent to the browser at all.
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import type { ChipDef } from '@/lib/tabs'
import ChipRowClient from '@/components/ChipRowClient'

/** Counts painted on chips, keyed by chip key. A chip with no entry, or a
 *  count of zero, wears NO badge — the tab rule exactly: a "0" is a thing to
 *  read and dismiss every time, where absence is silence. */
export type ChipBadges = Partial<Record<string, number>>

export default async function ChipRow({
  base,
  chips,
  badges = {},
}: {
  base: string
  chips: ChipDef[]
  badges?: ChipBadges
}) {
  const user = await getSessionUser()
  if (user === null) return null
  const allowed = chips.filter((c) => canAccess(user.role, `${base}/${c.key}`))
  return <ChipRowClient base={base} chips={allowed} badges={badges} />
}
