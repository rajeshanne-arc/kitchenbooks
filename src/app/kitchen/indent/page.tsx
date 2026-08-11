import Link from 'next/link'
import { getRestaurant } from '@/server/queries'
import { getKitchenSections, listIndents } from '@/server/kitchen-queries'
import IndentEntry from '@/components/kitchen/IndentEntry'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

const STATUS_BADGE: Record<string, string> = {
  open: 'border-amber-300 bg-amber-50 text-amber-800',
  issued: 'border-emerald-300 bg-emerald-50 text-emerald-800',
  cancelled: 'border-stone-300 bg-stone-100 text-stone-500',
}

export default async function IndentPage() {
  const restaurant = await getRestaurant()
  const [sections, indents] = await Promise.all([
    getKitchenSections(restaurant.id),
    listIndents(restaurant.id),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Indent</h1>
        <p className={pageSubCls}>ask the store — the issue answers</p>
      </header>

      <div className="space-y-4">
        <IndentEntry sections={sections} />

        <section className={cardCls}>
          <h2 className={sectionHeadCls}>Recent indents</h2>
          {indents.length === 0 ? (
            <p className="mt-2 text-sm text-stone-500">No indents yet — the first ask starts the paper trail.</p>
          ) : (
            <ul className="mt-1 divide-y divide-rule-soft">
              {indents.map((i) => (
                <li key={i.id}>
                  <Link href={`/kitchen/indent/${i.id}`} className="flex items-center justify-between gap-3 py-2.5 hover:bg-stone-50">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] text-stone-900">
                        {i.section_name} · {i.line_count} {i.line_count === 1 ? 'item' : 'items'}
                      </span>
                      <span className="block text-xs text-stone-500">
                        {fmtDate(i.indent_date)}
                        {i.entered_by !== null && <> · by {i.entered_by}</>}
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_BADGE[i.status]}`}>
                      {i.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
