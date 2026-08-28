import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// RETIRED: /store/books/bills -> /store/books/purchases
//
// A BARE PAGE, NOT A CATCH-ALL, and that is the whole point. The LIST merged
// into Purchases; the DOCUMENT at /store/books/bills/[id] did NOT move, and
// seven references across five files depend on it. A catch-all here — the
// shape /store/books/stock uses — would swallow every bill id and send it to
// /store/books/purchases/<id>, which does not exist. The [id] segment sits
// beside this file and keeps answering.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await goLegacy('/store/books/bills', await searchParams)
}
