// The WhatsApp day-close summary — how Indian restaurants actually report
// to owners. Plain text, label: value lines (WhatsApp has no monospace
// alignment), built from the ladder the database already computed.
import { decimalStringToPaise, formatMoneyString } from '@/lib/money'
import { fmtDate } from '@/lib/format'
import type { DayCloseLadderRow } from '@/lib/types'

export function buildCloseText(restaurantName: string, l: DayCloseLadderRow): string {
  const m = (s: string) => formatMoneyString(s)
  const diff = decimalStringToPaise(l.difference)
  const lines = [
    `*${restaurantName} — day close ${fmtDate(l.close_date)}*`,
    `Opening: ${m(l.opening_cash)}`,
    `+ POS cash: ${m(l.pos_cash)}`,
    `+ Other income: ${m(l.other_income)}`,
    `+ Extra in: ${m(l.extra_cash_in)}`,
    `− Vouchers: ${m(l.cashier_vouchers)}`,
    `− Handed over: ${m(l.handed_over)}${l.handed_to !== null ? ` (to ${l.handed_to})` : ''}`,
    `*Expected: ${m(l.expected_cash)}*`,
    `*Counted: ${m(l.cash_counted)}*`,
    diff === 0 ? `Difference: ${m(l.difference)} ✅` : `⚠️ Difference: ${m(l.difference)}`,
  ]
  if (l.bank_settled !== null) lines.push(`Bank settled: ${m(l.bank_settled)}`)
  if (l.filings > 1) lines.push(`(corrected ×${l.filings - 1} — latest wins)`)
  return lines.join('\n')
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}
