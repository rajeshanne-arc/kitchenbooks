import { getRestaurant } from '@/server/queries'
import { anyUsers } from '@/server/auth-core'
import SetupForm from '@/components/auth/SetupForm'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function SetupPage() {
  const restaurant = await getRestaurant()
  const closed = await anyUsers(restaurant.id)

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 pb-24">
      <h1 className="text-center text-2xl font-bold tracking-tight text-stone-900">{restaurant.name}</h1>
      <p className="mt-1 text-center text-sm text-stone-400">first-time setup</p>
      {closed ? (
        <div className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 text-center shadow-sm">
          <p className="text-[15px] font-semibold text-stone-900">Setup is closed.</p>
          <p className="mt-1 text-sm text-stone-500">
            Accounts already exist. Sign in instead — or ask an owner to add you.
          </p>
          <Link href="/login" className="mt-3 inline-block text-sm font-medium text-emerald-700 hover:underline">
            Go to sign in →
          </Link>
        </div>
      ) : (
        <SetupForm />
      )}
    </main>
  )
}
