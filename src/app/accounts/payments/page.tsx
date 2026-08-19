// The tab's default chip, RENDERED HERE rather than redirected to — one server
// round trip instead of two, the same as every other chip parent. The chip row
// marks the first chip active at the parent URL, so the screen looks identical;
// it just arrives once.
//
// Rendering Expense, which is the first chip — `dynamic` is declared here
// rather than re-exported, because Next parses that field statically and
// refuses to follow it through a re-export.
export const dynamic = 'force-dynamic'
export { default } from './expense/page'
