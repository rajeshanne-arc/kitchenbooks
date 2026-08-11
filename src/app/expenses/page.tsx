import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

export default async function Page() {
  await goLegacy('/expenses')
}
