import Link from 'next/link'
import { deniedHint } from '@/lib/roles'
import { getSessionUser } from '@/server/current-user'

export const dynamic = 'force-dynamic'

export default async function DeniedPage({ searchParams }: { searchParams: Promise<{ path?: string }> }) {
  const { path } = await searchParams
  const user = await getSessionUser()
  const hint = deniedHint(typeof path === 'string' ? path : '/')

  return (
    <main className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col justify-center px-4 pb-24 text-center">
      <p className="text-4xl">🔒</p>
      <h1 className="mt-2 text-xl font-bold text-stone-900">Not your key</h1>
      <p className="mt-2 text-sm text-stone-600">
        {user !== null && (
          <>
            You are signed in as <span className="font-semibold">{user.displayName}</span> ({user.role}).{' '}
          </>
        )}
        {hint}
      </p>
      <Link href="/" className="mt-4 text-sm font-medium text-emerald-700 hover:underline">
        ← Back to home
      </Link>
    </main>
  )
}
