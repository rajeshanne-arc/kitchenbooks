import Link from 'next/link'
import PurchaseImport from '@/components/store/PurchaseImport'
import { purchaseImportContract } from '@/server/purchase-import'
import { pageSubCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PurchaseImportPage() {
  return <>
    <header className="mx-auto max-w-3xl px-4 pb-4 pt-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-stone-900">Purchase import</h1>
      <p className={pageSubCls}>Bring in a bill when entering its lines manually is not practical.</p>
    </header>
    <PurchaseImport contract={await purchaseImportContract()} />
    <p className="mx-auto max-w-3xl px-4 pb-8 text-sm text-stone-600 sm:px-6">Need to load several supplier bills from one export? <Link href="/store/purchasing/import/batch" className="font-medium text-emerald-800 underline">Use the historical batch importer</Link>.</p>
  </>
}
