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

export type SaveIssueInput = {
  issueDate: string
  sectionId: string
  lines: { itemId: string; qty: string }[]
}

export type SaveIssueResult =
  | { ok: true; issue: IssueDetail; lines: IssueLineRow[]; stock: StockSnap[] }
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
      priorFilings: number
      anyCloses: boolean
    }
  | { ok: false; blocked: 'no_opening' | 'missing_prev'; missingDate: string | null; anyCloses: boolean; error: string }

export type DayCloseLadderRow = {
  close_date: string
  opening_cash: string
  pos_cash: string
  other_income: string
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
