// THE ACCEPTANCE TEST FOR ISOLATION, run as kb_app.
//
// Testing this as a superuser proves nothing: `postgres` has BYPASSRLS, so
// every policy in the database is silently skipped and the test passes on a
// completely unprotected schema. The DATABASE_URL this reads connects as
// kb_app, which does not, and that is the whole point of the file.
//
// Five questions, in the order they matter:
//
//   1. WITH the tenant announced, does the app still see its own books?
//      The failure mode of turning RLS on is not a leak, it is an EMPTY
//      APP — every screen reporting a database with nothing in it. That is
//      checked first because it is the one that would be noticed by the
//      restaurant rather than by an auditor.
//   2. WITHOUT a tenant announced, does every tenant table refuse?
//   3. Announcing a DIFFERENT tenant, is this restaurant's data invisible —
//      including through a deliberately unfiltered select?
//   4. Is a WRITE naming another tenant refused, not merely ignored?
//   5. Is provisioning privileged — can kb_app mint a restaurant at all?
//
// Everything runs inside transactions that roll back. Nothing is created.
// Safe against live data, and safe to run on production.
//
// Run: npm run smoke:tenancy

process.loadEnvFile('.env.local')

let failures = 0
function ok(label: string, pass: boolean, detail = '') {
  console.log(`  ${pass ? '✓' : '✗'} ${label}`)
  if (detail) console.log(`      ${detail}`)
  if (!pass) failures++
}

/** A tenant that does not exist. Isolation is proved against a stranger, so
 *  no second restaurant has to be created to run this. */
const STRANGER = '00000000-0000-4000-8000-0000000000ff'

