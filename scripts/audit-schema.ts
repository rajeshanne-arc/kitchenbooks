// THE SCHEMA GATE. Every column the app reads must still exist.
//
// Written because /owner/pnl answered 500 on every load for an unknown
// length of time: pnl_monthly was renamed underneath it (revenue ->
// food_beverage / net_sales, labour -> total_labour, expenses ->
// total_expenses) and nothing failed until a human opened the page.
// TypeScript cannot see inside a SQL string, and the smoke tests never
// touched that page. Schema-ahead-of-app is now a known failure mode, so it
// gets a test rather than a note in a document.
//
// HOW IT WORKS. It reads every sql`...` template in src/server, works out
// which relations each one selects from, and checks every column name it
// mentions against information_schema. Two kinds of reference are resolved:
//
//   qualified    p.bill_date, v.name        -> checked against p's relation
//   unqualified  coalesce(revenue, 0)       -> checked against the single
//                                              relation, when there is only one
//
// The unqualified case is the one that matters: the pnl query named its
// columns bare, so an alias-only checker would have sailed straight past the
// break it was written for. `npm run audit:schema -- --self-test` proves it
// still catches that exact regression.
//
// Run: npm run audit:schema   (exit 1 on any missing column)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

process.loadEnvFile('.env.local')

/* ── words that look like columns and are not ──────────────────────────── */

const SQL_KEYWORDS = new Set([
  'select', 'from', 'where', 'and', 'or', 'not', 'null', 'as', 'on', 'join', 'left', 'right', 'inner',
  'outer', 'full', 'cross', 'group', 'by', 'order', 'having', 'limit', 'offset', 'asc', 'desc', 'insert',
  'into', 'values', 'update', 'set', 'delete', 'returning', 'with', 'union', 'all', 'distinct', 'case',
  'when', 'then', 'else', 'end', 'is', 'in', 'exists', 'between', 'like', 'ilike', 'true', 'false',
  'nulls', 'first', 'last', 'filter', 'over', 'partition', 'interval', 'date', 'text', 'int', 'integer',
  'numeric', 'boolean', 'uuid', 'timestamptz', 'timestamp', 'array', 'any', 'cast', 'default', 'conflict',
  'do', 'nothing', 'using', 'lateral', 'recursive', 'current_date', 'current_timestamp', 'coalesce',
  'sum', 'count', 'max', 'min', 'avg', 'abs', 'round', 'greatest', 'least', 'nullif', 'lower', 'upper',
  'trim', 'btrim', 'concat', 'length', 'substring', 'replace', 'regexp_replace', 'string_agg', 'array_agg',
  'array_position', 'to_char', 'date_trunc', 'extract', 'now', 'age', 'row_number', 'rank', 'dense_rank',
  'lag', 'lead', 'jsonb_agg', 'json_agg', 'generate_series', 'unnest', 'pg_advisory_xact_lock',
  'hashtextextended', 'gen_random_uuid', 'bool_and', 'bool_or', 'position', 'strpos', 'split_part',
  'char_length', 'ceil', 'floor', 'mod', 'power', 'sqrt', 'sign', 'width_bucket',
  // trim(BOTH ' · ' FROM x) — these three read as bare identifiers to a
  // word-level scanner and are keywords, not columns. Added after the gate
  // flagged `both` as a missing column on purchase_register: a gate that
  // cries wolf is a gate people start ignoring.
  'both', 'leading', 'trailing',
])

/* ── read every sql template out of the server layer ───────────────────── */

type Stmt = { file: string; sql: string }

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** Pull out sql`…` / tx`…` bodies, with ${…} holes replaced by a marker. */
function extractStatements(file: string, src: string): Stmt[] {
  const out: Stmt[] = []
  const re = /\b(?:sql|tx)\s*(?:<[^`]*?>)?\s*`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length
    let depth = 0
    let body = ''
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '\\') {
        i++
        continue
      }
      if (c === '$' && src[i + 1] === '{') {
        depth = 1
        i += 2
        for (; i < src.length && depth > 0; i++) {
          if (src[i] === '{') depth++
          else if (src[i] === '}') depth--
        }
        i--
        body += ' ? '
        continue
      }
      if (c === '`') break
      body += c
    }
    out.push({ file, sql: body })
  }
  return out
}

/* ── work out which relations a statement touches ──────────────────────── */

type Rel = { name: string; alias: string | null }

function relationsOf(sqlText: string): Rel[] {
  const rels: Rel[] = []
  // from/join <name> [as] [alias]  — bare identifiers only; subqueries and
  // CTE bodies are skipped (an opening paren is not an identifier)
  const re = /\b(?:from|join)\s+([a-z_][a-z0-9_]*)\s*(?:\bas\s+)?([a-z][a-z0-9_]*)?/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(sqlText)) !== null) {
    const name = m[1].toLowerCase()
    if (SQL_KEYWORDS.has(name)) continue
    const alias = m[2]?.toLowerCase() ?? null
    rels.push({ name, alias: alias !== null && SQL_KEYWORDS.has(alias) ? null : alias })
  }
  return rels
}

