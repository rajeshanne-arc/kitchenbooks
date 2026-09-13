import { redirect } from 'next/navigation'
import { getSessionUser } from '@/server/current-user'
export const dynamic = 'force-dynamic'
export default async function SopsIndex() { const user = await getSessionUser(); if (!user) redirect('/login'); redirect(`/sops/${user.role}`) }
