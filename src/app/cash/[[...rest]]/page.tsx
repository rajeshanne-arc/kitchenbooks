import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

export default async function Page({ params }: { params: Promise<{ rest?: string[] }> }) {
  const { rest = [] } = await params
  await goLegacy(`/cash${rest.length > 0 ? `/${rest.join('/')}` : ''}`)
}
