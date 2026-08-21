import Link from 'next/link'
import { getSessionUser } from '@/server/current-user'
import { canAccess } from '@/lib/roles'
import { fmtDate } from '@/lib/format'

// A BUSINESS DATE IS A DOOR — to the owner day sheet for that date.
//
// IT GATES ITSELF, and that is the difference from PersonLink. The employee
// profile exists for every role that can reach it and hides a CARD from some
// of them, so a name can be a link anywhere and audit:matrix is enough. The
// day sheet gates the WHOLE PAGE: `/owner/day` is manager+owner, so a link to
// it from a reader who is denied is a link to a wall.
//
// That is not hypothetical — audit:matrix caught it on the first run. The
// ACCOUNTANT can open an employee profile and cannot open the day sheet, so
// the attendance strip there was handing them thirty dead links.
//
// So this component asks the matrix rather than trusting each caller to
// remember. A denied reader gets the same text, unlinked: they lose a door
// they never had, not information.
export default async function DateLink({
  date,
  className = '',
  title,
  children,
}: {
  date: string
  className?: string
  /** the day strip's cells carry their own sentence — see dayTitle */
  title?: string
  /** override the label; defaults to the formatted date */
  children?: React.ReactNode
}) {
  const user = await getSessionUser()
  const label = children ?? fmtDate(date)
  if (user === null || !canAccess(user.role, `/owner/day/${date}`)) {
    return (
      <span title={title} className={className}>
        {label}
      </span>
    )
  }
  return (
    <Link href={`/owner/day/${date}`} title={title} className={`hover:underline ${className}`}>
      {label}
    </Link>
  )
}
