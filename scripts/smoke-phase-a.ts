// Phase A gates, all of them checkable without a browser and therefore run on
// every build. Four things this asserts, each because it has been wrong
// before or would be invisible until a user hit it:
//
//   1. the nav link list per role, BY VALUE — not "obeys the matrix" but
//      "is exactly this list". A rule can be satisfied by a wrong list.
//   2. every rupee string uses Indian grouping (₹1,04,500.00, never ₹104,500.00)
//   3. no stray hex anywhere in src/ or public/ outside the token set
//   4. every retired URL still resolves to a live route, per role
//
// Run: npm run smoke:phase-a   (exit 1 on any failure)

import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ALL_ROLES, canAccess, navFor, type Role } from '../src/lib/roles'
import { TAB_DEFAULTS, TAB_GROUPS } from '../src/lib/tabs'
import { BOOKS } from '../src/lib/books'
import { legacyTarget } from '../src/lib/legacy'
import { formatPaise } from '../src/lib/money'

let failures = 0
const check = (name: string, fn: () => void) => {
  try {
    fn()
    console.log(`  ✓ ${name}`)
  } catch (e) {
    failures++
    console.log(`  ✗ ${name}\n      ${(e as Error).message}`)
  }
}

/* ── 1. the nav list per role, by value ─────────────────────────────── */

const EXPECTED_NAV: Record<Role, string[]> = {
  owner: ['Kitchen', 'Store', 'Sales', 'Staff', 'Owner'],
  manager: ['Kitchen', 'Store', 'Sales', 'Staff', 'Owner'],
  chef: ['Kitchen'],
  store: ['Store'],
  cashier: ['Sales'],
}

console.log('\nnav, by value')
for (const role of ALL_ROLES) {
  check(`${role} nav is exactly ${EXPECTED_NAV[role].join(' · ')}`, () => {
    assert.deepEqual(navFor(role).map((l) => l.label), EXPECTED_NAV[role])
  })
}

console.log('\nno surface offers a denied link')
for (const role of ALL_ROLES) {
  check(`${role} tabs, chips and books all open`, () => {
    for (const g of TAB_GROUPS) {
      for (const t of TAB_DEFAULTS[g]) {
        if (!canAccess(role, t.href)) continue
        for (const c of t.chips ?? []) {
          assert.ok(canAccess(role, `${t.href}/${c.key}`), `${role} chip ${t.href}/${c.key}`)
        }
      }
      for (const v of BOOKS[g]) {
        if (!canAccess(role, `/${g}/books`)) continue
        assert.ok(canAccess(role, v.href), `${role} book ${v.href}`)
      }
    }
  })
}

/* ── 2. Indian grouping ─────────────────────────────────────────────── */

console.log('\nmoney is grouped the Indian way')
const MONEY: [paise: number, text: string][] = [
  [0, '₹0.00'],
  [99, '₹0.99'],
  [123456, '₹1,234.56'],
  [10450000, '₹1,04,500.00'],
  [123456789, '₹12,34,567.89'],
  [100000000000, '₹1,00,00,00,000.00'],
  [-10450000, '-₹1,04,500.00'],
]
for (const [paise, text] of MONEY) {
  check(`${paise} paise -> ${text}`, () => assert.equal(formatPaise(paise), text))
}
check('no rupee figure is ever grouped in thousands', () => {
  // the western grouping of 1,04,500 would read 104,500 — assert it never can
  assert.ok(!formatPaise(10450000).includes('104,500'))
})

/* ── 3. no stray hex ────────────────────────────────────────────────── */

const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(tsx?|css|svg)$/.test(p)) out.push(p)
  }
  return out
}

const TOKENS_FILE = 'src/app/globals.css'
const tokenHexes = new Set(
  [...readFileSync(TOKENS_FILE, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()),
)

console.log('\nevery colour comes from the token set')
const strays: string[] = []
for (const f of [...walk('src'), 'public/icon.svg']) {
  if (f.endsWith(TOKENS_FILE) || f === TOKENS_FILE) continue
  const src = readFileSync(f, 'utf8')
  for (const m of src.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
    const hex = m[0].toLowerCase()
    if (!tokenHexes.has(hex)) strays.push(`${f}: ${m[0]}`)
  }
}
check(`no stray hex outside ${TOKENS_FILE}`, () => {
  assert.deepEqual(strays, [], `stray hexes:\n      ${strays.join('\n      ')}`)
})

/* ── 4. every retired URL still lands somewhere live ────────────────── */

const LIVE_ROUTES = new Set<string>()
;(function collect(dir: string, route: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) collect(p, `${route}/${e}`)
    else if (e === 'page.tsx') LIVE_ROUTES.add(route === '' ? '/' : route)
  }
})('src/app', '')

const RETIRED = [
  '/books', '/books/bills', '/books/bills/abc', '/books/store', '/books/stock', '/books/counts',
  '/books/counts/new', '/books/vendors', '/books/vendors/abc', '/books/items', '/books/items/new',
  '/books/recipes', '/books/recipes/abc', '/books/sales', '/books/sales/mapping', '/books/cash',
  '/books/sections', '/books/food-cost', '/books/staff', '/books/staff/abc', '/books/users',
  '/books/snapshots/2026-08-01', '/books/issues/abc', '/books/wastage/abc',
  '/bill', '/issue', '/wastage', '/store/payment',
  '/cash', '/cash/vouchers', '/cash/other-income', '/cash/off-book', '/cash/non-revenue',
  '/cash/dues', '/cash/settlements', '/cash/fetch',
  '/attendance', '/expenses', '/dashboard', '/pnl', '/settings',
  // '/kitchen/production' is a REAL route again — production split out of
  // End of shift — so it is no longer a retired URL and maps nowhere.
  '/kitchen/shift/production', '/kitchen/closing', '/kitchen/wastage',
]

/** '/store/books/bills/abc' -> '/store/books/bills/[id]' if that is the route */
const resolves = (target: string): boolean => {
  if (LIVE_ROUTES.has(target)) return true
  const segs = target.split('/').filter(Boolean)
  for (const live of LIVE_ROUTES) {
    const l = live.split('/').filter(Boolean)
    if (l.length !== segs.length) continue
    if (l.every((s, i) => s === segs[i] || /^\[.*\]$/.test(s))) return true
  }
  return false
}

console.log('\nevery retired URL still resolves, per role')
for (const role of ALL_ROLES) {
  check(`${role}: ${RETIRED.length} retired URLs land on live routes`, () => {
    for (const old of RETIRED) {
      const target = legacyTarget(old, role)
      assert.ok(target !== null, `${old} maps nowhere`)
      assert.ok(resolves(target), `${old} -> ${target}, which is not a route`)
      assert.ok(!target.startsWith('/books/'), `${old} -> ${target} is still a retired URL`)
    }
  })
}

console.log(failures === 0 ? '\nALL PHASE A SMOKE ASSERTIONS PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
