import { permanentRedirect } from 'next/navigation'

// RETIRED URL. Tax became a register — output from the POS, input from the bills.
// Phones and WhatsApp threads keep old links, so it still lands somewhere
// true rather than on a 404.
export const dynamic = 'force-dynamic'

export default function Page(): never {
  permanentRedirect('/accounts/registers/tax')
}
