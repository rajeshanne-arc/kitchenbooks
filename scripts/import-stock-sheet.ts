/**
 * ONE-TIME IMPORT of Rajesh's "Stock Management" Google Sheet into the live
 * ledger — items, the opening stock count, 330 purchase bills and 17 vendor
 * payments.
 *
 * Run:
 *   npm run import:stock            # DRY RUN — parses, validates, reports, writes nothing
 *   npm run import:stock -- --commit
 *
 * Source: sheet 1m0Et8lJDCrmAD9ItFflBjEYJRzVrDG99eR1bkwG_Q14, exported tab by
 * tab to CSV under ./import-data (gitignored — it is the restaurant's data).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE ORDER IS NOT THE BRIEF'S ORDER, AND THE REASON IS MECHANICAL.
 *
 * The brief said items → purchases → payments → opening stock. It cannot run
 * that way. `stock_on_hand` and `item_costs` are NOT date-aware: they are
 * all-time running totals. So a count saved AFTER the purchases would freeze
 * book_qty at everything ever bought and unit_cost at the weighted average of
 * those purchases — and accepting it would write `counted − book`, a large
 * negative adjustment that erases the purchases from the shelf.
 *
 * AGENTS.md already states the correct sequence in so many words: "set
 * items.opening_rate → count against the empty book → accept". So:
 *
 *      items  →  opening count  →  accept  →  purchases  →  payments
 *
 * Counting first is also what makes the frozen numbers HONEST. This script
 * writes book_qty and unit_cost by reading the same two views saveCount reads,
 * at the moment it reads them — it never asserts a frozen value the views
 * would not have returned. Hand-writing `book_qty = 0` to get the same answer
 * in the wrong order would have been a lie that happened to arrive at the
 * right number.
 * ─────────────────────────────────────────────────────────────────────────
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

process.loadEnvFile('.env.local')

const COMMIT = process.argv.includes('--commit')
/** Runs the WHOLE import for real and then rolls it back. The only way to
 *  prove 1,400 statements against live data before committing them. */
const REHEARSE = process.argv.includes('--rehearse')
const DIR = process.env.IMPORT_DIR ?? 'import-data'

/** Who is accountable for these records. Rajesh keyed every one of them into
 *  the sheet; `entered_by` answers "who recorded this", not "which process
 *  inserted it", and the activity log's person filter reads real usernames. */
const ENTERED_BY = 'rajeshanne'

/** The opening count's date, chosen with Rajesh rather than derived.
 *
 *  `store_stock_by_month` takes the LAST count of a month as that month's
 *  closing value, and `pnl_monthly` reads opening = lag(closing). Dating this
 *  4 June — literally the day before the first purchase, as first briefed —
 *  would have made ₹8.12 lakh JUNE's closing stock and printed June COGS as
 *  minus eight lakh on /owner/pnl. 31 May makes it May's closing, therefore
 *  June's OPENING, which is what an opening balance is.
 *
 *  stock_counts has no UPDATE grant on count_date and kb_app holds no DELETE,
 *  so this is permanent. It was a question, not a guess. */
const COUNT_DATE = '2026-05-31'

// ══════════════════════════════════════════════ pure: parsing & normalising

/** RFC4180 enough for a Sheets export: quoted fields, doubled quotes, CRLF. */
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

class ImportError extends Error {}

/**
 * THE MAPPER RAISES; IT NEVER DEFAULTS.
 *
 * Rajesh's first mapper carried the singulars and silently turned fifty items
 * into Pieces. `units` is keyed by CODE — kg, litre, pcs, tin, box, bottle,
 * pkt, bunch — and the sheet writes plurals and abbreviations: tins, pkts,
 * bot, and `Litr`, which was not even on the list of plurals to watch for.
 * A default here is a silent wrong unit on an item nobody will ever re-check.
 *
 * items.purchase_unit and stock_unit are FOREIGN KEYS to units(code), so
 * Postgres is the backstop — but a refusal from here names the sheet value,
 * and a foreign-key violation names nothing a person can act on.
 */
const UNITS: Record<string, string> = {
  kg: 'kg', pcs: 'pcs', Litr: 'litre', tins: 'tin',
  box: 'box', bot: 'bottle', pkts: 'pkt', bunch: 'bunch',
}
function unitCode(raw: string, where: string): string {
  const k = raw.trim()
  const u = UNITS[k]
  if (u === undefined) throw new ImportError(`${where}: unit ${JSON.stringify(raw)} is not in the mapper — add it to UNITS or fix the sheet; nothing was written`)
  return u
}

/**
 * KHP- IS A TRANSPOSITION OF HKP-, confirmed on five independent instances
 * rather than assumed from one. The master carries KHP-015 TRIGGER SPRAY
 * BOTTLE and no HKP-015; the ledger buys HKP-015 and also KHP-014/017/018/019,
 * and every one of those four matches an HKP master row by name, unit AND
 * rate — FRESH LAVENDER 184, TOILET ROLLS 16, M-FOLD NAPKIN 55, SPONGE WIPE
 * 30. So the rule is general, not a special case for the row Rajesh spotted.
 *
 * Zero-padding is the same correction Rajesh made by hand on PKG-0013: the
 * sheet also holds PLT-0012, VEG-0051 and VEG-39..42. Codes are compared as
 * TEXT everywhere in this app, so VEG-39 sorts after VEG-052.
 */
