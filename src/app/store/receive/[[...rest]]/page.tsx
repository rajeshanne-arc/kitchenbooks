import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// RETIRED: /store/receive -> /store/purchasing
//
// A CATCH-ALL, because the WHOLE SUBTREE moved — /store/receive/purchase,
// /pay, /vendor-return and every /orders/** URL beneath them. That is the
// opposite of /store/books/bills, which is a BARE page precisely because its
// [id] child did NOT move; the two shapes look identical and choosing wrongly
// either 404s every deep link or fails to carry one.
//
// legacyTarget() appends the remainder and renames the two segments that
// changed name; goLegacy carries the query string, so a bookmarked
// /store/receive/orders/new?vendor=<id> still arrives with its vendor.
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { rest = [] } = await params
  await goLegacy(`/store/receive${rest.length > 0 ? `/${rest.join('/')}` : ''}`, await searchParams)
}
