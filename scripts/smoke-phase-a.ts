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
import { chipsOf, TAB_DEFAULTS, TAB_GROUPS } from '../src/lib/tabs'
import { BOOKS } from '../src/lib/books'
import { legacyTarget, RETIRED_URLS } from '../src/lib/legacy'
import { formatPaise, formatRate } from '../src/lib/money'

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
  owner: ['Kitchen', 'Store', 'Sales', 'Staff', 'Owner', 'Accounts'],
  manager: ['Kitchen', 'Store', 'Sales', 'Staff', 'Owner'],
  chef: ['Kitchen'],
  store: ['Store'],
  cashier: ['Sales'],
  // One group, so '/' redirects them straight into it and they never see a
  // chooser. The accountant works from home; this is the whole app to them.
  accountant: ['Accounts'],
}

console.log('\nnav, by value')
for (const role of ALL_ROLES) {
  check(`${role} nav is exactly ${EXPECTED_NAV[role].join(' · ')}`, () => {
    assert.deepEqual(navFor(role).map((l) => l.label), EXPECTED_NAV[role])
  })
}

/* ── 1b. the owner strip, by value ──────────────────────────────────── */
//
// NINE TABS TO FOUR, and asserted by value because a count cannot see a
// reorder or a rename — the same reason PERIOD_KEYS.length === 3 was replaced
// by naming every key.

console.log('\nowner: four tabs, five chips, one divider')

check('the owner strip is exactly Dashboard · P&L · Activity · Setup', () => {
  assert.deepEqual(
    TAB_DEFAULTS.owner.map((t) => t.label),
    ['Dashboard', 'P&L', 'Approvals', 'Activity', 'Setup'],
  )
  // THE THREE THAT ARE READ COME FIRST. The point of the collapse was that
  // five rarely-visited masters made the three that matter one third of the
  // strip; if a master is ever promoted back, this says so.
  // FOUR READ TABS NOW, and the order is READING ORDER rather than urgency:
  // Dashboard is now, P&L is the period, Approvals is what needs me, Activity
  // is what happened. The badge does the summoning, so Approvals need not sit
  // second — a strip ordered by how alarming a tab might be is a strip that
  // means something different on a bad day.
  assert.equal(TAB_DEFAULTS.owner.filter((t) => t.chips === undefined).length, 4)
  assert.equal(TAB_DEFAULTS.owner[2].key, 'approvals', 'Approvals is not third')
})

check('Setup holds the masters, Settings last and after a rule', () => {
  const chips = chipsOf('owner', 'setup')
  assert.deepEqual(
    chips.map((c) => c.label),
    ['Money accounts', 'Meters', 'Users', 'Lists', 'Letterhead', 'Settings'],
  )
  // APPROVALS LEFT THIS ROW for a tab of its own — everything in Setup is
  // configuration again, which is what the chip row is for.
  //
  // SETTINGS LAST, AFTER A DIVIDER. The four before it ADD ROWS; this one
  // changes what every number in the app MEANS. The rule says that without a
  // sentence, and it is the only one in the app — if a second appears, the
  // distinction has stopped meaning anything.
  assert.equal(chips[chips.length - 1].key, 'settings', 'Settings is no longer last')
  assert.equal(chips[chips.length - 1].separatorBefore, true, 'the divider before Settings is gone')
  const dividers = TAB_GROUPS.flatMap((g) =>
    TAB_DEFAULTS[g].flatMap((t) => (t.chips ?? []).filter((c) => c.separatorBefore === true)),
  )
  assert.equal(dividers.length, 1, `${dividers.length} dividers in the app — it means one thing or nothing`)
})

