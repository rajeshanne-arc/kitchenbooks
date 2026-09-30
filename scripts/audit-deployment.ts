import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type VercelConfig = {
  regions?: unknown
  crons?: { path?: unknown; schedule?: unknown }[]
}

const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as VercelConfig
assert.ok(Array.isArray(config.regions) && config.regions.includes('bom1'), 'Vercel deployment must include the Mumbai region bom1')
const cron = config.crons?.find((entry) => entry.path === '/api/cron/pos-sync')
assert.ok(cron, 'Vercel must declare the POS sync cron route')
assert.equal(cron.schedule, '0 * * * *', 'POS sync cron must run hourly at minute zero')
console.log('deployment gate — Vercel is pinned to bom1 with the hourly POS sync route')
