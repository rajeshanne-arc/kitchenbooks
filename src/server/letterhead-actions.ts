'use server'

// WHOSE NAME IS ON THE DOCUMENT.
//
// A purchase order with no letterhead is a list of items from nobody. Every
// one of these fields is NULL on a new tenant and on Thrayam today, so the
// document names what it is missing rather than printing a heading with a gap
// where the address should be — the same rule the honesty strips follow.
//
// THE FIELDS ARE THE RESTAURANT'S OWN IDENTITY, not settings: they change
// nothing about what any number means, which is why they live on the
// `restaurants` row and not in `settings`. `document_style` is the one setting
// here, and it is allowed to be one for the same reason — a choice of layout
// cannot make two restaurants' figures mean different things.

import { z } from 'zod'
import { txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import type { Letterhead } from '@/lib/types'

class LetterheadError extends Error {}

export type LetterheadResult = { ok: true; letterhead: Letterhead } | { ok: false; error: string }

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof LetterheadError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('letterhead action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

/** A server action is a public endpoint and the route gate is not the check. */
async function actor(): Promise<void> {
  const user = await getSessionUser()
  if (!user) throw new LetterheadError('Sign in again — the session has expired')
  if (user.role !== 'owner' && user.role !== 'manager') {
    throw new LetterheadError('Only a manager or an owner can change the letterhead — ask them')
  }
}

const txt = (max: number) => z.string().trim().max(max)

const Schema = z.object({
  legalName: txt(200),
  addressLine1: txt(200),
  addressLine2: txt(200),
  city: txt(100),
  state: txt(100),
  pincode: txt(20),
  phone: txt(40),
  email: txt(200),
  gstin: txt(20),
  fssaiNumber: txt(30),
  // LOGO IS A URL FOR NOW, and the screen says so plainly. Upload waits on
  // attachments — decided (Vercel Blob with OIDC) and unbuilt — and a file
  // picker that silently did nothing would be worse than a field that admits
  // what it is.
  logoUrl: txt(500),
  documentStyle: z.enum(['classic', 'compact', 'plain']),
})

export type SaveLetterheadInput = z.infer<typeof Schema>

export async function saveLetterhead(raw: SaveLetterheadInput): Promise<LetterheadResult> {
  try {
    const input = Schema.parse(raw)
    await actor()
    if (input.logoUrl !== '' && !/^https:\/\//i.test(input.logoUrl)) {
      throw new LetterheadError('A logo address has to start with https:// — nothing was saved')
    }
    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const n = (s: string) => (s === '' ? null : s)

    return await txn(async (tx) => {
      await tx`
        update restaurants set
          legal_name = ${n(input.legalName)},
          address_line1 = ${n(input.addressLine1)},
          address_line2 = ${n(input.addressLine2)},
          city = ${n(input.city)},
          state = ${n(input.state)},
          pincode = ${n(input.pincode)},
          phone = ${n(input.phone)},
          email = ${n(input.email)},
          gstin = ${n(input.gstin)},
          fssai_number = ${n(input.fssaiNumber)},
          logo_url = ${n(input.logoUrl)}
        where id = ${rid}`

      // document_style rides along because it is set on the same screen and
      // nobody thinks of it as a different job.
      await tx`
        insert into settings (restaurant_id, key, value)
        values (${rid}, 'document_style', ${input.documentStyle})
        on conflict (restaurant_id, key) do update set value = excluded.value`

      // READ BACK, never echoed from the input.
      const [row] = await tx<Letterhead[]>`
        select name, legal_name, address_line1, address_line2, city, state, pincode,
               phone, email, gstin, fssai_number, logo_url
        from restaurants where id = ${rid}`
      return { ok: true as const, letterhead: row }
    })
  } catch (e) {
    return fail(e)
  }
}
