// MONEY — where it sits and how it moved.
//
// The one thing the accountant WRITES from here is a bank payment — the
// transfer they make from home, while the store records the cash it hands
// over at the door. Same recordPayment, same payments table, same PAY
// series: two screens because two people are in two places, not because
// there are two kinds of payment. The account master itself lives at
// /owner/accounts, which the matrix admits the accountant to precisely
// because it is reached from here — opening balances are their write and
// there is only ever one copy of that screen.
//
// The two things the balances do NOT cover are said out loud rather than
// papered over: the movements that name no account, and the fact that
// nothing here has been checked against a statement.
import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { countUnaccountedMovements, getAccountBalances, listMoneyAccounts } from '@/server/accounts-queries'
import { listVendorsWithDues } from '@/server/books-queries'
import { getList } from '@/server/settings'
import BalancesTable from '@/components/accountant/BalancesTable'
import BankPayment from '@/components/accountant/BankPayment'
import Honesty from '@/components/Honesty'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const masterLinkCls =
  'text-sm font-semibold text-emerald-800 underline underline-offset-2 hover:text-emerald-900'

export default async function MoneyPage() {
  const restaurant = await getRestaurant()
  const [balances, unaccounted, accounts, vendors, modes] = await Promise.all([
    getAccountBalances(restaurant.id),
    countUnaccountedMovements(restaurant.id),
    listMoneyAccounts(restaurant.id),
    listVendorsWithDues(restaurant.id),
    getList(restaurant.id, 'payment_mode'),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Money</h1>
        <p className={pageSubCls}>
          {restaurant.name} — where the money sits, account by account, and how it got there.
        </p>
      </header>

      <div className="space-y-4">
        {balances.length === 0 ? (
          <section className={cardCls}>
            <h2 className={sectionHeadCls}>No active account</h2>
            <p className="mt-1.5 text-sm text-stone-700">
              Nobody has named where the money sits — the drawer it is counted from, each bank
              account, each wallet — or every account named has since been retired. The view behind
              this screen covers active accounts only, so it cannot tell those two apart. For a new
              set of books it is the ordinary first state and not a fault: what has already been
              entered still counts, it simply has no account to sit in yet.
            </p>
            <p className="mt-2 text-sm text-stone-500">
              Accounts are named once and then every money form asks which one, and refuses to
              guess. Name them for the shape they are — cash, bank, wallet, card settlement, owner —
              never for a brand.
            </p>
            <Link href="/owner/accounts" className={`${masterLinkCls} mt-2 inline-block`}>
              Name the accounts
            </Link>
          </section>
        ) : (
          <section className={cardCls}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>Balances</h2>
              <span className="font-mono text-[10px] text-stone-400">account_balances</span>
            </div>
            <div className="mt-2">
              <BalancesTable rows={balances} />
            </div>
            <p className="mt-2 text-xs text-stone-500">
              Opening balance plus every movement through the account. An account with no movement
              still holds its opening balance — the blank is about activity, not about money. The
              view covers ACTIVE accounts only: a retired account is not counted here and still
              keeps every rupee that ever moved through it. The total is the sum of the balances
              above and nothing more — not a statement of what the business is worth.
            </p>
            <Link href="/owner/accounts" className={`${masterLinkCls} mt-2 inline-block`}>
              Add an account, or set an opening balance
            </Link>
          </section>
        )}

        <BankPayment vendors={vendors} accounts={accounts} modes={modes} />

        {unaccounted > 0 && (
          <Honesty verdict="account unnamed">
            {unaccounted} money {unaccounted === 1 ? 'movement names' : 'movements name'} no account
            — entries made before accounts existed. They still count in the P&amp;L; they simply
            cannot be placed in any one account&apos;s balance, so the balances above are short by
            whatever {unaccounted === 1 ? 'it carries' : 'they carry'}. How much that is, this
            screen cannot say — a count is all it has.
          </Honesty>
        )}

        {/* Built in migration 0016. The strip that used to sit here said
            reconciliation needed a table to remember what was matched; the
            table exists now, so the strip is gone rather than reworded. */}
        <section className={cardCls}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className={sectionHeadCls}>Against a statement</h2>
            <span className="font-mono text-[10px] text-stone-400">reconciliation_status</span>
          </div>
          <p className="mt-1.5 text-sm text-stone-700">
            Import what the bank, wallet or card provider says, and match its lines against the
            movements above. What is left unmatched on either side is the answer — money the
            provider knows about and the books do not, or the reverse.
          </p>
          <Link href="/accounts/money/reconcile" className={`${masterLinkCls} mt-2 inline-block`}>
            Statements and matching
          </Link>
        </section>
      </div>
    </>
  )
}
