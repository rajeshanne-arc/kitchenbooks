import LoginForm from '@/components/auth/LoginForm'
import { getRestaurant } from '@/server/queries'
import { sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const restaurant = await getRestaurant()
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 pb-24">
      <h1 className="text-center font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-stone-900">
        {restaurant.name}
      </h1>
      <p className={`mt-2 text-center ${sectionHeadCls}`}>KitchenBooks · sign in</p>
      <LoginForm next={typeof next === 'string' && next.startsWith('/') ? next : '/'} />
    </main>
  )
}
