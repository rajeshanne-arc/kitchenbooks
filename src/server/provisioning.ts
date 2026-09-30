import 'server-only'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { hashPassword } from '@/server/auth-core'

export class ProvisioningError extends Error {}

const Input = z.object({
  name: z.string().trim().min(2).max(120),
  ownerUsername: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/),
  ownerDisplayName: z.string().trim().min(1).max(80),
  ownerPassword: z.string().min(8).max(200),
})

export async function provisionRestaurant(
  platformKey: string | undefined,
  raw: unknown,
): Promise<{ ok: true; restaurantId: string } | { ok: false; error: string }> {
  try {
    const expected = process.env.KB_PLATFORM_ADMIN_KEY
    if (!expected || platformKey !== expected) throw new ProvisioningError('Platform authorization failed')
    const input = Input.parse(raw)
    const passwordHash = await hashPassword(input.ownerPassword)
    const [row] = await tsql<{ provision_restaurant: string }[]>`
      select provision_restaurant(
        ${input.name}, ${input.ownerUsername}, ${input.ownerDisplayName}, ${passwordHash}
      )`
    if (!row?.provision_restaurant) throw new ProvisioningError('Restaurant was not created')
    return { ok: true, restaurantId: row.provision_restaurant }
  } catch (error) {
    if (error instanceof ProvisioningError) return { ok: false, error: error.message }
    if (error instanceof z.ZodError) return { ok: false, error: 'Invalid provisioning input — nothing was created' }
    console.error('restaurant provisioning failed', error)
    return { ok: false, error: 'Provisioning failed — nothing was created' }
  }
}
