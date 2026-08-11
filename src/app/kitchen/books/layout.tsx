import BooksNav from '@/components/BooksNav'
import { BOOKS } from '@/lib/books'

export default function KitchenBooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BooksNav views={BOOKS.kitchen} />
      {children}
    </>
  )
}
