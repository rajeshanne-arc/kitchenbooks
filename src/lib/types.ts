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
  reorder_level: string | null
  default_vendor_id: string | null
  default_vendor_name: string | null
  item_type: string | null
  notes: string | null
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

/** Every column-granted item field EXCEPT yield_pct, which has a grant but
 *  is retired from the UI: recipes state gross quantities, so trim yield
 *  lives in the recipe, and an item-level yield field must not come back. */
export type UpdateItemInput = {
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

// ---------- Store actions (phase 3) ----------

export type DeptGroup = 'Management' | 'Support' | 'Kitchen' | 'Service' | 'Bar'

export type Section = {
  id: string
  code: string
  name: string
  sort_order: number
  status: 'active' | 'inactive'
  dept_group: DeptGroup
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

/** One row of the stock_on_hand view (+ item status) */
export type StockRow = {
  item_id: string
  code: string
  name: string
  category_name: string
  purchase_unit: string
  status: 'active' | 'inactive'
  purchased_qty: string
  issued_qty: string
  wasted_qty: string
  on_hand_qty: string
  issue_cost: string | null
  on_hand_value: string
}

/** A department (the sections table) with what already depends on it. */
export type DepartmentRow = {
  id: string
  code: string
  name: string
  dept_group: DeptGroup
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
}

export type SaveIssueInput = {
  issueDate: string
  sectionId: string
  lines: { itemId: string; qty: string; note: string }[]
  /** open indent this issue answers — stamped on the issue, marks the indent issued */
  indentId?: string
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
  /** from the return_reason managed list — membership enforced server-side */
  reason: string
  lines: { itemId: string; qty: string; note: string }[]
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
  status: 'active' | 'inactive'
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
  /** live: item_costs.issue_cost or sub's recipe_costs.cost_per_output_unit; null when unpriced */
  unit_cost: string | null
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
  status: 'active' | 'inactive'
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
      skippedOtherDates: number
      duplicateIds: number
      compDisagreements: number
      note: string | null
      day: SalesDayRow | null
      unknownOrders: UnknownOrderRow[]
    }
  | { ok: false; error: string }

export type UnmappedPosItem = {
  pos_item_id: string
  item_name: string | null
  qty: string
  revenue: string
}

export type PosMapRow = {
  id: string
  pos_item_id: string
  item_name: string | null
  recipe_id: string | null
  recipe_code: string | null
  recipe_name: string | null
  section_code: string | null
}

export type DishOption = { id: string; code: string; name: string; section_code: string }

export type MapItemResult = { ok: true; map: PosMapRow; unmappedLeft: number } | { ok: false; error: string }

export type QtySoldRow = { recipe_id: string; qty_sold: string; sales_value: string }

// ---------- Cash (phase 7) ----------

export type PaidBy = 'cashier' | 'owner'

export type VoucherRow = {
  id: string
  voucher_date: string
  amount: string
  paid_to: string
  paid_by: PaidBy
  owner_name: string | null
  category: string
  note: string | null
  created_at: string
}

export type SaveVoucherInput = {
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

export type SaveOtherIncomeInput = {
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
}

export type SaveCountInput = {
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
  /** itemised deductions; deduction_type comes from the settlement_deduction list */
  deductions: { type: string; amount: string; note: string }[]
}

export type SaveSettlementResult = { ok: true; settlement: SettlementRow } | { ok: false; error: string }
export type VoidSettlementResult =
  | { ok: true; original: SettlementRow; reversal: SettlementRow }
  | { ok: false; error: string }

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
  date: string
  description: string
  amount: string
  paymentMode: string
  note: string
  /** who bought it */
  customer: string
  /** which account it landed in — a UPI handle, a card machine, the drawer */
  receivedInto: string
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

export type SaveExpenseInput = {
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

export type DailyPurchaseRow = {
  bill_date: string
  vendor_name: string
  vendor_code: string
  bills: number
  spend: string
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

export type CreateVendorInput = {
  name: string
  category: string
  gstin: string
  phone: string
  paymentTerms: string
}

export type CreateVendorResult = { ok: true; vendor: VendorDetail } | { ok: false; error: string }

export type CreateItemInput = {
  name: string
  category: string
  purchaseUnit: string
  openingRate: string
  brand: string
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
