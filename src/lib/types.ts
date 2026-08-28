// Shared shapes between server queries and client components.
// All money values travel as Postgres numeric::text strings — never floats.

import type { Role } from '@/lib/roles'

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
  /**
   * numeric::text. VENDOR-SCOPED whenever the bill names an existing vendor.
   *
   * `item_rates.prefill_rate` is the last rate for the item ACROSS ALL VENDORS,
   * and that is wrong on a bill: measured on live data, Chicken Boneless reads
   * 330 because RR Chicken sold it last, while Sneha Chicken charges 300. A
   * Sneha bill was prefilling RR's price, 10% out, on a field somebody tabs
   * straight past. So when the vendor is known this comes from
   * `vendor_supplied_items.last_rate` — still a named view, never recomputed —
   * and falls back to item_rates only when that vendor has never sent the item.
   */
  prefill_rate: string | null
  /** where prefill_rate came from, so the screen can say. 'vendor' = this
   *  vendor's own last bill; 'any' = the last bill from anybody, which is a
   *  weaker claim and is labelled as one; null = no rate history at all. */
  rate_source: 'vendor' | 'any' | null
  /** WHEN this vendor last billed it, so a price warning can name the day it
   *  is comparing against. Only ever set alongside rate_source 'vendor':
   *  a movement is only a movement against the SAME vendor's own last price,
   *  and a date beside a cross-vendor rate would dress up a comparison that
   *  must not be made at all. */
  last_bought: string | null
  /** this vendor has supplied it before — what puts it in the scoped group */
  from_vendor: boolean
  /** whether this item carries a printed expiry date. The bill line asks for
   *  one only when it does — asking on every line trains people to type
   *  anything, and an invented date is worse than none. */
  tracks_expiry: boolean
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
  /** The purchase order this delivery fulfils, when it fulfils one. Optional
   *  and staying that way: a bill citing no order is not wrong, it is
   *  uncompared — po_fulfilment counts only bills that name one. */
  purchaseOrderId?: string
  vendor: { kind: 'existing'; id: string } | { kind: 'new'; name: string; category: string }
  lines: {
    expiryDate?: string
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
    docNo: string | null
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
  doc_no: string | null
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
  /** where a closed code went, and why — see src/lib/closed.ts */
  merged_into_code?: string | null
  closed_reason?: string | null
  closed_by?: string | null
  id: string
  code: string
  name: string
  category_name: string
  status: MasterStatus
  balance: string
  /** NULL when nobody can be rung. A purchase order to a vendor with no
   *  number can be written and printed and never sent. */
  phone: string | null
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
  status: MasterStatus
  created_at: string
  merged_into: string | null
  merged_into_code: string | null
  merged_into_name: string | null
  // contact
  contact_person: string | null
  alt_phone: string | null
  email: string | null
  address: string | null
  // banking — read and copied far more often than edited
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  upi_id: string | null
  // terms
  nature_of_supply: string | null
  /** load-bearing: vendor_dues is opening_balance + purchased − paid */
  opening_balance: string
  notes: string | null
} & DuesSnap

export type PaymentRow = {
  id: string
  doc_no: string | null
  paid_date: string
  amount: string
  mode: string | null
  note: string | null
  created_at: string
}

/** The partners MASTER — the aggregators themselves, not a text list.
 *  agreed_commission_pct is the whole point: it is what the settlement gap
 *  card compares their actual deduction against, and list_options could
 *  never carry it. */
export type Partner = {
  id: string
  name: string
  kind: string
  agreed_commission_pct: string | null
  status: 'active' | 'inactive'
}

export type SavePartnerInput = {
  name: string
  kind: string
  agreedCommissionPct: string
  status: 'active' | 'inactive'
}

export type SavePartnerResult = { ok: true; partner: Partner } | { ok: false; error: string }

/** One itemised deduction under a settlement. */
export type SettlementDeductionRow = {
  id: string
  deduction_type: string
  amount: string
  note: string | null
}

/** A vendor who is owed money — the payment queue, worst first. */
export type VendorDueRow = {
  id: string
  code: string
  name: string
  category_name: string
  payment_terms: string | null
  phone: string | null
  balance: string
  purchased: string
  paid: string
  last_paid_date: string | null
  /** null = never paid, which is not the same as "paid long ago" */
  days_since_payment: number | null
}

export type ItemListRow = {
  /** where a closed code went, and why — see src/lib/closed.ts */
  merged_into_code?: string | null
  closed_reason?: string | null
  closed_by?: string | null
  id: string
  code: string
  name: string
  category_name: string
  purchase_unit: string
  status: MasterStatus
  prefill_rate: string | null
}

/** RETIRED, DISCARDED AND MERGED ARE THREE DIFFERENT SENTENCES, and the
 *  schema keeps them apart on purpose: retired means we stopped buying it,
 *  discarded means it was never real, merged means look over there. Collapsing
 *  any two of them would lose the only account of why a code went quiet. */
export type MasterStatus = 'active' | 'inactive' | 'merged' | 'discarded'

export type ItemDetail = {
  /** PER ITEM, because onions carry no printed date — asking for one on
   *  every line trains people to type anything. */
  tracks_expiry?: boolean
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
  par_level: string | null
  brand: string | null
  status: MasterStatus
  created_at: string
  reorder_level: string | null
  default_vendor_id: string | null
  default_vendor_name: string | null
  item_type: string | null
  notes: string | null
  /** WHERE A CLOSED CODE POINTS. A merged or discarded row stays on the list
   *  forever so the old code still RESOLVES — looking up HKP-024 must tell you
   *  it became HKP-015. That is what makes closing one safe to do at all. */
  merged_into: string | null
  merged_into_code: string | null
  merged_into_name: string | null
  /** from item_rates */
  prefill_rate: string | null
  last_rate: string | null
  last_rate_date: string | null
  /** where it physically sits — null means nobody has placed it */
  storage_location_id: string | null
}

/**
 * One row of an item's movement ledger. `signed_qty` is already signed for the
 * direction — the ledger's job is that a reader never has to remember which
 * kinds add and which take away.
 */
export type ItemLedgerRow = {
  move_date: string
  row_id: string
  kind: 'Purchase' | 'Issue' | 'Return' | 'Wastage' | 'Adjustment' | 'Vendor return'
  signed_qty: string
  ref: string
  party: string | null
  detail: string | null
  /** the running balance AFTER this row, computed over every movement */
  balance: string
  /** how many movements exist in total, so the page can say what it is hiding */
  total: number
}

/** Every column-granted vendor field. `code` and `primary_category` are
 *  absent on purpose — the database refuses to UPDATE them, so the form
 *  shows them locked-with-reason rather than pretending. */
export type UpdateVendorInput = {
  name: string
  gstin: string
  phone: string
  paymentTerms: string
  supplies: string[]
  status: 'active' | 'inactive'
  contactPerson: string
  altPhone: string
  email: string
  address: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  natureOfSupply: string
  openingBalance: string
  notes: string
}

/** Every column-granted item field. yield_pct is absent because its UPDATE
 *  grant was revoked — yield lives on the recipe LINE now. */
export type UpdateItemInput = {
  tracksExpiry?: boolean
  name: string
  brand: string
  gstRate: string
  parLevel: string
  conversionFactor: string
  stockUnit: string
  openingRate: string
  status: 'active' | 'inactive'
  reorderLevel: string
  defaultVendorId: string
  itemType: string
  notes: string
  /** WHERE IT PHYSICALLY SITS — '' means not placed, which is a real answer
   *  and not a default. The count sheet groups unplaced items last and loudly. */
  storageLocationId: string
}

export type PaymentInput = {
  vendorId: string
  /** REQUIRED by the app though nullable in the database — see assertAccount */
  accountId: string
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

// ---------- Store actions (phase 3) ----------

export type DeptGroup = 'Management' | 'Support' | 'Kitchen' | 'Service' | 'Bar'

export type Section = {
  id: string
  code: string
  name: string
  sort_order: number
  status: 'active' | 'inactive'
  dept_group: DeptGroup
  /** whether stock can be ISSUED to this department. Store, Accounts, Valet
   *  and Security cannot receive: the store issuing to itself is not a
   *  movement, and the other three consume nothing the store holds. */
  receives_stock: boolean
}

/** Typeahead hit for issue/wastage forms — existing items only, costs hidden */
export type IssuableItemHit = {
  id: string
  code: string
  name: string
  category_name: string
  purchase_unit: string
  unit_name: string
  /** numeric::text from stock_on_hand */
  on_hand_qty: string
  /** item_costs.issue_cost is non-null — issuable */
  has_cost: boolean
}

/**
 * An item the CONTEXT already knows about — what this department takes, what
 * this vendor supplies.
 *
 * THE RULE IS SCOPE AND RANK, NEVER EXCLUDE. These sit at the top of the
 * picker and the general search stays underneath, reaching everything: a
 * first-time item has no history, and a picker that only offered history
 * would make it unfindable. Same shape bill entry already uses for the
 * starter library.
 */
export type ItemSuggestion = {
  item: IssuableItemHit
  /** how many times this context used it — the frequency half of the rank */
  times: number
  /** the recency half, as a date string */
  last: string
  /** SECTION scope: what a normal issue of this item looks like. A HINT shown
   *  beside the field, never written into it — the closing-prefill ruling
   *  applies, and a quantity nobody counted is worse than a blank one. */
  typical_qty: string | null
  /** VENDOR scope: what the last bill charged, and the LINE it came from, so
   *  a credit rate has a provenance instead of being remembered. */
  last_rate: string | null
  source_purchase_line_id: string | null
}

/** One row of the stock_on_hand view (+ item status) */
export type StockRow = {
  item_id: string
  code: string
  name: string
  category: string
  category_name: string
  purchase_unit: string
  status: 'active' | 'inactive'
  purchased_qty: string
  issued_qty: string
  wasted_qty: string
  on_hand_qty: string
  issue_cost: string | null
  on_hand_value: string
  /** Pareto class from stock_abc. NULL only when the item is absent from that
   *  view — it covers rows with value, so a zero-value item has no class. */
  abc: 'A' | 'B' | 'C' | null
  /** this item's share of total stock value, as published by stock_abc */
  pct_of_value: string | null
  /** QUANTITY DIVIDED BY AVERAGE DAILY USAGE — the number that says whether
   *  23.5 kg is sensible, which no absolute quantity can.
   *
   *  NULL below 7 days of issue history and the screen must SAY SO rather
   *  than print a figure: with one issue ever, max = min, and a naive average
   *  reads the whole quantity as a single day's usage. */
  days_on_hand: string | null
  /** days of issue history behind days_on_hand — null when there is none */
  days_of_history: number | null
}

/** A department (the sections table) with what already depends on it. */
export type DepartmentRow = {
  id: string
  code: string
  name: string
  dept_group: DeptGroup
  /** kitchen departments cook; operational ones do not. The split is what
   *  the two tabs are — a chef looking for Tandoori should not scroll past
   *  Security to reach it. */
  dept_kind: string
  /** whether stock can be ISSUED here. Unlike the code this can change: a
   *  department starts consuming, or stops. */
  receives_stock: boolean
  sort_order: number
  status: 'active' | 'inactive'
  issues: number
  dishes: number
  staff: number
}

export type SectionMonthRow = Section & {
  /** section_consumption.consumed_value for the month; '0' when absent */
  consumed_value: string
}

export type IssueDetail = {
  id: string
  issue_date: string
  section_id: string
  section_code: string
  section_name: string
  note: string | null
  indent_id: string | null
  reverses_id: string | null
  entered_by: string | null
  created_at: string
  is_reversal: boolean
  is_voided: boolean
  line_count: number
  total_value: string
}

export type IssueLineRow = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  unit_cost: string
  value: string
}

export type WastageDetail = {
  id: string
  waste_date: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  unit_cost: string
  value: string
  reason: string
  note: string | null
  reverses_id: string | null
  entered_by: string | null
  created_at: string
  is_reversal: boolean
  is_voided: boolean
}

/** Chronological store log: issues and wastage in one list */
export type StoreLogRow = {
  kind: 'issue' | 'wastage'
  id: string
  date: string
  created_at: string
  is_reversal: boolean
  is_voided: boolean
  value: string
  // issue rows
  section_code?: string
  section_name?: string
  line_count?: number
  // wastage rows
  item_name?: string
  qty?: string
  purchase_unit?: string
  reason?: string
}

/** stock_on_hand snapshot for reveals */
export type StockSnap = {
  item_id: string
  code: string
  name: string
  purchase_unit: string
  on_hand_qty: string
  on_hand_value: string
}

