import LoginForm from '@/components/auth/LoginForm'
import { sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

// THE LOGIN SCREEN DOES NOT NAME A RESTAURANT, and cannot.
//
// It used to print `getRestaurant().name` above the form. That worked while a
// deployment served exactly one restaurant and KB_TENANT said which — and the
// moment a second one existed it became a 500 on the one page nobody can get
// past, because getRestaurant() refuses to guess between two with no session
// to say which. Naming the tenant before knowing who is signing in was always
// a single-tenant artefact; this is what the screen looks like without it.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-sm flex-col justify-center px-4 pb-24">
      <h1 className="text-center font-display text-[28px] font-bold leading-none tracking-[-0.02em] text-stone-900">
        KitchenBooks
      </h1>
      <p className={`mt-2 text-center ${sectionHeadCls}`}>sign in</p>
      <LoginForm next={typeof next === 'string' && next.startsWith('/') ? next : '/'} />
    </main>
  )
}
