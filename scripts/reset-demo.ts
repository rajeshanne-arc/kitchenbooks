import { tsql } from '@/lib/db'

const tenant = process.env.KB_DEMO_TENANT_ID
const owner = process.env.KB_DEMO_OWNER_USERNAME ?? 'sunny'

if (!tenant) throw new Error('KB_DEMO_TENANT_ID is not set')

await tsql`select reset_demo_tenant(${tenant}::uuid, ${owner})`
await tsql`select seed_demo_tenant(${tenant}::uuid, ${owner})`
console.log(`demo tenant reset and reseeded: ${tenant}`)
