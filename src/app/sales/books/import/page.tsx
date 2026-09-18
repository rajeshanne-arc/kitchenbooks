import Link from 'next/link'
import SalesCsvImport from '@/components/sales/SalesCsvImport'
import { salesImportContract } from '@/server/sales-csv-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
import WhyNoRange from '@/components/books/WhyNoRange'
export const dynamic = 'force-dynamic'
export default async function SalesImportPage() {
  return <div className="mt-4"><Link href="/sales/books/sales" className="text-sm font-medium text-stone-500">← Sales</Link><h1 className={pageTitleCls + ' mt-2'}>Import sales</h1><p className={pageSubCls}>Load a corrected POS export through the same sales ledger path.</p><WhyNoRange why="source" what="A corrected POS export is committed for one business date at a time; the file itself carries that date." /><SalesCsvImport contract={await salesImportContract()} /></div>
}