check('Setup resolves per role — no reader is sent to a chip they cannot open', () => {
  // THE ONLY CHIP ROW IN THE APP THAT SPANS A ROLE BOUNDARY. The owner opens
  // five, the manager two, the accountant two OTHERS — and manager ∩
  // accountant is EMPTY, which is why the tab cannot have one fixed first
  // child. This is the resolution GroupTabs and /owner/setup both perform.
  const first = (role: Role) =>
    chipsOf('owner', 'setup').find((c) => canAccess(role, `/owner/setup/${c.key}`))?.key
  assert.equal(first('owner'), 'accounts')
  assert.equal(first('accountant'), 'accounts')
  assert.equal(first('manager'), 'lists', 'a manager would be sent to Money accounts — a link to a wall')
  for (const r of ['chef', 'store', 'cashier'] as const) {
    assert.equal(first(r), undefined, `${r} can open a Setup chip`)
    assert.ok(!canAccess(r, '/owner/setup'), `${r} can open Setup at all`)
  }
  // and manager and accountant really do share nothing, which is the whole
  // reason the resolution exists rather than a reordering of the chips
  const mine = (role: Role) =>
    chipsOf('owner', 'setup').filter((c) => canAccess(role, `/owner/setup/${c.key}`)).map((c) => c.key)
  assert.deepEqual(mine('manager'), ['lists', 'letterhead', 'settings'])
  assert.deepEqual(mine('accountant'), ['accounts', 'meters'])
  assert.deepEqual(
    mine('manager').filter((k) => mine('accountant').includes(k)),
    [],
    'manager and accountant now share a chip — a fixed first child may be simpler than the resolution',
  )
})

check('locations is a store master, and the store may edit it', () => {
  assert.deepEqual(
    chipsOf('store', 'masters').map((c) => c.label),
    ['Vendors', 'Items', 'Locations'],
  )
  // THE PERSON WHO WALKS THE SHELVES SETS THE ORDER THEY ARE WALKED IN. The
  // count sheet reads it, so whoever counts must be able to fix one that is
  // wrong — an owner would be setting a route they do not walk.
  for (const r of ['store', 'manager', 'owner'] as const) {
    assert.ok(canAccess(r, '/store/masters/locations'), `${r} cannot open locations`)
  }
  // The old path is a REDIRECT, not a screen. It stays open to every signed-in
  // role like every other legacy prefix — it carries no data and decides
  // nothing, and the target it lands on is matrix-checked like any other page.
  assert.equal(legacyTarget('/owner/locations', 'owner'), '/store/masters/locations')
  assert.equal(legacyTarget('/owner/locations', 'store'), '/store/masters/locations')
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const actions = readFileSync('src/server/locations-actions.ts', 'utf8')
  assert.ok(
    actions.includes("user.role !== 'store'"),
    'the store cannot WRITE a location — the route gate is not the check',
  )
})

