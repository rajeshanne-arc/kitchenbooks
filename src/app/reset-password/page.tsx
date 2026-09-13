import Link from 'next/link'
import ResetPasswordForm from '@/components/auth/ResetPasswordForm'

export const dynamic = 'force-dynamic'

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 pb-24">
      <h1 className="text-center font-display text-[28px] font-bold text-stone-900">KitchenBooks</h1>
      {typeof token === 'string' && token.length > 0 ? <ResetPasswordForm token={token} /> : <p className="mt-5 rounded-2xl border border-stone-200 bg-white p-5 text-center text-sm text-stone-600">This reset link is missing. Ask an owner to issue a new one.</p>}
      <Link href="/login" className="mt-4 text-center text-sm font-medium text-emerald-700 hover:underline">Back to sign in</Link>
    </main>
  )
}