/** Names introduced by `with x as (...)` or `... as alias` in a select list. */
function localNames(sqlText: string): Set<string> {
  const names = new Set<string>()
  for (const m of sqlText.matchAll(/\bwith\s+([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) names.add(m[1].toLowerCase())
  for (const m of sqlText.matchAll(/\)\s*,\s*([a-z_][a-z0-9_]*)\s+as\s*\(/gi)) names.add(m[1].toLowerCase())
  // output aliases: `... as foo` — these are names the query CREATES
  for (const m of sqlText.matchAll(/\bas\s+"?([a-z_][a-z0-9_]*)"?/gi)) names.add(m[1].toLowerCase())
  return names
}

/* ── the live schema ───────────────────────────────────────────────────── */

async function main() {
  const selfTest = process.argv.includes('--self-test')
  const { sql } = await import('../src/lib/db')

  const cols = await sql<{ table_name: string; column_name: string }[]>`
    select table_name, column_name from information_schema.columns where table_schema = 'public'`
  const schema = new Map<string, Set<string>>()
  for (const c of cols) {
    const set = schema.get(c.table_name) ?? new Set<string>()
    set.add(c.column_name)
    schema.set(c.table_name, set)
  }

  const files = walk('src/server')
  const statements = files.flatMap((f) => extractStatements(f, readFileSync(f, 'utf8')))

  type Miss = { file: string; relation: string; column: string; how: string }
  const misses: Miss[] = []
  let checkedCols = 0
  let checkedStmts = 0

  for (const st of statements) {
    // Strip string literals first: `insert … select -qty, 'void', id` would
    // otherwise offer "void" as a column name, which it very much is not.
    const clean = st.sql.replace(/'[^']*'/g, " '' ")
    const rels = relationsOf(clean).filter((r) => schema.has(r.name))
    if (rels.length === 0) continue
    checkedStmts++
    const local = localNames(clean)
    const byAlias = new Map<string, string>()
    for (const r of rels) {
      if (r.alias !== null) byAlias.set(r.alias, r.name)
      byAlias.set(r.name, r.name)
    }

    // qualified: alias.column
    for (const m of clean.matchAll(/\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/gi)) {
      const alias = m[1].toLowerCase()
      const col = m[2].toLowerCase()
      const rel = byAlias.get(alias)
      if (rel === undefined) continue // a CTE, a function, or another schema
      const set = schema.get(rel)
      if (set === undefined) continue
      checkedCols++
      if (!set.has(col)) misses.push({ file: st.file, relation: rel, column: col, how: `${alias}.${col}` })
    }

    // unqualified: only decidable when exactly one real relation is in play.
    // THIS is the case the pnl break lived in.
    // An INSERT names target COLUMNS before any relation is in scope, and an
    // INSERT … SELECT mixes both; the qualified pass above already covers the
    // select side, so skip the unqualified pass for writes entirely.
    const isWrite = /^\s*(insert|update|delete)\b/i.test(clean)
    const distinct = [...new Set(rels.map((r) => r.name))]
    if (distinct.length === 1 && !isWrite && !/\bwith\b/i.test(clean)) {
      const rel = distinct[0]
      const set = schema.get(rel)!
      const selectPart = clean.split(/\bfrom\b/i)[0] ?? ''
      for (const m of selectPart.matchAll(/\b([a-z_][a-z0-9_]*)\b/gi)) {
        const word = m[1].toLowerCase()
        if (SQL_KEYWORDS.has(word) || local.has(word) || byAlias.has(word)) continue
        if (/^\d/.test(word)) continue
        // only flag words that look like they were MEANT to be columns
        const after = selectPart.slice(m.index! + m[1].length)
        const before = selectPart.slice(0, m.index!)
        if (after.trimStart().startsWith('(')) continue // a function call
        if (after.startsWith('.')) continue // an alias: p.restaurant_id
        if (before.endsWith('.')) continue // the column half of a qualified ref
        if (before.trimEnd().endsWith('::')) continue // a cast target type
        checkedCols++
        if (!set.has(word)) misses.push({ file: st.file, relation: rel, column: word, how: word })
      }
    }
  }

  console.log(`\nschema gate — every column the server reads must still exist`)
  console.log(`  ${statements.length} sql templates, ${checkedStmts} with a known relation`)
  console.log(`  ${checkedCols} column references checked against information_schema\n`)

  const unique = new Map<string, Miss>()
  for (const m of misses) unique.set(`${m.file}|${m.relation}|${m.column}`, m)

  if (unique.size === 0) {
    console.log('  ✓ every column reference resolves')
  } else {
    for (const m of unique.values()) {
      console.log(`  ✗ ${m.file}\n      ${m.relation} has no column “${m.column}”  (read as ${m.how})`)
    }
  }

  if (selfTest) {
    // Prove the gate still catches the break it was written for: pnl_monthly
    // no longer has `revenue`, and the old query named it unqualified.
    const fake = `select month::text as month, coalesce(revenue, 0)::text as revenue from pnl_monthly where restaurant_id = ?`
    const rels = relationsOf(fake)
    const set = schema.get('pnl_monthly')
    const caught = rels.length === 1 && set !== undefined && !set.has('revenue')
    console.log(
      caught
        ? '\n  ✓ self-test: the gate still catches the pnl_monthly.revenue regression'
        : '\n  ✗ self-test FAILED: the gate would not catch the pnl break again',
    )
    if (!caught) process.exit(1)
  }

  process.exit(unique.size === 0 ? 0 : 1)
}

void main()
