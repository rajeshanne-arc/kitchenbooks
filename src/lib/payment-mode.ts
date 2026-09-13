/**
 * WHICH MODES MEAN "I HANDED OVER THE MONEY MYSELF".
 *
 * The store manager records what he OBSERVED. He watched cash leave his hand,
 * so he records a payment. He did not make the bank transfer, so he raises a
 * request instead — recording a transfer he did not make is writing down
 * hearsay, and on live data it is also the common case: 94% of payment value
 * has gone by transfer, 6% in cash.
 *
 * THE TENSION, STATED RATHER THAN HIDDEN. `payment_mode` is a managed list, and
 * this file makes one of its VALUES decide whether money is recorded or
 * requested — which is close to the line this project draws at "settings
 * configure vocabulary, never integrity". It stays on the right side of that
 * line only because it is CHECKED: `smoke:a2` asserts the live list contains
 * exactly one cash mode, so renaming it to something this cannot recognise
 * fails a gate instead of silently routing every payment into the approvals
 * queue. Without that assertion this would be a rename away from broken.
 *
 * The screen also never leaves the branch implicit — it says which act is
 * about to happen, in the words of the act, before the button is pressed.
 */
export const isCashMode = (mode: string): boolean => /\bcash\b/i.test(mode)

/** The modes that raise a request instead of recording a payment. */
export const needsApproval = (mode: string): boolean => mode !== '' && !isCashMode(mode)