export type ChecklistRow = { id: string; code: string; name: string; sort_order: number; issues_today: number }

/** One row of reorder_due — an item at or below its reorder level. */
/** One line of indent_fulfilment: what was asked, what was given, and the
 *  gap between them. The gap is the point of the whole screen. */
export type IndentFulfilmentRow = {
  indent_id: string
  indent_date: string
  session: string
  section_code: string
  section_name: string
  status: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty_requested: string
  /** NULL on a cancelled indent — never zero. Nothing was going to be given,
   *  so there is no quantity and no shortage to state. */
  qty_given: string | null
  /** given − requested: NEGATIVE is short, positive is extra, NULL cancelled.
   *  Rendered as words, never as a signed number. */
  gap: string | null
}

export type ReorderRow = {
  item_id: string
  code: string
  name: string
  category: string
  purchase_unit: string
  on_hand_qty: string
  reorder_level: string
  par_level: string | null
  suggested_qty: string
  usual_vendor: string | null
  vendor_id: string | null
  issue_cost: string | null
  /** proportion of the reorder level still on hand — lower is more urgent.
   *  NULL where no level is set, which sorts last. */
  urgency: string | null
}

export type SaveIssueInput = {
  issueDate: string
  sectionId: string
  /** Morning / Evening / Extra / Catering. REQUIRED — see saveIssue: the
   *  column defaults to 'Morning' in the database, and letting that default
   *  stand is what silently mislabelled every issue ever entered. */
  session: string
  lines: { itemId: string; qty: string; note: string }[]
  /** open indent this issue answers — stamped on the issue, marks the indent issued */
  indentId?: string
  /** the catering event this stock went to. catering_summary sums ONLY
   *  stamped issues, so without this an event's food cost reads zero and
   *  its margin reads as the whole revenue. */
  cateringId?: string
}

export type SaveIssueResult =
  | { ok: true; issue: IssueDetail; lines: IssueLineRow[]; stock: StockSnap[] }
  | { ok: false; error: string }

/** A return is an issue running backwards: stock coming back off a section.
 * Same shape as IssueDetail minus the indent stamp, plus the reason. */
export type ReturnDetail = {
  id: string
  return_date: string
  section_id: string
  section_code: string
  section_name: string
  reason: string
  note: string | null
  reverses_id: string | null
  entered_by: string | null
  created_at: string
  is_reversal: boolean
  is_voided: boolean
  line_count: number
  total_value: string
}

export type ReturnLineRow = IssueLineRow

export type SaveReturnInput = {
  returnDate: string
  sectionId: string
  /** the session this stock went back from */
  session: string
  /** PER LINE, from the return_reason managed list. A tray of gravy that was
   *  never needed and a crate of onions that turned go back on the same trip
   *  for two different reasons, and the reason is what waste analysis reads.
   *  Same ruling as kitchen and store loss. */
  lines: { itemId: string; qty: string; note: string; reason: string }[]
}

export type SaveReturnResult =
  | { ok: true; ret: ReturnDetail; lines: ReturnLineRow[]; stock: StockSnap[] }
  | { ok: false; error: string }

export type SaveWastageInput = {
  wasteDate: string
  itemId: string
  qty: string
  reason: string
  note: string
}

export type SaveWastageResult =
  | { ok: true; wastage: WastageDetail; stock: StockSnap }
  | { ok: false; error: string }

export type VoidIssueResult =
  | { ok: true; original: IssueDetail; reversal: IssueDetail; stock: StockSnap[]; monthValue: string }
  | { ok: false; error: string }

export type VoidWastageResult =
  | { ok: true; original: WastageDetail; reversal: WastageDetail; stock: StockSnap }
  | { ok: false; error: string }

// ---------- Recipes (phase 4) ----------

/** dish_costs view row (+ section sort for grouping) */
/** The whole dish card, exactly as dish_costs computes it. Every figure
 *  below is the VIEW's — this app renders them and never recomputes one. */
/** One supplier's EXPOSURE: how much of the menu depends on them. */
export type SupplierExposureRow = {
  supplier: string
  items: number
  dishes: number
  batch_cost: string
}

export type DishCard = {
  recipe_id: string
  code: string
  name: string
  section_code: string
  section_name: string
  pos_code: string | null
  course: string | null
  diet: string | null
  dish_cost: string
  portions: string | null
  portion_size: string | null
  portion_unit: string | null
  overhead_pct: string | null
  /** ingredients only, per portion */
  cost_per_portion: string | null
  /** with the manual overhead added */
  loaded_per_portion: string | null
  selling_price: string | null
  /** ingredients only — NOT loaded. Said on the card. */
  food_cost_pct: string | null
  margin_per_portion: string | null
  /** this course's target, from course_targets */
  target_pct: string | null
  /** OK | HIGH | CHECK — CHECK means the dish costs zero */
  flag: string | null
  uncosted_lines: number
  status: 'active' | 'inactive'
}

/** The header + inputs a chef may edit on a dish card. */
export type SaveDishCardInput = {
  posCode: string
  course: string
  diet: string
  photoUrl: string
  videoUrl: string
  portions: string
  portionSize: string
  portionUnit: string
  overheadPct: string
  sellingPrice: string
}

export type DishCostRow = {
  recipe_id: string
  code: string
  name: string
  section_code: string
  section_name: string
  section_sort: number
  dish_cost: string
  selling_price: string | null
  food_cost_pct: string | null
  uncosted_lines: number
  status: 'active' | 'inactive'
  /** the course this dish belongs to, which is what its TARGET is set against.
   *  Null when nobody has said, and a null target makes the flag comparison
   *  null — see `flag`. */
  course: string | null
  /** NULLABLE with no default: a dish nobody has told how many it makes has
   *  no per-portion answer at all, and the card says so rather than dividing. */
  portions: string | null
  cost_per_portion: string | null
  /** `course_targets` for this dish's course, falling back to DEFAULT */
  target_pct: string | null
  /** 'OK' | 'HIGH' | 'CHECK'. CHECK is NEITHER of the other two — it fires
   *  when the dish costs zero, has no selling price or has no portions, and it
   *  is a repair job, never a cheap dish. Note the degenerate case: a NULL
   *  target_pct makes the comparison NULL and the view's CASE falls through to
   *  'OK', so an unassessable dish can read OK — the card must not trust the
   *  flag alone when target_pct is null. */
  flag: string
}

/** recipe_costs view row for subs (+ status from recipes) */
export type SubCostRow = {
  recipe_id: string
  code: string
  name: string
  output_qty: string
  output_unit: string
  total_cost: string
  cost_per_output_unit: string
  uncosted_lines: number
  status: 'active' | 'inactive'
}

export type RecipeDetail = {
  merged_into: string | null
  merged_into_code: string | null
  merged_into_name: string | null
  id: string
  code: string
  name: string
  kind: 'dish' | 'sub'
  section_id: string | null
  section_code: string | null
  section_name: string | null
  output_qty: string
  output_unit: string
  output_unit_name: string
  selling_price: string | null
  status: MasterStatus
  created_at: string
  // live from recipe_costs / dish_costs
  total_cost: string
  cost_per_output_unit: string
  uncosted_lines: number
  food_cost_pct: string | null
}

export type RecipeLineRow = {
  id: string
  component_item_id: string | null
  component_recipe_id: string | null
  component_code: string
  component_name: string
  is_sub: boolean
  qty: string
  unit: string
  /** THE LINE'S yield, not the item's. 100 means nothing is trimmed away.
   *  A sub-recipe line always reads 100 and hides it — the yields inside
   *  the sub were already applied when its own cost was worked out, and
   *  applying one again would trim the same loss twice. */
  yield_pct: string
  /** live: item_costs.issue_cost or sub's recipe_costs.cost_per_output_unit; null when unpriced */
  unit_cost: string | null
  /** unit_cost ÷ (yield ÷ 100) — what a USABLE unit costs once trim is paid
   *  for. Basha at ₹350/kg and 55% yield is ₹636.36 per usable kilo. */
  usable_cost: string | null
  line_cost: string | null
  uncosted: boolean
  /** for sub components: how many of ITS lines are uncosted */
  sub_uncosted_lines: number
}

export type ComponentHit =
  | {
      kind: 'item'
      id: string
      code: string
      name: string
      category_name: string
      purchase_unit: string
      unit_name: string
      has_cost: boolean
    }
  | {
      kind: 'sub'
      id: string
      code: string
      name: string
      output_unit: string
      unit_name: string
    }

export type CreateRecipeInput = {
  kind: 'dish' | 'sub'
  name: string
  sectionId: string
  outputQty: string
  outputUnit: string
  sellingPrice: string
}

export type CreateRecipeResult = { ok: true; id: string; code: string } | { ok: false; error: string }

export type UpdateRecipeInput = {
  name: string
  outputQty: string
  outputUnit: string
  sellingPrice: string
  status: 'active' | 'inactive'
}

export type RecipeMutationResult =
  | { ok: true; recipe: RecipeDetail; lines: RecipeLineRow[] }
  | { ok: false; error: string }

export type AddLineInput = {
  recipeId: string
  component: { kind: 'item'; id: string } | { kind: 'sub'; id: string }
  qty: string
}

// ---------- Labour (phase 5) ----------

export type EmploymentType = 'full_time' | 'trainee' | 'contract'
export type Grade = 'L1' | 'L2' | 'L3' | 'L4' | 'L5' | 'L6' | 'L7'
export type PayMode = 'account' | 'cash'
export type AttendanceStatus = 'present' | 'half' | 'off' | 'leave' | 'absent'

export type StaffRow = {
  id: string
  code: string
  name: string
  designation: string | null
  section_id: string | null
  section_code: string | null
  section_name: string | null
  dept_group: DeptGroup | null
  section_sort: number | null
  grade: Grade | null
  employment_type: EmploymentType
  base_salary: string | null
  pay_mode: PayMode | null
  joined: string | null
  left_date: string | null
  reports_to: string | null
  reports_to_name: string | null
  phone: string | null
  /** EMERGENCY CONTACT IS MANAGER-VISIBLE, and deliberately on StaffRow
   *  rather than in the identity block: the person who needs it in an
   *  emergency is the one on shift, and a detail only the owner can read is
   *  no use at 11pm. Aadhaar and address are NOT here — StaffRow crosses the
   *  wire to a manager. */
  emergency_name: string | null
  emergency_phone: string | null
  emergency_relation: string | null
  status: 'active' | 'inactive'
  created_at: string
}

/** '' means null for the nullable fields */
export type StaffInput = {
  name: string
  designation: string
  sectionId: string
  grade: string
  employmentType: EmploymentType
  baseSalary: string
  payMode: string
  joined: string
  leftDate: string
  reportsTo: string
  phone: string
  emergencyName: string
  emergencyPhone: string
  emergencyRelation: string
  status: 'active' | 'inactive'
  /** Bank, statutory, personal — OWNER AND ACCOUNTANT ONLY, refused by name
   *  for anyone else. Optional because a manager's form does not render the
   *  block at all, and asked at CREATE as well as on edit: a field nobody
   *  fills on the way past is a field nobody ever fills. */
  identity?: UpdateStaffIdentityInput
}

/** One day on the strip. `filings` > 1 means the day was corrected; the
 *  correction is BADGED, never merged away. */
export type AttendanceDay = {
  att_date: string
  status: AttendanceStatus
  /** hours worked BEYOND the normal day. null is the ordinary case. */
  extra_hours: string | null
  entered_by: string | null
  filings: number
}

/** `staff_payroll_history`, one run. DRAFT IS NOT MONEY THAT MOVED. */
export type PayrollHistoryRow = {
  run_id: string
  doc_no: string | null
  period_start: string
  period_end: string
  status: 'draft' | 'approved' | 'paid'
  days_in_period: string
  days_paid: string
  earned: string
  overtime: string
  advance_recovered: string
  other_deduction: string
  withholding: string
  net_payable: string
  paid_on: string | null
  pay_mode: string | null
}

/** `advances_outstanding`. Absent entirely for somebody who never had one. */
export type AdvancesOutstandingRow = {
  given: string
  recovered: string
  outstanding: string
  last_advance: string | null
}

export type AdvanceLedgerRow = {
  id: string
  adv_date: string
  amount: string
  doc_no: string | null
  note: string | null
  entered_by: string | null
  is_reversal: boolean
  is_reversed: boolean
}

export type StaffMutationResult = { ok: true; staff: StaffRow } | { ok: false; error: string }

