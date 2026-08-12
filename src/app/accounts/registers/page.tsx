// The registers tab, rendered here rather than redirected to.
//
// Its child is a DYNAMIC route ([key]), so a bare re-export would arrive
// with no key and notFound(). The parent supplies the default one instead —
// the same component, one implementation, and the chip row marks Purchase
// active at this URL.
import RegisterPage from './[key]/page'

export const dynamic = 'force-dynamic'

export default async function RegistersIndex({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  return RegisterPage({ params: Promise.resolve({ key: 'purchase' }), searchParams })
}
