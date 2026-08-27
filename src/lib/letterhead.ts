// The letterhead's PURE half.
//
// Deliberately NOT in `letterhead-actions.ts`: every export of a `'use server'`
// module becomes a client-callable endpoint, and a lookup table and a
// list-comprehension have no business being one. Same reasoning that keeps
// `assertAccount` out of the accounts action file.

import type { DocumentStyle, Letterhead } from '@/lib/types'

/** What a document needs and this restaurant does not have.
 *
 *  NAMED, NEVER SILENTLY OMITTED. A purchase order with no letterhead is a
 *  list of items from nobody, and a document that simply leaves the address
 *  out looks like a design choice rather than a gap. Every field a document
 *  needs and the restaurant lacks is said on the screen that would print it. */
export function missingLetterheadFields(l: Letterhead): string[] {
  const need: [keyof Letterhead, string][] = [
    ['legal_name', 'legal name'],
    ['address_line1', 'address'],
    ['city', 'city'],
    ['state', 'state'],
    ['pincode', 'pincode'],
    ['phone', 'phone'],
    ['gstin', 'GSTIN'],
    ['fssai_number', 'FSSAI number'],
  ]
  return need.filter(([k]) => l[k] === null || String(l[k]).trim() === '').map(([, label]) => label)
}

/** Three layouts, and what each is for. The choice is per restaurant because
 *  taste in documents differs and nothing about a number changes with it. */
export const DOCUMENT_STYLE_NAMES: Record<DocumentStyle, string> = {
  classic: 'Classic',
  compact: 'Compact',
  message: 'Message',
}

/** WHAT EACH ONE IS FOR. The difference is the situation the document is read
 *  in, not the font — which is why there are three and not sixteen. */
export const DOCUMENT_STYLE_USES: Record<DocumentStyle, string> = {
  classic: 'A4, formal. Address block and a ruled table — what a vendor files.',
  compact: 'A4, dense. A thirty-line order still fits on one page.',
  message: 'Phone-shaped. Large type, one line per item, no wide table — reads on WhatsApp without zooming.',
}

/**
 * The stored value, narrowed — and a legacy 'plain' lands on classic.
 *
 * 'plain' was classic with the rules turned off, so that is where it belongs.
 * Reading it rather than migrating it: a setting is one row per restaurant and
 * an unrecognised value should fall back, not raise, on a screen somebody is
 * only visiting to change it.
 */
export function readDocumentStyle(v: string | null | undefined): DocumentStyle {
  if (v === 'compact' || v === 'message') return v
  return 'classic'
}
