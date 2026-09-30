import { getRestaurant } from '@/server/queries'
import { listActiveVendors } from '@/server/books-queries'
import { listPurchaseQuotes } from '@/server/quote-queries'
import { businessToday } from '@/server/business-day'
import QuoteForm from '@/components/store/QuoteForm'
import { cardCls, pageSubCls, pageTitleCls } from '@/components/ui'
import { formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import QuoteDecision from '@/components/store/QuoteDecision'
import { getSessionUser } from '@/server/current-user'
import QuoteToOrder from '@/components/store/QuoteToOrder'

export const dynamic = 'force-dynamic'
export default async function QuotesPage() {
  const restaurant = await getRestaurant(); const [vendors, quotes, today, user] = await Promise.all([listActiveVendors(restaurant.id), listPurchaseQuotes(restaurant.id), businessToday(), getSessionUser()])
  return <><header className="pb-4"><h1 className={pageTitleCls}>Vendor quotations</h1><p className={pageSubCls}>{restaurant.name} — compare what vendors offered before raising a purchase order.</p></header><QuoteForm vendors={vendors} today={today}/><section className={`${cardCls} mt-4`}><h2 className="font-display text-lg font-bold text-stone-900">Quotation register</h2>{quotes.length === 0 ? <p className="mt-2 text-sm text-stone-500">No quotations recorded.</p> : <ul className="mt-2 divide-y divide-rule-soft">{quotes.map((q) => <li key={q.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span><strong>{q.vendor_name}</strong> · {fmtDate(q.quote_date)} · {q.line_count} lines{q.reference && ` · ${q.reference}`}<span className="ml-2 text-xs text-stone-500">{q.status}</span></span><span className="flex items-center gap-2"><span className="font-mono tabular-nums">{formatMoneyString(q.total)}</span>{q.status === 'draft' && user !== null && ['manager', 'owner'].includes(user.role) && <QuoteDecision id={q.id}/>} {q.status === 'accepted' && <QuoteToOrder id={q.id}/>}</span></li>)}</ul>}</section></>
}
