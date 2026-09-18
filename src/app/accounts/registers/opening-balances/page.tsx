import Link from 'next/link'
import OpeningBalancesImport from '@/components/accountant/OpeningBalancesImport'
import { openingBalancesImportContract } from '@/server/opening-balances-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function OpeningBalancesPage() { return <div className="mt-4"><Link href="/accounts/registers" className="text-sm font-medium text-stone-500">← Registers</Link><h1 className={pageTitleCls + ' mt-2'}>Opening balances</h1><p className={pageSubCls}>Establish the starting ledger position for this restaurant.</p><OpeningBalancesImport contract={await openingBalancesImportContract()} /></div> }
