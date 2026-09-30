import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const files = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()
const runbook = readFileSync('docs/migration-runbook.md', 'utf8')
const ordered = [...runbook.matchAll(/^\d+\.\s+`([\w-]+\.sql)`/gm)].map((match) => match[1])
const maintenanceText = runbook.match(/The following maintenance migrations[\s\S]*?\n\n/)?.[0] ?? ''
const maintenance = [...maintenanceText.matchAll(/`([\w-]+\.sql)`/g)].map((match) => match[1])
const listed = [...ordered, ...maintenance]
const counts = new Map<string, number>()
for (const name of listed) counts.set(name, (counts.get(name) ?? 0) + 1)

const missing = files.filter((name) => !counts.has(name))
const unknown = listed.filter((name) => !files.includes(name))
const duplicate = [...counts.entries()].filter(([, count]) => count > 1).map(([name]) => name)

assert.deepEqual(missing, [], `migration files missing from docs/migration-runbook.md: ${missing.join(', ')}`)
assert.deepEqual(unknown, [], `runbook lists files that do not exist: ${unknown.join(', ')}`)
assert.deepEqual(duplicate, [], `migration files are listed more than once: ${duplicate.join(', ')}`)
console.log(`migration runbook gate — ${files.length} SQL migrations accounted for exactly once`)
