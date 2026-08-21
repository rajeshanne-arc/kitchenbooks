// THE TENANCY AUDIT. Three questions, because tenancy fails in three ways.
//
// 1. WRITES — every insert into a tenant table must NAME the tenant, and
//    every update/delete must say whose row it is touching.
//
//    This tier exists because of a real, live outage. Migration
//    `tenant_column_on_line_tables_and_unique_usernames` put a NOT NULL
//    restaurant_id on 15 line tables; nine multi-line inserts in the app
//    never learned to fill it. Nothing noticed. Every other gate stayed
//    green — including the smoke suites, which write their OWN sql and
//    therefore named the tenant where the app did not. A probe that writes
//    its own insert cannot test the app's column list. The column list is
//    in the source, so it is checked in the source.
//
//    Under RLS the symptom was total: "new row violates row-level security
//    policy" on every bill, issue, return, indent, closing and POS ingest.
//    This tier is a HARD failure, --strict or not.
//
// 2. READS — a statement on a tenant table must either filter on
//    restaurant_id, or be KEYED by a uuid it was already handed. A keyed
//    read cannot be steered to another tenant's row by a URL, because RLS
//    makes that row invisible first. An UNKEYED read — a list, a scan —
//    with no tenant named is the real leak, and is what --strict fails on.
//
// 3. RLS — the keyed exemption in tier 2 rests entirely on the policies
//    being on. So the gate asserts that, rather than assuming it. If RLS
//    is ever dropped from a table, the exemption stops being true and this
//    gate says so on the same run.
//
// It stays conservative about what it calls a leak:
//
//   - LINE tables reached through a parent are judged on their parent when
//     they carry no restaurant_id of their own.
//   - categories, units and starter_library are GLOBAL masters, shared by
//     every tenant on purpose. Reading them unfiltered is correct.
//   - restaurants itself is the tenant list.
//
// Run: npm run audit:tenancy [--strict]

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.loadEnvFile('.env.local')

/** Shared by every tenant on purpose — reading these unfiltered is correct. */
const GLOBAL = new Set(['categories', 'units', 'starter_library'])
/** The tenant list itself. */
const TENANT_TABLE = 'restaurants'

const SQL_NOISE = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'as', 'on', 'join', 'left', 'right', 'inner',
  'outer', 'full', 'cross', 'group', 'by', 'order', 'having', 'limit', 'offset', 'asc', 'desc', 'insert',
  'into', 'values', 'update', 'set', 'delete', 'returning', 'with', 'union', 'all', 'distinct', 'lateral',
  'recursive', 'exists', 'case', 'when', 'then', 'else', 'end', 'using', 'conflict', 'do', 'nothing',
])

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

type Stmt = { file: string; sql: string; holes: string; line: number }

/** Pull out sql`…` / tx`…` bodies with ${…} holes marked. */
function extract(file: string, src: string): Stmt[] {
  const out: Stmt[] = []
  // tsql TOO. When every read was renamed sql -> tsql for the tenancy GUC,
  // this regex stopped matching them and the gate quietly fell from 2088
  // column references to 234 — still green, checking almost nothing. That is
  // the "an assertion that cannot fail has not been tested" rule biting the
  // instrument that enforces it, so the count is now printed and watched.
  const re = /\b(?:tsql|sql|tx)\s*(?:<[^`]*?>)?\s*`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length
    let body = ''
    const holes: string[] = []
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '\\') { i++; continue }
      if (c === '$' && src[i + 1] === '{') {
        let depth = 1
        const start = i + 2
        i += 2
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '{') depth++
          else if (src[i] === '}') depth--
        }
        // THE COLUMN LIST CAN LIVE IN THE HOLE. `tx(rows, 'restaurant_id', …)`
        // is where a dynamic insert names its columns, so the hole's text is
        // kept — dropping it is how nine broken inserts read as fine.
        holes.push(src.slice(start, i - 1))
        i--
        body += ' ? '
        continue
      }
      if (c === '`') break
      body += c
    }
    out.push({ file, sql: body, holes: holes.join(' '), line: src.slice(0, m.index).split('\n').length })
  }
  return out
}

