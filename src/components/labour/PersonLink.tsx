import Link from 'next/link'

// A PERSON'S NAME IS A DOOR, EVERYWHERE IT IS WRITTEN.
//
// The profile shipped and the roster and the attendance sheet linked to it;
// the staff dashboard, the payroll run, the advances table and the accountant's
// people list did not. Inconsistent, not missing — which is worse, because the
// reader learns the name is sometimes a link and stops trying.
//
// So there is one component and a gate: a person named as a ROW without a way
// through to them is the bug. Prose is different — "{name} is retired" on their
// own page is not a door and does not want to be one.
//
// WHO CAN OPEN IT: manager, owner and accountant. Every surface that mounts
// this is already one of theirs, which is why this takes no role prop — if it
// is ever mounted somewhere a chef or cashier can see, the matrix audit fails
// on the href rather than this file guessing.
export default function PersonLink({
  code,
  name,
  className = '',
}: {
  /** the permanent E### — the URL is keyed on it, never on the uuid */
  code: string
  name: string
  className?: string
}) {
  return (
    <Link
      href={`/staff/people/employees/${code}`}
      className={`hover:underline ${className}`}
    >
      {name}
    </Link>
  )
}
