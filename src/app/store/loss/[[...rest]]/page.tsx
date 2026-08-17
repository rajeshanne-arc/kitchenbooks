import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// RETIRED: /store/loss -> /store/stock/loss
//
// A catch-all, not a bare page: the wastage form were real URLs and are
// bookmarked, so the rest of the path has to travel with the caller.
// legacyTarget() appends the remainder, and goLegacy carries the query
// string — dropping it once landed people on a blank form and looked
// exactly like a broken prefill.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { rest = [] } = await params
  await goLegacy(`/store/loss${rest.length > 0 ? `/${rest.join('/')}` : ''}`, await searchParams)
}
