// THREE STATES, NOT TWO — absent, unreadable, and present.
//
// `null` for both absent and unreadable is what let a corrupted `snapshot`
// render "no snapshot recorded" on every request ever made: AN HONEST EMPTY
// STATE ABSORBED A BROKEN READ, and the two were indistinguishable on screen
// by construction. A fallback for absent data is a place a broken read can
// hide, and the better the empty state the better the hiding place — so the
// sentence for "nobody recorded one" must not be reachable when one WAS
// recorded and will not parse.
//
// PURE, AND IN lib, so it can be asserted by value. It lived inside the
// component that needed it, which meant the distinction it exists to draw had
// nothing holding it: collapsing `unreadable` back into `absent` passed every
// gate in the suite.
//
// THE LEGACY SHAPE IS PARSED RATHER THAN REFUSED. `${JSON.stringify(x)}::jsonb`
// double-encoded four rows before the writes were fixed, and `snapshot` has no
// UPDATE grant, so they can never be repaired — only read. The stored string IS
// the object's JSON, so parsing recovers it exactly. That is reading round a
// fault rather than inventing a value, and it is available ONLY because
// nothing was lost; anything that does not parse to an object reports
// `unreadable` rather than guessing at it.

export type Read<T> = { state: 'ok'; value: T } | { state: 'absent' } | { state: 'unreadable' }

export function readObject<T>(v: unknown): Read<T> {
  if (v === null || v === undefined) return { state: 'absent' }
  if (typeof v === 'object') return { state: 'ok', value: v as T }
  if (typeof v === 'string') {
    try {
      const parsed: unknown = JSON.parse(v)
      // A jsonb SCALAR is not the object it was meant to be. `"5"` and
      // `"\"x\""` parse perfectly and are still the wrong shape.
      if (typeof parsed === 'object' && parsed !== null) return { state: 'ok', value: parsed as T }
    } catch {
      /* falls through to unreadable */
    }
  }
  return { state: 'unreadable' }
}
