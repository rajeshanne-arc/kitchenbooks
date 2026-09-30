import Link from 'next/link'
import AccountsImport from '@/components/accounts/AccountsImport'
import { accountsImportContract } from '@/server/accounts-import'
import { pageSubCls, pageTitleCls } from '@/components/ui'
export const dynamic = 'force-dynamic'
export default async function AccountsImportPage() { return <div className="mt-4"><Link href="/owner/setup/accounts" className="text-sm font-medium text-stone-500">← Accounts</Link><h1 className={pageTitleCls + ' mt-2'}>Import ledger accounts</h1><p className={pageSubCls}>Load a corrected chart of accounts into this restaurant.</p><AccountsImport contract={await accountsImportContract()} /></div> }