/** Keyed by a uuid it was already handed — `where id = ${x}`,
 *  `where indent_id = ${x}`, `id = any(${xs})`. The hole is already ` ? `. */
const KEYED = /\b(?:[a-z_]+\.)?(?:id|[a-z_]+_id)\s*(?:=|in)\s*(?:any\s*\()?\s*\?/i

function writeKindOf(sqlText: string): 'insert' | 'update' | 'delete' | null {
  if (/\binsert\s+into\b/i.test(sqlText)) return 'insert'
  if (/\bupdate\s+[a-z_]/i.test(sqlText)) return 'update'
  if (/\bdelete\s+from\b/i.test(sqlText)) return 'delete'
  return null
}

function relationsOf(sqlText: string): string[] {
  const rels: string[] = []
  const re = /\b(?:from|join|into|update)\s+([a-z_][a-z0-9_]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sqlText)) !== null) {
    const name = m[1].toLowerCase()
    if (!SQL_NOISE.has(name)) rels.push(name)
  }
  return [...new Set(rels)]
}

async function main() {
  const { sql } = await import('../src/lib/db')

  const cols = await sql<{ table_name: string }[]>`
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'restaurant_id'`
  const scoped = new Set(cols.map((c) => c.table_name))

  // src/app TOO. Both audits walked only src/server on the assumption that all
  // SQL lives there — but a page can import `sql` directly, and two did.
  // `/kitchen/departments` used a bare `sql` and so announced no tenant: under
  // RLS the policy cast an empty current_setting to uuid and the page 500'd on
  // every load, invisibly to a gate that never read the file.
  const files = [...walk('src/server'), ...walk('src/app')]
  const statements = files.flatMap((f) => extract(f, readFileSync(f, 'utf8')))

  type Leak = { file: string; line: number; relations: string[]; sql: string }
  const unkeyed: Leak[] = []
  const keyed: Leak[] = []
  const writes: Leak[] = []
  let checked = 0
  let filtered = 0
  let globalOnly = 0
  let lineOnly = 0

  for (const st of statements) {
    const clean = st.sql
      .replace(/--[^\n]*/g, ' ')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/'[^']*'/g, " '' ")
    const rels = relationsOf(clean)
    if (rels.length === 0) continue
    checked++

    const touchesScoped = rels.filter((r) => scoped.has(r) && r !== TENANT_TABLE)
    if (touchesScoped.length === 0) {
      if (rels.every((r) => GLOBAL.has(r) || r === TENANT_TABLE)) globalOnly++
      else lineOnly++
      continue
    }
    const row: Leak = {
      file: st.file,
      line: st.line,
      relations: touchesScoped,
      sql: st.sql.trim().replace(/\s+/g, ' ').slice(0, 110),
    }

    // A WRITE names the tenant in the statement OR in the hole that carries
    // its column list. Nothing else counts — an insert that merely sits next
    // to a scoped select is still an insert with a NULL tenant.
    const kind = writeKindOf(clean)
    if (kind === 'insert') {
      if (!/restaurant_id/i.test(st.sql + ' ' + st.holes)) writes.push(row)
      else filtered++
      continue
    }
    if (kind === 'update' || kind === 'delete') {
      if (!/restaurant_id/i.test(clean)) writes.push(row)
      else filtered++
      continue
    }

    if (/restaurant_id/i.test(clean)) {
      filtered++
      continue
    }
    ;(KEYED.test(clean) ? keyed : unkeyed).push(row)
  }

  // Tier 3: the keyed exemption is only true while the policies are on.
  const rls = await sql<{ table_name: string; enabled: boolean; forced: boolean; policies: number }[]>`
    select c.relname as table_name, c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
           (select count(*)::int from pg_policies p
             where p.schemaname = 'public' and p.tablename = c.relname) as policies
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ${sql([...scoped])}
    order by 1`
  const unprotected = rls.filter((t) => !t.enabled || !t.forced || t.policies === 0)

  const show = (title: string, rows: Leak[]) => {
    if (rows.length === 0) return
    console.log(`  ${title}`)
    const byFile = new Map<string, Leak[]>()
    for (const l of rows) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l])
    for (const [file, rs] of [...byFile.entries()].sort()) {
      console.log(`    ${file}`)
      for (const r of rs) console.log(`      :${r.line}  [${r.relations.join(', ')}]  ${r.sql}`)
    }
    console.log('')
  }

  console.log('\ntenancy gate — writes name the tenant, reads are scoped or keyed, RLS is on\n')
  console.log(`  ${statements.length} sql templates, ${checked} with a resolvable relation`)
  console.log(`  ${filtered} name restaurant_id`)
  console.log(`  ${lineOnly} touch only line tables (scoped through their parent)`)
  console.log(`  ${globalOnly} touch only global masters (categories, units, starter_library)`)
  console.log(`  ${keyed.length} read by a uuid key they were handed (RLS makes a foreign row invisible)`)
  console.log(`  ${unkeyed.length} READ A TENANT TABLE UNKEYED AND NAME NO TENANT`)
  console.log(`  ${writes.length} WRITE TO A TENANT TABLE WITHOUT NAMING IT\n`)

  show('WRITES WITH NO TENANT — these fail against RLS at runtime:', writes)
  show('UNKEYED READS WITH NO TENANT:', unkeyed)

  if (unprotected.length > 0) {
    console.log('  TABLES WITHOUT RLS — the keyed-read exemption above is NOT safe on these:')
    for (const t of unprotected) {
      console.log(`    ${t.table_name}  enabled=${t.enabled} forced=${t.forced} policies=${t.policies}`)
    }
    console.log('')
  } else {
    console.log(`  ✓ RLS enabled, forced and policied on all ${rls.length} tenant tables\n`)
  }

  // ── TIER 4: EVERY VIEW RUNS AS ITS CALLER ────────────────────────────
  //
  // THIS GATE WALKED 65 TABLES AND NEVER ONCE LOOKED AT A VIEW — the eighth
  // instance in this project of a check structurally incapable of finding
  // what it exists to find, and the most expensive one. A view without
  // `security_invoker` runs as its OWNER, which here is `postgres` with
  // BYPASSRLS: every policy on every base table is skipped and the view
  // hands back EVERY TENANT'S ROWS.
  //
  // Measured as kb_app with bypassrls off, announcing the probe tenant and
  // counting rows belonging to the live one: attendance_current 15,
  // labour_cost_daily 15, day_summary 11, vendor_supplied_items 7,
  // vendor_dues 5, vendor_performance 5, advances_outstanding 1, and six
  // more. Vendor balances, attendance and staff advances across the boundary.
  //
  // NINE MORE CARRIED THE SAME DEFECT AND DID NOT LEAK, which is worse than
  // leaking: they were saved by an INNER view that happens to be scoped
  // (sales_current joins latest_fetches, so the join came back empty). They
  // are one migration to a neighbouring view away from leaking too.
  //
  // The APP did not leak, because tier 2 above requires every read to name
  // its tenant — so it was protected by discipline and NOT by RLS, which is
  // exactly the backstop RLS exists to be.
  const views = await sql<{ relname: string; inv: boolean }[]>`
    select c.relname,
           coalesce((select true from pg_options_to_table(c.reloptions)
                     where option_name = 'security_invoker'
                       and lower(option_value) in ('on', 'true')), false) as inv
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
    order by c.relname`
  const invokerless = views.filter((v) => !v.inv).map((v) => v.relname)
  if (invokerless.length > 0) {
    console.log(`  ${invokerless.length} VIEWS RUN AS THEIR OWNER, NOT THEIR CALLER — these bypass RLS entirely:`)
    for (const v of invokerless) console.log(`    ${v}`)
    console.log('\n  Apply migrations/views_security_invoker.sql.\n')
  } else {
    console.log(`  ✓ all ${views.length} views run as their caller (security_invoker)\n`)
  }

  const strict = process.argv.includes('--strict')
  // Writes are a hard failure whatever the flags say: an insert with no
  // tenant does not leak data, it loses it — the save simply refuses.
  const fatal =
    writes.length > 0 ||
    (strict && (unkeyed.length > 0 || unprotected.length > 0 || invokerless.length > 0))
  if (!fatal && writes.length === 0 && unkeyed.length === 0) {
    console.log('  ✓ every query on a tenant table says which tenant it means\n')
  }
  process.exit(fatal ? 1 : 0)
}

void main()
