import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

// RETIRED: /staff/money-out/expense -> /accounts/payments/expense
//
// Expenses left the staff group because a group is a SUBJECT, not a person.
// Rent, power and licences are overheads — a different P&L line from wages —
// and the accountant already owns every non-drawer money movement.
//
// A MANAGER FOLLOWING THIS BOOKMARK NOW LANDS ON /denied, and that is correct
// rather than unfortunate: the target is matrix-checked like any other page,
// and the denial names who to ask. A 404 would have told them nothing.
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  await goLegacy('/staff/money-out/expense', await searchParams)
}
