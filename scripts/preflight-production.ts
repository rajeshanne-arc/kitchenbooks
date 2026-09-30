/**
 * Deployment preflight. It validates presence and scope, never prints a
 * secret, and deliberately refuses the local/demo defaults used by laptops.
 */
import assert from 'node:assert/strict'
import { isAbsolute } from 'node:path'

const errors: string[] = []
const present = (name: string) => (process.env[name] ?? '').trim() !== ''
const longEnough = (name: string, minimum: number) => (process.env[name] ?? '').trim().length >= minimum

const databaseUrlValue = (process.env.DATABASE_URL ?? '').trim()
if (databaseUrlValue === '') errors.push('DATABASE_URL is missing')
else {
  try {
    const databaseUrl = new URL(databaseUrlValue)
    if (databaseUrl.protocol !== 'postgres:' && databaseUrl.protocol !== 'postgresql:') {
      errors.push('DATABASE_URL must be a PostgreSQL connection string')
    } else if (databaseUrl.username !== 'kb_app') {
      errors.push('DATABASE_URL must use the dedicated kb_app runtime role, not a database-owner role')
    }
  } catch {
    errors.push('DATABASE_URL is not a valid PostgreSQL connection string')
  }
}
if ((process.env.KB_DB_SSL ?? '').trim().toLowerCase() === 'disable') errors.push('KB_DB_SSL=disable is local-only')
if (!present('KB_SESSION_SECRET')) errors.push('KB_SESSION_SECRET is missing')
else if (!longEnough('KB_SESSION_SECRET', 32)) errors.push('KB_SESSION_SECRET must be at least 32 characters')

const memberships = (process.env.KB_MEMBERSHIPS ?? '').trim().toLowerCase()
if (memberships !== '' && memberships !== 'true' && memberships !== 'false') {
  errors.push('KB_MEMBERSHIPS must be exactly true or false when set')
}

if ((process.env.PETPOOJA_DEMO ?? '').trim().toLowerCase() === 'true') errors.push('PETPOOJA_DEMO=true is not allowed in production')
if (!present('KB_POS_CREDENTIALS_KEY')) errors.push('KB_POS_CREDENTIALS_KEY is missing')
else if (!longEnough('KB_POS_CREDENTIALS_KEY', 32)) errors.push('KB_POS_CREDENTIALS_KEY must be at least 32 characters')
if (!present('CRON_SECRET')) errors.push('CRON_SECRET is missing')
else if (!longEnough('CRON_SECRET', 32)) errors.push('CRON_SECRET must be at least 32 characters')

const blobToken = process.env.BLOB_READ_WRITE_TOKEN ?? ''
const hasBlobToken = blobToken.startsWith('vercel_blob_')
const hasOidc = present('VERCEL_OIDC_TOKEN') && present('BLOB_STORE_ID')
const localStorage = (process.env.KB_FILE_STORAGE_DIR ?? '').trim()
const hasLocalStorage = isAbsolute(localStorage)
if (!hasBlobToken && !hasOidc && !hasLocalStorage) errors.push('private attachment storage is missing (use Blob credentials or an absolute KB_FILE_STORAGE_DIR on self-hosted deployments)')
if (blobToken === '[SENSITIVE]') errors.push('BLOB_READ_WRITE_TOKEN is the redacted placeholder, not a usable credential')

assert.equal(errors.length, 0, `Production preflight failed:\n- ${errors.join('\n- ')}`)
console.log('Production preflight passed: required server secrets are present, TLS is enabled, demo mode is off, and private storage is configured.')
