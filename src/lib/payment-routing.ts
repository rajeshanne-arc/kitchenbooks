// Which modes a particular vendor can actually be paid by.
//
// PURE, AND IN lib RATHER THAN NEXT TO THE QUERY, because the owner's routing
// control runs in the browser and `approvals-queries` is `server-only`. Same
// shape as `src/lib/payment-mode.ts`, which holds the record-or-request rule
// for the same reason.

/**
 * NOBODY CAN BE PAID BY UPI, AND THE SCREEN SAYS SO RATHER THAN OFFERING IT.
 *
 * Measured: 39 active vendors, 32 with bank details, **0 with a UPI id**, 7
 * with neither. `UPI` is nonetheless an active row in the payment_mode list,
 * so it is offered on every routing control and could not be used on a single
 * vendor — an option that cannot be taken is worse than a missing one, because
 * somebody picks it and finds out afterwards.
 *
 * The filter is PER VENDOR rather than global: the day one vendor supplies a
 * UPI id, that vendor's control offers it and the rest still say why they do
 * not. A global switch would need somebody to remember to flip it.
 */
export function modesForVendor(
  modes: string[],
  /** structural rather than the query's row type: this file must not import
   *  from a server-only module, and the only two fields that decide a mode
   *  are these. */
  vendor: { upi_id: string | null; account_no: string | null } | undefined,
): {
  allowed: string[]
  withheld: { mode: string; why: string }[]
} {
  const withheld: { mode: string; why: string }[] = []
  const allowed = modes.filter((m) => {
    if (/\bupi\b/i.test(m) && (vendor?.upi_id ?? '') === '') {
      withheld.push({ mode: m, why: 'no UPI id on record for this vendor' })
      return false
    }
    // A transfer needs somewhere to transfer TO. The bank details are the
    // whole of what makes the mode possible, and their absence is the
    // vendor's to fix, not the owner's to work around.
    if (/transfer|neft|imps|rtgs/i.test(m) && (vendor?.account_no ?? '') === '') {
      withheld.push({ mode: m, why: 'no account number on record for this vendor' })
      return false
    }
    return true
  })
  return { allowed, withheld }
}
