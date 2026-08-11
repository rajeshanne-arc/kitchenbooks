import BooksNav from '@/components/BooksNav'
import { BOOKS } from '@/lib/books'

export default function StoreBooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BooksNav views={BOOKS.store} />
      {children}
    </>
  )
}