export type AttendanceHistoryRow = { status: AttendanceStatus; created_at: string }

export type DaySheetRow = {
  staff_id: string
  code: string
  name: string
  designation: string | null
  section_name: string | null
  dept_group: DeptGroup | null
  employment_type: EmploymentType
  effective: AttendanceStatus | null
  /** hours worked BEYOND the normal day on the winning row. null is the
   *  ordinary case — a normal day is the ABSENCE of a value, not a zero. */
  extra_hours: string | null
  history: AttendanceHistoryRow[]
}

export type SaveAttendanceResult =
  | { ok: true; inserted: number; sheet: DaySheetRow[] }
  | { ok: false; error: string }

export type SectionCostRow = {
  section_code: string
  section_name: string
  dept_group: DeptGroup | null
  consumption: string
  labour: string
  total_cost: string
  sales: string
  margin: string
  unassigned_marks: number
  unsalaried_marks: number
}

// ---------- Sales (phase 6) ----------

export type StatusClass = 'revenue' | 'cancelled' | 'complimentary' | 'unknown'

export type SalesDayRow = {
  business_date: string
  orders: number
  covers: number
  revenue: string
  cash_revenue: string
  comps: number
  comp_value: string
  cancelled: number
  unknown_status: number
  fetch_count: number
  last_fetched_at: string
}

export type UnknownOrderRow = {
  business_date: string
  pos_order_id: string
  status_raw: string
  channel: string | null
  order_total: string | null
}

export type FetchDayResult =
  | {
      ok: true
      fetchId: string
      businessDate: string
      apiOrderCount: number
      insertedOrders: number
      /** superseded generations of this date, removed in the same
       *  transaction — every pos_fetches row is kept */
      prunedOrders: number
      skippedOtherDates: number
      duplicateIds: number
      compDisagreements: number
      note: string | null
      /** WHAT PETPOOJA ACTUALLY SENT — key NAMES only, never values. It
       *  answers, in one real fetch, two questions unanswerable from this
       *  side: whether an item code arrives, and whether any leakage field
       *  does. Not persisted: it is a diagnostic read once by a person, and
       *  a census of a payload carrying customer names must not become a
       *  copy of it. */
      census: PayloadCensus
      day: SalesDayRow | null
      unknownOrders: UnknownOrderRow[]
    }
  | { ok: false; error: string }

/** One POS order billed and not (fully) collected, waiting for a person to
 *  say who owes it. Due Payment asks WHO; Part Payment asks WHO and HOW MUCH,
 *  with the order total shown for reference — the POS gives us the total, not
 *  the split. */
export type PosReceivableRow = {
  business_date: string
  pos_order_id: string
  payment_mode: string
  order_total: string
  channel: string | null
  order_time: string | null
}

/** `day_summary`, one row per business date — the flash report's spine, and
 *  the same view the owner dashboard sums over a period. */
export type DaySummaryRow = {
  business_date: string
  revenue: string | null
  orders: number | null
  covers: number | null
  cash_revenue: string | null
  comps: number | null
  comp_value: string | null
  cancelled: number | null
  unknown_status: number | null
  per_cover: string | null
  off_book: string
  other_income: string
  purchases: string
  bills: number
  /** ISSUED IS NOT CONSUMED. Stock that left the store, not food that was
   *  eaten — a kitchen draws 10 kg on Monday and cooks it over three days. */
  issued: string
  returned: string
  issued_net: string
  store_wastage: string
  kitchen_wastage: string
  labour: string
  giveaway_cost: string
  gst_collected: string | null
  service_charge: string | null
  effective_gst_pct: string | null
  expected_cash: string | null
  cash_counted: string | null
  difference: string | null
  day_closed: boolean
  sections_closed: number
}

/** WHAT MAY BE SAID AT ALL. day_summary coalesces its money columns to 0, so
 *  a day with no bills entered reports ₹0 of purchases — indistinguishable
 *  from a day that bought nothing. These counts are the difference. */
export type DayEvidence = {
  bills: number
  issues: number
  store_losses: number
  kitchen_losses: number
  marks: number
  roster: number
  no_salary: number
  closable_sections: number
  fetches: number
}

export type PayloadCensus = {
  topKeys: string[]
  orderKeys: string[]
  itemKeys: string[]
  candidates: { itemCode: string[]; leakage: string[] }
}

export type UnmappedPosItem = {
  pos_item_id: string
  item_name: string | null
  qty: string
  revenue: string
}

/**
 * THREE TARGETS, and each answers a different amount of the question.
 *
 *   a DISH        gives the department AND the cost — the fullest answer
 *   a STOCK ITEM  gives the cost, and needs a department beside it to say
 *                 where it sold; bottled water is bought, stocked, issued and
 *                 sold, so it has a real cost and will never have a recipe
 *   a DEPARTMENT  gives the department alone — revenue lands in the right
 *                 place and no cost does
 *
 * Without the item target, resold goods sit inside ACTUAL consumption and are
 * absent from THEORETICAL, so every Bar variance is wrong by the price of the
 * drinks.
 */
export type PosMapRow = {
  id: string
  pos_item_id: string
  item_name: string | null
  recipe_id: string | null
  /** A DIRECT department, for anything that will never have a recipe.
   *  recipe_id WINS when both are set. */
  section_id: string | null
  /** A STOCK ITEM — carries the cost. Always saved WITH a section, because
   *  theoretical_food_cost groups on coalesce(recipe.section_id,
   *  map.section_id): an item with no department lands its cost in the
   *  Unmapped bucket, where the department that sold it never sees it.
   *  Measured on the probe tenant, not inferred. */
  item_id: string | null
  recipe_code: string | null
  recipe_name: string | null
  section_code: string | null
  section_name: string | null
  item_code: string | null
  /** The master item's own name, kept apart from `item_name`, which is what
   *  the POS calls the thing. */
  stock_item_name: string | null
}

/** An item a POS line can be pointed at — one that is bought and resold. */
export type ItemOption = {
  id: string
  code: string
  name: string
  category: string
  /** NULL when nothing has ever been bought and no opening rate is set: the
   *  cost side would be blank, so the picker says so rather than offering it
   *  as an equal answer. */
  issue_cost: string | null
}

/** `mapping_coverage`. COVERAGE IS THE HEADLINE, NOT A COUNT.
 *
 *  `revenue_mapped` is NULL, not 0, when nothing is mapped — a sum over no
 *  rows.
 *
 *  `items_costed` counts BOTH costing routes — `recipe_id IS NOT NULL OR
 *  item_id IS NOT NULL`. It briefly counted dishes alone, which made a mapped
 *  and priced bottled water read as uncosted.
 *
 *  IT STILL MEANS "POINTS AT A COSTING ROUTE", NOT "CAN BE PRICED THROUGH IT":
 *  a dish with no portion count is counted here and contributes nothing to
 *  theoretical_food_cost, whose join requires `cost_per_portion IS NOT NULL`.
 *  Those dishes are named individually on the variance card rather than left
 *  for a reader to infer from a percentage. */
export type MappingCoverage = {
  items_seen: number
  items_mapped: number
  items_costed: number
  revenue_seen: string
  revenue_mapped: string | null
  pct_attributed: string
}

export type SalesHourRow = {
  hour: number
  orders: number
  covers: number
  revenue: string
  /** NULL where covers is zero — the view refuses that division rather than
   *  reporting an infinite spend per head. */
  per_cover: string | null
}

export type PaymentSplitRow = {
  payment_mode: string
  orders: number
  revenue: string
}

export type DishOption = { id: string; code: string; name: string; section_code: string }

/**
 * How often a dish has been used in ONE context — the rank for a dish picker.
 *
 * `scope` is whatever narrows it: a non-revenue reason, a department. It is ''
 * when the only ranking available is overall frequency, which is the other half
 * of the picker rule — a picker WITHOUT context is ranked by frequency, and
 * alphabetical is the default nobody chose.
 *
 * Same shape as `ItemSuggestion` and used the same way: the suggested group
 * renders on top and every dish stays in the list below it.
 */
/* ── the staff dashboard (migration staff_analytics_views) ───────────────── */

/** `labour_summary`, verbatim. ALL THREE KINDS OF LABOUR, because pnl_monthly
 *  already treats them as one line: salaried wages, contract vendors and casual
 *  day hands. A dashboard that showed only payroll would understate the wage
 *  bill by however much of it walks in without a contract. */
export type LabourSummaryRow = {
  month: string
  wages: string
  contract: string
  casual: string
  total_labour: string
  /** NULL when no sales day has been fetched — the denominator, not a zero */
  revenue: string | null
  /** NULL for the same reason. Restaurants run roughly 25–35%. */
  labour_pct_of_sales: string | null
  active_heads: number
  cost_per_head: string | null
}

/** `attendance_summary` — one row per person per month. `off_days` and
 *  `leave_days` are named around the SQL keywords `off` and `leave`. */
export type AttendanceSummaryRow = {
  staff_id: string
  code: string
  name: string
  section_code: string | null
  section_name: string | null
  month: string
  days_marked: number
  present: number
  half: number
  off_days: number
  leave_days: number
  absent: number
  absent_pct: string | null
}

/** `labour_cost_by_section` for one month — the wage cost per department plus
 *  its two honesty columns. Its OWN type: reusing SectionCostRow meant faking
 *  consumption, sales and margin as '0' to satisfy the shape, and a type
 *  padded with lies is a comment rather than a contract. */
export type SectionLabourRow = {
  section_code: string
  section_name: string
  labour: string
  /** marks belonging to staff with no department — these land on the
   *  synthetic '—' row, so on a real department's row this is always 0 */
  unassigned_marks: number
  /** marks counted as paid for somebody with no salary on file */
  unsalaried_marks: number
}

/** `advances_outstanding` — money out of the business that nobody is chasing. */
export type AdvanceOutstandingRow = {
  staff_id: string
  code: string
  name: string
  given: string
  recovered: string
  outstanding: string
  last_advance: string | null
}

/** `headcount_by_section`. `no_salary_set` is the honesty column: a person with
 *  no salary contributes NOTHING to labour cost, so every one of them silently
 *  understates the wage bill. */
export type HeadcountRow = {
  section_code: string | null
  section_name: string | null
  dept_group: string | null
  employment_type: string
  heads: number
  no_salary_set: number
  monthly_salary_bill: string
}

/* ── the department drill-down (/kitchen/departments/[code]) ─────────────── */

/** The one `sections` read the whole page hangs off. It carries BOTH keys
 *  because the relations are split on which one they publish: `section_costs`,
 *  `section_food_cost`, `labour_cost_by_section`, `section_consumption_daily`,
 *  `indent_fulfilment`, `issue_frequency` and `dish_costs` key on
 *  `section_code` TEXT, while `productions`, `kitchen_wastage`,
 *  `kitchen_closing_current`, `issues`, `indents` and `staff` key on
 *  `section_id` UUID and carry no code at all. Picking the wrong one is a
 *  42703 on a live page, so the resolution happens once, here. */
export type DepartmentDetail = {
  id: string
  code: string
  name: string
  dept_group: string
  /** 'kitchen' | 'operational' — the switch for the thinner page. NOT
   *  dept_group: Service and Management are both operational. */
  dept_kind: string
  /** false for SF and KS as well as every operational unit — a dish CANNOT be
   *  coded here, which is a different sentence from "no dishes yet" */
  codes_dishes: boolean
  /** false for Store, Accounts, Valet, Security — they consume nothing the
   *  store holds, so an empty issue history is structural, not missing */
  receives_stock: boolean
  status: string
  dishes: number
  staff: number
}

/** `section_costs` for one department, ONE ROW PER MONTH and deliberately not
 *  summed in SQL — every figure is COALESCEd to 0 inside the view, so a month
 *  with no row must stay absent rather than arriving as a confident zero. */
export type SectionCostMonthRow = {
  month: string
  consumption: string
  labour: string
  total_cost: string
  sales: string
  margin: string
}

/** `labour_cost_by_section` for one department.
 *
 *  `unassigned_marks` is DELIBERATELY ABSENT. The view is grouped by
 *  `coalesce(s.code, '—')` and the column is
 *  `count(*) filter (where st.section_id is null)`, so on a real department's
 *  row it is structurally always 0 — a permanent all-clear against an honesty
 *  column that can never fire. `unsalaried_marks` is the one that can. */
export type SectionLabourMonthRow = {
  month: string
  labour_cost: string
  unsalaried_marks: number
}

