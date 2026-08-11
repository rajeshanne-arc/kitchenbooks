import { goLegacy } from '@/components/LegacyRedirect'

export const dynamic = 'force-dynamic'

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ rest?: string[] }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { rest = [] } = await params
  await goLegacy(`/books${rest.length > 0 ? `/${rest.join('/')}` : ''}`, await searchParams)
}
