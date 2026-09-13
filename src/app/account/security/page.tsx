import { redirect } from 'next/navigation'
import ChangePasswordForm from '@/components/auth/ChangePasswordForm'
import { getSessionUser } from '@/server/current-user'

export const dynamic = 'force-dynamic'

export default async function SecurityPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login?next=/account/security')

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-6 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Account</p>
      <h1 className="mt-1 font-display text-2xl font-bold text-stone-900">Security</h1>
      <p className="mt-1 text-sm text-stone-600">Signed in as {user.displayName} · {user.role}</p>
      <div className="mt-5">
        <ChangePasswordForm />
      </div>
    </main>
  )
}
