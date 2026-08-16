// Phase-5 smoke: the DoD through the real server modules — add a CH cook
// (L3, 45,000) and an SV steward (16,000), mark today (cook present,
// steward off), assert labour_cost_by_section shows CH = 45000/days and
// SV = 16000/days (off is PAID), re-mark the steward absent (new row wins,
// history keeps both), add a contract valet (excluded), and check
// section_costs joins consumption + labour. Prints ids for admin cleanup.
//
// Run: npm run smoke:labour
import assert from 'node:assert/strict'

process.loadEnvFile('.env.local')

async function main() {
const { businessMonthStart, businessToday } = await import('../src/server/business-day')
    const { getRestaurant } = await import('../src/server/queries')
  const { getSections } = await import('../src/server/store-queries')
  const { createStaff, saveAttendance, updateStaff } = await import('../src/server/labour-actions')
  const { getDaySheet, getSectionCosts, listRoster } = await import('../src/server/labour-queries')
  const { sql } = await import('../src/lib/db')

  const restaurant = await getRestaurant()
  const rid = restaurant.id
  const today = await businessToday()
  const monthStart = await businessMonthStart()
  const daysInMonth = new Date(Number(monthStart.slice(0, 4)), Number(monthStart.slice(5, 7)), 0).getDate()
  console.log('restaurant:', restaurant.name, '| today:', today, '| days in month:', daysInMonth)

  const near = (a: string, b: number, msg: string) => {
    const diff = Math.abs(Number(a) - b)
    assert.ok(diff < 0.01, `${msg}: expected ≈${b.toFixed(4)}, got ${a}`)
  }

  const sections = await getSections(rid)
  const ch = sections.find((s) => s.code === 'CH')
  const sv = sections.find((s) => s.code === 'SV')
  const vl = sections.find((s) => s.code === 'VL')
  assert.ok(ch && sv && vl, 'CH, SV, VL sections must exist')
  assert.equal(sections.length, 16, '16 org units expected')

  const blank = {
    designation: '', sectionId: '', grade: '', baseSalary: '', payMode: '',
    joined: '', leftDate: '', reportsTo: '', phone: '', status: 'active' as const,
  }

  // ---- cook & steward
  const cook = await createStaff({
    ...blank, name: 'Zz Cook', designation: 'Cook', sectionId: ch.id, grade: 'L3',
    employmentType: 'full_time', baseSalary: '45000', payMode: 'account',
  })
  assert.ok(cook.ok, `create cook failed: ${cook.ok === false ? cook.error : ''}`)
  assert.equal(cook.staff.code, 'E001')
  const steward = await createStaff({
    ...blank, name: 'Zz Steward', designation: 'Steward', sectionId: sv.id, grade: 'L1',
    employmentType: 'full_time', baseSalary: '16000', payMode: 'cash',
  })
  assert.ok(steward.ok, `create steward failed: ${steward.ok === false ? steward.error : ''}`)
  assert.equal(steward.staff.code, 'E002')

  // roster order: cook (Kitchen) before steward (Service)
  const roster = await listRoster(rid)
  assert.deepEqual(roster.map((r) => r.code), ['E001', 'E002'])

  // ---- mark today: cook present, steward off
  const marks = await saveAttendance({
    date: today,
    marks: [
      { staffId: cook.staff.id, status: 'present' },
      { staffId: steward.staff.id, status: 'off' },
    ],
  })
  assert.ok(marks.ok, `saveAttendance failed: ${marks.ok === false ? marks.error : ''}`)
  assert.equal(marks.inserted, 2)

  let costs = await getSectionCosts(rid, monthStart)
  near(costs.find((c) => c.section_code === 'CH')!.labour, 45000 / daysInMonth, 'CH labour (present)')
  near(costs.find((c) => c.section_code === 'SV')!.labour, 16000 / daysInMonth, 'SV labour (off is PAID)')

  // ---- re-mark the steward absent: new row wins, history keeps both
  const remark = await saveAttendance({ date: today, marks: [{ staffId: steward.staff.id, status: 'absent' }] })
  assert.ok(remark.ok && remark.inserted === 1, 're-mark must insert exactly one new row')
  const sheet = await getDaySheet(rid, today)
  const stewardRow = sheet.find((r) => r.staff_id === steward.staff.id)!
  assert.equal(stewardRow.effective, 'absent')
  assert.equal(stewardRow.history.length, 2, 'both rows must remain visible')
  assert.equal(stewardRow.history[0].status, 'absent', 'latest row is effective')
  assert.equal(stewardRow.history[1].status, 'off')

  costs = await getSectionCosts(rid, monthStart)
  assert.equal(Number(costs.find((c) => c.section_code === 'SV')!.labour), 0, 'SV drops to 0 after absent')

  // idempotent save: same status inserts nothing
  const again = await saveAttendance({ date: today, marks: [{ staffId: steward.staff.id, status: 'absent' }] })
  assert.ok(again.ok && again.inserted === 0, 're-saving the same status must not add rows')

  // ---- contract valet: attendance allowed, labour unchanged
  const valet = await createStaff({
    ...blank, name: 'Zz Valet', designation: 'Valet', sectionId: vl.id,
    employmentType: 'contract', baseSalary: '20000',
  })
  assert.ok(valet.ok, `create valet failed: ${valet.ok === false ? valet.error : ''}`)
  assert.equal(valet.staff.code, 'E003')
  const vmark = await saveAttendance({ date: today, marks: [{ staffId: valet.staff.id, status: 'present' }] })
  assert.ok(vmark.ok)
  costs = await getSectionCosts(rid, monthStart)
  assert.equal(Number(costs.find((c) => c.section_code === 'VL')!.labour), 0, 'contract stays out of labour cost')

  // ---- honesty columns: unsalaried + unassigned
  const helper = await createStaff({
    ...blank, name: 'Zz Helper', employmentType: 'full_time',
  })
  assert.ok(helper.ok, 'create helper failed')
  const hmark = await saveAttendance({ date: today, marks: [{ staffId: helper.staff.id, status: 'present' }] })
  assert.ok(hmark.ok)
  costs = await getSectionCosts(rid, monthStart)
  const unassignedRow = costs.find((c) => c.section_code === '—')
  assert.ok(unassignedRow, 'unassigned row must surface')
  assert.equal(unassignedRow.unassigned_marks, 1)
  assert.equal(unassignedRow.unsalaried_marks, 1)
  assert.equal(Number(unassignedRow.labour), 0)

  // section_costs joins both legs for CH
  const chRow = costs.find((c) => c.section_code === 'CH')!
  near(chRow.total_cost, Number(chRow.consumption) + 45000 / daysInMonth, 'CH total = consumption + labour')

  // update path: move helper into CH, salary set — granted columns only
  const fix = await updateStaff(helper.staff.id, {
    ...blank, name: 'Zz Helper', sectionId: ch.id, baseSalary: '12000', employmentType: 'full_time',
  })
  assert.ok(fix.ok && fix.staff.section_code === 'CH' && fix.staff.base_salary === '12000')

  console.log('ALL LABOUR SMOKE ASSERTIONS PASSED')
  console.log(
    'CLEANUP_IDS ' +
      JSON.stringify({ staff: [cook.staff.id, steward.staff.id, valet.staff.id, helper.staff.id] }),
  )
  await sql.end()
}

main().catch((e) => {
  console.error('LABOUR SMOKE FAILED:', e)
  process.exit(1)
})
