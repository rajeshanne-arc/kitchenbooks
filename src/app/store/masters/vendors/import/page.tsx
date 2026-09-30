import Link from 'next/link'
import VendorImport from '@/components/books/VendorImport'
import { vendorImportContract } from '@/server/vendor-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function VendorImportPage() {
  return <div className="mt-4"><Link href="/store/masters/vendors" className="text-sm font-medium text-stone-500">← Vendors</Link><h1 className={pageTitleCls + ' mt-2'}>Import vendors</h1><p className={pageSubCls}>Load a corrected vendor master into this restaurant.</p><VendorImport contract={await vendorImportContract()} /></div>
}
