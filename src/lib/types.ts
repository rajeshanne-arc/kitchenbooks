// Shared shapes between server queries and client components.
// All money values travel as Postgres numeric::text strings — never floats.

export type Category = { code: string; name: string; kind: 'ingredient' | 'operational'; sort_order: number }
export type Unit = { code: string; name: string }
export type Restaurant = { id: string; name: string }

export type VendorHit = {
  id: string
  code: string
  name: string
  primary_category: string
  category_name: string
  /** numeric::text from the vendor_dues view */
  balance: string
}

export type ItemHitExisting = {
  kind: 'item'
  id: string
  code: string
  name: string
  category: string
  category_name: string
  purchase_unit: string
  unit_name: string
  /** numeric::text from the item_rates view; null when the item has no rate history */
  prefill_rate: string | null
}

export type ItemHitStarter = {
  kind: 'starter'
  starter_id: number
  name: string
  category: string
  category_name: string
  purchase_unit: string
  unit_name: string
}

export type ItemHit = ItemHitExisting | ItemHitStarter

// Client-side selection state
export type VendorSel = { kind: 'existing'; hit: VendorHit } | { kind: 'new'; name: string; category: string }
export type ItemSel =
  | { kind: 'existing'; hit: ItemHitExisting }
  | { kind: 'starter'; hit: ItemHitStarter; unit: string }
  | { kind: 'new'; name: string; category: string; unit: string }

// Server action payload / result
export type SaveBillInput = {
  billDate: string
  vendor: { kind: 'existing'; id: string } | { kind: 'new'; name: string; category: string }
  lines: {
    item:
      | { kind: 'existing'; id: string }
      | { kind: 'starter'; starterId: number; unit: string }
      | { kind: 'new'; name: string; category: string; unit: string }
    qty: string
    rate: string
  }[]
  gstTotal: string
  transport: string
}

export type SavedBill = {
  purchase: {
    id: string
    billDate: string
    goodsTotal: string
    gstTotal: string
    transport: string
    billTotal: string
    lineCount: number
  }
  vendor: { id: string; code: string; name: string; created: boolean }
  createdItems: { id: string; code: string; name: string }[]
  /** read back from the vendor_dues view after commit */
  dues: { balance: string; purchased: string; paid: string }
}

export type SaveBillResult = ({ ok: true } & SavedBill) | { ok: false; error: string }

// ---------- Books (phase 2) ----------

/** One row of the `bills` view (+ reverses_id joined from purchases for linking) */
export type BillRow = {
  id: string
  bill_date: string
  bill_no: string | null
  vendor_id: string
  vendor_code: string
  vendor_name: string
  goods_total: string
  gst_total: string
  transport: string
  bill_total: string
  line_count: number
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
  reverses_id: string | null
}

export type BillLine = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  rate: string
  amount: string
  gst_amount: string
  transport_alloc: string
  landed: string
}

export type DuesSnap = { balance: string; purchased: string; paid: string }

export type VendorListRow = {
  id: string
  code: string
  name: string
  category_name: string
  status: 'active' | 'inactive'
  balance: string
}

export type VendorDetail = {
  id: string
  code: string
  name: string
  primary_category: string
  category_name: string
  supplies: string[]
  gstin: string | null
  phone: string | null
  payment_terms: string | null
  status: 'active' | 'inactive'
  created_at: string
} & DuesSnap

export type PaymentRow = {
  id: string
  paid_date: string
  amount: string
  mode: string | null
  note: string | null
  created_at: string
}

export type ItemListRow = {
  id: string
  code: string
  name: string
  category_name: string
  purchase_unit: string
  status: 'active' | 'inactive'
  prefill_rate: string | null
}

export type ItemDetail = {
  id: string
  code: string
  name: string
  category: string
  category_name: string
  purchase_unit: string
  purchase_unit_name: string
  stock_unit: string | null
  stock_unit_name: string | null
  conversion_factor: string
  opening_rate: string | null
  gst_rate: string | null
  yield_pct: string
  par_level: string | null
  brand: string | null
  status: 'active' | 'inactive'
  created_at: string
  /** from item_rates */
  prefill_rate: string | null
  last_rate: string | null
  last_rate_date: string | null
}

export type ItemHistoryRow = {
  purchase_id: string
  bill_date: string
  bill_no: string | null
  vendor_name: string
  qty: string
  rate: string
  amount: string
  landed: string
}

export type UpdateVendorInput = {
  name: string
  gstin: string
  phone: string
  paymentTerms: string
  supplies: string[]
  status: 'active' | 'inactive'
}

export type UpdateItemInput = {
  name: string
  brand: string
  gstRate: string
  yieldPct: string
  parLevel: string
  conversionFactor: string
  stockUnit: string
  openingRate: string
  status: 'active' | 'inactive'
}

export type PaymentInput = {
  vendorId: string
  paidDate: string
  amount: string
  mode: string
  note: string
}

export type VoidBillResult =
  | { ok: true; original: BillRow; reversal: BillRow; dues: DuesSnap; duesBefore: string | null }
  | { ok: false; error: string }

export type PaymentResult =
  | { ok: true; payment: PaymentRow; dues: DuesSnap; duesBefore: string }
  | { ok: false; error: string }

export type UpdateVendorResult = { ok: true; vendor: VendorDetail } | { ok: false; error: string }
export type UpdateItemResult = { ok: true; item: ItemDetail } | { ok: false; error: string }
