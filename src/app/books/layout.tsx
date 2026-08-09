import BooksTabs from '@/components/books/BooksTabs'

export default function BooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-2xl px-4 pb-24 pt-6 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight text-stone-900">Books</h1>
      <BooksTabs />
      {children}
    </main>
  )
}
