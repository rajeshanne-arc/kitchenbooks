import BooksNav from '@/components/BooksNav'
import { BOOKS } from '@/lib/books'

export default function SalesBooksLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <BooksNav views={BOOKS.sales} />
      {children}
    </>
  )
}
