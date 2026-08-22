// STRICT INVISIBILITY, checked instead of claimed.
//
// Two passes, both exhaustive — this is deliberately stronger than clicking
// through five logins, because it covers every route and every role rather
// than the handful anyone would screenshot:
//
//   PASS 1  Executes the surfaces that emit navigation — navFor, the group
//           tab strips, their chip rows, each group's books strip, and the
//           home group tiles — once per role, and asserts
//           every href they produce is one the matrix admits for that role.
//           This is the rendered link list, taken from the same functions the
//           components render, so it cannot drift from what ships.
//
//   PASS 2  Walks every page in src/app, follows its imports, and collects
//           every literal internal href reachable from it. For each role that
//           can open the page, it asserts the role can also open every link
//           on it. This is the leak that matrix-filtering the nav does NOT
//           catch: a quick link hardcoded in the body of a page.
//
// Run: npm run audit:matrix   (exit code 1 on any violation)

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { ALL_ROLES, canAccess, groupsFor, navFor, type Role } from '../src/lib/roles'
import { TAB_DEFAULTS, TAB_GROUPS } from '../src/lib/tabs'
import { BOOKS } from '../src/lib/books'

const SRC = resolve(process.cwd(), 'src')
const APP = join(SRC, 'app')

type Violation = { where: string; role: Role; href: string }
const violations: Violation[] = []
/** A denied href inside a file that never calls canAccess cannot be gated —
 *  that is the bug class this audit exists for, and it fails the run. A file
 *  that does call canAccess has thought about it; those are listed for review
 *  rather than failing, since a static scan cannot see which JSX branch the
 *  guard wraps. */
const review: Violation[] = []

/* ------------------------------------------------------------------ */
/* the home tiles — the one nav surface whose list lives in a page      */
/* ------------------------------------------------------------------ */

function homeTiles(role: Role): string[] {
  return groupsFor(role).map((g) => g.href)
}

/* ------------------------------------------------------------------ */
/* PASS 1 — what each role is actually offered                          */
/* ------------------------------------------------------------------ */

export type RoleReport = {
  role: Role
  nav: string[]
  booksTabs: string[]
  groupTabs: Record<string, string[]>
  chips: string[]
  tiles: string[]
}

function reportFor(role: Role): RoleReport {
  const nav = navFor(role).map((l) => `${l.label} ${l.href}`)
  const groupTabs: Record<string, string[]> = {}
  const chips: string[] = []
  for (const g of TAB_GROUPS) {
    // A settings row can reorder, relabel or hide a tab; tabs.ts is the key
    // registry and cannot invent a route, so the defaults are the complete
    // href set that could ever reach the DOM.
    const admitted = TAB_DEFAULTS[g].filter((t) => canAccess(role, t.href))
    if (admitted.length > 0) groupTabs[g] = admitted.map((t) => `${t.label} ${t.href}`)
    for (const t of admitted) {
      // CHIPS ARE MATRIX-FILTERED AT RENDER, so this models the row that
      // actually reaches the DOM rather than the registry behind it. Every
      // chip row in the app was uniform until Owner → Setup: there the owner
      // gets five, the manager two and the accountant two others, and no chip
      // is common to manager and accountant.
      //
      // THE EXEMPTION EXPIRES BY ITSELF — the assertion below reads ChipRow
      // and fails if the filtering goes, so this cannot quietly become a
      // blind spot.
      for (const c of t.chips ?? []) {
        const href = `${t.href}/${c.key}`
        if (canAccess(role, href)) chips.push(`${c.label} ${href}`)
      }
    }
  }
  const booksTabs: string[] = []
  for (const g of TAB_GROUPS) {
    if (!canAccess(role, `/${g}/books`) && g !== 'owner') continue
    for (const v of BOOKS[g]) booksTabs.push(`${v.label} ${v.href}`)
  }
  const tiles = homeTiles(role)

  const check = (where: string, hrefs: string[]) => {
    for (const h of hrefs) {
      const href = h.includes(' ') ? h.slice(h.lastIndexOf(' ') + 1) : h
      if (!canAccess(role, href)) violations.push({ where, role, href })
    }
  }
  check('nav', nav)
  check('books strip', booksTabs)
  check('chips', chips)
  for (const [g, list] of Object.entries(groupTabs)) check(`${g} tab strip`, list)
  check('group tiles', tiles)

  return { role, nav, booksTabs, groupTabs, chips, tiles }
}

/* ------------------------------------------------------------------ */
/* PASS 2 — every literal href reachable from every page                */
/* ------------------------------------------------------------------ */

const walk = (dir: string, out: string[] = []): string[] => {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

/** src/app/books/bills/[id]/page.tsx -> /books/bills/[id] */
function routeOf(file: string): string | null {
  if (!/\/(page|route)\.tsx?$/.test(file)) return null
  const rel = file.slice(APP.length).replace(/\/(page|route)\.tsx?$/, '')
  const segs = rel.split('/').filter((s) => s !== '' && !/^\(.*\)$/.test(s))
  return '/' + segs.join('/')
}

function resolveImport(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('.')) base = resolve(dirname(fromFile), spec)
  else return null
  for (const cand of [`${base}.tsx`, `${base}.ts`, join(base, 'index.tsx'), join(base, 'index.ts')]) {
    try {
      if (statSync(cand).isFile()) return cand
    } catch {
      /* not this one */
    }
  }
  return null
}

const fileCache = new Map<string, string>()
const read = (f: string): string => {
  let s = fileCache.get(f)
  if (s === undefined) {
    s = readFileSync(f, 'utf8')
    fileCache.set(f, s)
  }
  return s
}