/** One day of "made and held" for a department. `closed` is NULL when no
 *  closing was filed that day — never 0, which is a real closing. */
export type SectionShiftDayRow = {
  day: string
  produced: string
  batches: number
  closed: string | null
}

/** Kitchen loss for one department, grouped by the reason the chef stated.
 *  Grouped on the TEXT: inline list additions mean a reason can legitimately
 *  be a word `list_options` has never seen. */
export type SectionLossReasonRow = {
  reason: string
  events: number
  value: string
}

/** `issue_frequency`, verbatim. `issue_count` counts issues FILED — the view
 *  filters `reverses_id is null` and nothing else, so a voided issue's original
 *  is still in it. `sessions` is a comma-joined string, not an array. */
export type IssueFrequencyRow = {
  issue_date: string
  issue_count: number
  sessions: string
  extra_count: number
}

/** Who is posted to a department. A NARROWED select on purpose: `STAFF_SELECT`
 *  carries `base_salary` and `phone`, and everything in an RSC payload is
 *  shipped to the browser — a chef has no reason to hold a cook's salary. */
export type SectionStaffRow = {
  id: string
  code: string
  name: string
  designation: string | null
  grade: string | null
  employment_type: string
}

export type DishUsage = {
  scope: string
  recipe_id: string
  times: number
  last: string
}

export type MapItemResult =
  | { ok: true; map: PosMapRow; unmappedLeft: number; coverage: MappingCoverage | null }
  | { ok: false; error: string }

export type QtySoldRow = { recipe_id: string; qty_sold: string; sales_value: string }

// ---------- Cash (phase 7) ----------

export type PaidBy = 'cashier' | 'owner'

export type VoucherRow = {
  id: string
  doc_no: string | null
  voucher_date: string
  amount: string
  paid_to: string
  paid_by: PaidBy
  owner_name: string | null
  category: string
  note: string | null
  created_at: string
}

/** One payment. Everything that identifies a payment is per line — the payee,
 *  the amount, who funded it, what kind of thing it was. */
export type VoucherLineInput = {
  /** PER LINE, not shared. "Paid by" says whose money it was; this says which
   *  account it actually left, and in one sitting a cashier payment leaves
   *  the drawer while an owner-funded one leaves the owner's own account. */
  accountId: string
  amount: string
  paidTo: string
  paidBy: PaidBy
  ownerName: string
  category: string
  note: string
  isStockPurchase: boolean
  isCasualLabour: boolean
}

/**
 * Header + lines, and the header is ONLY the date. The account is per line:
 * see VoucherLineInput.
 *
 * EVERY LINE TAKES ITS OWN DOCUMENT NUMBER. A batch is a convenience of
 * ENTRY, not a document. Three payments made in one sitting are three
 * payments — different payees, individually voidable, individually cited by
 * an accountant months later — and one number across three would change
 * meaning the instant one of them was voided.
 *
 * This is exactly where it differs from `SaveShortsInput`, and the difference
 * is real rather than a convention: there the header is THE BILL, a document
 * that already exists and is already numbered, and the shorts hang off it.
 * Here the header is a date, which is a keystroke saving and nothing more.
 */
export type SaveVouchersInput = {
  date: string
  lines: VoucherLineInput[]
}
export type SaveVouchersResult =
  | { ok: true; vouchers: VoucherRow[]; total: string }
  | { ok: false; error: string }

export type SaveVoucherInput = {
  accountId: string
  date: string
  amount: string
  paidTo: string
  paidBy: PaidBy
  ownerName: string
  category: string
  note: string
  /** LOAD-BEARING, not a tick-box. The P&L computes cost of goods as
   *  opening + purchases − closing. A cash market purchase recorded only as
   *  a voucher never enters `purchases`, so it vanishes from COGS entirely:
   *  understated cost, overstated margin, and nothing on screen looks wrong.
   *  This flag is what lets those vouchers be found and counted. */
  isStockPurchase: boolean
  /** Drawer-paid casual labour. The drawer reconciles against reality, and
   *  reality is ONE payment — requiring both a voucher and a casual_labour
   *  row for the same Rs 800 is double entry with nothing checking the
   *  halves. pnl_monthly's casual_labour line UNIONs flagged vouchers with
   *  the casual_labour table; changing either side changes that total. */
  isCasualLabour: boolean
}

export type SaveVoucherResult = { ok: true; voucher: VoucherRow } | { ok: false; error: string }

export type OtherIncomeRow = {
  id: string
  income_date: string
  item: string
  qty: string | null
  unit: string | null
  amount: string
  buyer: string | null
  received_by: string | null
  created_at: string
}

/** One sundry receipt. The BUYER is per line, argued: a scrap dealer taking
 *  three things is a real shared fact, but a day's sundries just as often
 *  means a dealer, a vending commission and a staff sale — different buyers
 *  entirely. Per line is never wrong; the name picker makes repetition cheap. */
export type OtherIncomeLineInput = {
  accountId: string
  item: string
  qty: string
  unit: string
  amount: string
  buyer: string
  receivedBy: string
}
export type SaveOtherIncomesInput = { date: string; lines: OtherIncomeLineInput[] }
export type SaveOtherIncomesResult =
  | { ok: true; rows: OtherIncomeRow[]; total: string }
  | { ok: false; error: string }

export type SaveOtherIncomeInput = {
  accountId: string
  date: string
  item: string
  qty: string
  unit: string
  amount: string
  buyer: string
  receivedBy: string
}

export type SaveOtherIncomeResult = { ok: true; income: OtherIncomeRow } | { ok: false; error: string }

export type OwnerOwedRow = {
  person: string
  paid_from_pocket: string
  reimbursed: string
  balance: string
}

/** One rung short of saving: everything the cashier does NOT type, read
 * server-side so the close form can show the ladder before the save. */
export type ClosePrefill =
  | {
      ok: true
      date: string
      opening: string
      openingSource: 'previous counted' | 'first_opening_cash' | 'first day (re-file)'
      posCash: string
      otherIncome: string
      cashierVouchers: string
      /** off-book orders paid in CASH — they sit in the drawer too */
      offBookCash: string
      priorFilings: number
      anyCloses: boolean
    }
  | { ok: false; blocked: 'no_opening' | 'missing_prev'; missingDate: string | null; anyCloses: boolean; error: string }

export type DayCloseLadderRow = {
  close_date: string
  opening_cash: string
  pos_cash: string
  other_income: string
  off_book_cash: string
  extra_cash_in: string
  cashier_vouchers: string
  handed_over: string
  handed_to: string | null
  expected_cash: string
  cash_counted: string
  difference: string
  bank_settled: string | null
  entered_by: string | null
  created_at: string
  filings: number
}

export type CloseDayInput = {
  /** the account the bank block settled into. Required only when
   *  bankSettled is non-zero — money that did not move needs no account. */
  bankAccountId: string
  date: string
  extraCashIn: string
  handedOver: string
  handedTo: string
  cashCounted: string
  bankSettled: string
  note: string
}

export type CloseDayResult = { ok: true; ladder: DayCloseLadderRow } | { ok: false; error: string }

export type SetOpeningResult = { ok: true; value: string } | { ok: false; error: string }

// ---------- Counts + snapshots (phase 8) ----------

export type CountableItem = {
  id: string
  code: string
  name: string
  purchase_unit: string
  unit_name: string
  category_name: string
  /** WHERE IT PHYSICALLY IS. Null means nobody has placed it, and the sheet
   *  groups those LAST and loudly — an unplaced item is missed on a walk. */
  location_id: string | null
  location_name: string | null
  location_kind: string | null
  /** walking order, not alphabetical — see storage_locations.sort_order */
  location_order: number | null
  abc: 'A' | 'B' | 'C' | null
}

/** Where stock physically sits. A MASTER, not a list value: items point at a
 *  row, so a rename has to follow them, and nothing can point at a list
 *  value. Same reasoning as sections and partners. */
export type StorageLocation = {
  id: string
  name: string
  kind: string
  sort_order: number
  note: string | null
  status: 'active' | 'inactive'
  /** how many items are placed here — the reason reordering matters */
  item_count: number
}

export type SaveLocationInput = {
  name: string
  kind: string
  note: string
  status: 'active' | 'inactive'
}

export type SaveCountInput = {
  /** Join a count already in progress rather than starting a second one. Two
   *  people counting two rooms are doing ONE count; two rows for one night
   *  would freeze the same book twice and produce two variance sets. */
  countId?: string
  /** the room this person walked — recorded so the sheet can say what is
   *  still to do, and so a line can say who counted it */
  locationId?: string
  countDate: string
  note: string
  lines: { itemId: string; countedQty: string }[]
}

export type CountVarianceRow = {
  item_id: string
  code: string
  name: string
  purchase_unit: string
  counted_qty: string
  book_qty: string
  unit_cost: string
  variance_qty: string
  variance_value: string
}

export type CountHeader = {
  id: string
  count_date: string
  note: string | null
  created_at: string
  line_count: number
  total_variance_value: string
}

export type SaveCountResult =
  | { ok: true; count: CountHeader; variances: CountVarianceRow[]; historyDays: number }
  | { ok: false; error: string }

export type SnapshotGroup = {
  snap_date: string
  dishes: number
  created_at: string
}

export type SnapshotRow = {
  code: string | null
  name: string | null
  section_code: string | null
  dish_cost: string | null
  selling_price: string | null
  food_cost_pct: string | null
}

export type PhotographResult =
  | { ok: true; snapDate: string; dishes: number }
  | { ok: false; error: string }

// ---------- Kitchen (phase 9) ----------

export type ClosingRow = {
  id: string
  section_id: string
  section_code: string
  section_name: string
  close_date: string
  closing_value: string
  note: string | null
  entered_by: string | null
  created_at: string
  filings: number
}

export type SaveClosingInput = { date: string; sectionId: string; value: string; note: string }
export type SaveClosingResult = { ok: true; closing: ClosingRow } | { ok: false; error: string }

export type ClosingChecklistRow = {
  section_id: string
  code: string
  name: string
  closing_value: string | null
  filings: number
  entered_by: string | null
}

export type KitchenWastageRow = {
  id: string
  waste_date: string
  section_id: string
  section_code: string
  section_name: string
  item_id: string | null
  item_name: string | null
  qty: string | null
  purchase_unit: string | null
  recipe_id: string | null
  recipe_code: string | null
  recipe_name: string | null
  output_unit: string | null
  value: string
  reason: string
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

export type SaveKitchenWastageInput = {
  date: string
  sectionId: string
  value: string
  reason: string
  itemId: string
  qty: string
  note: string
}
export type SaveKitchenWastageResult = { ok: true; wastage: KitchenWastageRow } | { ok: false; error: string }
export type VoidKitchenWastageResult =
  | { ok: true; original: KitchenWastageRow; reversal: KitchenWastageRow }
  | { ok: false; error: string }

// ---------- Identities (phase 10) ----------

export type AppUserRow = {
  id: string
  username: string
  display_name: string
  role: 'owner' | 'manager' | 'chef' | 'store' | 'cashier'
  staff_id: string | null
  staff_name: string | null
  staff_code: string | null
  status: 'active' | 'inactive'
  created_at: string
}

export type LoginResult = { ok: true; role: string } | { ok: false; error: string }
export type SetupResult = { ok: true; username: string } | { ok: false; error: string }
export type UserMutationResult = { ok: true; user: AppUserRow } | { ok: false; error: string }
export type ResetPasswordResult = { ok: true } | { ok: false; error: string }

export type FoodCostRow = {
  section_code: string
  section_name: string
  has_activity: boolean
  opening_value: string
  issued_value: string
  ending_value: string | null
  kitchen_wastage: string
  consumed_total: string | null
  sales_value: string | null
  food_cost_pct: string | null
}

// ---------- Kitchen group (phase 12) ----------

export type IndentStatus = 'open' | 'issued' | 'cancelled'

export type IndentRow = {
  session: string
  id: string
  indent_date: string
  section_id: string
  section_code: string
  section_name: string
  status: IndentStatus
  note: string | null
  entered_by: string | null
  created_at: string
  line_count: number
}

export type IndentLineRow = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty_requested: string
}

/** Asked vs given, per item, across the indent and every live issue
 * stamped with it. The gap is the point — never hide it. */
export type IndentGapRow = {
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty_requested: string | null
  qty_issued: string | null
  gap: string
}

export type IndentDetail = {
  indent: IndentRow
  lines: IndentLineRow[]
  issues: IssueDetail[]
  gap: IndentGapRow[]
}

