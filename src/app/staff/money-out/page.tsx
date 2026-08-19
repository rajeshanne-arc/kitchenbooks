// The tab's default chip, RENDERED HERE rather than redirected to.
//
// Rendering Contract bill now that Expense has left for Accounts → Payments:
// the first chip and the parent must render the same thing, or the chip row
// highlights one screen while another is on the page. That exact mismatch was
// live on /sales/record, which rendered Voucher while marking "Day close".
export const dynamic = 'force-dynamic'
export { default } from './contract/page'
