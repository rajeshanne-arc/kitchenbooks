/**
 * WHICH PAYMENTS THE PERSON AT THE SCREEN CAN ACTUALLY MAKE.
 *
 * THIS IS A TEMPORARY RULE AND HERE IS WHAT REPLACES IT. The string match asks
 * "is this mode cash". The question that actually matters is CAN THIS PERSON
 * PERFORM THIS PAYMENT, and the two coincide today only because cash is the
 * one thing a store manager can hand over.
 *
 *   THE SUCCESSOR — key on ACCOUNT ACCESS, not on the mode string:
 *     the actor has an account that could settle this  -> he RECORDS it
 *     he has none                                      -> he REQUESTS it
 *
 * That is a PERMISSION rather than a list value. It cannot be broken by
 * renaming a dropdown option, and it generalises: give the store manager a UPI
 * wallet he controls and he can pay from it with no code change, which the
 * string match can never express.
 *
 * WHY IT IS NOT BUILT YET — a DATA gap, not a design one. There are four money
 * accounts (two bank, one owner, one wallet) and ZERO tills: `is_till` is false
 * on every one. Under account-access there would be nothing a store manager
 * could pay from, so every payment he entered would become a request —
 * INCLUDING the cash he physically hands over, which is the one case the whole
 * split exists to keep as a record. If cash leaves the restaurant, some account
 * is where it leaves from, and that account has to exist first.
 *
 * So: the match stays until a till exists, and then this file is deleted rather
 * than extended. A temporary rule that does not name its successor becomes
 * permanent.
 *
 * WHAT THE GATE PROTECTS, PRECISELY. `smoke:a2` asserts the live payment_mode
 * list holds exactly one cash mode and at least one that is not. While this
 * rule stands, that is an INTEGRITY check — rename Cash and every payment
 * silently routes into the approvals queue. After the successor lands it
 * protects only a LABEL, and should be re-read in that light rather than kept
 * out of habit.
 */
export const isCashMode = (mode: string): boolean => /\bcash\b/i.test(mode)

/** The modes that raise a request instead of recording a payment. */
export const needsApproval = (mode: string): boolean => mode !== '' && !isCashMode(mode)
