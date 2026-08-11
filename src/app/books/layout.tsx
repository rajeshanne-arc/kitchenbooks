import BooksTabs from '@/components/books/BooksTabs'
import { getSessionUser } from '@/server/current-user'
import { pageTitleCls } from '@/components/ui'

export default async function BooksLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <h1 className={pageTitleCls}>Books</h1>
      <BooksTabs role={user?.role ?? 'store'} />
      {children}
    </main>
  )
}
