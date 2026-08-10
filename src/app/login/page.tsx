import LoginForm from '@/components/auth/LoginForm'
import { getRestaurant } from '@/server/queries'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const restaurant = await getRestaurant()
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 pb-24">
      <h1 className="text-center text-2xl font-bold tracking-tight text-stone-900">{restaurant.name}</h1>
      <p className="mt-1 text-center text-sm text-stone-400">KitchenBooks — sign in</p>
      <LoginForm next={typeof next === 'string' && next.startsWith('/') ? next : '/'} />
    </main>
  )
}
