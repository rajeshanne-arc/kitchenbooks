import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const files = readdirSync('migrations').filter((name) => name.endsWith('.sql')).sort()
const destructive = /\b(?:drop\s+(?:table|schema|database)|truncate|alter\s+role|grant\s+all)\b/i
const unsafeDefiners: string[] = []
const unsafeDdl: string[] = []

for (const file of files) {
  const source = readFileSync(`migrations/${file}`, 'utf8')
  // Audit executable SQL, not explanatory comments. A migration may document
  // why SECURITY DEFINER is dangerous without defining one itself.
  const executable = source
    .replace(/--[^\n]*(?:\n|$)/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
  if (destructive.test(executable)) unsafeDdl.push(file)
  const definers = [...executable.matchAll(/security\s+definer/gi)]
  for (const match of definers) {
    const block = executable.slice(match.index, match.index + 180)
    if (!/set\s+search_path\s*=/i.test(block)) unsafeDefiners.push(file)
  }
}

assert.deepEqual(unsafeDdl, [], `migration contains destructive/broad DDL: ${unsafeDdl.join(', ')}`)
assert.deepEqual(unsafeDefiners, [], `SECURITY DEFINER lacks explicit search_path: ${unsafeDefiners.join(', ')}`)
console.log(`migration safety gate — ${files.length} migrations contain no destructive/broad DDL and all definers pin search_path`)
