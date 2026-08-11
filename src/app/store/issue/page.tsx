import Link from 'next/link'
import IssueEntry from '@/components/store/IssueEntry'
import { getRestaurant } from '@/server/queries'
import { getIndentPrefill, getSections, listOpenIndents } from '@/server/store-queries'
import { getList } from '@/server/settings'
import { fmtDate } from '@/lib/format'
import { cardCls, pageSubCls, pageTitleCls, sectionHeadCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function IssuePage({ searchParams }: { searchParams: Promise<{ indent?: string }> }) {
  const { indent: indentParam } = await searchParams
  const restaurant = await getRestaurant()
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const [sections, openIndents, prefill, returnReasons] = await Promise.all([
    getSections(restaurant.id),
    listOpenIndents(restaurant.id),
    indentParam !== undefined && UUID.test(indentParam)
      ? getIndentPrefill(restaurant.id, indentParam)
      : Promise.resolve(null),
    getList(restaurant.id, 'return_reason'),
  ])

  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Stock movement</h1>
        <p className={pageSubCls}>{restaurant.name} store — out to a section, or back from one</p>
      </header>

      <div className="space-y-4">
        {openIndents.length > 0 && (
          <section className={`${cardCls} border-amber-300 bg-amber-50/60`}>
            <div className="flex items-baseline justify-between gap-3">
              <h2 className={sectionHeadCls}>Open indents — the kitchens are asking</h2>
              <span className="text-xs text-stone-400">open_indents</span>
            </div>
            <ul className="mt-1 divide-y divide-amber-200/60">
              {openIndents.map((i) => (
                <li key={i.id}>
                  <Link
                    href={`/store/issue?indent=${i.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 hover:bg-amber-100/50"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-stone-900">
                        {i.section_name} · {i.line_count} {i.line_count === 1 ? 'item' : 'items'}
                      </span>
                      <span className="block text-xs text-stone-500">
                        {fmtDate(i.indent_date)}
                        {i.entered_by !== null && <> · asked by {i.entered_by}</>}
                      </span>
                    </span>
                    <span className="shrink-0 text-xs font-semibold text-amber-800">fill it →</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <IssueEntry sections={sections} returnReasons={returnReasons} initialIndent={prefill} />
      </div>
    </>
  )
}
