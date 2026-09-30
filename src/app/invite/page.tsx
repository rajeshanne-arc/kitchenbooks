import { createHash } from 'node:crypto'
import { tsql } from '@/lib/db'
import InvitationForm from '@/components/auth/InvitationForm'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  const tokenValue = typeof token === 'string' && token.length >= 40 && token.length <= 100 ? token : null
  const [invitation] = tokenValue !== null ? await tsql<{ restaurant_name: string; username: string; display_name: string; role: string }[]>`
    select restaurant_name, username, display_name, role from invitation_for_token(${createHash('sha256').update(tokenValue).digest('hex')})
  ` : []
  return <main className="mx-auto max-w-md px-5 py-12">
    <h1 className={pageTitleCls}>Join KitchenBooks</h1>
    <p className={pageSubCls}>{invitation ? `${invitation.display_name}, you were invited to ${invitation.restaurant_name} as ${invitation.role}.` : 'This invitation is missing, expired, or already used.'}</p>
    {invitation && tokenValue !== null && <InvitationForm token={tokenValue} username={invitation.username} />}
  </main>
}
