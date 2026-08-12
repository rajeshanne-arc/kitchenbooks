// THE TENANCY AUDIT. Every query that reads a tenant-scoped table must say
// which tenant.
//
// With one restaurant in the database, a missing `where restaurant_id = ...`
// is invisible: the answer is right by accident, because there is only one
// possible answer. The moment a second tenant exists, every one of those is
// a cross-tenant read — and, on a write path, a cross-tenant WRITE.
//
// This counts them. It is deliberately conservative about what it calls a
// leak:
//
//   - 15 of the 69 tables are LINE tables with no restaurant_id of their own
//     (purchase_lines, issue_lines, …). They are reached through a parent,
//     so a statement touching only those is judged on its parent.
//   - categories, units and starter_library are GLOBAL masters, shared by
//     every tenant on purpose. Reading them unfiltered is correct.
//   - restaurants itself is the tenant list.
//
// So a statement is flagged only when it touches a table that HAS a
// restaurant_id and mentions restaurant_id nowhere. That is the honest
// definition of "cannot say which tenant it meant".
//
// Run: npm run audit:tenancy

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

type Stmt = { file: string; sql: string; line: number }

/** Pull out sql`…` / tx`…` bodies with ${…} holes marked. */
function extract(file: string, src: string): Stmt[] {
  const out: Stmt[] = []
  const re = /\b(?:sql|tx)\s*(?:<[^`]*?>)?\s*`/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    let i = m.index + m[0].length
    let body = ''
    for (; i < src.length; i++) {
      const c = src[i]
      if (c === '\\') { i++; continue }
      if (c === '$' && src[i + 1] === '{') {
        let depth = 1
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
    out.push({ file, sql: body, line: src.slice(0, m.index).split('\n').length })
  }
  return out
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

  const files = walk('src/server')
  const statements = files.flatMap((f) => extract(f, readFileSync(f, 'utf8')))

  type Leak = { file: string; line: number; relations: string[]; sql: string }
  const leaks: Leak[] = []
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
    if (/restaurant_id/i.test(clean)) {
      filtered++
      continue
    }
    leaks.push({
      file: st.file,
      line: st.line,
      relations: touchesScoped,
      sql: st.sql.trim().replace(/\s+/g, ' ').slice(0, 110),
    })
  }

  console.log('\ntenancy gate — every query on a tenant table must say which tenant\n')
  console.log(`  ${statements.length} sql templates, ${checked} with a resolvable relation`)
  console.log(`  ${filtered} filter on restaurant_id`)
  console.log(`  ${lineOnly} touch only line tables (scoped through their parent)`)
  console.log(`  ${globalOnly} touch only global masters (categories, units, starter_library)`)
  console.log(`  ${leaks.length} touch a tenant table and NAME NO TENANT\n`)

  if (leaks.length > 0) {
    const byFile = new Map<string, Leak[]>()
    for (const l of leaks) byFile.set(l.file, [...(byFile.get(l.file) ?? []), l])
    for (const [file, rows] of [...byFile.entries()].sort()) {
      console.log(`  ${file}`)
      for (const r of rows) {
        console.log(`    :${r.line}  [${r.relations.join(', ')}]  ${r.sql}`)
      }
    }
    console.log('')
  }

  const failOnLeak = process.argv.includes('--strict')
  if (leaks.length === 0) console.log('  ✓ every query on a tenant table names its tenant\n')
  process.exit(failOnLeak && leaks.length > 0 ? 1 : 0)
}

void main()
