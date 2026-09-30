import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const roots = ['src', 'scripts', 'docs', 'README.md', 'AGENTS.md']
const files: string[] = []

function walk(path: string) {
  if (!existsSync(path)) return
  const stat = readdirSync(path, { withFileTypes: true })
  for (const entry of stat) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) {
      if (!['node_modules', '.next', '.git'].includes(entry.name)) walk(child)
    } else if (/\.(md|sql|tsx?|mjs|cjs)$/.test(entry.name)) {
      files.push(child)
    }
  }
}

for (const root of roots) {
  if (root.includes('.')) files.push(root)
  else walk(root)
}

const missing = new Set<string>()
for (const file of files) {
  const text = readFileSync(file, 'utf8')
  for (const match of text.matchAll(/(?:^|[(`\s])migrations\/([A-Za-z0-9_-]+\.sql)\b/g)) {
    const migration = match[1]
    if (!existsSync(join('migrations', migration))) missing.add(`${file}: migrations/${migration}`)
  }
}

assert.deepEqual([...missing], [], `references to missing migrations:\n  ${[...missing].join('\n  ')}`)
console.log(`migration reference gate — ${files.length} files checked; all referenced migrations exist`)
