// The tab's default view, RENDERED HERE rather than redirected to — the same
// rule as every other chip parent. A redirect would cost two round trips per
// tab click, and the chip row already marks the first chip active at the
// parent URL, so the screen looks identical and simply arrives once.
//
// Rendering On hand: what is on the shelf is the question a store manager
// opens this tab to answer, and the negative-stock warning lives here.
//
// `dynamic` is declared rather than re-exported — Next parses that field
// statically and will not follow it through a re-export.
export const dynamic = 'force-dynamic'
export { default } from './on-hand/page'
