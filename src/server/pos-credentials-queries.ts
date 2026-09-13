import 'server-only'

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { tsql } from '@/lib/db'

export type PetpoojaCredentials = { appKey: string; appSecret: string; accessToken: string; restaurantId: string }

function key(): Buffer {
  const secret = process.env.KB_POS_CREDENTIALS_KEY ?? ''
  if (secret === '') throw new Error('KB_POS_CREDENTIALS_KEY is not configured')
  return createHash('sha256').update(secret).digest()
}

export function encryptCredentials(value: PetpoojaCredentials) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()])
  return { ciphertext: ciphertext.toString('base64'), iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') }
}

function decrypt(row: { ciphertext: string; iv: string; auth_tag: string }): PetpoojaCredentials {
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(row.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.auth_tag, 'base64'))
  const parsed = JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as Partial<PetpoojaCredentials>
  if (![parsed.appKey, parsed.appSecret, parsed.accessToken, parsed.restaurantId].every((value) => typeof value === 'string' && value !== '')) throw new Error('Stored Petpooja credentials are invalid')
  return parsed as PetpoojaCredentials
}

export async function getPetpoojaCredentials(restaurantId: string): Promise<PetpoojaCredentials | null> {
  const [row] = await tsql<{ ciphertext: string; iv: string; auth_tag: string }[]>`
    select ciphertext, iv, auth_tag from pos_credentials
    where restaurant_id = ${restaurantId} and provider = 'petpooja'`
  return row ? decrypt(row) : null
}

export async function hasPetpoojaCredentials(restaurantId: string): Promise<boolean> {
  const [row] = await tsql<{ present: boolean }[]>`
    select exists (select 1 from pos_credentials where restaurant_id = ${restaurantId} and provider = 'petpooja') as present`
  return row?.present ?? false
}