export type SaveIndentInput = {
  date: string
  sectionId: string
  /** Morning / Evening / Extra / Catering, from the session list. An indent
   *  is for a SHIFT, not a day — the evening kitchen asks for different
   *  things than the morning one, and the store needs to know which. */
  session: string
  note: string
  lines: { itemId: string; qty: string }[]
}

export type SaveIndentResult = { ok: true; indent: IndentRow; lines: IndentLineRow[] } | { ok: false; error: string }
export type IndentStatusResult = { ok: true; indent: IndentRow } | { ok: false; error: string }

/** An open indent shaped for the issue form: pickable lines with live
 * stock, ready to prefill. */
export type IndentPrefill = {
  id: string
  indent_date: string
  /** filling an indent adopts ITS session — the ask and the answer belong
   *  to the same shift, so the store never has to restate it */
  session: string
  section_id: string
  section_code: string
  section_name: string
  note: string | null
  lines: { item: IssuableItemHit; qty: string }[]
}

export type ProductionRow = {
  id: string
  prod_date: string
  section_id: string
  section_code: string
  section_name: string
  recipe_id: string
  recipe_code: string
  recipe_name: string
  output_qty: string
  output_unit: string
  unit_cost: string
  value: string
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

export type SaveProductionInput = {
  date: string
  sectionId: string
  recipeId: string
  outputQty: string
  note: string
}

export type SaveProductionResult = { ok: true; production: ProductionRow } | { ok: false; error: string }
export type VoidProductionResult =
  | { ok: true; original: ProductionRow; reversal: ProductionRow }
  | { ok: false; error: string }

/** Three-component picker hit for closings/kitchen wastage: raw item
 * (issue_cost), sub (cost_per_output_unit) or dish (dish_cost). */
export type KitchenComponentHit = {
  kind: 'item' | 'sub' | 'dish'
  id: string
  code: string
  name: string
  unit_name: string
  has_cost: boolean
  /** The frozen-at-save cost, so a line can show what it is worth AS IT IS
   *  TYPED. Null when the component cannot be costed yet — the form shows a
   *  dash rather than a confident zero, and the server refuses the save with
   *  the component named. The authority is still the value frozen at save;
   *  this is the same figure read a moment earlier. */
  unit_cost: string | null
  /** This DEPARTMENT already handles it — issued to it, or made by it. What
   *  puts a hit in the scoped group at the top; false for everything else,
   *  which stays in the list below. */
  from_section: boolean
}

export type ClosingLineInput = { kind: 'item' | 'sub' | 'dish'; id: string; qty: string }

export type ClosingLineRow = {
  id: string
  kind: 'item' | 'sub' | 'dish'
  component_code: string
  component_name: string
  unit: string
  qty: string
  unit_cost: string
  value: string
}

export type SaveItemizedClosingInput = {
  date: string
  sectionId: string
  note: string
  lines: ClosingLineInput[]
}

export type SaveItemizedClosingResult =
  | { ok: true; closing: ClosingRow; lines: ClosingLineRow[] }
  | { ok: false; error: string }

/** Kitchen wastage, phase-12 shape: component item OR sub/dish OR value-
 * only. With a component the value is FROZEN server-side (qty × cost) —
 * the chef types a value only in value-only mode. */
export type SaveKitchenWastage2Input = {
  date: string
  sectionId: string
  reason: string
  note: string
  component:
    | { kind: 'item'; id: string; qty: string }
    | { kind: 'recipe'; id: string; qty: string }
    | { kind: 'none'; value: string }
}

export type KitchenDayRow = {
  section_id: string
  section_code: string
  section_name: string
  issued: string
  produced: string
  wasted: string
  closed: string | null
}

export type RecipePerfRow = {
  recipe_id: string
  code: string
  name: string
  section_code: string
  qty_sold: string
  sales_value: string
  dish_cost: string
  selling_price: string | null
  food_cost_pct: string | null
  uncosted_lines: number
}

export type WasteByReasonRow = { reason: string; entries: number; value: string }

// ---------- Cashier group (phase 13) ----------

export type SettlementRow = {
  id: string
  partner: string
  period_start: string
  period_end: string
  gross_sales: string | null
  commission: string | null
  other_deductions: string | null
  amount_received: string | null
  received_date: string | null
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

export type SaveSettlementInput = {
  partner: string
  periodStart: string
  periodEnd: string
  grossSales: string
  commission: string
  otherDeductions: string
  amountReceived: string
  receivedDate: string
  note: string
  /** what OUR books say we sold through them — the left side of the gap */
  billedByUs: string
  /** what THEIR statement admits to — the right side */
  claimedByThem: string
  /** their statement or UTR number — what you quote when disputing */
  reference: string
  /** where the receipt landed. Required only when an amount was received —
   *  a settlement filed before payment has no movement to place. */
  accountId: string
  /** itemised deductions; deduction_type comes from the settlement_deduction list */
  deductions: { type: string; amount: string; note: string }[]
}

export type SaveSettlementResult = { ok: true; settlement: SettlementRow } | { ok: false; error: string }
export type VoidSettlementResult =
  | { ok: true; original: SettlementRow; reversal: SettlementRow }
  | { ok: false; error: string }

/** A partner and everything settled with them, with the variance stated
 *  BOTH ways — the rupee gap and the effective-vs-agreed rate. They are
 *  different findings: a small gap on a huge period can hide a rate that
 *  drifted, and a big gap can be one disputed invoice at the agreed rate. */
/* ── money accounts ────────────────────────────────────────────────────── */

/** Where money actually sits. USER-NAMED and TYPE-TAGGED: nothing here
 *  hardcodes one country's banks or wallets, so the same product works
 *  wherever it is sold. */
export type MoneyAccountKind = 'cash' | 'bank' | 'wallet' | 'card_settlement' | 'owner' | 'other'

export type MoneyAccount = {
  /** the drawer. Its balance is the COUNTED cash from the last day close,
   *  not a computed figure — see account_balances.basis */
  is_till: boolean
  id: string
  name: string
  kind: MoneyAccountKind
  identifier: string | null
  opening_balance: string
  opening_date: string | null
  sort_order: number
  status: 'active' | 'inactive'
}

export type SaveMoneyAccountInput = {
  isTill: boolean
  name: string
  kind: MoneyAccountKind
  identifier: string
  openingBalance: string
  openingDate: string
  sortOrder: string
  status: 'active' | 'inactive'
}

export type SaveMoneyAccountResult = { ok: true; account: MoneyAccount } | { ok: false; error: string }

/** account_balances — opening plus every movement through it. */
export type AccountBalanceRow = {
  /** 'counted' only for a till with a day close behind it — that balance is
   *  physically counted cash, not opening + movements. Everything else is
   *  'computed', and the difference is worth showing. */
  basis: 'counted' | 'computed'
  counted_on: string | null
  is_till: boolean
  account_id: string
  name: string
  kind: MoneyAccountKind
  identifier: string | null
  opening_balance: string
  movements: string
  balance: string
  last_move: string | null
}

/* ── catering ──────────────────────────────────────────────────────────── */

/** One event as catering_summary states it. food_cost sums ONLY issue lines
 *  stamped with this catering_id — an unstamped issue is invisible here, so
 *  margin would read as the whole revenue. The screen says so. */
export type CateringSummaryRow = {
  catering_id: string
  event_date: string
  name: string
  customer: string | null
  covers: number | null
  revenue_collected: string
  food_cost: string
  other_expenses: string
  total_cost: string
  margin: string
}

export type CateringEventDetail = CateringSummaryRow & {
  contact: string | null
  payment_mode: string | null
  note: string | null
  /** issues stamped to this event — what the kitchen actually took */
  issues: { id: string; issue_date: string; section_name: string; line_count: number; value: string }[]
  expenses: { id: string; description: string | null; amount: string; paid_via: string | null }[]
}

export type SaveCateringEventInput = {
  date: string
  name: string
  customer: string
  contact: string
  covers: string
  revenueCollected: string
  paymentMode: string
  note: string
}

export type SaveCateringEventResult =
  | { ok: true; event: CateringSummaryRow }
  | { ok: false; error: string }

export type SaveCateringExpenseInput = {
  cateringId: string
  description: string
  amount: string
  paidVia: string
}

/* ── contract bills and casual labour: money out that is LABOUR ────────── */

export type ContractBillRow = {
  id: string
  doc_no: string | null
  bill_date: string
  vendor_name: string
  service: string | null
  headcount: number | null
  period_start: string | null
  period_end: string | null
  amount: string
  paid_via: string | null
  note: string | null
  entered_by: string | null
  is_reversal: boolean
  is_voided: boolean
}

export type SaveContractBillInput = {
  accountId: string
  date: string
  vendorName: string
  service: string
  headcount: string
  periodStart: string
  periodEnd: string
  amount: string
  paidVia: string
  note: string
}

export type SaveContractBillResult =
  | { ok: true; bill: ContractBillRow }
  | { ok: false; error: string }

export type CasualLabourRow = {
  id: string
  doc_no: string | null
  work_date: string
  section_id: string | null
  section_name: string | null
  persons: number
  description: string | null
  amount: string
  paid_via: string | null
  note: string | null
  entered_by: string | null
  is_reversal: boolean
  is_voided: boolean
}

/** One day hand. The DEPARTMENT is per line: a day's hands routinely split
 *  across departments — one unloading for the store, one washing up in the
 *  kitchen — and blank still means the whole place, which is a real answer. */
export type CasualLabourLineInput = {
  accountId: string
  sectionId: string
  persons: string
  description: string
  amount: string
  paidVia: string
  note: string
}
export type SaveCasualLaboursInput = { date: string; lines: CasualLabourLineInput[] }
export type SaveCasualLaboursResult =
  | { ok: true; rows: CasualLabourRow[]; total: string }
  | { ok: false; error: string }

export type SaveCasualLabourInput = {
  accountId: string
  date: string
  sectionId: string
  persons: string
  description: string
  amount: string
  paidVia: string
  note: string
}

export type SaveCasualLabourResult =
  | { ok: true; entry: CasualLabourRow }
  | { ok: false; error: string }

export type PartnerPanelRow = {
  partner: string
  kind: string | null
  /** what they said they would take */
  agreed_pct: string | null
  settlements: number
  gross_sales: string
  commission: string
  billed: string
  claimed: string
  /** billed − claimed, the GENERATED column summed */
  gap: string
  received: string
  outstanding: string
  /** settlements with only one side of the comparison filled in */
  uncompared: number
  /** commission ÷ gross × 100 — what they ACTUALLY kept */
  effective_pct: string | null
}

export type PartnerSummaryRow = {
  partner: string
  settlements: number
  gross_sales: string
  commission: string
  other_deductions: string
  amount_received: string
  /** gross − commission − deductions − received: what the partner still owes */
  outstanding: string
}

export type OffBookRow = {
  id: string
  order_date: string
  description: string | null
  amount: string
  payment_mode: string
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

export type SaveOffBookInput = {
  accountId: string
  date: string
  description: string
  amount: string
  paymentMode: string
  note: string
  /** who bought it */
  customer: string
  /** which account it landed in — a UPI handle, a card machine, the drawer */
  receivedInto: string
  /** what was actually sold, and at what price against the menu. at_menu and
   *  agreed_value are GENERATED — never inserted; cost_value is frozen from
   *  dish_costs at save, the same rule as a non-revenue giveaway. */
  lines: { recipeId: string; description: string; qty: string; menuPrice: string; agreedPrice: string }[]
}

export type SaveOffBookResult = { ok: true; order: OffBookRow } | { ok: false; error: string }
export type VoidOffBookResult = { ok: true; original: OffBookRow; reversal: OffBookRow } | { ok: false; error: string }

export type NonRevenueRow = {
  id: string
  nr_date: string
  reason: string
  recipe_id: string | null
  recipe_code: string | null
  recipe_name: string | null
  description: string | null
  qty: string | null
  menu_value: string | null
  cost_value: string
  given_to: string | null
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

/** One giveaway. REASON IS PER LINE — argued against the adjustments ruling
 *  and coming out the other way: a batch of corrections is one event, but a
 *  staff meal and a dish comped for a complaint are two events that merely
 *  got written down together. */
export type NonRevenueLineInput = {
  reason: string
  recipeId: string
  description: string
  qty: string
  menuValue: string
  givenTo: string
  note: string
}
export type SaveNonRevenuesInput = { date: string; lines: NonRevenueLineInput[] }
export type SaveNonRevenuesResult =
  | { ok: true; rows: NonRevenueRow[]; total: string }
  | { ok: false; error: string }

export type SaveNonRevenueInput = {
  date: string
  reason: string
  /** dish picked → cost_value frozen from dish_costs at save */
  recipeId: string
  description: string
  qty: string
  menuValue: string
  givenTo: string
  note: string
}

export type SaveNonRevenueResult = { ok: true; entry: NonRevenueRow } | { ok: false; error: string }
export type VoidNonRevenueResult =
  | { ok: true; original: NonRevenueRow; reversal: NonRevenueRow }
  | { ok: false; error: string }

export type DueRow = {
  id: string
  due_date: string
  party: string
  amount: string
  against_what: string | null
  ref: string | null
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

export type SaveDueInput = {
  date: string
  party: string
  /** positive = credit given, negative = received back */
  amount: string
  direction: 'given' | 'received'
  againstWhat: string
  ref: string
  note: string
}

export type SaveDueResult = { ok: true; due: DueRow; outstanding: DueOutstandingRow[] } | { ok: false; error: string }
export type VoidDueResult = { ok: true; original: DueRow; reversal: DueRow } | { ok: false; error: string }

export type DueOutstandingRow = { party: string; balance: string }

export type DifferenceTrendRow = { close_date: string; difference: string; filings: number }

export type VoucherCategorySummaryRow = { category: string; entries: number; amount: string }

// ---------- Expenses + P&L (phase 14) ----------

export type ExpenseRow = {
  id: string
  doc_no: string | null
  expense_date: string
  category: string
  payee: string | null
  amount: string
  paid_via: string
  note: string | null
  reverses_id: string | null
  is_reversal: boolean
  is_voided: boolean
  entered_by: string | null
  created_at: string
}

/** One receipt. EVERYTHING here is per line — argued, not inherited: two
 *  bills entered in the same sitting routinely differ in category, payee,
 *  amount, how they were paid and which account paid them. */
export type ExpenseLineInput = {
  accountId: string
  category: string
  payee: string
  amount: string
  paidVia: string
  note: string
}

/**
 * Header + lines, and the header is ONLY the date.
 *
 * Asked of this form specifically rather than copied from vouchers: what does
 * a sitting genuinely SHARE? Here, nothing but the day somebody sat down with
 * a stack of receipts. The account differs (one paid by transfer, one by
 * UPI), the mode differs with it, and category and payee obviously do. A
 * header holds what the lines actually have in common and nothing else.
 *
 * N expenses, N EXP numbers — a batch is entry, not a document.
 */
export type SaveExpensesInput = { date: string; lines: ExpenseLineInput[] }
export type SaveExpensesResult =
  | { ok: true; expenses: ExpenseRow[]; total: string }
  | { ok: false; error: string }

export type SaveExpenseInput = {
  accountId: string
  date: string
  category: string
  payee: string
  amount: string
  paidVia: string
  note: string
}

export type SaveExpenseResult = { ok: true; expense: ExpenseRow } | { ok: false; error: string }
export type VoidExpenseResult = { ok: true; original: ExpenseRow; reversal: ExpenseRow } | { ok: false; error: string }

/** One day on the sales line. Absent days are absent, never zero-filled. */
export type SalesSeriesPoint = { date: string; revenue: string; orders: number; covers: number }

/** One aggregator's period: what we billed vs what they admit to. */
export type SettlementGapRow = {
  partner: string
  billed: string
  claimed: string
  /** billed − claimed, the GENERATED column summed; positive = unexplained */
  gap: string
  gross_sales: string
  commission: string
  received: string
  /** from partners.agreed_commission_pct — null when the partner is unknown */
  agreed_pct: string | null
  /** settlements where one side of the comparison was never filled in */
  uncompared: number
  settlements: number
}

export type SectionCostRangeRow = {
  section_code: string
  section_name: string
  dept_group: DeptGroup | null
  total_cost: string
  sales: string
  margin: string
}

/** What was actually entered in the period — the basis of an honest empty state. */
export type EntryPulse = {
  bills: number
  issues: number
  salesDays: number
  closes: number
  kitchenClosings: number
  expenses: number
}

/* ── the four recovered reports, and the activity log ─────────────────── */

export type GstServiceRow = {
  business_date: string
  food_bev: string
  gst_collected: string
  service_charge: string
  container: string
  /** null when there was no food & bev to divide by — never a fake 0% */
  effective_gst_pct: string | null
}

export type CashHandoverRow = { close_date: string; person: string; amount: string }

export type SlowMovingRow = {
  item_id: string
  code: string
  name: string
  category: string
  on_hand_qty: string
  purchase_unit: string
  on_hand_value: string
  last_bought: string | null
  days_since_bought: number | null
}


export type ActivityRow = {
  what: string
  id: string
  created_at: string
  entered_by: string | null
  on_date: string
  amount: string | null
  is_reversal: boolean
}

export type ExpenseCategoryMonthRow = { category: string; month: string; amount: string }

/** A category that had money last month, offered back at that figure. */
export type RecurringExpenseOffer = {
  category: string
  /** last month's net total for this category */
  last_amount: string
  payee: string | null
  paid_via: string | null
  /** this month's net total so far — 0 when nothing recorded yet */
  this_amount: string
  done_this_month: boolean
}

/** One month of pnl_monthly, exactly as the view now names its columns.
 *  cogs stays NULL — never zero — until the month has ending closings. */
export type PnlRow = {
  month: string
  food_beverage: string
  off_book: string
  net_sales: string
  opening_store: string | null
  opening_kitchen: string | null
  purchases: string
  closing_store: string | null
  closing_kitchen: string | null
  cogs: string | null
  staff_food: string | null
  wages: string
  contract_vendors: string
  casual_labour: string
  total_labour: string
  controllable: string
  occupancy: string
  total_expenses: string
  other_income: string
  orders: number
  covers: number
}

/** A row of pnl_diagnostics — the view's own honesty column, in words. */
export type PnlDiagnostic = { month: string; severity: string; what: string }

/** Same shape for vendors: the code-bearing essentials up front, every
 *  other INSERT-granted column behind the fold — including the banking
 *  block, which is the whole reason anyone opens a vendor again. */
export type CreateVendorInput = {
  name: string
  category: string
  gstin: string
  phone: string
  paymentTerms: string
  contactPerson: string
  altPhone: string
  email: string
  address: string
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  natureOfSupply: string
  openingBalance: string
  supplies: string
  notes: string
}

export type CreateVendorResult = { ok: true; vendor: VendorDetail } | { ok: false; error: string }

/** Creating an item asks the five fields that cannot wait, and offers the
 *  rest behind a fold. Everything optional here is a column kb_app may
 *  INSERT — a second trip to the edit page to set a reorder level was a
 *  trip nobody made. yield_pct is absent: yield lives on the recipe line. */
export type CreateItemInput = {
  tracksExpiry?: boolean
  name: string
  category: string
  purchaseUnit: string
  openingRate: string
  brand: string
  stockUnit: string
  conversionFactor: string
  gstRate: string
  parLevel: string
  reorderLevel: string
  defaultVendorId: string
  itemType: string
  notes: string
  /** asked at CREATE as well as on edit — a field nobody fills on the way past
   *  is a field nobody ever fills, and an unplaced item is walked past */
  storageLocationId: string
}

export type CreateItemResult = { ok: true; item: ItemDetail } | { ok: false; error: string }

export type LabourMonthRow = {
  section_code: string | null
  section_name: string | null
  dept_group: DeptGroup | null
  labour_cost: string
  unassigned_marks: number
  unsalaried_marks: number
}

// ---------- Phase C: the query loop ----------

export type QueryStatus = 'open' | 'answered' | 'resolved'

/** One row of `queries`. entity_id is nullable because a question is often
 *  about a DAY or a category rather than a single record. */
export type QueryRow = {
  id: string
  entity_type: string
  entity_id: string | null
  entity_date: string | null
  question: string
  assigned_role: Role
  status: QueryStatus
  answer: string | null
  raised_by: string | null
  raised_at: string
  answered_by: string | null
  answered_at: string | null
  resolved_by: string | null
  resolved_at: string | null
}

export type RaiseQueryInput = {
  entityType: string
  entityId: string
  entityDate: string
  question: string
  assignedRole: string
}

export type SaveQueryResult = { ok: true; query: QueryRow } | { ok: false; error: string }

export type ClosePeriodInput = { periodStart: string; periodEnd: string; note: string }
export type ClosePeriodResult = { ok: true } | { ok: false; error: string }

/** books_completeness, verbatim — the view owns both the severity and the
 *  wording, so a screen can never soften what it says. */
export type BooksCompletenessRow = { severity: string; what: string; n: number }

export type ClosedPeriodRow = {
  /** the period_closes row, so a reopen REQUEST can name it */
  id: string
  period_start: string
  period_end: string
  closed_at: string
  closed_by: string | null
}

// ---------- Phase C: the accountant's registers ----------

export type RegisterKey = 'purchase' | 'sales' | 'payment' | 'expense' | 'cash' | 'bank' | 'wages'

/** ONE shape for all seven registers. debit and credit are nullable rather
 *  than zero: an empty cell is how a ledger says "not this side". */
export type RegisterRow = {
  entry_date: string
  doc_no: string | null
  kind: string
  party: string
  narration: string
  debit: string | null
  credit: string | null
  amount: string
  account_name: string | null
}

export type VendorStatementRow = {
  code: string
  name: string
  gstin: string | null
  opening_balance: string
  move_date: string
  kind: string
  doc_no: string | null
  narration: string
  debit: string
  credit: string
}

export type AggregatorReceivableRow = {
  partner: string
  agreed_commission_pct: string | null
  gross_billed: string
  received: string
  outstanding: string
  last_settled: string | null
}

export type GstDayRow = {
  business_date: string
  food_bev: string
  gst_collected: string
  service_charge: string
  container: string
  effective_gst_pct: string | null
}

/** What was withheld. rate_pct is RECORDED — it is what the deduction
 *  worked out to, never a rate this app applied. */
export type WithholdingRow = {
  id: string
  wh_date: string
  entity_type: string
  party: string
  regime_code: string | null
  base_amount: string
  rate_pct: string | null
  amount: string
  deposited_on: string | null
  account_id: string | null
  challan_ref: string | null
  note: string | null
  entered_by: string | null
}

export type SaveWithholdingInput = {
  date: string
  party: string
  entityType: string
  regimeCode: string
  baseAmount: string
  amount: string
  note: string
}

export type SaveWithholdingResult = { ok: true; withholding: WithholdingRow } | { ok: false; error: string }

export type StaffFundBalance = { collected: string; distributed: string; owed_to_staff: string }

export type StaffFundInput = {
  date: string
  direction: 'collected' | 'distributed'
  amount: string
  source: string
  accountId: string
  note: string
}

export type StaffFundResult = { ok: true } | { ok: false; error: string }

// ---------- Phase C: payroll ----------

export type PayrollStatus = 'draft' | 'approved' | 'paid' | 'cancelled'

export type PayrollRunRow = {
  id: string
  doc_no: string | null
  period_start: string
  period_end: string
  status: PayrollStatus
  prepared_by: string | null
  prepared_at: string
  approved_by: string | null
  approved_at: string | null
  note: string | null
  line_count: number
  net_total: string
}

/** FROZEN at prepare time. payroll_lines has no UPDATE grant on any amount,
 *  so what a run says the day it is approved is what it says forever. */
export type PayrollLineRow = {
  id: string
  staff_id: string
  staff_code: string
  staff_name: string
  section_name: string | null
  grade: string | null
  days_in_period: string
  days_paid: string
  base_salary: string
  earned: string
  overtime: string
  advance_recovered: string
  other_deduction: string
  withholding: string
  net_payable: string
  pay_mode: string | null
  account_id: string | null
  paid_on: string | null
  note: string | null
}

/** Computed, never stored — the screen the accountant edits BEFORE the
 *  figures are frozen. `unsalaried` is an honesty column: they worked and
 *  nobody has said what they are paid. */
export type PayrollDraftLine = {
  staff_id: string
  staff_code: string
  staff_name: string
  section_name: string | null
  grade: string | null
  pay_mode: string | null
  days_in_period: string
  days_paid: string
  base_salary: string
  unsalaried: boolean
  earned: string
  advance_outstanding: string
}

export type PreparePayrollInput = {
  periodStart: string
  periodEnd: string
  note: string
  lines: {
    staffId: string
    daysInPeriod: string
    daysPaid: string
    baseSalary: string
    earned: string
    overtime: string
    advanceRecovered: string
    otherDeduction: string
    withholding: string
    note: string
  }[]
}

export type PayrollResult = { ok: true; run: PayrollRunRow } | { ok: false; error: string }

export type MarkPaidInput = { runId: string; paidOn: string; accountId: string; payMode: string }

export type SaveAdvanceInput = {
  date: string
  staffId: string
  amount: string
  accountId: string
  note: string
}

export type AdvanceOutstanding = {
  staff_id: string
  staff_code: string
  staff_name: string
  outstanding: string
  last_advance: string | null
}

/** Owner and accountant only — never the manager. */
export type StaffIdentity = {
  id: string
  code: string
  name: string
  designation: string | null
  section_name: string | null
  employment_type: string
  pay_mode: string | null
  base_salary: string | null
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  upi_id: string | null
  pan: string | null
  uan: string | null
  pf_number: string | null
  esic_number: string | null
  dob: string | null
  gender: string | null
  /** OWNER AND ACCOUNTANT ONLY, like the rest of this block. An address and a
   *  government id are the two most sensitive things here and neither is any
   *  use to a shift manager. */
  aadhaar: string | null
  address: string | null
}

/** What they owe AFTER this advance — read back from getOutstandingAdvances,
 *  the same figure the payroll draft offers as recovery. */
export type SaveAdvanceResult =
  | { ok: true; outstanding: string; staffName: string | null }
  | { ok: false; error: string }

export type UpdateStaffIdentityInput = {
  bankName: string
  accountNo: string
  ifsc: string
  upiId: string
  pan: string
  uan: string
  pfNumber: string
  esicNumber: string
  dob: string
  gender: string
  payMode: string
  aadhaar: string
  address: string
}

// ---------- Migration 0016: reconciliation ----------

/** One imported statement. opening/closing are what the PROVIDER says; the
 *  self-check compares them against the lines and is allowed to disagree. */
export type StatementRow = {
  id: string
  account_id: string
  account_name: string
  period_start: string
  period_end: string
  opening_balance: string | null
  closing_balance: string | null
  note: string | null
  imported_by: string | null
  imported_at: string
  statement_lines: number
  statement_total: string
  matched_lines: number
  unmatched_lines: number
  /** opening + lines − closing. Non-zero means the statement does not add up
   *  on its own terms, which is a fact about the statement, not the books. */
  statement_self_check: string | null
}

export type StatementLineRow = {
  statement_line_id: string
  stmt_date: string
  description: string | null
  reference: string | null
  amount: string
}

export type UnmatchedMovementRow = {
  entity_type: string
  entity_id: string
  kind: string
  doc_no: string | null
  move_date: string
  amount: string
  party: string | null
  narration: string | null
}

export type ImportStatementInput = {
  accountId: string
  periodStart: string
  periodEnd: string
  openingBalance: string
  closingBalance: string
  note: string
  lines: { date: string; description: string; reference: string; amount: string }[]
}

export type ImportStatementResult = { ok: true; statementId: string } | { ok: false; error: string }

export type MatchInput = { statementLineId: string; entityType: string; entityId: string; note: string }

export type ReconcileResult = { ok: true } | { ok: false; error: string }

/** One department's consumption on one day in one session, net of returns —
 *  section_consumption_daily. Value, never quantity: the indent asks in
 *  quantities so a rupee figure cannot shrink the request. */
export type SectionConsumptionDay = {
  section_code: string
  section_name: string
  move_date: string
  session: string
  consumed_value: string
  movements: number
}

/** Editing an OPEN indent. Editable only while it asserts an intention and
 *  nothing depends on it yet — once an issue carries its indent_id the
 *  asked-vs-given gap has meaning and the request freezes.
 *
 *  A line with an id is updated, one without is inserted, and an id absent
 *  from this list is deleted. There is no update grant on item_id: changing
 *  WHICH item a line is for is a delete plus an insert, not an edit. */
export type UpdateIndentInput = {
  indentId: string
  indentDate: string
  session: string
  sectionId: string
  note: string
  lines: { id: string | null; itemId: string; qty: string }[]
}

export type UpdateIndentResult = { ok: true } | { ok: false; error: string }

// ---------- Stock adjustments, shorts and vendor returns ----------

/** A signed correction to the book. An EVENT: append-only, reasoned, and
 *  either standing alone (opening stock) or carrying the count it came
 *  from. `value` is GENERATED — never in an insert column list. */
export type StockAdjustmentRow = {
  id: string
  adj_date: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  unit_cost: string
  value: string
  reason: string
  count_id: string | null
  note: string | null
  entered_by: string | null
}

export type AdjustmentInput = {
  date: string
  itemId: string
  qty: string
  reason: string
  note: string
}

export type AdjustmentResult = { ok: true } | { ok: false; error: string }

/** One corrected item. Signed: minus is a shortfall. */
export type AdjustmentLineInput = { itemId: string; qty: string }

/**
 * Header + lines, because OPENING STOCK IS INHERENTLY MANY ITEMS AT ONCE —
 * and it is the flow every new restaurant hits first, before anyone has any
 * patience for the app.
 *
 * The reason and note are HEADER fields here, unlike the loss forms where the
 * reason is per line. The difference is real: two things in one bin are lost
 * for two different reasons, but a batch of corrections is one EVENT — a
 * stocktake, an opening balance, a found crate. Two reasons means two events,
 * which is two saves.
 */
export type SaveAdjustmentsInput = {
  date: string
  reason: string
  note: string
  lines: AdjustmentLineInput[]
}
export type SaveAdjustmentsResult =
  | { ok: true; count: number; reason: string; stock: StockSnap[] }
  | { ok: false; error: string }

/** ACCEPTING A VARIANCE IS A JUDGEMENT, NOT A CONSEQUENCE. A variance can
 *  be a counting error as easily as a stock error, so the book is never
 *  corrected automatically — a person accepts the count, and that writes
 *  the adjustments. An unaccepted count is a thing to surface: leave it and
 *  the same variance reappears at the next count with nobody knowing why. */
export type CountAcceptance = {
  count_id: string
  count_date: string
  entered_by: string | null
  accepted_at: string | null
  accepted_by: string | null
  lines: number
  variance_lines: number
  variance_value: string
}

export type AcceptCountResult = { ok: true; adjustments: number } | { ok: false; error: string }

export type ShortKind = 'short' | 'damaged' | 'rejected'
export type ShortSettlement = 'open' | 'credit_note' | 'replaced' | 'absorbed'

/** What the vendor billed but did not deliver. `purchase_lines.qty` still
 *  means WHAT ARRIVED, so nothing downstream shifts. */
export type ShortRow = {
  id: string
  purchase_line_id: string
  purchase_id: string
  bill_date: string
  doc_no: string | null
  vendor_id: string
  vendor_name: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty_received: string
  qty_short: string
  rate: string
  kind: ShortKind
  settlement: ShortSettlement
  credit_note_ref: string | null
  note: string | null
  entered_by: string | null
}

/** One shorted line. The BILL is the header — see SaveShortsInput. */
export type ShortLineInput = {
  purchaseLineId: string
  qtyShort: string
  kind: ShortKind
  settlement: ShortSettlement
  creditNoteRef: string
  note: string
}

/**
 * THE HEADER IS THE BILL, and it was already sitting there.
 *
 * One delivery shorts several lines at once — the driver leaves, three crates
 * are light. Recording that as three separate saves punished checking a
 * delivery carefully, which is the exact behaviour the app wants to
 * encourage. The purchase id is passed explicitly rather than inferred from
 * the lines, so the server can refuse a batch that spans two bills.
 */
export type SaveShortsInput = { purchaseId: string; lines: ShortLineInput[] }
export type SaveShortsResult =
  | {
      ok: true
      count: number
      /** every short on this bill, valued — read back, never echoed */
      value: string
      /** the ones nobody has chased: open is the state that matters */
      openCount: number
      openValue: string
    }
  | { ok: false; error: string }

export type SettleShortInput = {
  id: string
  settlement: ShortSettlement
  creditNoteRef: string
  note: string
}

export type ShortResult = { ok: true } | { ok: false; error: string }

/** Goods going BACK to the vendor. Its own event rather than a negative
 *  purchase, so purchase_register stays a record of what was bought. */
export type VendorReturnRow = {
  id: string
  return_date: string
  vendor_id: string
  vendor_name: string
  /** COMPUTED FROM THE LINES — one distinct reason names itself, several read
   *  "Mixed". Never cached on the header: caching it would let the summary
   *  disagree with the lines it summarises. Null only on rows that predate
   *  per-line reasons. */
  reason: string | null
  credit_note_ref: string | null
  settled_against_purchase_id: string | null
  note: string | null
  entered_by: string | null
  is_reversal: boolean
  is_voided: boolean
  line_count: number
  total: string
}

export type VendorReturnInput = {
  date: string
  vendorId: string
  creditNoteRef: string
  note: string
  /** PER LINE. A rotten crate and a wrong item go back on the same trip for
   *  two reasons, so there is no header reason to collect — a list reads the
   *  lines and says "Quality" or "Mixed". `sourcePurchaseLineId` is where the
   *  goods came from, which is what gives the rate a provenance. */
  lines: {
    itemId: string
    qty: string
    rate: string
    reason: string
    sourcePurchaseLineId: string
  }[]
}

export type VendorReturnResult =
  | {
      ok: true
      id: string
      ret: VendorReturnRow
      /** read back from vendor_dues AFTER the credit — never echoed from the
       *  lines, so the acknowledgement states the balance somebody will
       *  actually argue about */
      dues: DuesSnap
    }
  | { ok: false; error: string }

/**
 * `vendor_return_reasons`, verbatim — what came back from this vendor and why.
 *
 * The per-line reason finally has a READER. `vendor_performance` carries only
 * `returned_value`, and a rupee total cannot tell four rotten crates from one
 * expensive wrong delivery. "Four Quality returns" is the fact that decides
 * whether to keep buying from somebody.
 *
 * `lines` COUNTS LINES, NOT TRIPS — two lines on one return both marked Quality
 * count as two. The screen says so rather than implying four separate visits.
 */
export type VendorReturnReasonRow = {
  vendor_id: string
  vendor_name: string
  reason: string
  lines: number
  value: string
  last_returned: string
}

/** A bill a return could be opened FROM. Reversals and voided bills are
 *  absent — there is nothing left on them to send back. */
export type ReturnableBillRow = {
  id: string
  doc_no: string | null
  bill_no: string | null
  bill_date: string
  vendor_id: string
  vendor_name: string
  bill_total: string
  line_count: number
}

/**
 * A bill, opened as a return. Picking the bill answers the vendor, the items
 * AND the rate at once — the three things the blank form was asking the store
 * manager to remember about a delivery they are holding in their hands.
 * Quantities stay BLANK: what arrived is not what is going back.
 */
export type BillReturnPrefill = {
  purchase_id: string
  vendor_id: string
  vendor_name: string
  bill_no: string | null
  doc_no: string | null
  bill_date: string
  lines: {
    item: IssuableItemHit
    /** the rate this bill charged — the rate a credit is normally claimed at */
    rate: string
    /** how much the bill said arrived, shown as context beside the box */
    billed_qty: string
    /** provenance: vendor_return_lines.source_purchase_line_id */
    purchase_line_id: string
  }[]
}

/** vendor_performance, verbatim. `unsettled` is the one to surface: a short
 *  nobody chased is a different fact from one that was credited. */
export type VendorPerformanceRow = {
  vendor_id: string
  code: string
  name: string
  bills: number
  short_events: number
  short_value: string
  unsettled: number
  returned_value: string
}

// ---------- Header + lines: four forms, one shape (phase: batch entry) ----------
//
// The closing form's shape — header (date · section) + a line table + Add
// item + Note + Save — applied to kitchen loss, store loss and production.
// One save writes N rows sharing the header's date and section. No schema
// change: every one of these tables already carries its own date and section
// on each row, which is why they can be written as a batch and still be read
// one row at a time.

/** One line of a kitchen loss.
 *
 *  REASON IS PER LINE, not per header. Burnt gravy and expired milk go in the
 *  same bin on the same night for different reasons, and the reason is what
 *  makes waste analysis worth anything. This is the one place the loss forms
 *  must differ from closing. */
export type KitchenLossLineInput =
  | { kind: 'item'; id: string; qty: string; reason: string }
  | { kind: 'recipe'; id: string; qty: string; reason: string }
  /** value-only, for "half a tray of gravy" where a quantity means nothing */
  | { kind: 'none'; value: string; reason: string }

export type SaveKitchenLossesInput = {
  date: string
  sectionId: string
  note: string
  lines: KitchenLossLineInput[]
}
export type SaveKitchenLossesResult =
  | { ok: true; rows: KitchenWastageRow[]; total: string }
  | { ok: false; error: string }

export type StoreLossLineInput = { itemId: string; qty: string; reason: string; note: string }
export type SaveStoreLossesInput = { date: string; note: string; lines: StoreLossLineInput[] }
export type SaveStoreLossesResult =
  | { ok: true; rows: WastageDetail[]; stock: StockSnap[]; total: string }
  | { ok: false; error: string }

export type ProductionLineInput = { recipeId: string; outputQty: string }
export type SaveProductionsInput = {
  date: string
  sectionId: string
  note: string
  lines: ProductionLineInput[]
}
export type SaveProductionsResult =
  | { ok: true; rows: ProductionRow[]; total: string }
  | { ok: false; error: string }

/** One line of "what this department made / held last time", for refill.
 *  Quantities come back editable; nothing is written until Save. */
export type RefillLine = {
  kind: 'item' | 'sub' | 'dish'
  id: string
  code: string
  name: string
  unit_name: string
  qty: string
}
export type RefillSet = { on: string; lines: RefillLine[] } | null

/**
 * Something a kitchen can record MAKING — a sub batch or a dish cooked ahead.
 *
 * A DISH IS PRODUCED IN PORTIONS. Its `output_qty` means portions made, and
 * its cost freezes from `dish_costs.cost_per_portion`, never
 * `cost_per_output_unit`: a dish has no batch yield, so asking it for one
 * would produce a number that looks fine and means nothing.
 *
 * `portions` is null when nobody has ever said how many a dish makes.
 * cost_per_portion divides by it, so the save REFUSES such a dish by name
 * rather than freezing a silent zero.
 */
export type ProducibleRow = {
  recipe_id: string
  kind: 'sub' | 'dish'
  code: string
  name: string
  /** what ONE unit of output is called: a sub's batch unit, or 'portion' */
  unit_name: string
  /** cost of one output unit — cost_per_output_unit for a sub,
   *  cost_per_portion for a dish. Null when it cannot be costed yet. */
  unit_cost: string | null
  /** dishes only: null when portions has never been set */
  portions: string | null
  uncosted_lines: number
}

/**
 * A dish produced today that no closing has accounted for.
 *
 * THIS IS THE LINE THAT MAKES PRODUCED DISHES EARN THEIR PLACE. The loop is
 * produced → held → counted: `kitchen_closing_lines` already accepts a dish
 * as a component, so produced 20 / closed 12 says twelve are still there and
 * eight went out. A dish produced and never closed has NO READER, and storing
 * data nobody reads is the `issues.session` mistake wearing a new hat.
 */
export type UnclosedDishRow = {
  section_id: string
  section_name: string
  recipe_id: string
  code: string
  name: string
  /** portions made today */
  produced: string
  /** portions accounted for in tonight's winning closing — 0 when none */
  closed: string
}

// ─────────────────────────── meters ───────────────────────────────────────
//
// A meter is a MASTER, not a setting — the same argument that moved partners
// out of list_options. A list row holds a name; a meter carries a unit and an
// `assumed_rate`, and the rate is the number every estimate on the screen
// turns on.

/** On hand answers one question two ways. See listStock for why there is no
 *  third: Count already walks by location. */
/** One category's share of stock value. `kind` is categories.kind verbatim —
 *  ingredient or operational — plus 'unclassified' for a code that resolves to
 *  no category row at all. */
export type CategoryRollupRow = {
  category: string
  category_name: string
  kind: 'ingredient' | 'operational' | 'unclassified'
  items: number
  negatives: number
  value: string
}

export type StockView = 'by-category' | 'by-value'

/* readStockView is GONE. It was a second front door for one screen while every
 * other toggle went through readView — and two doors is the thing the shared
 * reader exists to remove. See VIEW_KEYS.stock in src/lib/views.ts. */

export type MeterKind = 'electricity' | 'gas' | 'water' | 'other'

export type MeterRow = {
  id: string
  name: string
  kind: MeterKind
  /** kWh, m³, kL — free text on purpose. The `units` table is bag/kg/litre:
   *  purchase units for stock, which a meter does not have. */
  unit: string
  /** rupees per unit, or null when nobody has said. NULL is why an estimate
   *  is withheld rather than printed as ₹0.00. */
  assumed_rate: string | null
  status: 'active' | 'inactive'
}

/**
 * One reading and what it says about the span since the last one.
 *
 * `days_spanned` IS NEVER DIVIDED. Read on Monday and again on Wednesday and
 * Wednesday's row carries two days of consumption; halving it would invent a
 * Tuesday nobody measured. Every surface states the span and leaves the
 * figure whole.
 *
 * The FIRST reading of a meter has no predecessor, so `previous_reading`,
 * `units`, `days_spanned` and `estimated_cost` all arrive NULL. That is a
 * baseline, not a zero.
 */
export type MeterConsumptionRow = {
  meter_id: string
  name: string
  kind: MeterKind
  unit: string
  assumed_rate: string | null
  read_date: string
  reading: string
  previous_reading: string | null
  previous_date: string | null
  units: string | null
  days_spanned: number | null
  /** units × assumed_rate. ALWAYS an estimate — electricity is slabbed, so
   *  the true unit cost depends on the month's total. Reconcile against the
   *  real bill. */
  estimated_cost: string | null
}

/** How this restaurant measures each utility. Both are facts about the
 *  plumbing, not opinions about accounting — see meters-queries.ts. */
export type MeteringMode = {
  gas: 'cylinders' | 'meter'
  electricity: 'off' | 'on'
}

/**
 * Gas bought as stock, and how much of it has ever been issued.
 *
 * COMPUTED, NEVER ASSERTED — the same law as the first-count warning. A
 * cylinder is consumed on the day it is CONNECTED, so it reaches a
 * department's consumption only when somebody issues it. Bought-but-never-
 * issued is the finding this row exists to make visible.
 */
export type CylinderStockRow = {
  code: string
  name: string
  unit: string
  purchased: string
  issued: string
  on_hand: string
  on_hand_value: string | null
}

// ---------- Purchase orders (the store's outward document) ----------

/**
 * KitchenBooks had NO store-to-vendor document. The indent is
 * kitchen-to-store; nothing pointed outward. Stock, reorder levels and vendor
 * history all live here, so the order belongs where the stock is.
 */
export type PoStatus = 'draft' | 'sent' | 'received' | 'closed' | 'cancelled'

export const PO_STATUSES: PoStatus[] = ['draft', 'sent', 'received', 'closed', 'cancelled']

/** How a sent order left the building. Recorded because "did we send it?" is
 *  the first question anyone asks about a delivery that has not arrived. */
export type SentVia = 'whatsapp' | 'print' | 'email' | 'other'

export type PurchaseOrderRow = {
  id: string
  doc_no: string | null
  vendor_id: string
  vendor_code: string
  vendor_name: string
  /** NULL on every one of Thrayam's five vendors today. A purchase order with
   *  nowhere to send it is a PDF, so this travels with the row and is said on
   *  screen rather than discovered at the moment of sending. */
  vendor_phone: string | null
  po_date: string
  expected_date: string | null
  status: PoStatus
  note: string | null
  sent_at: string | null
  sent_by: string | null
  sent_via: SentVia | null
  entered_by: string | null
  lines: number
  total: string
}

export type PoLineRow = {
  id: string
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  qty: string
  rate: string
  amount: string
  note: string | null
}

/**
 * ONE LINE OF A BILL PREFILLED FROM AN ORDER — and it carries the item's FULL
 * hit, not a hand-built subset.
 *
 * This type exists because the PO path used to build a partial `hit` from the
 * order line alone — id, code, name, purchase_unit — and cast it. Three fields
 * were therefore `undefined` on a prefilled line and on no other: `category`
 * (an orphan separator on screen), `unit_name` (no unit label) and
 * `tracks_expiry`, which is falsy, which silently HID the expiry field on
 * exactly the items that require one.
 *
 * A prefill differs from a fresh line only in the qty and rate it arrives
 * with. Everything else about the item is the item's.
 */
export type BillPrefillLine = {
  hit: ItemHitExisting
  /** what was ORDERED — an offer the receiver corrects to what arrived */
  qty: string
  /** the rate the order was placed at; blank when the order carried none */
  rate: string
}

/** `po_fulfilment` — ordered vs delivered, the same shape as
 *  `indent_fulfilment`. `gap` is delivered − ordered, so NEGATIVE IS SHORT,
 *  which is the opposite of how a person says it out loud; it is rendered in
 *  words, never as a signed number. */
export type PoFulfilmentRow = {
  po_id: string
  doc_no: string | null
  status: PoStatus
  item_code: string
  item_name: string
  purchase_unit: string
  qty_ordered: string
  rate: string
  qty_delivered: string
  gap: string
}

/** One line of a draft, offered from what the shelf says and what this vendor
 *  last charged. Nothing is written until the order is saved. */
export type PoDraftLine = {
  item_id: string
  item_code: string
  item_name: string
  purchase_unit: string
  /** par − on hand, from reorder_due */
  suggested_qty: string
  on_hand_qty: string
  /** THEIR last rate, from vendor_supplied_items — never another vendor's.
   *  Null when this vendor has never billed this item. */
  last_rate: string | null
  last_bought: string | null
}

/** The restaurant as it appears on a document somebody outside the building
 *  reads. Every field is NULL on a new tenant, and a document names what it is
 *  missing rather than quietly leaving a gap. */
export type Letterhead = {
  name: string
  legal_name: string | null
  address_line1: string | null
  address_line2: string | null
  city: string | null
  state: string | null
  pincode: string | null
  phone: string | null
  email: string | null
  gstin: string | null
  fssai_number: string | null
  logo_url: string | null
}

/** Three layouts, per restaurant, in settings.document_style. A choice of
 *  style is not a choice about what a number MEANS, which is why this is
 *  allowed to be a setting at all. */
/**
 * THREE LAYOUTS THAT DIFFER BY USE, NOT BY TASTE.
 *
 * `plain` — "no rules, cheapest to print" — is gone, because it differed from
 * classic by decoration and nothing else. `message` replaces it and is the one
 * that earns its place: PHONE-SHAPED, because this app's delivery channel is
 * WhatsApp. Zoho ships sixteen templates that vary by font and colour and every
 * one of them assumes A4, because nobody in that market sends a purchase order
 * over a chat app.
 *
 * A stored 'plain' still reads — see readDocumentStyle — and lands on classic,
 * which is what it was: the same document with the rules turned off.
 */
export type DocumentStyle = 'classic' | 'compact' | 'message'

export const DOCUMENT_STYLES: DocumentStyle[] = ['classic', 'compact', 'message']

/** `price_movements` — what a vendor's price did, bill over bill.
 *
 *  `previous_rate` is NULL on a first-ever purchase from that vendor: there is
 *  nothing to compare and the row says so rather than reading as a change from
 *  zero. `cost_of_change` is qty × the difference — what the move actually
 *  cost on THAT delivery, which is the figure that turns a percentage into a
 *  decision. */
export type PriceMovementRow = {
  vendor_name: string
  item_code: string
  item_name: string
  purchase_unit: string
  bill_date: string
  bill_no: string | null
  qty: string
  rate: string
  previous_rate: string | null
  previous_date: string | null
  change_value: string | null
  change_pct: string | null
  cost_of_change: string | null
}

/** `expiring_stock` — a dated delivery of an item the restaurant still holds.
 *
 *  `on_hand_qty` is the ITEM's running total, NOT this batch's: there is no
 *  lot tracking, and the view is honest about that by construction rather than
 *  pretending to a per-batch figure it cannot compute. Every surface reading
 *  this must phrase it as a prompt to go and look. */
export type ExpiringStockRow = {
  item_id: string
  code: string
  name: string
  category: string
  purchase_unit: string
  on_hand_qty: string
  issue_cost: string | null
  bill_date: string
  expiry_date: string
  qty_received: string
  vendor_name: string
  bill_no: string | null
}

/** One row of the vendor-payments log — the destination of the store
 *  dashboard's "Paid out" card. */
export type PaymentLogRow = {
  id: string
  doc_no: string | null
  paid_date: string
  amount: string
  mode: string | null
  note: string | null
  entered_by: string | null
  vendor_code: string
  vendor_name: string
  account_name: string | null
}
