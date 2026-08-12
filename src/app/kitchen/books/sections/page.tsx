import SectionsView from '@/components/views/SectionsView'

export const dynamic = 'force-dynamic'

// The SURVIVING mount. SectionsView is a per-department costs report —
// sales, cost, margin — and it was mounted twice, here and under the staff
// Books tab, from one file. Two mounts of one component is duplication by
// definition, so one went; this is not the Departments MASTER, which is a
// different screen with a different job, and dropping both would have
// deleted a report nothing else shows.
export default function Page() {
  return <SectionsView />
}
