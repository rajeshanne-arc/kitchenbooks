/**
 * INCREMENTAL PURCHASES IMPORT — 27–31 Aug 2026, from the Stock Management
 * sheet's Purchase Ledger tab.
 *
 * Continuation of scripts/import-stock-sheet.ts (332 bills through 26 Aug are
 * already live). UNLIKE that script, this one creates NOTHING — every vendor
 * code and item code must already resolve against the live database, or the
 * whole run aborts naming the line. No new items, no new vendors, ever.
 *
 * Run:
 *   npm run import:purchases-aug27-31                  # parse+validate+reconcile, NO writes
 *   npm run import:purchases-aug27-31 -- --rehearse     # runs for real against the DB, then rolls back
 *   npm run import:purchases-aug27-31 -- --commit       # writes and commits
 *
 * Source: import-data/Purchase_Ledger.csv — the WHOLE Purchase Ledger tab,
 * re-exported via File ▸ Download ▸ CSV. NEVER a Drive text-export: that path
 * silently collapses vendor row-groups (measured: 96 of ~1,300+ lines
 * recovered, 86.3% of the money, largest single-day gap ₹12,147). Re-exporting
 * the WHOLE tab rather than just the new days is deliberate — it lets this
 * script also confirm the pre-27-Aug rows in the fresh export still agree with
 * what is already committed, which is a second, free check that the export is
 * complete and that nothing already booked was retroactively edited.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE GATE (§5 of the brief) is the point of this script, not a formality.
 * The sheet's own "Daily Purchases Summary" tab derives its day totals from
 * the ledger by a DIFFERENT route than this script does, so it is a genuine
 * second source of truth. Both a SUM and a COUNT are checked per day, in
 * exact paise, with no tolerance — the count exists because a sum can still
 * add up correctly over a truncated extraction if the truncation happens to
 * land at the tail (this is exactly how the by-vendor `limit 8` bug survived
 * in production once already). Any mismatch stops the run cold and writes
 * nothing.
 * ─────────────────────────────────────────────────────────────────────────
 */

process.loadEnvFile('.env.local')

import { readFileSync } from 'node:fs'
import path from 'node:path'

const COMMIT = process.argv.includes('--commit')
/** Runs the whole import for real against the DB, then rolls back. The only
 *  way to prove the inserts (and the doc-number allocation) before committing
 *  them — a dry run only proves the parser. */
const REHEARSE = process.argv.includes('--rehearse')
const DIR = process.env.IMPORT_DIR ?? 'import-data'

/** TESTING ONLY — never pass this on a real run. Drops one day's lines from
 *  the extract before the §5 gate runs, to prove the gate can actually fail
 *  and name the day. See the CLASSIFY note in the brief: "Perturb it: drop
 *  one day's rows from the extract and confirm the gate names that day and
 *  refuses." */
const DROP_DAY = process.argv.find((a) => a.startsWith('--drop-day='))?.split('=')[1] ?? null

const ENTERED_BY = 'rajeshanne'

const WINDOW_START = '2026-08-27'
const WINDOW_END = '2026-08-31'
/** The last date already committed by the original stock-sheet import — used
 *  only for the continuity check below, never for the window itself. */
const LAST_COMMITTED_DATE = '2026-08-26'

/**
 * The ORIGINAL bulk import's own verified state as of 26 Aug — 330 bills,
 * 1,101 lines, ₹17,96,960.25 goods (matches AGENTS.md's recorded figures,
 * re-verified live against the bulk-import transaction's own timestamp before
 * writing this check).
 *
 * Deliberately NOT "current DB minus voids": two bills were added live
 * through the app AFTER the bulk import and before this script was written —
 * SRI MAHA LAKSHMI TRADERS #1015 (₹1,69,950, dated 4 Aug, entered in the bulk
 * import) was voided on 28 Aug and replaced with a corrected ₹15,450 entry,
 * both real bookkeeping activity through the live app, unrelated to the
 * sheet. The continuity check's job is to prove the FRESH EXPORT still agrees
 * with what the SHEET said as of 26 Aug — comparing against "today's DB minus
 * a guessed void filter" would silently absorb or fight with live corrections
 * that have nothing to do with the sheet. Comparing against the import's own
 * documented, already-triple-verified baseline is the precise, stable check.
 */
const BASELINE = { bills: 330, lines: 1101, goods: '1796960.25' }

/**
 * THE SHEET MOVED — the day-level EXPECTED figures used to be hardcoded here
 * (read from an early prose brief, then cross-checked against a first CSV
 * export). Both are now stale: the sheet was rebuilt 03-Sep after the 01-Sep
 * export, changing five-day-window and day totals alike, and Rajesh said so
 * explicitly — "every figure in the earlier briefs is stale; take all
 * expectations from this file only." So there is no EXPECTED constant any
 * more. §5's day-level ground truth is DERIVED from `summary.days` (see
 * readDailySummary below), filtered to the window, every run — never a
 * number transcribed once and left to drift out of sync with a sheet that
 * keeps moving. vendorDays at that grain = count of DISTINCT (date, vendor)
 * pairs, i.e. one vendor delivering twice in a day counts once.
 */

/**
 * THE THIRD GATE COLUMN — per (date, vendor), read from the Daily Purchases
 * Summary tab's own vendor-grain rows, NOT derived from the Purchase Ledger
 * this script already parses. 54 independent checks instead of 5; a mismatch
 * names the vendor, not just the day.
 *
 * NOT POPULATED YET. The 27 Aug figures given in the brief are explicitly
 * INCOMPLETE (one truncated value, four vendors missing) and are stated as
 * orientation only, not ground truth — "take every number from the CSV."
 * This script therefore refuses to run the vendor-grain gate until
 * import-data/Daily_Purchases_Summary.csv exists, and reports exactly that
 * rather than silently skipping it or guessing at column positions for a
 * header nobody has read yet (the same discipline as the Purchase Ledger
 * header check above).
 *
 * NO BILL-COUNT CHECK AT THIS GRAIN, deliberately: two bills from one vendor
 * on one day roll into a single vendor-day sub-row on the sheet's side, and
 * the sheet exposes no per-bill count to check against. A sum tolerates that
 * naturally; a count would not, and would be checking a thing the second
 * source cannot even state.
 *
 * TRANSPORT, GST AND LANDED ARE ALL COMPARED, not just goods. Real figures,
 * not an abstract risk: the sheet's own rebuild stamp reads 1,337 purchase
 * lines · GST ₹14,318.60 · transport ₹200.00 overall, and August alone
 * carries GST ₹14,216.75. There IS a real nonzero transport row — 25 Aug,
 * N.V.S.S.RAVI TEJA TRADERS, goods ₹7,000.00 + transport ₹200.00 = landed
 * ₹7,200.00 — but it falls OUTSIDE this 27–31 Aug window, whose every row
 * carries GST = 0 and transport = 0 (verified below, not assumed). So the
 * GST and transport comparisons in THIS run are WRITTEN but UNEXERCISED
 * against a real nonzero case — flagged explicitly in the report rather than
 * left silent, per this project's own rule: an assertion that cannot fail on
 * the data at hand has not been tested. `landed` is computed here as
 * goods + gst + transport, which is only safe because GST is tracked as its
 * own column now (§3 of addendum 2) — the earlier goods+transport-only
 * formula was wrong the moment a window carries real GST.
 */
