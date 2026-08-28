// WHERE A TAB LIVES, ASKED RATHER THAN REMEMBERED.
//
// Discarding an item offered a link to /owner/setup/approvals. Approvals had
// moved to /owner/approvals when it became a main tab, and one literal string
// did not move with it. That is a HAND-MAINTAINED COPY OF A ROUTE — the same
// shape as the retired-URL list sitting at 51 against legacy.ts's 57, and
// DOC_TYPES at eight against nine. Third instance.
//
// `tabs.ts` already knows where every tab and chip lives; it is the registry
// the tab strip, the chip row and the settings editor all read. This makes it
// answer the same question for a link in a component, so a tab move is one
// edit rather than one edit plus however many literals nobody greps for.
//
// SCOPED TO TAB DESTINATIONS, DELIBERATELY. A deep link — /store/masters/items/
// <id>, /owner/day/<date> — does not move when a tab moves, has no entry in any
// registry, and could not be expressed through one. Forcing those through here
// would be ceremony that buys nothing; the class that actually broke is the
// class that has an answer.

import { TAB_DEFAULTS, chipsOf, type TabGroup } from '@/lib/tabs'

/**
 * A tab's URL, from the registry.
 *
 * Throws on an unknown key rather than returning a plausible-looking path. A
 * link is a promise that a page exists, and a silent fallback would keep that
 * promise loosely — which is exactly how the stale one survived.
 */
export function tabHref(group: TabGroup, key: string): string {
  const tab = TAB_DEFAULTS[group].find((t) => t.key === key)
  if (tab === undefined) throw new Error(`No ${group} tab called "${key}" — check src/lib/tabs.ts`)
  return tab.href
}

/** A chip's URL: its tab's href, plus the chip key. Same shape the chip row
 *  builds, so the two cannot drift. */
export function chipHref(group: TabGroup, tabKey: string, chipKey: string): string {
  const chip = chipsOf(group, tabKey).find((c) => c.key === chipKey)
  if (chip === undefined) {
    throw new Error(`No "${chipKey}" chip under ${group}/${tabKey} — check src/lib/tabs.ts`)
  }
  return `${tabHref(group, tabKey)}/${chip.key}`
}

/**
 * Every tab and chip destination there is — what the gate compares literals
 * against, and the answer to "is this string a route that can move".
 */
export function allTabRoutes(): string[] {
  const out: string[] = []
  for (const g of Object.keys(TAB_DEFAULTS) as TabGroup[]) {
    for (const t of TAB_DEFAULTS[g]) {
      out.push(t.href)
      for (const c of t.chips ?? []) out.push(`${t.href}/${c.key}`)
    }
  }
  return out
}
