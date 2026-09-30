import { fmtDateTime } from '@/lib/format'
import { cardCls, sectionHeadCls } from '@/components/ui'
import type { RecipeVersionRow } from '@/lib/types'

export default function RecipeVersionHistory({ rows }: { rows: RecipeVersionRow[] }) {
  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={sectionHeadCls}>Recipe versions</h2>
        <span className="font-mono text-[11px] text-stone-400">recipe_versions</span>
      </div>
      <p className="mt-1 text-sm text-stone-600">Every saved recipe state remains available as an effective-dated snapshot. The current card is version {rows.find((row) => row.effective_to === null)?.version_no ?? '—'}.</p>
      {rows.length === 0 ? (
        <p className="mt-2 text-sm text-stone-500">Version history starts when the recipe-version migration is applied.</p>
      ) : (
        <div className="mt-2 divide-y divide-rule-soft">
          {rows.map((row) => (
            <div key={row.id} className="flex flex-wrap items-baseline gap-x-3 py-2 text-sm">
              <span className="font-semibold text-stone-900">v{row.version_no}</span>
              <span className="text-stone-600">{row.line_count} component line(s)</span>
              <span className="text-xs text-stone-500">effective {fmtDateTime(row.effective_from)}</span>
              <span className="ml-auto text-xs text-stone-500">{row.recorded_by ?? 'system'}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
