'use server'

import { z } from 'zod'
import { tsql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { encryptCredentials } from '@/server/pos-credentials-queries'

const Input = z.object({
  appKey: z.string().trim().min(1).max(500),
  appSecret: z.string().trim().min(1).max(500),
  accessToken: z.string().trim().min(1).max(500),
  restaurantId: z.string().trim().min(1).max(120),
})

export async function savePetpoojaCredentials(raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = Input.parse(raw)
    const user = await getSessionUser()
    if (!user || user.role !== 'owner') return { ok: false, error: 'Only an owner can configure POS credentials' }
    const restaurant = await getRestaurant()
    const encrypted = encryptCredentials({ appKey: input.appKey, appSecret: input.appSecret, accessToken: input.accessToken, restaurantId: input.restaurantId })
    await tsql`
      insert into pos_credentials (restaurant_id, provider, ciphertext, iv, auth_tag, updated_by)
      values (${restaurant.id}, 'petpooja', ${encrypted.ciphertext}, ${encrypted.iv}, ${encrypted.authTag}, ${user.username})
      on conflict (restaurant_id) do update set provider = excluded.provider,
        ciphertext = excluded.ciphertext, iv = excluded.iv, auth_tag = excluded.auth_tag,
        updated_by = excluded.updated_by, updated_at = now()`
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'POS credentials could not be saved' }
  }
}
