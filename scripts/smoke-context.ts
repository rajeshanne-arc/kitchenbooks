import { withTenant } from '../src/lib/tenant'

/** All database-writing smoke suites run against an explicitly named probe.
 * The live tenant check is a second guard against copying the same value into
 * both environment variables and turning an acceptance test into production
 * data. */
export function withProbeTenant<T>(fn: () => Promise<T>): Promise<T> {
  const probe = process.env.KB_PROBE_TENANT
  if (!probe) throw new Error('KB_PROBE_TENANT is not set — write-capable smoke suites require a disposable probe tenant')
  if (process.env.KB_LIVE_TENANT && process.env.KB_LIVE_TENANT === probe) {
    throw new Error('KB_PROBE_TENANT equals KB_LIVE_TENANT — refusing to write smoke evidence to the live tenant')
  }
  return withTenant(probe, fn)
}
