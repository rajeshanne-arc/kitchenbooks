import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// Settlements moved INSIDE Partners — a settlement is something a partner
// does. Phones have this one bookmarked.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await goLegacy('/sales/settlements', await searchParams)
}
