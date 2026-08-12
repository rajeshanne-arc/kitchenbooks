// Phase-10 smoke: identities through auth-core + session + the role matrix
// against the live DB — everything that does not need a browser. Proves:
// the bootstrap creates the FIRST owner exactly once (gated by the
// bootstrap code) and refuses forever after; login is generic-error with a
// real delay on failure; sessions sign/verify/expire/tamper correctly; the
// role matrix matches the brief; owner-only admin (create, role change,
// staff link, reset password, retire-never-delete); the last active owner
// is demotion-proof; and the DB itself refuses DELETE on app_users.
//
// EXPECTS app_users empty (true until Rajesh runs /setup). Creates zz-*
// accounts and prints them for cleanup as postgres — after cleanup the
// real /setup is open again.
//
// Run: npm run smoke:auth
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
  const { getRestaurant } = await import('../src/server/queries')
  const {
    createFirstOwner, createUser, listUsers, resetPassword, updateUser, verifyCredentials,
  } = await import('../src/server/auth-core')
  const { signSession, verifySession } = await import('../src/lib/session')
  const { ALL_ROLES, canAccess, deniedHint, navFor } = await import('../src/lib/roles')
  const { getSessionUser } = await import('../src/server/current-user')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  console.log('restaurant:', restaurant.name)

  // ---- preconditions
  const existing = await listUsers(rid)
  assert.equal(existing.length, 0, 'expected zero app_users — is an earlier smoke uncleaned or setup already run?')
  const pin = process.env.KB_PIN
  assert.ok(pin, 'KB_PIN must exist in .env.local — it is the bootstrap code')

  // ---- 1. sessions: sign, verify, expire, tamper
  const secret = 'test-secret-not-the-real-one'
  const good = await signSession({ u: 'someone', r: 'chef', t: rid, exp: Math.floor(Date.now() / 1000) + 60 }, secret)
  const verified = await verifySession(good, secret)
  assert.ok(verified && verified.u === 'someone' && verified.r === 'chef')
  const expired = await signSession({ u: 'someone', r: 'chef', t: rid, exp: Math.floor(Date.now() / 1000) - 5 }, secret)
  assert.equal(await verifySession(expired, secret), null, 'expired tokens die')
  const tampered = `${good.slice(0, -4)}beef`
  assert.equal(await verifySession(tampered, secret), null, 'tampered signature dies')
  const [v1, body] = [good.split('.')[0], good.split('.')[1]]
  const forged = `${v1}.${body.replace(/..$/, 'ff')}.${good.split('.')[2]}`
  assert.equal(await verifySession(forged, secret), null, 'tampered payload dies')
  assert.equal(await verifySession(good, 'other-secret'), null, 'wrong secret dies')
  assert.equal(await verifySession(undefined, secret), null)

  // ---- 2. the role matrix, spot-checked against the brief
  assert.ok(canAccess('store', '/bill') && canAccess('store', '/issue') && canAccess('store', '/wastage'))
  assert.ok(canAccess('store', '/books/bills') && canAccess('store', '/books/counts') && canAccess('store', '/books/vendors'))
  assert.ok(!canAccess('store', '/attendance') && !canAccess('store', '/books/recipes') && !canAccess('store', '/cash'))
  assert.ok(!canAccess('store', '/books/users') && !canAccess('store', '/dashboard'))
  assert.ok(canAccess('chef', '/kitchen') && canAccess('chef', '/books/recipes') && canAccess('chef', '/books/food-cost'))
  assert.ok(canAccess('chef', '/books/stock') && canAccess('chef', '/books/sections'))
  assert.ok(!canAccess('chef', '/bill') && !canAccess('chef', '/cash') && !canAccess('chef', '/attendance'))
  assert.ok(canAccess('cashier', '/cash') && canAccess('cashier', '/books/sales') && canAccess('cashier', '/books/cash'))
  assert.ok(!canAccess('cashier', '/issue') && !canAccess('cashier', '/kitchen') && !canAccess('cashier', '/books/recipes'))
  assert.ok(canAccess('manager', '/attendance') && canAccess('manager', '/bill') && canAccess('manager', '/kitchen'))
  assert.ok(canAccess('manager', '/cash') && canAccess('manager', '/dashboard') && canAccess('manager', '/books/staff'))
  assert.ok(!canAccess('manager', '/books/users') && !canAccess('manager', '/books/snapshots'), 'manager stops below Users + snapshots')
  for (const p of ['/books/users', '/books/snapshots', '/attendance', '/dashboard', '/bill', '/kitchen', '/cash']) {
    assert.ok(canAccess('owner', p), `owner opens everything: ${p}`)
  }
  assert.ok(/owner/i.test(deniedHint('/owner/users')), 'denied names who to ask')
  assert.ok(/manager or owner/i.test(deniedHint('/staff/people/attendance')))
  // Nav is the group list, matrix-filtered. The books strips, chip rows and
  // every literal href on every page are asserted exhaustively by
  // scripts/audit-matrix.ts, which is the LAW 1 gate.
  for (const role of ALL_ROLES) {
    for (const l of navFor(role)) {
      assert.ok(canAccess(role, l.href), `nav shows only what opens: ${role} ${l.href}`)
    }
  }

  // ---- 3. bootstrap: wrong code refused (slowly), right code once, then closed
  const t0 = Date.now()
  await assert.rejects(
    () => createFirstOwner(rid, { username: 'zz-rajesh', displayName: 'Zz Rajesh', password: 'longenough1', bootstrapCode: 'not-it' }),
    /bootstrap code is wrong/i,
  )
  assert.ok(Date.now() - t0 >= 300, 'a wrong bootstrap code costs a delay')
  await assert.rejects(
    () => createFirstOwner(rid, { username: 'zz', displayName: 'Zz', password: 'longenough1', bootstrapCode: pin }),
    /username/i,
  )
  await assert.rejects(
    () => createFirstOwner(rid, { username: 'zz-rajesh', displayName: 'Zz Rajesh', password: 'short', bootstrapCode: pin }),
    /8 characters/i,
  )
  const owner = await createFirstOwner(rid, {
    username: 'ZZ-Rajesh', displayName: 'Zz Rajesh', password: 'first-owner-pw1', bootstrapCode: pin,
  })
  assert.equal(owner.username, 'zz-rajesh', 'usernames store lowercased')
  assert.equal(owner.role, 'owner')
  await assert.rejects(
    () => createFirstOwner(rid, { username: 'zz-again', displayName: 'Zz Again', password: 'longenough1', bootstrapCode: pin }),
    /closed forever|already exist/i,
  )

  // ---- 4. login: generic and slow on failure, case-insensitive on success
  const t1 = Date.now()
  assert.equal(await verifyCredentials('zz-rajesh', 'wrong-password'), null)
  assert.ok(Date.now() - t1 >= 300, 'a wrong password costs a delay')
  assert.equal(await verifyCredentials('zz-nobody', 'first-owner-pw1'), null, 'unknown user, same null')
  const logged = await verifyCredentials('ZZ-RAJESH', 'first-owner-pw1')
  assert.ok(logged && logged.username === 'zz-rajesh')

  // ---- 5. owner-only admin: one account per role, duplicates refused
  await assert.rejects(
    () => createUser('store', rid, { username: 'zz-x', displayName: 'X', role: 'chef', password: 'longenough1', staffId: '' }),
    /only an owner/i,
  )
  const roles = ['manager', 'chef', 'store', 'cashier'] as const
  for (const r of roles) {
    const u = await createUser('owner', rid, {
      username: `zz-${r}`, displayName: `Zz ${r}`, role: r, password: `pw-for-${r}-1`, staffId: '',
    })
    assert.equal(u.role, r)
  }
  await assert.rejects(
    () => createUser('owner', rid, { username: 'ZZ-CHEF', displayName: 'Dup', role: 'chef', password: 'longenough1', staffId: '' }),
    /taken/i,
  )
  assert.equal((await listUsers(rid)).length, 5)

  // ---- 6. the last active owner is demotion- and retirement-proof
  await assert.rejects(
    () => updateUser('owner', rid, owner.id, { displayName: 'Zz Rajesh', role: 'manager', staffId: '', status: 'active' }),
    /last active owner/i,
  )
  await assert.rejects(
    () => updateUser('owner', rid, owner.id, { displayName: 'Zz Rajesh', role: 'owner', staffId: '', status: 'inactive' }),
    /last active owner/i,
  )
  const second = await createUser('owner', rid, {
    username: 'zz-owner2', displayName: 'Zz Second', role: 'owner', password: 'second-owner1', staffId: '',
  })
  const demoted = await updateUser('owner', rid, owner.id, {
    displayName: 'Zz Rajesh', role: 'manager', staffId: '', status: 'active',
  })
  assert.equal(demoted.role, 'manager', 'with a second owner standing, demotion works')
  const restored = await updateUser('owner', rid, owner.id, {
    displayName: 'Zz Rajesh', role: 'owner', staffId: '', status: 'active',
  })
  assert.equal(restored.role, 'owner')

  // ---- 7. reset password + retire (never delete)
  await resetPassword('owner', rid, second.id, 'a-new-password1')
  assert.equal(await verifyCredentials('zz-owner2', 'second-owner1'), null, 'old password dead')
  assert.ok(await verifyCredentials('zz-owner2', 'a-new-password1'), 'new password lives')
  const retired = await updateUser('owner', rid, second.id, {
    displayName: 'Zz Second', role: 'owner', staffId: '', status: 'inactive',
  })
  assert.equal(retired.status, 'inactive')
  assert.equal(await verifyCredentials('zz-owner2', 'a-new-password1'), null, 'a retired key stops working')

  // ---- 8. the database refuses DELETE — retire is the only removal
  await assert.rejects(
    async () => sql`delete from app_users where username like 'zz-%'`,
    /permission denied/i,
    'kb_app must hold no DELETE on app_users',
  )

  // ---- 9. outside a request there is no session — entered_by stays null
  assert.equal(await getSessionUser(), null)

  console.log('ALL AUTH SMOKE ASSERTIONS PASSED')
  console.log('CLEANUP_IDS ' + JSON.stringify({ app_users_like: 'zz-%', count: (await listUsers(rid)).length }))
  await sql.end()
}

main().catch((e) => {
  console.error('AUTH SMOKE FAILED:', e)
  process.exit(1)
})
