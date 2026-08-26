// WHATSAPP DELIVERY, VIA wa.me — and deliberately NOT the Business API.
//
// `wa.me/<number>?text=<encoded>` opens WhatsApp with the message already
// written. No Business API, no Meta template approval, no BSP, no monthly fee.
// The store manager taps Send, WhatsApp opens addressed to that vendor, he
// READS IT and presses send.
//
// THAT REVIEW STEP IS A FEATURE, NOT A LIMITATION. A document involving money
// should be seen by a person before it goes, and the one thing this app can
// never verify is whether a vendor understood it. An automated send would buy
// a receipt and lose the reading.
//
// DO NOT BUILD THE BUSINESS API HERE. When it is justified, the real work is
// not the sending — it is MULTI-TENANT IDENTITY: the vendor must see the
// RESTAURANT's name, not KitchenBooks, so every tenant needs its own WhatsApp
// Business Account and number. India utility rates are ₹0.115–0.145 a message
// while BSP platform fees start near ₹1,580/month, so at fifty orders a month
// the platform fee dwarfs the sending. wa.me tests whether vendors respond at
// all before any of that is paid for.

/**
 * A phone number as wa.me needs it: digits only, country code included, no
 * plus, no spaces, no punctuation.
 *
 * RETURNS NULL RATHER THAN GUESSING. A number that cannot be dialled is the
 * difference between an order that goes out and one that sits there, and a
 * silently mangled number looks exactly like a vendor who never replies.
 *
 * The default country code is a PARAMETER with an Indian default rather than a
 * constant, because the rest of this app is careful not to bake in one
 * country — and a 10-digit local number is the common case in the sheets this
 * replaced.
 */
export function waNumber(raw: string | null | undefined, defaultCc = '91'): string | null {
  if (raw === null || raw === undefined) return null
  const digits = raw.replace(/\D/g, '')
  if (digits === '') return null
  // already carries a country code
  if (raw.trim().startsWith('+')) return digits.length >= 8 ? digits : null
  if (digits.length === 10) return `${defaultCc}${digits}`
  // 11 digits starting 0 is a local trunk prefix — drop it
  if (digits.length === 11 && digits.startsWith('0')) return `${defaultCc}${digits.slice(1)}`
  if (digits.length >= 11) return digits
  return null
}

/** The link that opens WhatsApp with the message written. Null when there is
 *  no usable number — the caller says so in words rather than rendering a
 *  button that goes nowhere. */
export function waLink(phone: string | null | undefined, text: string): string | null {
  const n = waNumber(phone)
  if (n === null) return null
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`
}

export type WaOrderLine = { item_name: string; qty: string; purchase_unit: string; rate: string }

/**
 * The message itself: who it is from, what is wanted, when, and how much it
 * comes to at the rates WE HAVE ON RECORD.
 *
 * THE RATES ARE MARKED AS OURS, not asserted as theirs. They come from what
 * this vendor last billed, and a vendor reading a total should know whether it
 * is a quote they gave or a figure we worked out — otherwise the first
 * disagreement is about arithmetic instead of price.
 */
export function waOrderText(input: {
  restaurantName: string
  docNo: string | null
  poDate: string
  expectedDate: string | null
  lines: WaOrderLine[]
  total: string
  note: string | null
  anyRate: boolean
}): string {
  const head = [
    `*${input.restaurantName}* — Purchase order${input.docNo === null ? '' : ` ${input.docNo}`}`,
    `Date: ${input.poDate}`,
    input.expectedDate === null ? null : `Needed by: ${input.expectedDate}`,
    '',
  ].filter((x): x is string => x !== null)

  const body = input.lines.map(
    (l, i) =>
      `${i + 1}. ${l.item_name} — ${l.qty} ${l.purchase_unit}` +
      (Number(l.rate) > 0 ? ` @ ${l.rate}` : ''),
  )

  const tail = [
    '',
    input.anyRate ? `Total at our last rates: ${input.total}` : null,
    input.anyRate ? '(rates from your last bill to us — please confirm)' : null,
    input.note === null || input.note === '' ? null : `Note: ${input.note}`,
    '',
    'Please confirm.',
  ].filter((x): x is string => x !== null)

  return [...head, ...body, ...tail].join('\n')
}
