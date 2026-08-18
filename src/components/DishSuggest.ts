// Ranking a DISH picker the way the item pickers are ranked.
//
// THE SAME PRINCIPLE, in the one place a <select> can express it: the dishes a
// context has actually used render in a labelled <optgroup> on top, and EVERY
// dish stays in the group below. Scoping never excludes — a dish comped for the
// first time has no history, and a picker that only offered history would make
// it unreachable.
//
// The rank is FREQUENCY THEN RECENCY, computed here from rows the server
// already ranked, because narrowing by scope changes which rows are in play and
// therefore their order.

import type { DishUsage } from '@/lib/types'

/**
 * Split a dish list into (suggested, rest) for one scope.
 *
 * `scope` of '' means no context yet — then the rank is overall frequency,
 * summed across every scope, which is the other half of the rule rather than a
 * fallback to alphabetical.
 */
export function rankDishes<T>(
  dishes: T[],
  usage: DishUsage[],
  scope: string,
  /** how to read the recipe id off a row. Explicit rather than assuming `.id`:
   *  the off-book picker's rows call it `recipe_id`, and a cast to paper over
   *  that is how a picker silently matches nothing. */
  idOf: (d: T) => string,
  cap = 6,
): { suggested: T[]; rest: T[] } {
  const rows = scope === '' ? usage : usage.filter((u) => u.scope === scope)
  // Summed, not picked: with no scope the same dish appears once per reason,
  // and taking the first row would rank it by one reason's count alone.
  const tally = new Map<string, { times: number; last: string }>()
  for (const u of rows) {
    const prev = tally.get(u.recipe_id)
    tally.set(u.recipe_id, {
      times: (prev?.times ?? 0) + u.times,
      last: prev === undefined || u.last > prev.last ? u.last : prev.last,
    })
  }
  const byId = new Map(dishes.map((d) => [idOf(d), d]))
  const suggested = [...tally.entries()]
    .sort((a, b) => b[1].times - a[1].times || b[1].last.localeCompare(a[1].last))
    .map(([id]) => byId.get(id))
    .filter((d): d is T => d !== undefined)
    .slice(0, cap)
  const shown = new Set(suggested.map(idOf))
  return { suggested, rest: dishes.filter((d) => !shown.has(idOf(d))) }
}