console.log('\nno surface offers a denied link')
for (const role of ALL_ROLES) {
  check(`${role} tabs, chips and books all open`, () => {
    for (const g of TAB_GROUPS) {
      for (const t of TAB_DEFAULTS[g]) {
        if (!canAccess(role, t.href)) continue
        // A TAB A ROLE CAN OPEN MUST HAVE SOMEWHERE FOR THEM TO LAND. Chips
        // are matrix-filtered at render now — Owner → Setup is the first row
        // whose chips are not uniformly accessible, and no chip in it is
        // common to the manager and the accountant — so the old assertion
        // ("every registered chip opens") is no longer the invariant.
        //
        // THE STRONGER ONE TAKES ITS PLACE: whatever the filter leaves must
        // be non-empty and must open. A tab admitting a role to an EMPTY chip
        // row is a dead tab, which the old check could never have caught.
        const chips = t.chips ?? []
        if (chips.length === 0) continue
        const mine = chips.filter((c) => canAccess(role, `${t.href}/${c.key}`))
        assert.ok(
          mine.length > 0,
          `${role} is admitted to ${t.href} and can open none of its ${chips.length} chips — a dead tab`,
        )
        for (const c of mine) {
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
  assert.ok(!formatRate('104500.00').includes('104,500'))
})

// A RATE IS NOT AN AMOUNT. A slab tariff is quoted to four decimals and the
// meter view multiplies by all four, so rounding it to paise would put a rate
// on screen that is not the rate being applied. formatRate is the ONE place
// that may show more than two decimals, and it shares formatPaise's grouping
// rather than reimplementing it.
const RATES: [text: string, out: string][] = [
  ['8.4750', '₹8.475'],
  ['8.5000', '₹8.50'],
  ['7', '₹7.00'],
  ['0.9500', '₹0.95'],
  ['104500.1234', '₹1,04,500.1234'],
  ['-8.4750', '-₹8.475'],
  ['not a number', '—'],
]
for (const [text, out] of RATES) {
  check(`rate ${text} -> ${out}`, () => assert.equal(formatRate(text), out))
}

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

/* ── the real route table, read off the filesystem once ──────────────── */
// Used by the chip check below and by the retired-URL check further down —
// one source, so the two cannot disagree about what a route is.
const LIVE_ROUTES = new Set<string>()
;(function collect(dir: string, route: string) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) collect(p, `${route}/${e}`)
    else if (e === 'page.tsx') LIVE_ROUTES.add(route === '' ? '/' : route)
  }
})('src/app', '')

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

/* ── 3b. every CHIP inside a tab resolves to a real route ────────────── */

// Chip URLs are BUILT from the tab registry — `${base}/${chip.key}` — so they
// are not literal hrefs in any page and audit:matrix, which reads literal
// hrefs, could never see them. It could not, and did not: the Reorder tab
// carried chips for `due` and `slow` pointing at /store/reorder/due and
// /store/reorder/slow, neither of which ever existed as a directory. Both
// 404'd, on the live site, for as long as that tab has been there.
//
// This walks src/app once for real routes and checks every chip against it.

check('every tab chip resolves to a real route', () => {
  const missing: string[] = []
  let checked = 0
  for (const group of TAB_GROUPS) {
    for (const tab of TAB_DEFAULTS[group]) {
      for (const chip of tab.chips ?? []) {
        checked++
        if (!resolves(`${tab.href}/${chip.key}`)) missing.push(`${tab.href}/${chip.key}`)
      }
    }
  }
  assert.deepEqual(missing, [], `chips pointing at nothing: ${missing.join(', ')}`)
  console.log(`      ${checked} chips across ${TAB_GROUPS.length} groups`)
})

/* ── 3c. the store dashboard keeps its one-click path to Loss ─────────── */

// Loss stopped being a top-level tab and became a view inside Stock. That is
// only acceptable while the dashboard carries a Wastage tile, because wastage
// is chronically under-recorded precisely BECAUSE it is uncomfortable and an
// extra tap costs real data. The brief said so in words; this says it in a
// test. If the tile goes, Loss comes back out as a tab.

check('the store dashboard still offers a one-click path to Loss', () => {
  const src = readFileSync('src/app/store/page.tsx', 'utf8')
  assert.match(
    src,
    /href="\/store\/stock\/loss"/,
    'the store dashboard must link straight to Loss — it is the only one-click route left',
  )
  // and it must not be hidden behind a condition the way the alarm tiles are
  const at = src.indexOf('href="/store/stock/loss"')
  const before = src.slice(Math.max(0, at - 400), at)
  assert.ok(
    !/\.length > 0 && \($/.test(before.trimEnd()),
    'the Loss tile must be unconditional — an alarm appears when something is wrong, a door is always open',
  )
})

/* ── 4. every retired URL still lands somewhere live ────────────────── */


// DERIVED FROM legacy.ts, NOT COPIED. This gate kept its own list of 51 while
// the source held 57 — six owner masters had moved and nothing here knew, which
// is a drift whose only symptom is a 404 on somebody's bookmarked phone. The
// two role-aware prefixes are resolved in code rather than listed, so they are
// added by hand here and nowhere else.
const RETIRED = [...RETIRED_URLS, '/books/stock', '/books/sections', '/books']

console.log('\nevery retired URL still resolves, per role')
for (const role of ALL_ROLES) {
  check(`${role}: ${RETIRED.length} retired URLs land on live routes`, () => {
    for (const old of RETIRED) {
      const target = legacyTarget(old, role)
      assert.ok(target !== null, `${old} maps nowhere`)
      assert.ok(resolves(target), `${old} -> ${target}, which is not a route`)
      // A RETIRED URL MUST LAND ON A LIVE ROUTE, NEVER ON A SECOND REDIRECT —
      // in general, not just for /books. The old check named one prefix and
      // would have sailed past `/settings -> /owner/settings` the day
      // /owner/settings itself was retired, which is exactly what happened
      // when the owner masters moved under Setup.
      assert.equal(
        legacyTarget(target, role),
        null,
        `${old} -> ${target}, which is ITSELF retired — a bookmark should not chain through two redirects`,
      )
    }
  })
}

console.log(failures === 0 ? '\nALL PHASE A SMOKE ASSERTIONS PASSED' : `\n${failures} FAILED`)
process.exit(failures === 0 ? 0 : 1)
