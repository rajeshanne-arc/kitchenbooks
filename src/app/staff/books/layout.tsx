import BooksNav from '@/components/BooksNav'
import { BOOKS } from '@/lib/books'

export default function StaffBooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BooksNav views={BOOKS.staff} />
      {children}
    </>
  )
}
