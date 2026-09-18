import PurchaseBatchImport from '@/components/store/PurchaseBatchImport'
import { purchaseBatchImportContract } from '@/server/purchase-import'
import { pageSubCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function PurchaseBatchImportPage() {
  return <>
    <header className="mx-auto max-w-3xl px-4 pb-4 pt-6 sm:px-6">
      <h1 className="text-2xl font-semibold text-stone-900">Historical purchase batch</h1>
      <p className={pageSubCls}>Load several supplier bills from one validated source file.</p>
    </header>
    <PurchaseBatchImport contract={await purchaseBatchImportContract()} />
  </>
}
