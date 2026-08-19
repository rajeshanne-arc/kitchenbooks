// NOT a chip parent any more — Employees and Attendance are tabs of their own,
// because one level of "people" inside a group already called Staff was enough.
//
// It stays a LIVE ROUTE rather than a retired one: phones have it bookmarked,
// and a redirect is impossible here because the target lives underneath it —
// the legacy matcher appends the remainder of a prefix, so /staff/people →
// /staff/people/employees would send /staff/people/employees to
// /staff/people/employees/employees. Rendering Employees costs one round trip
// and cannot collide with anything.
export const dynamic = 'force-dynamic'
export { default } from './employees/page'
