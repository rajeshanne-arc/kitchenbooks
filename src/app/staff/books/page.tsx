import { permanentRedirect } from 'next/navigation'

// RETIRED URL. The staff Books tab held a SECOND mount of SectionsView and is gone;
// the surviving one is in the kitchen books.
// Phones and WhatsApp threads keep old links, so it still lands somewhere
// true rather than on a 404.
export const dynamic = 'force-dynamic'

export default function Page(): never {
  permanentRedirect('/kitchen/books/sections')
}
