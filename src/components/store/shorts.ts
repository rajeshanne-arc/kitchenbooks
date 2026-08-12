// The shorts vocabulary, shared by the server and the screens.
//
// These two sets are database CHECK constraints, not managed lists — a new
// kind or a new settlement is a migration, not a Settings entry. That is why
// they live in code beside the forms rather than in list_options.

import type { ShortKind, ShortRow, ShortSettlement } from '@/lib/types'

export const SHORT_KINDS: readonly ShortKind[] = ['short', 'damaged', 'rejected']

export const SHORT_KIND_LABELS: Record<ShortKind, string> = {
  short: 'Short',
  damaged: 'Damaged',
  rejected: 'Rejected',
}

/** what each one means at the door, in the receiver's words */
export const SHORT_KIND_HELP: Record<ShortKind, string> = {
  short: 'billed, never arrived',
  damaged: 'arrived unusable',
  rejected: 'sent back at the door',
}

export const SHORT_SETTLEMENTS: readonly ShortSettlement[] = ['open', 'credit_note', 'replaced', 'absorbed']

export const SHORT_SETTLEMENT_LABELS: Record<ShortSettlement, string> = {
  open: 'Open — nobody has chased it',
  credit_note: 'Credit note received',
  replaced: 'Replaced by the vendor',
  absorbed: 'Absorbed — we let it go',
}

/** the short word for a column, where the sentence above is already on screen */
export const SHORT_SETTLEMENT_SHORT: Record<ShortSettlement, string> = {
  open: 'Open',
  credit_note: 'Credit note',
  replaced: 'Replaced',
  absorbed: 'Absorbed',
}

/**
 * A short with the two figures Postgres works out for it: what the vendor
 * billed (arrived + short) and what the shortfall is worth at the bill rate.
 * Both are numeric text off the database — never multiplied in JavaScript,
 * so the row on screen agrees with vendor_performance to the paisa.
 */
export type ValuedShort = ShortRow & { qty_billed: string; short_value: string }
