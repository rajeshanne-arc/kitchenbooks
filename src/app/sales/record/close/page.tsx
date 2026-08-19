import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// RETIRED: /sales/record/close -> /sales/close
//
// The day close came back out of Record and onto its own tab, because a tab
// can carry "3 days unclosed" and a chip cannot. This is the URL it lived at
// for one phase, and the cashier who bookmarked it every night is exactly the
// person who must not be sent to a 404.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await goLegacy('/sales/record/close', await searchParams)
}
