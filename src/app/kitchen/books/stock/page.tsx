import StockView from '@/components/views/StockView'
import { readStockView } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; view?: string }>
}) {
  const { q = '', view } = await searchParams
  return <StockView q={q} view={readStockView(view)} />
}