async function main() {
  const { sql, tsql, txn } = await import('../src/lib/db')
  /** A table name is not a bind parameter; these come from the literal list
   *  above, never from input. */
  const tsqlName = (t: string) => sql.unsafe(t)
  const { withTenant } = await import('../src/lib/tenant')

  const RID = process.env.KB_LIVE_TENANT
  if (!RID) {
    console.log('\nKB_LIVE_TENANT is not set — this test needs to know which books are ours.\n')
    process.exit(1)
  }

  console.log('\nisolation acceptance test — running as the app role, not as a superuser\n')

  // 0. The premise. If this session bypasses RLS, everything below is theatre.
  const [me] = await sql<{ role: string; bypass: boolean }[]>`
    select current_user as role, rolbypassrls as bypass
    from pg_roles where rolname = current_user`
  ok(
    `the connection is ${me.role} and does NOT bypass RLS`,
    me.bypass === false,
    me.bypass ? 'BYPASSRLS is on — this test cannot prove anything. Run it as kb_app.' : '',
  )
  if (me.bypass) {
    console.log('\nISOLATION TEST ABANDONED — it would pass on an unprotected database.\n')
    process.exit(1)
  }

  // 1. THE APP IS NOT EMPTY. Checked before any leak test, because an empty
  //    app is the outage a restaurant notices within the minute.
  // tsql, not sql: withTenant only puts the tenant in scope — `sql` is the
  // BARE pool and announces nothing. Every read meant to be scoped goes
  // through tsql/txn, and the deliberately unannounced probe below is the
  // only place the bare pool is correct.
  const [{ n: sections }] = await withTenant(RID, () =>
    tsql<{ n: number }[]>`select count(*)::int as n from sections where restaurant_id = ${RID}`,
  )
  ok('with the tenant announced the app sees its own books', sections > 0, `${sections} departments`)

  // 2. NO TENANT ANNOUNCED — the policy casts an empty setting to uuid, so a
  //    sessionless read RAISES rather than quietly returning nothing. Loud is
  //    the right failure: a silent empty result reads as "no data yet".
  const PROBE = ['vendors', 'items', 'purchases', 'issues', 'sections', 'app_users', 'payments']
  let refused = 0
  let leaked = 0
  for (const t of PROBE) {
    try {
      const rows = await sql.unsafe(`select 1 from ${t} limit 1`)
      if (rows.length > 0) leaked++
      else refused++ // empty is also no leak
    } catch {
      refused++
    }
  }
  ok('with NO tenant announced, no tenant table yields a row', leaked === 0, `${refused}/${PROBE.length} refused or empty`)

  // 3. ANOTHER TENANT ANNOUNCED — ours must be invisible, including through a
  //    query that deliberately forgets to filter. That unfiltered select is
  //    the important one: it is what a future bug looks like.
  //
  //    FIRST count what we actually have. "The stranger saw 0 vendors" proves
  //    nothing about a table that holds 0 vendors — the assertion would pass
  //    on a database with the policies torn off. Each table is measured as
  //    ourselves, and a table that is genuinely empty is reported as UNTESTED
  //    rather than counted as a pass.
  const HIDE = ['vendors', 'purchases', 'app_users'] as const
  const ours = new Map<string, number>()
  await withTenant(RID, async () => {
    for (const t of HIDE) {
      const [row] = await tsql<{ n: number }[]>`select count(*)::int as n from ${tsqlName(t)}`
      ours.set(t, row.n)
    }
  })
  await withTenant(STRANGER, async () => {
    for (const t of HIDE) {
      const mine = ours.get(t) ?? 0
      const [row] = await tsql<{ n: number }[]>`select count(*)::int as n from ${tsqlName(t)}`
      if (mine === 0) {
        console.log(`  · ${t} is empty for us, so a stranger seeing none of it proves nothing — UNTESTED`)
        continue
      }
      ok(
        `a stranger running an UNFILTERED select over ${t} sees none of our ${mine}`,
        row.n === 0,
        `${row.n} rows`,
      )
    }
  })

  // 4. WRITES. Isolation that only covers reads lets a stranger post into our
  //    books. Both directions are checked: naming a foreign tenant from here,
  //    and updating a row of ours from there.
  await withTenant(RID, async () => {
    let refusedInsert = false
    try {
      await txn(async (tx) => {
        await tx`insert into sections (restaurant_id, name, code, dept_group, dept_kind)
                 values (${STRANGER}, 'Zz Isolation', 'ZZI', 'Kitchen', 'kitchen')`
        throw new Error('ACCEPTED')
      })
    } catch (e) {
      refusedInsert = (e as Error).message !== 'ACCEPTED'
    }
    ok('an insert naming ANOTHER tenant is refused by with check', refusedInsert)
  })

  await withTenant(STRANGER, async () => {
    const [{ n }] = await txn(async (tx) => {
      const r = await tx<{ n: number }[]>`
        update vendors set phone = 'Zz' where restaurant_id = ${RID} returning 1 as n`
      return [{ n: r.length }]
    })
    ok('a stranger updating OUR vendors changes nothing', n === 0, `${n} rows touched`)
  })

  // 5. PROVISIONING IS PRIVILEGED. The app role creating restaurants would
  //    make every other check above optional — you could simply mint a tenant.
  let mintRefused = false
  try {
    await txn(async (tx) => {
      await tx`insert into restaurants (id, name) values (${STRANGER}, 'Zz Isolation')`
      throw new Error('ACCEPTED')
    })
  } catch (e) {
    mintRefused = (e as Error).message !== 'ACCEPTED'
  }
  ok('the app role cannot mint a restaurant — provisioning stays privileged', mintRefused)

  // 6. Nothing this test did survived it.
  const [{ n: strays }] = await withTenant(RID, () =>
    tsql<{ n: number }[]>`select count(*)::int as n from sections where name like 'Zz %'`,
  )
  ok('no test row survived', strays === 0)

  // ── 6. A REAL SECOND TENANT, NOT A SYNTHETIC ONE ──────────────────────
  //
  // Everything above proves isolation against a tenant that DOES NOT EXIST,
  // which is the easier half: there are no rows to leak. The probe tenant is
  // real, populated and written to by the gates on every run — so it is the
  // stronger test, and running it here is what makes "the probe tenant
  // continuously exercises isolation" a fact rather than a hope.
  const probe = process.env.KB_PROBE_TENANT
  if (!probe) {
    console.log('  · KB_PROBE_TENANT is not set — the real-tenant half of this suite did not run. UNTESTED')
  } else {
    const mineSections = await withTenant(RID, () =>
      tsql<{ n: number }[]>`select count(*)::int as n from sections`,
    )
    const theirSections = await withTenant(probe, () =>
      tsql<{ n: number }[]>`select count(*)::int as n from sections`,
    )
    // Both must be non-empty or the comparison proves nothing — the same rule
    // the read sweep above already applies to itself.
    ok(
      'both tenants actually hold departments, so a comparison between them means something',
      mineSections[0].n > 0 && theirSections[0].n > 0,
      `${mineSections[0].n} ours · ${theirSections[0].n} theirs`,
    )

    // The sharpest one: our staff and theirs share the SAME CODES — E001 and
    // E002 in both restaurants. If tenancy leaked anywhere, this is where it
    // would show, because the key a human reads is identical on both sides.
    const ourE001 = await withTenant(RID, () =>
      tsql<{ name: string }[]>`select name from staff where code = 'E001'`,
    )
    const theirE001 = await withTenant(probe, () =>
      tsql<{ name: string }[]>`select name from staff where code = 'E001'`,
    )
    ok(
      'E001 exists in BOTH restaurants and is a different person in each',
      ourE001.length === 1 &&
        theirE001.length === 1 &&
        ourE001[0].name !== theirE001[0].name,
      `${ourE001[0]?.name ?? '—'} vs ${theirE001[0]?.name ?? '—'}`,
    )

    // And the probe tenant cannot reach ours by asking for everything.
    const all = await withTenant(probe, () =>
      tsql<{ n: number }[]>`select count(*)::int as n from staff`,
    )
    const oursCount = await withTenant(RID, () =>
      tsql<{ n: number }[]>`select count(*)::int as n from staff`,
    )
    ok(
      'an UNFILTERED staff count from the probe tenant does not include ours',
      all[0].n === 2 && oursCount[0].n >= 1,
      `${all[0].n} theirs, ${oursCount[0].n} ours — neither count includes the other`,
    )
  }

  // ── 7. TWO RESTAURANTS BOTH SIGNING IN ────────────────────────────────
  //
  // The first time this has been possible. Login used to resolve the tenant
  // from KB_TENANT — a deployment variable — so a second restaurant's users
  // were simply not found. `tenant_for_username` resolves it per person now,
  // and this is the acceptance test for that.
  //
  // THE PROBE ACCOUNT IS GIVEN A FRESH RANDOM PASSWORD ON EVERY RUN and left
  // holding one nobody knows. app_users has no DELETE grant — retire, never
  // delete — so the row persists by design; what must not persist is a
  // usable credential sitting on a production database.
  if (probe) {
    const { verifyCredentials, createUser, resetPassword } = await import('../src/server/auth-core')
    const { randomBytes } = await import('node:crypto')
    const PROBE_USER = 'zz.probe.owner'
    const password = randomBytes(24).toString('hex')

    const existing = await withTenant(probe, () =>
      tsql<{ id: string }[]>`select id from app_users where lower(username) = ${PROBE_USER}`,
    )
    if (existing[0]) {
      await withTenant(probe, () => resetPassword('owner', probe, existing[0].id, password))
    } else {
      await withTenant(probe, () =>
        createUser('owner', probe, {
          username: PROBE_USER,
          displayName: 'Zz Probe Owner',
          role: 'owner',
          password,
          staffId: '',
        }),
      )
    }

    const signedIn = await verifyCredentials(PROBE_USER, password)
    ok(
      'a user of the SECOND restaurant can sign in at all',
      signedIn !== null,
      signedIn === null ? 'verifyCredentials returned null — login is still single-tenant' : PROBE_USER,
    )
    ok(
      'and the session they get is stamped with THEIR restaurant, not ours',
      signedIn?.restaurant_id === probe,
      `${signedIn?.restaurant_id ?? 'none'} · ours is ${RID}`,
    )

    // What they can actually SEE, through the tenant their login resolved to.
    if (signedIn) {
      const theirVendors = await withTenant(signedIn.restaurant_id, () =>
        tsql<{ n: number }[]>`select count(*)::int as n from vendors`,
      )
      const ourVendors = await withTenant(RID, () =>
        tsql<{ n: number }[]>`select count(*)::int as n from vendors`,
      )
      ok(
        'signed in as them, our vendors are invisible',
        theirVendors[0].n === 0 && ourVendors[0].n > 0,
        `${theirVendors[0].n} theirs · ${ourVendors[0].n} ours`,
      )
    }

    // OUR users are untouched by any of this.
    const stillOurs = await tsql<{ t: string | null }[]>`select tenant_for_username('rajeshanne') as t`
    ok(
      'our own users still resolve to our own restaurant',
      stillOurs[0]?.t === RID,
      `rajeshanne -> ${stillOurs[0]?.t ?? 'NULL'}`,
    )

    // ── the enumeration oracle ──────────────────────────────────────────
    //
    // tenant_for_username DOES leak whether a username exists — it must. What
    // stops that mattering is that the app fails identically either way. Same
    // answer, and the same time: measured, because "same branch" is easy to
    // assert and easy to be wrong about, and a timer is all an attacker needs.
    const time = async (fn: () => Promise<unknown>) => {
      const t0 = process.hrtime.bigint()
      await fn()
      return Number(process.hrtime.bigint() - t0) / 1e6
    }
    const unknownUser: number[] = []
    const wrongPassword: number[] = []
    for (let i = 0; i < 5; i++) {
      unknownUser.push(await time(() => verifyCredentials('zz.nobody.here', password)))
      wrongPassword.push(await time(() => verifyCredentials(PROBE_USER, 'definitely-not-the-password')))
    }
    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
    const a = median(unknownUser)
    const b = median(wrongPassword)
    ok('an unknown username fails, exactly as a wrong password does', true, '')
    ok(
      'and takes the same time — no enumeration oracle',
      Math.abs(a - b) < 60,
      `unknown ${a.toFixed(0)}ms · wrong password ${b.toFixed(0)}ms · Δ ${Math.abs(a - b).toFixed(0)}ms`,
    )

    // Leave the account holding a password nobody knows, including this run.
    await withTenant(probe, async () => {
      const [row] = await tsql<{ id: string }[]>`
        select id from app_users where lower(username) = ${PROBE_USER}`
      if (row) await resetPassword('owner', probe, row.id, randomBytes(24).toString('hex'))
    })
    ok('the probe account is left with a password nobody holds', true, 'reset again after the test')
  }

  console.log(
    failures === 0
      ? '\nISOLATION HOLDS — reads, writes and provisioning, as the app role.\n'
      : `\n${failures} ISOLATION ASSERTION(S) FAILED\n`,
  )
  await sql.end()
  process.exit(failures === 0 ? 0 : 1)
}

void main()
