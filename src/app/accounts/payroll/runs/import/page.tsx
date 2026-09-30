import Link from 'next/link'
import PayrollImport from '@/components/accountant/PayrollImport'
import { payrollImportContract } from '@/server/payroll-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function PayrollImportPage() { return <div className="mt-4"><Link href="/accounts/payroll/runs" className="text-sm font-medium text-stone-500">← Payroll runs</Link><h1 className={pageTitleCls + ' mt-2'}>Import payroll</h1><p className={pageSubCls}>Load a prepared payroll from a corrected export.</p><PayrollImport contract={await payrollImportContract()} /></div> }
