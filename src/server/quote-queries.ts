import 'server-only'
import { tsql } from '@/lib/db'

export type PurchaseQuoteRow = { id: string; vendor_name: string; quote_date: string; valid_until: string | null; status: string; reference: string | null; entered_by: string; decided_by: string | null; line_count: number; total: string }
export async function listPurchaseQuotes(restaurantId: string): Promise<PurchaseQuoteRow[]> {
  return tsql<PurchaseQuoteRow[]>`select q.id, v.name as vendor_name, q.quote_date::text as quote_date, q.valid_until::text as valid_until, case when q.status = 'draft' and q.valid_until < current_date then 'expired' else q.status end as status, q.reference, q.entered_by, q.decided_by, count(l.id)::int as line_count, coalesce(sum(l.qty * l.rate), 0)::text as total from purchase_quotes q join vendors v on v.restaurant_id = q.restaurant_id and v.id = q.vendor_id left join purchase_quote_lines l on l.restaurant_id = q.restaurant_id and l.quote_id = q.id where q.restaurant_id = ${restaurantId} group by q.id, v.name order by q.quote_date desc, q.created_at desc`
}