function normItemCode(raw: string, where: string): string {
  let c = raw.trim().toUpperCase()
  if (c.startsWith('KHP-')) c = `HKP-${c.slice(4)}`
  const m = /^([A-Z]{3})-0*(\d+)$/.exec(c)
  if (!m) throw new ImportError(`${where}: item code ${JSON.stringify(raw)} is not <CAT>-<number>; nothing was written`)
  return `${m[1]}-${String(Number(m[2])).padStart(3, '0')}`
}

/** categories is keyed by CODE, not name — derive it from the item's own code
 *  rather than from the sheet's CATEGORY column, which disagrees on PKG-0013
 *  (it says "Services" while the code says Packaging). The code is right:
 *  the code is what every other tab joins on. */
const catOf = (code: string) => code.split('-')[0]

// ── exact decimal arithmetic, scaled to 6 dp ──────────────────────────────
// Money must not touch a float. The sheet's own Value column already shows
// what happens when it does: 16 lines read 1047.6000000000001 and the like,
// because Sheets computed =Qty*Rate in binary. qty × rate in exact decimal is
// the truth, and it is also what Postgres will generate into
// purchase_lines.amount, so the two agree by construction.
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
/** a × b, exact: both carry ≤3 dp in this data, so the product needs ≤6. */
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

// ══════════════════════════════════════════════════════════ read the source

type MasterRow = {
  code: string; name: string; brand: string | null
  purchaseUnit: string; stockUnit: string; conversionFactor: string
  openingRate: string | null; sheetRow: number
}

function readMaster() {
  const rows = readCsv('Raw_Material_Master.csv')
  const out: MasterRow[] = []
  const dupes: { code: string; keptRow: number; keptName: string; dropped: MasterRow }[] = []
  const seen = new Map<string, MasterRow>()
  rows.slice(4).forEach((r, i) => {
    if (!r[0] || r[0].trim() === '') return
    const sheetRow = i + 5
    const where = `Raw Material Master row ${sheetRow}`
    const code = normItemCode(r[0], where)
    // OPENING COST, falling back to WTD AVG COST — the rule the first 120
    // rows were already loaded under (DRY-026 has a blank opening cost and
    // carries 350, its weighted average). A rate of ZERO is not a rate: it
    // would make item_costs.issue_cost 0 and the item silently issuable at
    // no cost, where NULL makes it refuse by name until a bill exists.
    const opening = r[10]?.trim() !== '' ? r[10].trim() : r[9]?.trim() ?? ''
    const openingRate = opening === '' || dec(opening, where) === 0n ? null : opening
    const row: MasterRow = {
      code,
      name: r[1].trim(),
      brand: r[3].trim() === '' ? null : r[3].trim(),
      purchaseUnit: unitCode(r[5], `${where} (purchase unit)`),
      stockUnit: unitCode(r[6], `${where} (stock unit)`),
      conversionFactor: r[7].trim() === '' ? '1' : r[7].trim(),
      openingRate,
      sheetRow,
    }
    const prior = seen.get(code)
    if (prior) {
      // TWO ITEMS, ONE CODE. The code is the identity, so the second row has
      // no identity of its own — it cannot be loaded, and inventing a fresh
      // code for it would put a number in the permanent series that Rajesh
      // never chose. Reported by name instead.
      dupes.push({ code, keptRow: prior.sheetRow, keptName: prior.name, dropped: row })
      return
    }
    seen.set(code, row)
    out.push(row)
  })
  return { items: out, dupes }
}

type LedgerLine = {
  date: string; vendorCode: string; billNo: string
  itemCode: string; qty: bigint; rate: bigint; gst: bigint; transport: bigint
  sheetRow: number
}

function readLedger(): LedgerLine[] {
  const rows = readCsv('Purchase_Ledger.csv')
  const out: LedgerLine[] = []
  rows.slice(1).forEach((r, i) => {
    if (!r.some((c) => c.trim() !== '')) return
    const sheetRow = i + 2
    const where = `Purchase Ledger row ${sheetRow}`
    out.push({
      date: r[0].trim(),
      vendorCode: r[9].trim(),
      billNo: r[8].trim(),
      itemCode: normItemCode(r[2], where),
      qty: dec(r[4], `${where} (qty)`),
      rate: dec(r[6], `${where} (rate)`),
      gst: dec(r[11], `${where} (GST Rs)`),
      transport: dec(r[12], `${where} (transport)`),
      sheetRow,
    })
  })
  return out
}

/** The sheet writes 'Bank Transfer'; the managed list holds 'Bank transfer'.
 *  Mapped to the LIST's exact value — an unmatched mode lands in
 *  list_suggestions as a second, silent vocabulary for the same thing. */
const MODES: Record<string, string> = { Cash: 'Cash', 'Bank Transfer': 'Bank transfer' }

function readPayments() {
  const rows = readCsv('Payments.csv')
  return rows.slice(3).flatMap((r, i) => {
    if (!r.some((c) => c.trim() !== '')) return []
    const where = `Payments row ${i + 4}`
    const mode = MODES[r[4].trim()]
    if (mode === undefined) throw new ImportError(`${where}: payment mode ${JSON.stringify(r[4])} is not in the mapper — check Setup → Lists`)
    return [{
      date: r[0].trim(), vendorCode: r[1].trim(),
      amount: dec(r[3], `${where} (amount)`), mode,
      ref: r[5].trim(), note: r[6].trim(), sheetRow: i + 4,
    }]
  })
}

