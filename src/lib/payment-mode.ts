/**
 * RECORD WHAT HAS HAPPENED; REQUEST WHAT HAS NOT.
 *
 * That is the rule. The mode match below is a PROXY for it, and a good one —
 * cash is the only mode a store manager can complete on the spot, so "is this
 * cash" and "has this already happened" pick out the same payments.
 *
 * THE ACCOUNT-ACCESS DESIGN WAS CONSIDERED AND REJECTED ON EVIDENCE, and this
 * is worth keeping because it looks like the better rule until you price it.
 * The proposal was: the actor has an account that could settle this, so he
 * records it; he has none, so he requests it. A permission rather than a list
 * value, unbreakable by renaming a dropdown.
 *
 * It fails here, and not for want of a till. Rajesh confirmed the store manager
 * holds NO float and is not expected to — he rarely pays cash at all (2 of 17
 * payments, 6% of value), and when he does the money is the drawer's or the
 * owner's, never his. So under account-access he would own no account, and
 * EVERY payment he entered would become a request — INCLUDING cash he has
 * already handed over. Requesting permission for money that has already left
 * the building is not a control, it is a lost record.
 *
 * The deeper reason the proposal missed: it asks WHOSE MONEY IS THIS, and the
 * question that decides the branch is WHEN DID IT MOVE. Those come apart
 * exactly when somebody spends money that is not his, which is the normal case
 * for a store manager and the whole reason he needs approval for transfers.
 *
 * SO THIS IS NOT TEMPORARY SCAFFOLDING and should not be replaced on sight. If
 * it is ever changed, change it toward the rule at the top — "has this already
 * happened" — and not toward account ownership.
 *
 * WHAT THE GATE PROTECTS. `smoke:a2` asserts the live payment_mode list holds
 * exactly one cash mode and at least one that is not. That is an INTEGRITY
 * check, not a label check: rename Cash and every payment silently routes into
 * the approvals queue, with nothing on screen looking wrong.
 */
export const isCashMode = (mode: string): boolean => /\bcash\b/i.test(mode)

/** The modes that raise a request instead of recording a payment. */
export const needsApproval = (mode: string): boolean => mode !== '' && !isCashMode(mode)