type VendorDayExpected = { date: string; vendorName: string; goods: string; gst: string; transport: string; landed: string }
/** One row of the Daily Purchases Summary's DAY-GRAIN total (the group row
 *  above its vendor sub-rows) — used both to cross-check EXPECTED above and,
 *  critically, to run gate §3 (addendum 2) against 1–26 Aug, which this
 *  script was never given ground truth for directly. */
type DayExpected = { date: string; goods: string; gst: string; transport: string; landed: string; labelVendorCount: number | null }

class ImportError extends Error {}

// ══════════════════════════════════ exact decimal arithmetic, scaled to 6 dp
//
// Copied VERBATIM from scripts/import-stock-sheet.ts rather than imported —
// that script is a one-time import already executed against production and
// is left as historical record; these four pure functions are proven correct
// against real data there (they are what made the original import's
// paise-exact reconciliation pass), so duplicating ~30 lines of tested pure
// arithmetic is the safer trade against touching an already-run script.
const SCALE = 1_000_000n
function dec(s: string, where: string): bigint {
  const t = (s ?? '').trim()
  if (t === '') return 0n
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(t)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new ImportError(`${where}: ${JSON.stringify(s)} is not a plain number`)
  const frac = (m[3] ?? '').padEnd(6, '0')
  if (frac.length > 6) throw new ImportError(`${where}: ${JSON.stringify(s)} has more than 6 decimals`)
  const v = BigInt(m[2] === '' ? '0' : m[2]) * SCALE + BigInt(frac)
  return m[1] === '-' ? -v : v
}
function mul(a: bigint, b: bigint): bigint {
  const p = a * b
  if (p % SCALE !== 0n) throw new ImportError('a product needed more than 6 decimals — refusing to round money')
  return p / SCALE
}
function str(v: bigint): string {
  const neg = v < 0n
  const a = neg ? -v : v
  const whole = a / SCALE
  const frac = (a % SCALE).toString().padStart(6, '0').replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`
}
const money = (v: bigint) => {
  const s = str(v < 0n ? -v : v)
  const [w, f = ''] = s.split('.')
  const head = w.length <= 3 ? w : w.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',') + ',' + w.slice(-3)
  return `${v < 0n ? '-' : ''}₹${head}.${f.padEnd(2, '0').slice(0, 2)}`
}
/** norm() for paise-scale exact comparison: DB numeric preserves scale
 *  (e.g. "380.000000"), the sheet does not ("380.00"). Trimming trailing
 *  zeros is value-preserving — it cannot make two different numbers agree,
 *  only two spellings of the same number. */
const norm = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)

// ══════════════════════════════════════════════════════════ read the source

/** RFC4180 enough for a Sheets export: quoted fields, doubled quotes, CRLF.
 *  Same parser as import-stock-sheet.ts. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = 0
  const push = () => { row.push(field); field = '' }
  const endRow = () => { push(); rows.push(row); row = [] }
  while (i < text.length) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue }
        quoted = false; i++; continue
      }
      field += c; i++; continue
    }
    if (c === '"') { quoted = true; i++; continue }
    if (c === ',') { push(); i++; continue }
    if (c === '\r') { i++; continue }
    if (c === '\n') { endRow(); i++; continue }
    field += c; i++
  }
  if (field !== '' || row.length > 0) endRow()
  return rows
}
const readCsv = (name: string) => parseCsv(readFileSync(path.join(DIR, name), 'utf8'))

/** Same mapper as import-stock-sheet.ts — raised, never defaulted. Extended
 *  here with whatever the Purchase Ledger's own Unit column turns out to
 *  hold; unknown values abort by name rather than silently passing through. */
const UNITS: Record<string, string> = {
  kg: 'kg', pcs: 'pcs', Litr: 'litre', litre: 'litre', tins: 'tin', tin: 'tin',
  box: 'box', bot: 'bottle', bottle: 'bottle', pkts: 'pkt', pkt: 'pkt', bunch: 'bunch',
}
function unitCode(raw: string, where: string): string {
  const k = raw.trim()
  const u = UNITS[k]
  if (u === undefined) throw new ImportError(`${where}: unit ${JSON.stringify(raw)} is not in the mapper — add it to UNITS or check the sheet; nothing was written`)
  return u
}

/** Same transposition/zero-pad fix as import-stock-sheet.ts. This is FORMAT
 *  normalisation of an exact code (a known, five-instance-confirmed sheet
 *  quirk), not fuzzy name matching — §3 of the brief forbids the latter, not
 *  the former. Anything that still does not resolve after this aborts. */
function normItemCode(raw: string, where: string): string {
  let c = raw.trim().toUpperCase()
  if (c.startsWith('KHP-')) c = `HKP-${c.slice(4)}`
  const m = /^([A-Z]{3})-0*(\d+)$/.exec(c)
  if (!m) throw new ImportError(`${where}: item code ${JSON.stringify(raw)} is not <CAT>-<number>; nothing was written`)
  return `${m[1]}-${String(Number(m[2])).padStart(3, '0')}`
}

const EXPECTED_HEADER = ['Date', 'Vendor', 'Code', 'Item', 'Qty', 'Unit', 'Rate', 'Value', 'Bill#', 'Vendor code', 'GST %', 'GST Rs', 'Transport', 'Landed']

type LedgerLine = {
  date: string; vendorCode: string; billNo: string
  itemCode: string; unitRaw: string
  qty: bigint; rate: bigint; gstPct: string; gstRs: bigint; transport: bigint
  sheetRow: number
}

/** Every row in the file, split into three buckets by date: PRE (already
 *  committed — used only for the continuity check), WINDOW (what this script
 *  imports), and AFTER (later than the window — ignored, but counted and
 *  reported so a stale or over-eager export does not silently vanish). */
function readLedger(): { pre: LedgerLine[]; window: LedgerLine[]; after: LedgerLine[]; headerOk: boolean; header: string[] } {
  const rows = readCsv('Purchase_Ledger.csv')
  const header = rows[0] ?? []
  const headerOk = header.length === EXPECTED_HEADER.length && header.every((h, i) => h.trim() === EXPECTED_HEADER[i])

  const pre: LedgerLine[] = [], windowRows: LedgerLine[] = [], after: LedgerLine[] = []
  rows.slice(1).forEach((r, i) => {
    if (!r.some((c) => c.trim() !== '')) return
    const sheetRow = i + 2
    const where = `Purchase Ledger row ${sheetRow}`
    const date = r[0].trim()
    const line: LedgerLine = {
      date,
      vendorCode: r[9].trim(),
      billNo: r[8].trim(),
      itemCode: normItemCode(r[2], where),
      unitRaw: r[5].trim(),
      qty: dec(r[4], `${where} (qty)`),
      rate: dec(r[6], `${where} (rate)`),
      gstPct: r[10].trim(),
      gstRs: dec(r[11], `${where} (GST Rs)`),
      transport: dec(r[12], `${where} (transport)`),
      sheetRow,
    }
    if (date <= LAST_COMMITTED_DATE) pre.push(line)
    else if (date >= WINDOW_START && date <= WINDOW_END) {
      if (DROP_DAY && date === DROP_DAY) return // TESTING ONLY
      windowRows.push(line)
    } else after.push(line)
  })
  return { pre, window: windowRows, after, headerOk, header }
}

/**
 * The Daily Purchases Summary tab — six columns, confirmed by direct
 * reading: Date | Vendor | Goods | GST | Transport | Landed. Not guessed
 * past that — if the real header differs, this refuses loudly and prints
 * both, the same discipline as the Purchase Ledger header check.
 *
 * THE SHAPE, confirmed rather than assumed:
 *  - Above the data sit merged title rows and a rebuild stamp. The header is
 *    found by CONTENT (first two cells "Date","Vendor"), never by row number.
 *  - Each day is a GROUP ROW carrying the real date (e.g. "27-Aug-2026") and
 *    a Vendor cell that is a fold indicator ("▸ (14 vendors)"), not a name —
 *    its Goods/GST/Transport/Landed are the DAY TOTAL.
 *  - Below each group row sit that day's VENDOR SUB-ROWS, which carry a
 *    BLANK Date — forward-filled from the group row above them.
 *  - A GRAND TOTAL row and a MONTH TO DATE row sit below all of that. Neither
 *    is a day: their Date cell does not parse as a calendar date, so they
 *    fall through to the "special row" branch below rather than being
 *    forward-filled from or mistaken for a vendor row. MONTH TO DATE is
 *    captured separately (useful for §6); GRAND TOTAL is logged only.
 *
 * Returns null if the file does not exist yet — the caller decides what that
 * means for a dry run vs. a commit vs. gate §3.
 */
const SUMMARY_FILE = 'Stock Management - Daily Purchases Summary.csv'
const SUMMARY_HEADER = ['Date', 'Vendor', 'Goods', 'GST', 'Transport', 'Landed']

/** Every money cell in this file is formatted, not plain — "₹2,058.00",
 *  "₹213,724.33", even the zero cells read "₹0.00". Strip the symbol and
 *  the thousands separators before handing the digits to dec(); dec() itself
 *  stays untouched since it is shared with the Purchase Ledger reader, whose
 *  cells are already plain. */
function cleanMoney(raw: string): string {
  return raw.trim().replace(/₹/g, '').replace(/,/g, '').trim()
}

/** "27-Aug-2026" -> "2026-08-27". Returns null for anything that is not
 *  recognisably a calendar date — which is exactly how a GRAND TOTAL or
 *  MONTH TO DATE row (whose Date cell is text, not a date) is told apart
 *  from a real day-group row, without hardcoding a row number or a label
 *  string that could be spelled differently. */
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' }
function parseSheetDate(raw: string): string | null {
  const s = raw.trim()
  if (s === '') return null
  const m1 = /^(\d{1,2})-([A-Za-z]{3,})-(\d{4})$/.exec(s)
  if (m1) {
    const mon = MONTHS[m1[2].slice(0, 3).toLowerCase()]
    return mon ? `${m1[3]}-${mon}-${m1[1].padStart(2, '0')}` : null
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m2 = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s) // D/M/YYYY, Sheets' locale default
  if (m2) return `${m2[3]}-${m2[2].padStart(2, '0')}-${m2[1].padStart(2, '0')}`
  return null
}

type SummaryTotal = { label: string; goods: string; gst: string; transport: string; landed: string }
function readDailySummary(): { header: string[]; headerRowIndex: number; days: DayExpected[]; vendorDays: VendorDayExpected[]; monthToDate: SummaryTotal | null; grandTotal: SummaryTotal | null } | null {
  let text: string
  try {
    text = readFileSync(path.join(DIR, SUMMARY_FILE), 'utf8')
  } catch {
    return null
  }
  const csvRows = parseCsv(text)
  const headerIdx = csvRows.findIndex((r) => (r[0] ?? '').trim() === 'Date' && (r[1] ?? '').trim() === 'Vendor')
  if (headerIdx === -1) {
    throw new ImportError(`${SUMMARY_FILE}: could not find a header row (first two cells "Date","Vendor") anywhere in the file. Nothing was read.`)
  }
  const header = csvRows[headerIdx]
  const headerOk = header.length === SUMMARY_HEADER.length && header.every((h, i) => h.trim() === SUMMARY_HEADER[i])
  if (!headerOk) {
    throw new ImportError(
      `${SUMMARY_FILE} header does not match what this script expects.\n` +
      `  expected: ${SUMMARY_HEADER.join(', ')}\n  got:      ${header.join(', ')}\n` +
      'Fix the mapping in readDailySummary() against the real header — do not guess. Nothing was read.',
    )
  }

  const days: DayExpected[] = []
  const vendorDays: VendorDayExpected[] = []
  let monthToDate: SummaryTotal | null = null
  let grandTotal: SummaryTotal | null = null
  let currentDate: string | null = null

  for (const r of csvRows.slice(headerIdx + 1)) {
    if (!r.some((c) => c.trim() !== '')) continue
    const rawDate = (r[0] ?? '').trim()
    const rawVendor = (r[1] ?? '').trim()
    const rest = {
      goods: cleanMoney(r[2] ?? ''), gst: cleanMoney(r[3] ?? ''),
      transport: cleanMoney(r[4] ?? ''), landed: cleanMoney(r[5] ?? ''),
    }

    if (rawDate === '') {
      // Vendor sub-row — forward-filled from the last day-group row seen.
      if (currentDate === null) throw new ImportError(`${SUMMARY_FILE}: a vendor row (${rawVendor}) appears before any day-group row — cannot forward-fill its date`)
      vendorDays.push({ date: currentDate, vendorName: rawVendor, ...rest })
      continue
    }

    const iso = parseSheetDate(rawDate)
    if (iso) {
      currentDate = iso
      // The Vendor cell on a day-group row is a fold indicator, e.g.
      // "▸ (14 vendors)" — extracted here so it can be checked against the
      // actual number of sub-rows forward-filled to this date, an internal
      // consistency check on the file (and on this parser) independent of
      // anything KitchenBooks holds.
      const m = /\((\d+)\s*vendors?\)/i.exec(rawVendor)
      days.push({ date: iso, labelVendorCount: m ? Number(m[1]) : null, ...rest })
      continue
    }

    // Not blank, not a parseable date -> a special row (title, rebuild
    // stamp, GRAND TOTAL, MONTH TO DATE). Never forward-filled from, never
    // treated as a day or a vendor row.
    if (/month to date/i.test(rawDate) || /month to date/i.test(rawVendor)) {
      monthToDate = { label: rawDate || rawVendor, ...rest }
    } else if (/grand total/i.test(rawDate) || /grand total/i.test(rawVendor)) {
      grandTotal = { label: rawDate || rawVendor, ...rest }
    }
  }
  return { header, headerRowIndex: headerIdx + 1, days, vendorDays, monthToDate, grandTotal }
}

// ═════════════════════════════════════════════════════════════════════ main

async function main() {
  const { withTenant } = await import('../src/lib/tenant')
  const { txn, tsql } = await import('../src/lib/db')
  const { nextDocNo } = await import('../src/server/doc-numbers')
  const rid = process.env.KB_LIVE_TENANT
  if (!rid) throw new ImportError('KB_LIVE_TENANT is not set')

  const log = (s = '') => console.log(s)
  const head = (s: string) => { log(); log(`\x1b[1m${s}\x1b[0m`); log('─'.repeat(s.length)) }

  await withTenant(rid, async () => {
    head(COMMIT ? 'PURCHASES 27–31 AUG — COMMITTING'
      : REHEARSE ? 'PURCHASES 27–31 AUG — REHEARSAL (runs for real, then rolls back)'
      : 'PURCHASES 27–31 AUG — DRY RUN (parses, validates and reconciles only)')
    if (DROP_DAY) log(`\x1b[31m⚠ TEST MODE: dropping all ${DROP_DAY} lines from the extract to prove the §5 gate fails\x1b[0m`)

    // ═══════════════ §3 (addendum 2) — GATE ON DATA ALREADY IMPORTED, FIRST
    //
    // Runs before this script reads ANYTHING about the new window. This is
    // the only moment both sources sit side by side with a clean boundary —
    // once 27–31 Aug lands, the month total moves toward the sheet and a
    // pre-existing divergence hides inside a number that now looks roughly
    // right. If this fails, STOP: nothing below it runs.
    head('§3 — reconciling EXISTING 1–26 Aug KitchenBooks goods against the sheet, day grain, in SQL')
    const summary = readDailySummary()
    if (summary === null) {
      log(`  ⚠ ${SUMMARY_FILE} does not exist in ${DIR}/ — this gate cannot run.`)
      log(`    Export the Daily Purchases Summary tab (File ▸ Download ▸ CSV) to that path — the WHOLE tab,`)
      log(`    not just 27–31 Aug, since this gate needs the sheet's own 1–26 Aug day totals too.`)
      log(`    Assumed header (checked, not guessed, once the file exists): ${SUMMARY_HEADER.join(', ')}`)
      throw new ImportError('§3 cannot run without the Daily Purchases Summary export. Stopping here, per the brief\'s own order of work — nothing else was read, nothing was written.')
    }
    // ═══════════════════ INDEPENDENT VERIFICATION OF THE PARSE ═══════════
    //
    // "Verify my parse independently rather than trusting it... If your
    // reader disagrees anywhere, say so before running the gate." Every
    // number here is computed from THIS parser's own output and checked
    // against what was reported to me — never assumed to agree.
    head('Independent verification of the parse')
    log(`  header located at row ${summary.headerRowIndex} (by content, not assumed): ${summary.header.join(' | ')}`)
    if (summary.headerRowIndex !== 3) log(`  ⚠ expected row 3 — got row ${summary.headerRowIndex}`)
    log(`  ${summary.days.length} day-group rows · ${summary.vendorDays.length} vendor sub-rows`)
    if (summary.days.length !== 35) log(`  ⚠ expected 35 day groups — got ${summary.days.length}`)
    if (summary.vendorDays.length !== 379) log(`  ⚠ expected 379 vendor rows — got ${summary.vendorDays.length}`)

    // Every day's label count vs its actual forward-filled sub-row count —
    // internal consistency of the file AND of this parser, checked for
    // EVERY day, not spot-checked on one.
    let labelMismatches = 0
    for (const d of summary.days) {
      const n = summary.vendorDays.filter((v) => v.date === d.date).length
      if (d.labelVendorCount === null) { log(`  ⚠ ${d.date}: could not read a "(N vendors)" label from the group row`); labelMismatches++; continue }
      if (d.labelVendorCount !== n) { log(`  ✗ ${d.date}: label says ${d.labelVendorCount} vendors, ${n} sub-rows actually followed it`); labelMismatches++ }
    }
    if (labelMismatches === 0) log(`  ✓ every day's label count equals its sub-row count (all ${summary.days.length} days)`)

    // The forward-fill demonstrated concretely on a real multi-vendor day.
    const fillCheckDay = summary.days.find((d) => d.labelVendorCount !== null && d.labelVendorCount > 1)
    if (fillCheckDay) {
      const n = summary.vendorDays.filter((v) => v.date === fillCheckDay.date).length
      log(`  ✓ forward-fill demonstrated: ${fillCheckDay.date} has ${n} vendor sub-rows, all carrying that date (none blank)`)
    }

    // GRAND TOTAL and MONTH TO DATE reproduced from this parser's OWN
    // day-group rows — never printed as a bare "found it".
    //
    // TOLERANCE, and why this is the one place in this script that has one:
    // every OTHER comparison here (gate §3, §5, §5b) compares TWO INDEPENDENT
    // SOURCES — KitchenBooks against the sheet, or this script's own ledger
    // extraction against the sheet's vendor rows — where "no tolerance" is
    // the whole point, because a real missing bill could hide behind a
    // rounding excuse. This check is different in kind: it sums the file's
    // OWN day-group cells (each already displayed to 2dp) to try to reproduce
    // the file's OWN aggregate row, computed by the SAME spreadsheet from
    // full-precision line items. Rounding 35 (or 31) independently-rounded
    // 2dp figures and re-summing them is not guaranteed to equal a total
    // computed before that rounding happened — this is the identical
    // "rounding is not associative" fact this codebase has hit repeatedly
    // (the stock category rollup, the issue-log reconciliation). A tolerance
    // of ONE PAISA per figure cannot hide a missing line — a missing line is
    // worth rupees — so it is allowed here, and ONLY here, and every
    // agreement below states whether it was exact or within that tolerance.
    const PAISA = SCALE / 100n
    const closeEnough = (a: bigint, b: bigint) => { const d = a > b ? a - b : b - a; return d <= PAISA }
    let totalsBad = 0
    const checkTotal = (label: string, sumOf: string, row: SummaryTotal | null) => {
      if (!row) { log(`  ⚠ no ${label} row found — cannot reproduce it`); totalsBad++; return }
      const sum = { goods: 0n, gst: 0n, transport: 0n, landed: 0n }
      for (const d of summary.days.filter((x) => sumOf === 'all' || x.date.startsWith('2026-08'))) {
        sum.goods += dec(d.goods, `${label}.goods`); sum.gst += dec(d.gst, `${label}.gst`)
        sum.transport += dec(d.transport, `${label}.transport`); sum.landed += dec(d.landed, `${label}.landed`)
      }
      const want = { goods: dec(row.goods, label), gst: dec(row.gst, label), transport: dec(row.transport, label), landed: dec(row.landed, label) }
      const exact = sum.goods === want.goods && sum.gst === want.gst && sum.transport === want.transport && sum.landed === want.landed
      const within = closeEnough(sum.goods, want.goods) && closeEnough(sum.gst, want.gst) && closeEnough(sum.transport, want.transport) && closeEnough(sum.landed, want.landed)
      const mark = exact ? '✓' : within ? '≈' : '✗'
      log(`  ${mark} ${label} ("${row.label}") reproduced: sum = goods ${money(sum.goods)} gst ${money(sum.gst)} transport ${money(sum.transport)} landed ${money(sum.landed)}${exact ? '' : within ? '  (within 1 paisa — rounding, not a mismatch)' : ''}`)
      log(`      file's own ${label} row:  goods ${money(want.goods)} gst ${money(want.gst)} transport ${money(want.transport)} landed ${money(want.landed)}`)
      if (!within) totalsBad++
    }
    checkTotal('GRAND TOTAL', 'all', summary.grandTotal)
    checkTotal('MONTH TO DATE', 'aug', summary.monthToDate)

    if (labelMismatches > 0 || totalsBad > 0 || summary.headerRowIndex !== 3 || summary.days.length !== 35 || summary.vendorDays.length !== 379) {
      throw new ImportError('Independent verification found a disagreement — see ⚠/✗ lines above. Not proceeding to gate §3 until the parser and the file agree.')
    }
    log('\n\x1b[32m✓ parse independently verified — proceeding to gate §3\x1b[0m')

    // KitchenBooks side: the CURRENT state, not the frozen bulk-import
    // baseline — §3 asks whether the BOOKS AS THEY STAND TODAY agree with
    // the sheet, and the 28-Aug void+replacement (dated 4 Aug) is part of
    // that current state, not an artifact to exclude.
    const kbDays = await tsql<{ bill_date: string; goods: string }[]>`
      select bill_date::text, sum(goods_total)::text goods
      from purchases where restaurant_id = ${rid} and bill_date >= '2026-08-01' and bill_date <= ${LAST_COMMITTED_DATE}
      group by bill_date order by bill_date`
    const kbByDate = new Map(kbDays.map((d) => [d.bill_date, d.goods]))
    const sheetByDate = new Map(summary.days.filter((d) => d.date >= '2026-08-01' && d.date <= LAST_COMMITTED_DATE).map((d) => [d.date, d.goods]))
    const allDates = [...new Set([...kbByDate.keys(), ...sheetByDate.keys()])].sort()

    // Per bill_date, how many of KitchenBooks' bills were ENTERED after
    // 26 Aug (created_at vs bill_date), as literally asked.
    //
    // THIS TURNED OUT TO BE VACUOUS FOR THIS DATASET, and it is worth saying
    // why rather than reporting it at face value. The ENTIRE purchases table
    // was written across exactly two days — 27 Aug (the 330-bill bulk
    // import) and 28 Aug (the one void+replacement) — confirmed exhaustively
    // by grouping on created_at::date in the previous turn. Nothing has EVER
    // been entered after 28 Aug. So "created_at > 26 Aug" is true for every
    // row in the table without exception: it cannot tell "the store manager
    // caught up late" apart from "the bulk import ran on the 27th", because
    // in this dataset there is no organic entry to distinguish it from — the
    // check's own premise (day-by-day entry over time) does not hold here.
    // A second cutoff, against the LAST date anything was actually entered
    // (28 Aug), is what actually answers the question: is there SOME
    // KitchenBooks activity later than that which could explain a gap.
    const lateEntries = await tsql<{ bill_date: string; n_after_26: string; n_after_28: string; value_after_28: string }[]>`
      select bill_date::text,
             count(*) filter (where created_at::date > ${LAST_COMMITTED_DATE})::text n_after_26,
             count(*) filter (where created_at::date > '2026-08-28')::text n_after_28,
             coalesce(sum(goods_total) filter (where created_at::date > '2026-08-28'), 0)::text value_after_28
      from purchases where restaurant_id = ${rid} and bill_date >= '2026-08-01' and bill_date <= ${LAST_COMMITTED_DATE}
      group by bill_date`
    const lateByDate = new Map(lateEntries.map((r) => [r.bill_date, r]))

    let gate3Bad = 0
    let kbTotal = 0n, sheetTotal = 0n
    for (const date of allDates) {
      const kb = kbByDate.get(date) ?? '0'
      const sh = sheetByDate.get(date) ?? '0'
      const ok = norm(kb) === norm(sh)
      kbTotal += dec(kb, 'kb'); sheetTotal += dec(sh, 'sheet')
      if (!ok) {
        gate3Bad++
        const diff = dec(kb, 'kb') - dec(sh, 'sheet')
        log(`  ✗ ${date}   KitchenBooks ${money(dec(kb, 'kb'))}  vs  sheet ${money(dec(sh, 'sheet'))}   (KitchenBooks ${diff > 0n ? 'HIGHER' : 'LOWER'} by ${money(diff < 0n ? -diff : diff)})`)
        const late = lateByDate.get(date)
        const after28 = late ? Number(late.n_after_28) : 0
        if (after28 > 0) {
          log(`      of which ${after28} bill(s) entered after 28 Aug (genuinely later than any known KitchenBooks activity), worth ${money(dec(late!.value_after_28, 'late'))} — possibly the store manager catching up`)
        } else {
          log('      NOT explained by late entry: every KitchenBooks bill on this date was written on 27 or 28 Aug (the bulk import and its one correction) — nothing has been entered since. The gap is on the sheet\'s side or elsewhere, not a KitchenBooks catch-up.')
        }
      }
    }
    log(`\n  KitchenBooks 1–26 Aug total   ${money(kbTotal)}`)
    log(`  Sheet        1–26 Aug total   ${money(sheetTotal)}`)
    if (gate3Bad > 0) {
      log(`\n  ${gate3Bad} day(s) above disagree. This is a decision list for Rajesh, not a target to make KitchenBooks match —`)
      log(`  both books hold corrections the other lacks (KitchenBooks: the ₹1,69,950 void + ₹15,450 replacement on 4 Aug;`)
      log(`  the sheet: its own ₹1,23,540 two-day movement between the 01-Sep and 03-Sep rebuilds). Neither side is assumed right.`)
      throw new ImportError(`§3 gate FAILED — ${gate3Bad} day(s) of pre-existing (1–26 Aug) data disagree between KitchenBooks and the sheet. Stopping here — nothing else was read, nothing was written.`)
    }
    log(`\n\x1b[32m✓ §3 gate passed — KitchenBooks' existing 1–26 Aug books tie exactly to the sheet, day by day (${allDates.length} days)\x1b[0m`)

    // ── read the source ────────────────────────────────────────────────────
    const { pre, window: winLines, after, headerOk, header } = readLedger()
    head('Header')
    log(`  expected: ${EXPECTED_HEADER.join(' | ')}`)
    log(`  got:      ${header.join(' | ')}`)
    if (!headerOk) throw new ImportError('Purchase_Ledger.csv header does not match what this script expects — aborting, nothing was read')
    log('  ✓ header matches')

    log(`\n  rows on/before ${LAST_COMMITTED_DATE} (pre-window)   ${pre.length}`)
    log(`  rows ${WINDOW_START}..${WINDOW_END} (this import)      ${winLines.length}`)
    log(`  rows after ${WINDOW_END}                        ${after.length}`)
    if (after.length > 0) log(`  ⚠ ${after.length} rows dated after ${WINDOW_END} exist in the file and will NOT be imported by this script`)

    // ── group into bills ───────────────────────────────────────────────────
    type Bill = { date: string; vendorCode: string; billNo: string; lines: LedgerLine[] }
    const billMap = new Map<string, Bill>()
    for (const l of winLines) {
      const key = `${l.date}|${l.vendorCode}|${l.billNo}`
      let b = billMap.get(key)
      if (!b) { b = { date: l.date, vendorCode: l.vendorCode, billNo: l.billNo, lines: [] }; billMap.set(key, b) }
      b.lines.push(l)
    }
    const bills = [...billMap.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      a.vendorCode < b.vendorCode ? -1 : a.vendorCode > b.vendorCode ? 1 :
      a.billNo < b.billNo ? -1 : a.billNo > b.billNo ? 1 : 0)

    let goods = 0n, gst = 0n, transport = 0n
    for (const b of bills) for (const l of b.lines) { goods += mul(l.qty, l.rate); gst += l.gstRs; transport += l.transport }

    head('Extracted — before writing anything')
    log(`  lines                ${winLines.length}`)
    log(`  bills                ${bills.length}  (${new Set(bills.map((b) => b.vendorCode)).size} distinct vendors)`)
    log(`  goods                ${money(goods)}`)
    log(`  GST                  ${money(gst)}    on ${winLines.filter((l) => l.gstRs !== 0n).length} lines`)
    log(`  transport            ${money(transport)}`)
    log(`  landed (goods+gst+transport)  ${money(goods + gst + transport)}`)
    if (gst !== 0n) {
      log(`\n  ⚠ NON-ZERO GST FOUND — the brief expected 0% throughout this window. Handled the same way the original`)
      log(`    import handles it (GST on the purchase HEADER, gst_amount=0 on every line) — never invented, never dropped.`)
      for (const l of winLines.filter((x) => x.gstRs !== 0n)) log(`    row ${l.sheetRow}: ${l.itemCode} bill#${l.billNo} ${l.date} GST% ${l.gstPct} = ${money(l.gstRs)}`)
    } else {
      log('  ✓ GST is 0 on every line in this window, as expected')
    }

    // ── database as it stands ──────────────────────────────────────────────
    const [state] = await tsql<{ bills: string; lines: string; latest: string | null; amount: string }[]>`
      select (select count(*) from purchases where restaurant_id = ${rid})::text bills,
             (select count(*) from purchase_lines where restaurant_id = ${rid})::text lines,
             (select max(bill_date)::text from purchases where restaurant_id = ${rid}) latest,
             (select coalesce(sum(amount), 0) from purchase_lines where restaurant_id = ${rid})::text amount`
    log(`\ndatabase now: ${state.bills} bills · ${state.lines} lines · latest bill_date ${state.latest} · sum(amount) ₹${state.amount}`)
    if (state.latest !== LAST_COMMITTED_DATE) {
      log(`  ⚠ expected latest bill_date to be ${LAST_COMMITTED_DATE} (this script's continuity baseline) — it is ${state.latest}.`)
      log(`    Either this script's window/baseline is stale, or something else has written purchases since. Stopping.`)
      throw new ImportError(`latest committed bill_date is ${state.latest}, not the expected ${LAST_COMMITTED_DATE}`)
    }

    // ═══════════════════════════════ continuity check — the FREE second gate
    //
    // Not asked for in the brief, added because it is cheap and catches the
    // same class of fault §5 exists for: if the fresh export is itself
    // incomplete or a stale/wrong tab, the PRE-window rows will disagree with
    // the original bulk import's own already-verified baseline (see BASELINE
    // above for why that baseline, not "current DB", is the right comparison
    // — two bills were added live through the app since the bulk import,
    // real correction activity unrelated to the sheet). A mismatch here means
    // the export cannot be trusted for the new days either.
    head('Continuity check — do the pre-27-Aug rows in this export match the original import\'s own baseline?')
    let preGoods = 0n
    for (const l of pre) preGoods += mul(l.qty, l.rate)
    const preBillCount = new Set(pre.map((l) => `${l.date}|${l.vendorCode}|${l.billNo}`)).size
    const preOk = pre.length === BASELINE.lines && preBillCount === BASELINE.bills && norm(str(preGoods)) === norm(BASELINE.goods)
    log(`  export pre-window   ${preBillCount} bills · ${pre.length} lines · ${money(preGoods)}`)
    log(`  baseline            ${BASELINE.bills} bills · ${BASELINE.lines} lines · ₹${BASELINE.goods}`)
    if (!preOk) throw new ImportError('the pre-27-Aug rows in this export do not match the original import\'s baseline — the export cannot be trusted for the new days either; nothing was written')
    log('  ✓ pre-window rows agree with the original import\'s verified baseline')

    // ═══════════════════════════════════════════════ validate against the DB
    head('Validation — every code must already resolve; nothing is created')
    const vendorRows = await tsql<{ code: string; id: string; name: string }[]>`
      select code, id, name from vendors where restaurant_id = ${rid} and status = 'active'`
    const vendors = new Map(vendorRows.map((v) => [v.code, v.id]))
    /** Exact, case-insensitive, trimmed — matching a vendor NAME (what the
     *  summary tab prints) to its CODE (what this script keys on everywhere
     *  else). Not fuzzy: an unmatched name aborts by name below, same as any
     *  other unresolved reference. */
    const vendorCodeByName = new Map(vendorRows.map((v) => [v.name.trim().toUpperCase(), v.code]))
    const items = new Map((await tsql<{ code: string; id: string; purchase_unit: string; tracks_expiry: boolean }[]>`
      select code, id, purchase_unit, tracks_expiry from items where restaurant_id = ${rid} and status = 'active'`).map((i) => [i.code, i]))

    const problems: string[] = []
    for (const l of winLines) {
      if (!vendors.has(l.vendorCode)) problems.push(`row ${l.sheetRow}: vendor code ${JSON.stringify(l.vendorCode)} is not an active vendor`)
      const item = items.get(l.itemCode)
      if (!item) { problems.push(`row ${l.sheetRow}: item ${l.itemCode} is not an active item`); continue }
      const wantUnit = unitCode(l.unitRaw, `row ${l.sheetRow}`)
      if (wantUnit !== item.purchase_unit) {
        problems.push(`row ${l.sheetRow}: ${l.itemCode} — sheet unit ${JSON.stringify(l.unitRaw)} (${wantUnit}) does not match the item's purchase_unit (${item.purchase_unit}); the rate would be per a different unit`)
      }
    }
    if (problems.length > 0) {
      problems.forEach((p) => log(`  ✗ ${p}`))
      throw new ImportError(`${problems.length} references do not resolve — nothing was written`)
    }
    log(`  ✓ every vendor code, item code and unit in the window resolves (${winLines.length} lines)`)

    // items.tracks_expiry — only checked for lines actually in this window.
    // The ledger carries no expiry column at all, so a tracks_expiry item
    // appearing here has no source to freeze expiry_date from; abort by name
    // rather than leaving it null (save-bill.ts refuses a blank the same way
    // for a live entry — this path bypasses that action, so the same rule is
    // re-asserted here).
    const expiryProblems = winLines.filter((l) => items.get(l.itemCode)!.tracks_expiry)
    if (expiryProblems.length > 0) {
      for (const l of expiryProblems) log(`  ✗ row ${l.sheetRow}: ${l.itemCode} tracks expiry and the ledger carries no expiry date — cannot freeze expiry_date`)
      throw new ImportError(`${expiryProblems.length} lines involve a tracks_expiry item with no expiry source — nothing was written`)
    }
    log('  ✓ no tracks_expiry item appears in this window')

    // ═════════════════════════════════════════════ idempotency guard
    //
    // No unique constraint exists on (restaurant_id, vendor_id, bill_no,
    // bill_date) or equivalent — confirmed by reading pg_constraint. So this
    // script enforces it itself: if ANY of the bills we are about to write
    // already exist, refuse the WHOLE run rather than silently skipping —
    // a partial re-run against an already-partially-written state is exactly
    // how a ledger doubles.
    head('Idempotency guard')
    const dupCheck = await tsql<{ vendor_id: string; bill_no: string; bill_date: string }[]>`
      select vendor_id::text, bill_no, bill_date::text from purchases
      where restaurant_id = ${rid} and reverses_id is null
        and bill_date >= ${WINDOW_START} and bill_date <= ${WINDOW_END}`
    const existing = new Set(dupCheck.map((r) => `${r.vendor_id}|${r.bill_no}|${r.bill_date}`))
    const clashes = bills.filter((b) => existing.has(`${vendors.get(b.vendorCode)}|${b.billNo}|${b.date}`))
    if (clashes.length > 0) {
      for (const c of clashes) log(`  ✗ ${c.date} vendor ${c.vendorCode} bill#${c.billNo} already exists in the database`)
      throw new ImportError(`${clashes.length} bills in this window already exist — this run would double them; nothing was written`)
    }
    log(`  ✓ none of the ${bills.length} bills in this window already exist (${dupCheck.length} purchases already dated in this window, all distinct from ours)`)

    // ═══════════════════════════════════════════════════ §5 — THE GATE
    head('§5 — reconciliation against the sheet\'s own Daily Purchases Summary')
    const byDay = new Map<string, { goods: bigint; vendors: Set<string> }>()
    /** date -> vendorCode -> aggregates, for the vendor-grain gate below.
     *  Built from the SAME bill grouping as byDay — a vendor with two bills
     *  on one day sums into one entry here, matching how the sheet's own
     *  vendor-day sub-row works (no bill count to check against it). */
    const byVendorDay = new Map<string, Map<string, { goods: bigint; gst: bigint; transport: bigint }>>()
    for (const b of bills) {
      let d = byDay.get(b.date)
      if (!d) { d = { goods: 0n, vendors: new Set() }; byDay.set(b.date, d) }
      d.vendors.add(b.vendorCode)
      let vd = byVendorDay.get(b.date)
      if (!vd) { vd = new Map(); byVendorDay.set(b.date, vd) }
      let v = vd.get(b.vendorCode)
      if (!v) { v = { goods: 0n, gst: 0n, transport: 0n }; vd.set(b.vendorCode, v) }
      for (const l of b.lines) { d.goods += mul(l.qty, l.rate); v.goods += mul(l.qty, l.rate); v.gst += l.gstRs; v.transport += l.transport }
    }
    // EXPECTED derived from summary.days, THIS RUN, for the window — never a
    // transcribed constant. "Take all expectations from this file only."
    const expectedDays = summary.days.filter((d) => d.date >= WINDOW_START && d.date <= WINDOW_END)
    let gateBad = 0
    let totalGoods = 0n, totalVendorDays = 0
    for (const e of expectedDays) {
      const d = byDay.get(e.date) ?? { goods: 0n, vendors: new Set() }
      const goodsOk = norm(str(d.goods)) === norm(e.goods)
      const countOk = e.labelVendorCount !== null && d.vendors.size === e.labelVendorCount
      if (!goodsOk || !countOk) gateBad++
      totalGoods += d.goods
      totalVendorDays += d.vendors.size
      log(`  ${goodsOk && countOk ? '✓' : '✗'} ${e.date}   goods: sheet ${money(dec(e.goods, 'expected'))}  vs  extracted ${money(d.goods)}${goodsOk ? '' : '  ← MISMATCH'}`)
      log(`      vendor-days: sheet ${e.labelVendorCount ?? '(no label count)'}  vs  extracted ${d.vendors.size}${countOk ? '' : '  ← MISMATCH'}`)
    }
    const expectedTotalGoods = expectedDays.reduce((a, e) => a + dec(e.goods, 'expected total'), 0n)
    const expectedTotalVendorDays = expectedDays.reduce((a, e) => a + (e.labelVendorCount ?? 0), 0)
    const totalGoodsOk = norm(str(totalGoods)) === norm(str(expectedTotalGoods))
    const totalCountOk = totalVendorDays === expectedTotalVendorDays
    if (!totalGoodsOk || !totalCountOk) gateBad++
    log(`  ${totalGoodsOk && totalCountOk ? '✓' : '✗'} TOTAL     goods: sheet ${money(expectedTotalGoods)}  vs  extracted ${money(totalGoods)}`)
    log(`      vendor-days: sheet ${expectedTotalVendorDays}  vs  extracted ${totalVendorDays}`)

    if (expectedDays.length !== 5) log(`  ⚠ expected ${SUMMARY_FILE} to carry a day-group row for all 5 dates in ${WINDOW_START}..${WINDOW_END}; found ${expectedDays.length}`)
    if (gateBad > 0) {
      throw new ImportError(`§5 gate FAILED on ${gateBad} row(s) above — the extraction does not reconcile against the sheet's own Daily Purchases Summary. Nothing was written.`)
    }
    log('\n\x1b[32m✓ §5 gate passed — extraction reconciles exactly, sum and count, all five days\x1b[0m')

    // ═══════════════════════════════════════════ §5b — THE VENDOR-GRAIN GATE
    head('§5b — vendor-grain reconciliation (54 independent checks, not 5)')
    {
      let vgBad = 0, vgChecked = 0, transportChecked = 0, gstChecked = 0
      const summaryRows = summary.vendorDays.filter((r) => r.date >= WINDOW_START && r.date <= WINDOW_END)
      for (const r of summaryRows) {
        const code = vendorCodeByName.get(r.vendorName.trim().toUpperCase())
        if (!code) {
          log(`  ✗ ${r.date} ${r.vendorName}: this vendor name does not match any active vendor — aborting`)
          vgBad++
          continue
        }
        const got = byVendorDay.get(r.date)?.get(code) ?? { goods: 0n, gst: 0n, transport: 0n }
        const goodsOk = norm(str(got.goods)) === norm(r.goods)
        const gstOk = norm(str(got.gst)) === norm(r.gst)
        const transportOk = norm(str(got.transport)) === norm(r.transport)
        // landed = goods + gst + transport, GST tracked as its own column
        // now (addendum 2 §1/§2) — the earlier goods+transport-only formula
        // was wrong the moment a window carries real GST.
        const landedOk = norm(str(got.goods + got.gst + got.transport)) === norm(r.landed)
        vgChecked++
        if (dec(r.transport, 'expected transport') !== 0n) transportChecked++
        if (dec(r.gst, 'expected gst') !== 0n) gstChecked++
        if (!goodsOk || !gstOk || !transportOk || !landedOk) {
          vgBad++
          log(`  ✗ ${r.date} ${r.vendorName} (${code}): goods sheet ${money(dec(r.goods, 'g'))} vs extracted ${money(got.goods)}${goodsOk ? '' : ' ← MISMATCH'}` +
              `; gst sheet ${money(dec(r.gst, 'gst'))} vs extracted ${money(got.gst)}${gstOk ? '' : ' ← MISMATCH'}` +
              `; transport sheet ${money(dec(r.transport, 't'))} vs extracted ${money(got.transport)}${transportOk ? '' : ' ← MISMATCH'}` +
              `; landed ${landedOk ? 'ok' : 'MISMATCH'}`)
        }
      }
      // Every (date, vendor) this script is about to write must ALSO appear
      // in the summary — a vendor-day we extracted that the summary never
      // mentions is exactly as wrong as one the summary states differently.
      for (const [date, vd] of byVendorDay) {
        for (const code of vd.keys()) {
          const name = [...vendorCodeByName.entries()].find(([, c]) => c === code)?.[0]
          const seen = summaryRows.some((r) => r.date === date && r.vendorName.trim().toUpperCase() === name)
          if (!seen) { log(`  ✗ ${date} ${code}: extracted from the ledger but the summary has no row for it`); vgBad++ }
        }
      }
      log(`  checked ${vgChecked} vendor-day rows (${gstChecked} with nonzero GST, ${transportChecked} with nonzero transport in the sheet)`)
      if (transportChecked === 0) {
        log(`  ⚠ transport comparison is UNEXERCISED against a real nonzero case — every row in THIS window has transport = 0.`)
        log(`    The real case (25 Aug, N.V.S.S.RAVI TEJA TRADERS: goods ₹7,000.00 + transport ₹200.00 = landed ₹7,200.00) is`)
        log(`    outside this window; that day's import is what will actually exercise this path.`)
      }
      if (gstChecked === 0) {
        log(`  ⚠ GST comparison is UNEXERCISED against a real nonzero case — every row in THIS window has GST = 0, though the`)
        log(`    sheet carries real GST elsewhere (August total ₹14,216.75; overall rebuild stamp ₹14,318.60 across 1,337 lines).`)
      }
      if (vgBad > 0) throw new ImportError(`§5b gate FAILED on ${vgBad} vendor-day row(s) above. Nothing was written.`)
      log(`\n\x1b[32m✓ §5b gate passed — ${vgChecked} vendor-day rows reconcile exactly (goods, gst, transport, landed)\x1b[0m`)
    }

    if (!COMMIT && !REHEARSE) {
      log('\nDRY RUN — nothing was written. Rehearse with --rehearse, then write with --commit.')
      return
    }

    // ══════════════════════════════════════════════ ONE TRANSACTION, ALL OF IT
    class Rehearsed extends Error {}
    const t0 = Date.now()
    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      // Re-check idempotency INSIDE the lock — a bill written between the
      // check above and this transaction acquiring the lock must still stop
      // the save (same discipline as the purchase-order freeze and closePeriod).
      const dupCheck2 = await tx<{ vendor_id: string; bill_no: string; bill_date: string }[]>`
        select vendor_id::text, bill_no, bill_date::text from purchases
        where restaurant_id = ${rid} and reverses_id is null
          and bill_date >= ${WINDOW_START} and bill_date <= ${WINDOW_END}`
      const existing2 = new Set(dupCheck2.map((r) => `${r.vendor_id}|${r.bill_no}|${r.bill_date}`))
      for (const b of bills) {
        const key = `${vendors.get(b.vendorCode)}|${b.billNo}|${b.date}`
        if (existing2.has(key)) throw new ImportError(`${b.date} vendor ${b.vendorCode} bill#${b.billNo} appeared since the dry-run check — refusing`)
      }

      head('Writing purchases')
      for (const b of bills) {
        let g = 0n, t = 0n, gs = 0n
        for (const l of b.lines) { g += mul(l.qty, l.rate); gs += l.gstRs; t += l.transport }
        // Through the app's own doc-number allocator, on the SAME transaction
        // as the row it numbers — never a hand-rolled FY lookup.
        const docNo = await nextDocNo(tx, rid, 'PUR', b.date)
        const [purchase] = await tx<{ id: string }[]>`
          insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, doc_no, goods_total, gst_total, transport, entered_by)
          values (${rid}, ${b.date}, ${vendors.get(b.vendorCode)!}, ${b.billNo}, ${docNo},
                  ${str(g)}::numeric, ${str(gs)}::numeric, ${str(t)}::numeric, ${ENTERED_BY})
          returning id`
        const lineRows = b.lines.map((l) => ({
          restaurant_id: rid, purchase_id: purchase.id, item_id: items.get(l.itemCode)!.id,
          qty: str(l.qty), rate: str(l.rate), gst_amount: '0', transport_alloc: str(l.transport),
        }))
        await tx`insert into purchase_lines ${tx(lineRows, 'restaurant_id', 'purchase_id', 'item_id', 'qty', 'rate', 'gst_amount', 'transport_alloc')}`
      }
      log(`  ✓ ${bills.length} bills · ${winLines.length} lines`)

      // ── verify INSIDE the transaction — a mismatch rolls back rather than
      // reporting a fault in data that is already committed ──────────────────
      head('Post-write verification — inside the transaction')
      let bad = 0
      const cmp = (label: string, expected: string, got: string) => {
        const ok = norm(expected) === norm(got)
        if (!ok) bad++
        log(`  ${ok ? '✓' : '✗'} ${label.padEnd(38)} expected ${expected.padStart(15)}   got ${got.padStart(15)}`)
      }
      const [tot] = await tx<{ bills: string; lines: string; goods: string; gst: string; transport: string; landed: string }[]>`
        select (select count(*) from purchases where restaurant_id = ${rid})::text bills,
               (select count(*) from purchase_lines where restaurant_id = ${rid})::text lines,
               (select coalesce(sum(goods_total), 0) from purchases where restaurant_id = ${rid})::text goods,
               (select coalesce(sum(gst_total), 0) from purchases where restaurant_id = ${rid})::text gst,
               (select coalesce(sum(transport), 0) from purchases where restaurant_id = ${rid})::text transport,
               (select coalesce(sum(bill_total), 0) from purchases where restaurant_id = ${rid})::text landed`
      cmp(`bills (${state.bills} + new)`, String(Number(state.bills) + bills.length), tot.bills)
      cmp(`lines (${state.lines} + new)`, String(Number(state.lines) + winLines.length), tot.lines)
      const [lineSum] = await tx<{ amount: string }[]>`select sum(amount)::text amount from purchase_lines where restaurant_id = ${rid}`
      cmp('sum(purchase_lines.amount)', str(dec(state.amount, 'db amount before') + goods), lineSum.amount)

      log()
      if (bad > 0) throw new ImportError(`${bad} post-write checks FAILED — rolling back, nothing was written`)
      log(`\x1b[32mAll post-write checks passed\x1b[0m  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
      if (REHEARSE) throw new Rehearsed('rehearsal complete — rolling back')
    }).catch((e) => {
      if (e instanceof Rehearsed) { log(`\n${e.message}`); return }
      throw e
    })

    if (COMMIT) {
      // ══════════════════════════════════════════ §6 — after the write
      head('§6 — what moved')
      const [aug] = await tsql<{ bills: string; goods: string; total: string }[]>`
        select count(*)::text bills, coalesce(sum(goods_total),0)::text goods, coalesce(sum(bill_total),0)::text total
        from purchases where restaurant_id = ${rid} and bill_date >= '2026-08-01' and bill_date <= '2026-08-31'`
      log(`  August 2026 (full month): ${aug.bills} bills, goods ₹${aug.goods}, landed ₹${aug.total}`)
      const [win] = await tsql<{ bills: string; goods: string; total: string }[]>`
        select count(*)::text bills, coalesce(sum(goods_total),0)::text goods, coalesce(sum(bill_total),0)::text total
        from purchases where restaurant_id = ${rid} and bill_date >= ${WINDOW_START} and bill_date <= ${WINDOW_END}`
      log(`  27–31 Aug window: ${win.bills} bills, goods ₹${win.goods}, landed ₹${win.total}`)
      const [all] = await tsql<{ bills: string }[]>`select count(*)::text bills from purchases where restaurant_id = ${rid}`
      log(`  total bills in the ledger: ${state.bills} → ${all.bills}`)
    }
  })
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