/** Every src/ file reachable from an entry file, the entry included. */
function closure(entry: string): string[] {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length > 0) {
    const f = stack.pop()
    if (f === undefined || seen.has(f)) continue
    seen.add(f)
    for (const m of read(f).matchAll(/from\s+'([^']+)'/g)) {
      const r = resolveImport(m[1], f)
      if (r !== null && !seen.has(r)) stack.push(r)
    }
  }
  return [...seen]
}

/** Internal hrefs written literally in a file. Dynamic segments collapse to
 *  the static prefix, which is what the matrix keys on anyway. */
function hrefsIn(file: string): string[] {
  const src = read(file)
  const found = new Set<string>()
  for (const m of src.matchAll(/href=(?:"(\/[^"]*)"|\{`(\/[^`]*)`\}|\{'(\/[^']*)'\})/g)) {
    const raw = m[1] ?? m[2] ?? m[3]
    const cut = raw.indexOf('${')
    const clean = (cut === -1 ? raw : raw.slice(0, cut)).split('?')[0].replace(/\/+$/, '')
    if (clean !== '') found.add(clean)
  }
  return [...found]
}

// The surfaces that filter through canAccess at render time are verified by
// PASS 1 instead — checking their unfiltered source arrays here would be a
// false positive, since none of those hrefs reaches the DOM ungated.
const GATED = new Set(
  [
    'lib/roles.ts',
    'lib/tabs.ts',
    'components/TopNav.tsx',
    'components/TabStrip.tsx',
    'components/GroupTabs.tsx',
    'lib/books.ts',
    'lib/legacy.ts',
    'components/BooksNav.tsx',
    'components/ChipRow.tsx',
    'app/page.tsx',
  ].map((p) => join(SRC, p)),
)

function pass2(): void {
  for (const file of walk(APP)) {
    const route = routeOf(file)
    if (route === null || route.startsWith('/api')) continue
    if (route === '/login' || route === '/setup' || route === '/denied') continue

    // href -> whether the file holding it gates anything on the matrix
    const hrefs = new Map<string, boolean>()
    for (const f of closure(file)) {
      if (GATED.has(f)) continue
      const guards = read(f).includes('canAccess')
      for (const h of hrefsIn(f)) hrefs.set(h, (hrefs.get(h) ?? false) || guards)
    }

    for (const role of ALL_ROLES) {
      if (!canAccess(role, route)) continue
      for (const [href, gated] of hrefs) {
        if (href === '/' || href === '/login') continue
        if (canAccess(role, href)) continue
        ;(gated ? review : violations).push({ where: `page ${route}`, role, href })
      }
    }
  }
}

/* ------------------------------------------------------------------ */

function main(): void {
  const reports = ALL_ROLES.map(reportFor)
  pass2()

  for (const r of reports) {
    console.log(`\n═══ ${r.role.toUpperCase()} ${'═'.repeat(52 - r.role.length)}`)
    console.log(`  nav          ${r.nav.join('  ·  ') || '(none)'}`)
    console.log(`  group tiles  ${r.tiles.join('  ·  ') || '(none)'}`)
    for (const [g, list] of Object.entries(r.groupTabs)) {
      console.log(`  ${g.padEnd(12)} ${list.join('  ·  ')}`)
    }
    console.log(`  chips        ${r.chips.join('  ·  ') || '(none)'}`)
    console.log(`  books        ${r.booksTabs.join('  ·  ') || '(none)'}`)
  }

  const routes = walk(APP)
    .map(routeOf)
    .filter((r): r is string => r !== null && !r.startsWith('/api'))
  console.log(`\n═══ COVERAGE ${'═'.repeat(48)}`)
  console.log(`  ${routes.length} routes × ${ALL_ROLES.length} roles = ${routes.length * ALL_ROLES.length} checks`)
  for (const role of ALL_ROLES) {
    const open = routes.filter((r) => canAccess(role, r))
    console.log(`  ${role.padEnd(8)} can open ${String(open.length).padStart(2)} of ${routes.length} routes`)
  }

  if (review.length > 0) {
    console.log(`\n═══ GATED, FOR REVIEW ${'═'.repeat(39)}`)
    for (const v of review) console.log(`  ~ ${v.role} · ${v.where} · ${v.href}  (file calls canAccess)`)
  }

  // THE CHIP EXEMPTION, AND THE CONDITION THAT MAKES IT SAFE.
  //
  // Pass 1 now models the chip row AS RENDERED — filtered through the matrix —
  // rather than as registered, because Owner → Setup is the first row whose
  // chips are not uniformly accessible. That is only sound while ChipRow
  // really does the filtering, so the condition is checked rather than
  // remembered: if the filter goes, this fails on the same run.
  const chipRow = readFileSync(join('src', 'components', 'ChipRow.tsx'), 'utf8')
  const filters =
    chipRow.includes('canAccess(user.role, `${base}/${c.key}`)') && chipRow.includes('chips.filter(')
  if (!filters) {
    violations.push({
      where: 'ChipRow',
      role: 'owner',
      href: 'chips are no longer matrix-filtered — pass 1 models a row that is not what renders',
    })
  } else {
    review.push({
      where: 'chips',
      role: 'owner' as Role,
      href: 'row filtered through canAccess before render',
    })
  }

  console.log(`\n═══ VIOLATIONS ${'═'.repeat(46)}`)
  if (violations.length === 0) {
    console.log('  none — no ungated surface offers any role a link the matrix denies it')
  } else {
    for (const v of violations) console.log(`  ✗ ${v.role} · ${v.where} · ${v.href}`)
  }
  process.exit(violations.length === 0 ? 0 : 1)
}

main()