function readCount() {
  const rows = readCsv('Stock_Count.csv')
  const out: { itemCode: string; qty: bigint; sheetRow: number }[] = []
  const seen = new Set<string>()
  const skipped: string[] = []
  rows.slice(3).forEach((r, i) => {
    if (!r[0] || r[0].trim() === '') return
    const sheetRow = i + 4
    const code = normItemCode(r[0], `Stock Count row ${sheetRow}`)
    // A BLANK IS NOT A ZERO. An explicit 0 is a real count — somebody walked
    // to the shelf and found nothing — and it belongs on the sheet as a line.
    // A blank is nobody having said anything, and turning it into a counted
    // zero would assert a count that was never taken. Same law as an unmarked
    // day on the attendance sheet.
    if (r[2].trim() === '') return
    if (seen.has(code)) { skipped.push(code); return }
    seen.add(code)
    out.push({ itemCode: code, qty: dec(r[2], `Stock Count row ${sheetRow}`), sheetRow })
  })
  return { lines: out, skipped }
}

// ═════════════════════════════════════════════════════════════════════ main

async function main() {
  const { withTenant } = await import('../src/lib/tenant')
  const { txn, tsql, sql } = await import('../src/lib/db')
  const rid = process.env.KB_LIVE_TENANT
  if (!rid) throw new ImportError('KB_LIVE_TENANT is not set')

  const log = (s = '') => console.log(s)
  const head = (s: string) => { log(); log(`\x1b[1m${s}\x1b[0m`); log('─'.repeat(s.length)) }

  await withTenant(rid, async () => {
    head(COMMIT ? 'STOCK SHEET IMPORT — COMMITTING'
      : REHEARSE ? 'STOCK SHEET IMPORT — REHEARSAL (runs for real, then rolls back)'
      : 'STOCK SHEET IMPORT — DRY RUN (parses and validates only)')

    // ── read and normalise everything before touching the database ────────
    const master = readMaster()
    const ledger = readLedger()
    const payments = readPayments()
    const count = readCount()

    log(`source: ${DIR}`)
    log(`  master        ${master.items.length + master.dupes.length} rows -> ${master.items.length} distinct codes`)
    log(`  ledger        ${ledger.length} lines`)
    log(`  payments      ${payments.length} rows`)
    log(`  stock count   ${count.lines.length} lines with a quantity`)

    // ── the database as it stands ─────────────────────────────────────────
    const [state] = await tsql<{ items: number; purchases: number; lines: number; payments: number; counts: number; adjustments: number }[]>`
      select (select count(*) from items where restaurant_id = ${rid})::int items,
             (select count(*) from purchases where restaurant_id = ${rid})::int purchases,
             (select count(*) from purchase_lines where restaurant_id = ${rid})::int lines,
             (select count(*) from payments where restaurant_id = ${rid})::int payments,
             (select count(*) from stock_counts where restaurant_id = ${rid})::int counts,
             (select count(*) from stock_adjustments where restaurant_id = ${rid})::int adjustments`
    log(`\ndatabase now: ${state.items} items · ${state.purchases} bills · ${state.lines} lines · ${state.payments} payments · ${state.counts} counts · ${state.adjustments} adjustments`)

    // AN IMPORT THAT CAN RUN TWICE WILL. purchases, payments and
    // stock_adjustments are INSERT-only and kb_app holds no DELETE, so a
    // second run cannot be undone — it would double the books permanently.
    if (COMMIT && (state.purchases > 0 || state.payments > 0 || state.counts > 0)) {
      throw new ImportError(
        `Refusing to run: the ledger already holds ${state.purchases} bills, ${state.payments} payments and ${state.counts} counts. ` +
        'These tables are append-only with no DELETE grant, so a second import could not be undone.',
      )
    }

    const vendors = new Map((await tsql<{ code: string; id: string }[]>`
      select code, id from vendors where restaurant_id = ${rid}`).map((v) => [v.code, v.id]))
    const existing = new Map((await tsql<{ code: string; id: string }[]>`
      select code, id from items where restaurant_id = ${rid}`).map((i) => [i.code, i.id]))

    // ═══════════════════════════════════════════════ validate against the DB
    head('Validation')
    const problems: string[] = []

    for (const l of ledger) {
      if (!vendors.has(l.vendorCode)) problems.push(`Ledger row ${l.sheetRow}: vendor ${l.vendorCode} is not in the vendor master`)
    }
    for (const p of payments) {
      if (!vendors.has(p.vendorCode)) problems.push(`Payments row ${p.sheetRow}: vendor ${p.vendorCode} is not in the vendor master`)
    }
    const masterCodes = new Set(master.items.map((m) => m.code))
    for (const l of ledger) {
      if (!masterCodes.has(l.itemCode)) problems.push(`Ledger row ${l.sheetRow}: item ${l.itemCode} is in no master row`)
    }
    for (const c of count.lines) {
      if (!masterCodes.has(c.itemCode)) problems.push(`Stock Count row ${c.sheetRow}: item ${c.itemCode} is in no master row`)
    }
    if (problems.length > 0) {
      problems.slice(0, 20).forEach((p) => log(`  ✗ ${p}`))
      if (problems.length > 20) log(`  … and ${problems.length - 20} more`)
      throw new ImportError(`${problems.length} references do not resolve — nothing was written`)
    }
    log('  ✓ every vendor code, item code and unit in all four tabs resolves')

    // ═════════════════════════════════════════════════════ what will be done
    // PLT-0012 -> PLT-012, decided with Rajesh. items.code has no UPDATE
    // grant and kb_app no DELETE, so the old row cannot be renamed or
    // removed; it is RETIRED (status is updatable) and the six ledger lines
    // point at the new code. Purchases are still empty, which is the only
    // moment this costs nothing.
    const RENAME_FROM = 'PLT-0012'
    const RENAME_TO = 'PLT-012'
    const renameSource = existing.has(RENAME_FROM) ? master.items.find((m) => m.code === RENAME_TO) : undefined
    const toCreate = master.items.filter((m) => !existing.has(m.code) && m.code !== RENAME_TO)
    const needsRename = existing.has(RENAME_FROM) && !existing.has(RENAME_TO)

    log(`\n  items to create      ${toCreate.length + (needsRename ? 1 : 0)}`)
    log(`  items already there  ${master.items.length - toCreate.length - (needsRename ? 1 : 0)}`)
    if (needsRename) log(`  ${RENAME_FROM} -> ${RENAME_TO} (new row; ${RENAME_FROM} retired)`)
    for (const d of master.dupes) {
      log(`  ⚠ NOT LOADED  ${d.dropped.name} (sheet row ${d.dropped.sheetRow}) — its code ${d.code} already belongs to ${d.keptName} (row ${d.keptRow})`)
    }
    for (const s of count.skipped) log(`  ⚠ count line for ${s} skipped — the code appears twice in the sheet`)
    const noRate = master.items.filter((m) => m.openingRate === null)
    for (const m of noRate) log(`  ⚠ ${m.code} ${m.name} has no opening rate — un-issuable until a bill exists`)

    // ─ bills ─
    type Bill = { date: string; vendorCode: string; billNo: string; lines: LedgerLine[] }
    const billMap = new Map<string, Bill>()
    for (const l of ledger) {
      const key = `${l.date}|${l.vendorCode}|${l.billNo}`
      let b = billMap.get(key)
      if (!b) { b = { date: l.date, vendorCode: l.vendorCode, billNo: l.billNo, lines: [] }; billMap.set(key, b) }
      b.lines.push(l)
    }
    // Date order, so the PUR series ascends with the bill dates it numbers.
    const bills = [...billMap.values()].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 :
      a.vendorCode < b.vendorCode ? -1 : a.vendorCode > b.vendorCode ? 1 :
      a.billNo < b.billNo ? -1 : a.billNo > b.billNo ? 1 : 0)

    let goods = 0n, gst = 0n, transport = 0n
    for (const b of bills) for (const l of b.lines) { goods += mul(l.qty, l.rate); gst += l.gst; transport += l.transport }
    const paid = payments.reduce((a, p) => a + p.amount, 0n)

    log(`\n  bills                ${bills.length}  (${ledger.length} lines, ${new Set(bills.map((b) => b.vendorCode)).size} vendors)`)
    log(`    goods              ${money(goods)}`)
    log(`    GST                ${money(gst)}    on ${ledger.filter((l) => l.gst !== 0n).length} lines`)
    log(`    transport          ${money(transport)}`)
    log(`    landed             ${money(goods + gst + transport)}`)
    log(`  payments             ${payments.length}   ${money(paid)}`)
    const nonZero = count.lines.filter((c) => c.qty !== 0n).length
    log(`  opening count        ${count.lines.length} lines (${nonZero} with stock, ${count.lines.length - nonZero} counted zero) dated ${COUNT_DATE}`)


    if (!COMMIT && !REHEARSE) {
      log('\nDRY RUN — nothing was written. Rehearse with --rehearse, then write with --commit.')
      return
    }

    // ══════════════════════════════════════════════ ONE TRANSACTION, ALL OF IT
    //
    // Four transactions, one per stage, would have been the app's own shape —
    // but the app is not doing this. If stage 3 failed here, stages 1 and 2
    // would already be committed, and an ACCEPTED count cannot be re-run:
    // stock_counts and stock_adjustments are append-only with no DELETE grant,
    // and the guard at the top of this script would then refuse the retry.
    // All-or-nothing is the only recoverable shape.
    //
    // It is also what makes --rehearse possible: the same fourteen hundred
    // statements against live data, then a throw. A dry run proves the parser;
    // only a rehearsal proves the inserts.
    //
    // Every read inside is on `tx`, never `tsql`. A tsql within a txn callback
    // opens a SECOND connection while this one is held — the shape the tenancy
    // gate refuses, and the shape that deadlocked the pool once already. It is
    // also necessary rather than merely tidy: the views must see this
    // transaction's own uncommitted rows.
    class Rehearsed extends Error {}
    const t0 = Date.now()
    try {
      await txn(async (tx) => {
        await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

        // ════════════════════════════════════════════════════ 1 · items
        head('1 · Items')
        const rows = toCreate.map((m) => ({
          restaurant_id: rid, code: m.code, name: m.name, category: catOf(m.code),
          purchase_unit: m.purchaseUnit, stock_unit: m.stockUnit,
          conversion_factor: m.conversionFactor,
          // Sent as text so a null in the first row cannot make postgres.js
          // infer the column type for the whole batch; numeric takes it.
          opening_rate: m.openingRate, brand: m.brand,
        }))
        for (let i = 0; i < rows.length; i += 100) {
          await tx`insert into items ${tx(rows.slice(i, i + 100), 'restaurant_id', 'code', 'name', 'category', 'purchase_unit', 'stock_unit', 'conversion_factor', 'opening_rate', 'brand')}`
        }
        if (needsRename) {
          if (!renameSource) throw new ImportError(`${RENAME_TO} is not in the master — cannot rebuild ${RENAME_FROM}`)
          await tx`insert into items (restaurant_id, code, name, category, purchase_unit, stock_unit, conversion_factor, opening_rate, brand)
                   values (${rid}, ${RENAME_TO}, ${renameSource.name}, ${catOf(RENAME_TO)}, ${renameSource.purchaseUnit},
                           ${renameSource.stockUnit}, ${renameSource.conversionFactor}, ${renameSource.openingRate}, ${renameSource.brand})`
          const [ret] = await tx<{ id: string }[]>`
            update items set status = 'inactive'
            where restaurant_id = ${rid} and code = ${RENAME_FROM} returning id`
          if (!ret) throw new ImportError(`could not retire ${RENAME_FROM}`)
        }
        const items = new Map((await tx<{ code: string; id: string }[]>`
          select code, id from items where restaurant_id = ${rid} and status = 'active'`).map((i) => [i.code, i.id]))
        log(`  ✓ ${toCreate.length + (needsRename ? 1 : 0)} created · ${items.size} active items`)

        // ═══════════════════════════════════════════ 2 · opening stock count
        head('2 · Opening stock count')
        const [c] = await tx<{ id: string }[]>`
          insert into stock_counts (restaurant_id, count_date, note, entered_by)
          values (${rid}, ${COUNT_DATE}, ${'Opening stock — imported from the Stock Management sheet'}, ${ENTERED_BY})
          returning id`
        const countId = c.id

        // book_qty and unit_cost are FROZEN from the same two views saveCount
        // reads, one statement per line, so each frozen value is what the
        // views actually held at that instant. The book is empty here by
        // construction — no purchase has been written yet in this transaction
        // — so every book_qty comes back 0 and every unit_cost is the item's
        // own opening_rate. That is why the count comes before the bills.
        for (const l of count.lines) {
          const itemId = items.get(l.itemCode)
          if (!itemId) throw new ImportError(`count line: item ${l.itemCode} not found after the item load`)
          const [snap] = await tx<{ book_qty: string; unit_cost: string | null }[]>`
            select coalesce(s.on_hand_qty, 0)::text as book_qty, ic.issue_cost::text as unit_cost
            from items i
            left join stock_on_hand s on s.item_id = i.id
            left join item_costs ic on ic.item_id = i.id
            where i.id = ${itemId} and i.restaurant_id = ${rid} and i.status = 'active'`
          if (!snap) throw new ImportError(`count line: ${l.itemCode} is not an active item`)
          await tx`
            insert into stock_count_lines (restaurant_id, count_id, item_id, counted_qty, book_qty, unit_cost, counted_by)
            values (${rid}, ${countId}, ${itemId}, ${str(l.qty)}::numeric, ${snap.book_qty}::numeric,
                    ${snap.unit_cost ?? '0'}::numeric, ${ENTERED_BY})`
        }
        const [saved] = await tx<{ n: number; book: string }[]>`
          select count(*)::int n, coalesce(sum(book_qty), 0)::text book
          from stock_count_lines where count_id = ${countId} and restaurant_id = ${rid}`
        log(`  ✓ count ${countId} · ${saved.n} lines`)
        // THE ASSERTION THAT HOLDS THE ORDER IN PLACE. If a purchase ever
        // moves above this point, every book_qty freezes at what was bought
        // and accepting the count writes a large negative correction that
        // erases it. A sum of zero is the proof that the book was empty.
        if (saved.book !== '0') {
          throw new ImportError(`the book was NOT empty at count time (sum of book_qty = ${saved.book}) — the opening count must precede the purchases`)
        }

        // ── accept it ─────────────────────────────────────────────────────
        // acceptCount() hardcodes reason 'Count correction'. That word is
        // wrong for 228 rows that correct nothing — they ESTABLISH the book.
        // 'Opening stock' is an active value in the adjustment_reason list.
        // The arithmetic is acceptCount's verbatim, prior-adjustments clause
        // included: it finds nothing here, and copying it means this behaves
        // the same way if it ever does.
        const [{ n: adjustments }] = await tx<{ n: number }[]>`
          with prior as (
            select a.item_id, coalesce(sum(a.qty), 0) as already
            from stock_adjustments a
            join stock_counts c2 on c2.id = ${countId}
            where a.restaurant_id = ${rid}
              and a.created_at >= c2.created_at
              and a.count_id is distinct from ${countId}::uuid
            group by a.item_id
          ),
          ins as (
            insert into stock_adjustments
              (restaurant_id, adj_date, item_id, qty, unit_cost, reason, count_id, note, entered_by)
            select ${rid}::uuid, ${COUNT_DATE}::date, l.item_id,
                   l.variance_qty - coalesce(p.already, 0), l.unit_cost,
                   'Opening stock'::text, ${countId}::uuid, null, ${ENTERED_BY}::text
            from stock_count_lines l
            left join prior p on p.item_id = l.item_id
            where l.count_id = ${countId}
              and l.variance_qty - coalesce(p.already, 0) <> 0
            returning 1
          ) select count(*)::int as n from ins`
        const [stamped] = await tx<{ id: string }[]>`
          update stock_counts set accepted_at = now(), accepted_by = ${ENTERED_BY}
          where id = ${countId} and restaurant_id = ${rid} and accepted_at is null returning id`
        if (!stamped) throw new ImportError('the acceptance could not be stamped')
        log(`  ✓ accepted · ${adjustments} stock_adjustments with reason 'Opening stock'`)

        // ════════════════════════════════════════════════════ 3 · purchases
        head('3 · Purchases')
        const { fyLabel, parseFyStartMonth } = await import('../src/lib/fy')
        const [fy] = await tx<{ value: string }[]>`
          select value from settings where restaurant_id = ${rid} and key = 'fy_start_month'`
        const startMonth = parseFyStartMonth(fy?.value ?? null)
        for (const b of bills) {
          let g = 0n, t = 0n, gs = 0n
          for (const l of b.lines) { g += mul(l.qty, l.rate); gs += l.gst; t += l.transport }
          // Drawn on the same transaction as the row it numbers, and on the
          // BILL DATE, so a June bill lands in the FY June falls in.
          const [{ next_doc_no: docNo }] = await tx<{ next_doc_no: string }[]>`
            select next_doc_no(${rid}, ${'PUR'}, ${fyLabel(b.date, startMonth)}) as next_doc_no`
          const [purchase] = await tx<{ id: string }[]>`
            insert into purchases (restaurant_id, bill_date, vendor_id, bill_no, doc_no, goods_total, gst_total, transport, entered_by)
            values (${rid}, ${b.date}, ${vendors.get(b.vendorCode)!}, ${b.billNo}, ${docNo},
                    ${str(g)}::numeric, ${str(gs)}::numeric, ${str(t)}::numeric, ${ENTERED_BY})
            returning id`
          // GST GOES ON THE HEADER, NOT THE LINE, and gst_amount stays 0.
          //
          // purchase_lines.landed is GENERATED as qty*rate + gst_amount +
          // transport_alloc, and item_costs.issue_cost is landed/qty — so GST
          // on a line changes what every recipe and every issue costs. The
          // app's own bill flow writes gst_amount 0 and carries GST on
          // purchases.gst_total; per-line GST entry is a deliberately deferred
          // phase. Written per line here, the 90 GST lines would be the only
          // rows in the ledger costed on a different basis from every bill
          // entered afterwards, and no screen would say so. bill_total,
          // vendor_dues and the P&L all read the header, so the money is
          // identical either way — only the cost basis would have diverged.
          //
          // Transport is the sheet's OWN per-line figure, not allocateTransport:
          // the sheet already apportioned it, and re-deriving a split it
          // already states would be this app disagreeing with its source.
          const lineRows = b.lines.map((l) => ({
            restaurant_id: rid, purchase_id: purchase.id, item_id: items.get(l.itemCode)!,
            qty: str(l.qty), rate: str(l.rate), gst_amount: '0', transport_alloc: str(l.transport),
          }))
          await tx`insert into purchase_lines ${tx(lineRows, 'restaurant_id', 'purchase_id', 'item_id', 'qty', 'rate', 'gst_amount', 'transport_alloc')}`
        }
        log(`  ✓ ${bills.length} bills · ${ledger.length} lines`)

        // ════════════════════════════════════════════════════ 4 · payments
        head('4 · Payments')
        for (const p of payments) {
          const [{ next_doc_no: docNo }] = await tx<{ next_doc_no: string }[]>`
            select next_doc_no(${rid}, ${'PAY'}, ${fyLabel(p.date, startMonth)}) as next_doc_no`
          // account_id is NULL, and that is the documented case rather than a
          // shortcut: the column is nullable precisely because history predates
          // money accounts. The sheet records a MODE — Cash, Bank Transfer —
          // and never an account, and this restaurant has no cash account at
          // all, so naming one would be inventing the journey. vendor_dues
          // reads payments directly, so every balance is right; these rows
          // simply reach no cash or bank register until somebody says which.
          const note = [p.ref, p.note].filter((s) => s !== '').join(' · ')
          await tx`
            insert into payments (restaurant_id, paid_date, vendor_id, amount, mode, note, account_id, doc_no, entered_by)
            values (${rid}, ${p.date}, ${vendors.get(p.vendorCode)!}, ${str(p.amount)}::numeric,
                    ${p.mode}, ${note === '' ? null : note}, null, ${docNo}, ${ENTERED_BY})`
        }
        log(`  ✓ ${payments.length} payments · ${money(paid)}`)

        // ═══════════════════════════ 5 · verify, INSIDE the transaction
        //
        // Inside, so a mismatch rolls the whole import back rather than
        // reporting a fault in data that is already committed. Every figure is
        // compared against the SHEET's own — recomputed here from the source
        // rows in exact decimal — never against another number this script
        // wrote.
        head('5 · Verification — read back against the sheet')
        let bad = 0
        // POSTGRES NUMERIC PRESERVES SCALE, and the sheet does not.
        // purchase_lines.amount is generated as qty × rate, so its scale is
        // scale(qty)+scale(rate) and the sum reads 1796960.250 where the sheet
        // says 1796960.25 — the same value in two written forms. Trimming
        // trailing zeros off the fraction is value-preserving: it cannot make
        // two different numbers agree, only two spellings of one number. Both
        // sides go through it, so neither is rounded to meet the other.
        const norm = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s)
        const cmp = (label: string, sheet: string, db: string) => {
          const ok = norm(sheet) === norm(db)
          if (!ok) bad++
          log(`  ${ok ? '✓' : '✗'} ${label.padEnd(38)} sheet ${sheet.padStart(15)}   db ${db.padStart(15)}`)
        }
        // ONE HEADER PER BILL, COUNTED ONCE.
        //
        // The first version of this joined purchases to purchase_lines and
        // summed the header columns over the joined rows — so a five-line bill
        // contributed its goods_total five times and the total came out at
        // ₹74 lakh against the sheet's ₹17.9 lakh. It was caught by the
        // rehearsal rather than by reading, which is the argument for having
        // one. Header sums come from `purchases` alone; the line count comes
        // from `purchase_lines` alone; nothing is aggregated across a join.
        const [tot] = await tx<{ bills: string; lines: string; goods: string; gst: string; transport: string; landed: string }[]>`
          select (select count(*) from purchases where restaurant_id = ${rid})::text bills,
                 (select count(*) from purchase_lines where restaurant_id = ${rid})::text lines,
                 (select coalesce(sum(goods_total), 0) from purchases where restaurant_id = ${rid})::text goods,
                 (select coalesce(sum(gst_total), 0) from purchases where restaurant_id = ${rid})::text gst,
                 (select coalesce(sum(transport), 0) from purchases where restaurant_id = ${rid})::text transport,
                 (select coalesce(sum(bill_total), 0) from purchases where restaurant_id = ${rid})::text landed`
        cmp('bills', String(bills.length), tot.bills)
        cmp('purchase lines', String(ledger.length), tot.lines)
        cmp('goods total', str(goods), tot.goods)
        cmp('GST total', str(gst), tot.gst)
        cmp('transport total', str(transport), tot.transport)
        cmp('landed total (bill_total)', str(goods + gst + transport), tot.landed)
        // The GENERATED columns, checked independently of the headers written
        // above. If GST had leaked onto a line, landed would exceed goods +
        // transport and this is what would say so.
        const [lineSum] = await tx<{ amount: string; landed: string }[]>`
          select sum(amount)::text amount, sum(landed)::text landed
          from purchase_lines where restaurant_id = ${rid}`
        cmp('sum(lines.amount)', str(goods), lineSum.amount)
        cmp('sum(lines.landed)', str(goods + transport), lineSum.landed)

        const [pay] = await tx<{ n: string; amount: string }[]>`
          select count(*)::text n, coalesce(sum(amount), 0)::text amount
          from payments where restaurant_id = ${rid}`
        cmp('payments', String(payments.length), pay.n)
        cmp('payments total', str(paid), pay.amount)

        const sheetOpening = count.lines.reduce((a, l) => {
          const m = master.items.find((x) => x.code === l.itemCode)!
          return a + (m.openingRate === null ? 0n : mul(l.qty, dec(m.openingRate, m.code)))
        }, 0n)
        const [cnt] = await tx<{ n: string; counted: string; value: string; adj: string; adjvalue: string }[]>`
          select (select count(*) from stock_count_lines where count_id = ${countId})::text n,
                 (select count(*) from stock_count_lines where count_id = ${countId} and counted_qty <> 0)::text counted,
                 (select coalesce(sum(counted_qty * unit_cost), 0) from stock_count_lines where count_id = ${countId})::text value,
                 (select count(*) from stock_adjustments where count_id = ${countId})::text adj,
                 (select coalesce(sum(value), 0) from stock_adjustments where count_id = ${countId})::text adjvalue`
        cmp('count lines', String(count.lines.length), cnt.n)
        cmp('count lines with stock', String(nonZero), cnt.counted)
        cmp('adjustments written', String(nonZero), cnt.adj)
        cmp('opening stock value', str(sheetOpening), cnt.value)
        cmp('adjusted value = counted value', cnt.value, cnt.adjvalue)

        const [item] = await tx<{ n: string; retired: string }[]>`
          select (select count(*) from items where restaurant_id = ${rid} and status = 'active')::text n,
                 (select count(*) from items where restaurant_id = ${rid} and status = 'inactive')::text retired`
        cmp('active items', String(master.items.length), item.n)
        cmp('retired items', needsRename ? '1' : '0', item.retired)

        // Per month, against the sheet's own _owner tab: 2026-06 one bill of
        // ₹8,594 and 2026-07 six bills of ₹25,146.85. An independent witness —
        // those figures were computed by the sheet, not by this script.
        const byMonth = new Map<string, bigint>()
        const billsByMonth = new Map<string, number>()
        for (const b of bills) {
          const m = b.date.slice(0, 7)
          billsByMonth.set(m, (billsByMonth.get(m) ?? 0) + 1)
          for (const l of b.lines) byMonth.set(m, (byMonth.get(m) ?? 0n) + mul(l.qty, l.rate) + l.gst + l.transport)
        }
        const dbMonths = await tx<{ m: string; v: string; n: string }[]>`
          select to_char(bill_date, 'YYYY-MM') m, sum(bill_total)::text v, count(*)::text n
          from purchases where restaurant_id = ${rid} group by 1 order by 1`
        for (const r of dbMonths) {
          cmp(`landed ${r.m}`, str(byMonth.get(r.m) ?? 0n), r.v)
          cmp(`bills  ${r.m}`, String(billsByMonth.get(r.m) ?? 0), r.n)
        }

        // Stock now = opening + purchased, item by item, against the sheet.
        const [shelf] = await tx<{ mismatches: string }[]>`
          with sheet as (
            select i.id,
                   coalesce((select sum(l.counted_qty) from stock_count_lines l where l.item_id = i.id), 0)
                 + coalesce((select sum(pl.qty) from purchase_lines pl where pl.item_id = i.id), 0) as expected
            from items i where i.restaurant_id = ${rid}
          )
          select count(*)::text mismatches
          from sheet s join stock_on_hand h on h.item_id = s.id
          where h.on_hand_qty <> s.expected`
        cmp('items where on-hand <> counted+purchased', '0', shelf.mismatches)

        // ── the price spot-check ──────────────────────────────────────────
        //
        // THE ONE THE BRIEF ASKED FOR IS NOT IN THIS SHEET. It asked that RR
        // Chicken's Chicken Boneless "still show ₹310 then ₹330". Searched
        // across all 1,101 ledger lines: no poultry line anywhere carries
        // either rate. RR Chicken bought a boneless item exactly once — PLT-004
        // Chicken Leg Boneless, 8 Aug, 9.98 kg at ₹305 — so there is no second
        // bill for a movement to be measured against. Those figures were
        // measured on a different state of the database during the Phase B
        // price-variance work; the ledger being imported does not contain them.
        //
        // What the sheet DOES contain tests the same view harder, so that is
        // what is asserted:
        //
        //   1. PLT-004 is bought from TWO vendors at TWO prices — RR at ₹305
        //      once, Sneha at ₹315 twenty-three times. RR's single line must
        //      read "first bill from this vendor" and must NOT report −₹10
        //      against Sneha's rate. That is exactly the cross-vendor
        //      comparison AGENTS.md records as a live bug, and an assertion
        //      that it does not happen is stronger than re-reading a movement.
        //
        //   2. RR Chicken · Chicken Whole Birds is a genuine eleven-bill rate
        //      chain, 211 → 231 → 221 → 205 → 195 → 179 → 185, which is what a
        //      real price movement looks like.
        head('Price movements — the spot-check')
        const cross = await tx<{ vendor: string; bill_date: string; rate: string; previous_rate: string | null }[]>`
          select vendor_name as vendor, bill_date::text as bill_date, rate::text as rate,
                 previous_rate::text as previous_rate
          from price_movements
          where restaurant_id = ${rid} and item_code = 'PLT-004'
          order by bill_date, vendor_name`
        const rr = cross.filter((m) => m.vendor.toUpperCase().includes('RR CHICKEN'))
        log(`  PLT-004 Chicken Leg Boneless is bought from ${new Set(cross.map((m) => m.vendor)).size} vendors`)
        cmp('RR Chicken rows for PLT-004', '1', String(rr.length))
        cmp('RR Chicken rate', '305', rr[0]?.rate ?? '(none)')
        // The whole point: NULL, not a comparison against Sneha's ₹315.
        cmp('RR Chicken previous_rate (per vendor)', '(none)', rr[0]?.previous_rate ?? '(none)')
        const sneha = cross.filter((m) => m.vendor.toUpperCase().includes('SNEHA'))
        cmp('Sneha rows for PLT-004', '23', String(sneha.length))
        cmp('Sneha holds one rate throughout', '315', [...new Set(sneha.map((m) => m.rate))].join('/'))

        head('RR Chicken · Chicken Whole Birds — a real movement chain')
        const chain = await tx<{ bill_date: string; rate: string; previous_rate: string | null; pct: string | null; cost: string | null }[]>`
          select bill_date::text as bill_date, rate::text as rate, previous_rate::text as previous_rate,
                 change_pct::text as pct, cost_of_change::text as cost
          from price_movements
          where restaurant_id = ${rid} and item_code = 'PLT-008' and vendor_name ilike '%RR CHICKEN%'
          order by bill_date`
        for (const m of chain) {
          log(`  ${m.bill_date}  ₹${m.rate.padStart(6)}${m.previous_rate ? `   was ₹${m.previous_rate}   ${m.pct}%   cost of change ${money(dec(m.cost ?? '0', 'cost'))}` : '   — first bill from this vendor'}`)
        }
        cmp('movement rows in the chain', '11', String(chain.length))
        cmp('chain opens with no previous rate', '(none)', chain[0]?.previous_rate ?? '(none)')
        cmp('chain opens at', '211', chain[0]?.rate ?? '(none)')

        log()
        if (bad > 0) throw new ImportError(`${bad} verification checks FAILED — rolling back, nothing was written`)
        log(`\x1b[32mAll verification checks passed\x1b[0m  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
        if (REHEARSE) throw new Rehearsed('rehearsal complete')
      })
    } catch (e) {
      if (e instanceof Rehearsed) {
        log('\n\x1b[33mREHEARSAL — the transaction was rolled back. Nothing was written.\x1b[0m')
        log('Re-run with --commit to keep it.')
      } else throw e
    }
  })

  await sql.end()
}

main().catch((e) => {
  console.error(`\n\x1b[31m${e instanceof ImportError ? e.message : e}\x1b[0m`)
  process.exit(1)
})
