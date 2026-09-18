// Acceptance probe for the reusable multi-bill writer. It uses the same
// saveBill path as the batch action, runs two bills inside one outer
// transaction, then deliberately rolls back. Nothing survives in the local
// disposable database and this script must never be aimed at Supabase.
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
  const { tsql, txn } = await import('../src/lib/db')
  const { saveBill } = await import('../src/server/save-bill')
  const { withProbeTenant } = await import('./smoke-context')
  const rid = process.env.KB_PROBE_TENANT
  if (!rid) throw new Error('KB_PROBE_TENANT is not set')

  const [vendor] = await withProbeTenant(() => tsql<{ id: string }[]>`select id from vendors where status = 'active' order by code limit 1`)
  const [item] = await withProbeTenant(() => tsql<{ id: string }[]>`select id from items where status = 'active' and tracks_expiry = false order by code limit 1`)
  assert.ok(vendor && item, 'fixture needs an active vendor and non-expiring item')
  const refs = ['ZZ-BATCH-ROLLBACK-1', 'ZZ-BATCH-ROLLBACK-2']

  await withProbeTenant(async () => {
    try {
      await txn(async () => {
        for (const [index, billNo] of refs.entries()) {
          const result = await saveBill({
            billDate: '2001-07-01', billNo,
            vendor: { kind: 'existing', id: vendor.id },
            lines: [{ item: { kind: 'existing', id: item.id }, qty: '1', rate: String(index + 1) }],
            gstTotal: '0', transport: '0',
          })
          assert.equal(result.ok, true, result.ok ? '' : result.error)
          if (result.ok) {
            const [stored] = await tsql<{ bill_no: string | null }[]>`select bill_no from purchases where id = ${result.purchase.id}`
            assert.equal(stored.bill_no, billNo, 'supplier bill reference was not retained')
          }
        }
        throw new Error('BATCH_ROLLBACK_PROBE')
      })
    } catch (error) {
      assert.equal((error as Error).message, 'BATCH_ROLLBACK_PROBE')
    }
    const rows = await tsql<{ n: number }[]>`select count(*)::int as n from purchases where restaurant_id = ${rid} and bill_no = any(${refs}::text[])`
    assert.equal(rows[0].n, 0, 'a failed batch left a purchase behind')
  })

  console.log('PURCHASE BATCH TRANSACTION ASSERTIONS PASSED')
}

void main().catch((error) => { console.error(error); process.exitCode = 1 })
