import StockView from '@/components/views/StockView'
import { readView } from '@/lib/views'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string; cat?: string }>
}) {
  const { q = '', view, cat = '' } = await searchParams
  return <StockView q={q} view={readView('stock', view)} cat={cat} />
}
