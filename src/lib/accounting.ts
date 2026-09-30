export const POSTING_KEYS = ['vendor_payable', 'owner_payable', 'sales_revenue', 'other_income_revenue', 'inventory_asset', 'input_tax_asset', 'food_cost', 'operating_expense', 'labour_expense', 'withholding_payable', 'staff_advance_asset', 'payroll_deduction_payable', 'tax_payable', 'staff_fund', 'pos_cash_asset', 'pos_upi_asset', 'pos_card_asset', 'pos_delivery_asset', 'pos_receivable_asset', 'pos_other_asset'] as const
export type PostingKey = (typeof POSTING_KEYS)[number]

export function posPaymentMappingKey(mode: string | null): PostingKey {
  const value = (mode ?? '').trim().toLowerCase()
  if (value.includes('cash')) return 'pos_cash_asset'
  if (value.includes('upi') || value.includes('wallet')) return 'pos_upi_asset'
  if (value.includes('card') || value.includes('credit') || value.includes('debit')) return 'pos_card_asset'
  if (value.includes('swiggy') || value.includes('zomato') || value.includes('delivery')) return 'pos_delivery_asset'
  if (value.includes('due') || value.includes('part payment') || value.includes('receivable')) return 'pos_receivable_asset'
  return 'pos_other_asset'
}
