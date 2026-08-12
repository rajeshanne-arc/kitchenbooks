// The tab's default chip, RENDERED HERE rather than redirected to.
//
// Every one of these was a redirect, so every tab click cost two server
// round trips: one to be told where to go, one to go there. On a phone in a
// kitchen that is the difference people describe as "slow". The chip row
// marks the first chip active at the parent URL, so the screen looks
// identical — it just arrives once.
//
// Rendering Expense — the same component the chip's own URL renders, so
// there is one implementation and it cannot drift. `dynamic` is declared
// here rather than re-exported: Next parses that field statically and
// refuses to follow it through a re-export.
export const dynamic = 'force-dynamic'
export { default } from './expense/page'
