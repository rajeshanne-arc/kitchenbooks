import Link from 'next/link'
import { fmtDate } from '@/lib/format'

// A BUSINESS DATE IS A DOOR — to the owner day sheet for that date.
//
// Same shape as PersonLink and the same rule: it takes no role prop, because
// every surface that mounts it must already be one a manager or owner can
// open. `/owner/day/<date>` lives under `/owner`, which is manager+owner, so
// a mount on a chef, store or cashier screen is a LAW 1 violation and
// `audit:matrix` fails on the href rather than this file guessing.
//
// That is why it is NOT mounted on every date in the app: the fetch list, the
// day-close ladder and the sales books are cashier surfaces, and a cashier
// cannot open a flash report carrying the wage bill.
export default function DateLink({
  date,
  className = '',
  children,
}: {
  date: string
  className?: string
  /** override the label; defaults to the formatted date */
  children?: React.ReactNode
}) {
  return (
    <Link href={`/owner/day/${date}`} className={`hover:underline ${className}`}>
      {children ?? fmtDate(date)}
    </Link>
  )
}
