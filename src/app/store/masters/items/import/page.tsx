import Link from 'next/link'
import ItemImport from '@/components/books/ItemImport'
import { itemImportContract } from '@/server/item-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function ItemImportPage() {
  return <div className="mt-4"><Link href="/store/masters/items" className="text-sm font-medium text-stone-500">← Items</Link><h1 className={pageTitleCls + ' mt-2'}>Import items</h1><p className={pageSubCls}>Load a corrected item master into this restaurant.</p><ItemImport contract={await itemImportContract()} /></div>
}
