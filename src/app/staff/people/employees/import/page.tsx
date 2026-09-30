import Link from 'next/link'
import StaffImport from '@/components/labour/StaffImport'
import { staffImportContract } from '@/server/staff-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'

export default async function StaffImportPage() {
  return <div className="mt-4"><Link href="/staff/people/employees" className="text-sm font-medium text-stone-500">← Staff</Link><h1 className={`${pageTitleCls} mt-2`}>Import staff</h1><p className={pageSubCls}>Load a corrected roster into this restaurant.</p><StaffImport contract={await staffImportContract()} /></div>
}
