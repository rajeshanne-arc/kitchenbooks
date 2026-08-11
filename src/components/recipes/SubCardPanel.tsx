'use client'

// The sub-recipe card. Same lines as a dish, ending in the three figures a
// sub exists to state: Makes | Unit | Cost per unit.
//
// A SUB'S OUTPUT IS ITS BATCH YIELD, and the cost per unit is what every
// dish using it pays. Get it wrong and the error multiplies through every
// card downstream — which is why this screen argues with itself rather than
// printing a confident number.
//
// THE TRAP, found in the schema rather than guessed at: `output_qty` is NOT
// NULL DEFAULT 1 and `output_unit` is NOT NULL DEFAULT 'portion'. Neither
// can be missing, so the database cannot tell "this batch makes 1 portion"
// from "nobody ever said what this batch makes". A gravy that really makes
// 5 litres but still carries the defaults reports its whole batch cost as
// the cost of one portion — five times the truth — and nothing looks wrong.
//
// So the card treats BOTH-AT-DEFAULT as unanswered and says which figure it
// doubts, instead of showing a cost per unit that may be off by the size of
// the batch. This is the same failure as issues.session defaulting to
// 'Morning': a column default standing in for a human answer.

import type { RecipeDetail } from '@/lib/types'
import { formatMoneyString } from '@/lib/money'
import { cardCls, heroNumCls, sectionHeadCls } from '@/components/ui'
import Honesty from '@/components/Honesty'

export default function SubCardPanel({ recipe }: { recipe: RecipeDetail }) {
  const qty = Number(recipe.output_qty)
  const atDefaultQty = recipe.output_qty === '1' || qty === 1
  const atDefaultUnit = recipe.output_unit === 'portion'
  // Both untouched is the tell. One alone is ordinary — a sub really can
  // make 1 litre, and a sub really can be portioned.
  const unanswered = atDefaultQty && atDefaultUnit

  return (
    <div className="space-y-4">
      <section className={cardCls}>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className={sectionHeadCls}>Batch cost — ingredients</h3>
          <span className="font-mono text-[10px] text-stone-400">recipe_costs</span>
        </div>
        <p className={`mt-1 text-[30px] ${heroNumCls} text-stone-900`}>
          {formatMoneyString(recipe.total_cost)}
        </p>
        <p className="text-xs text-stone-500">
          the whole batch, with each line&apos;s yield already applied
        </p>
        {recipe.uncosted_lines > 0 && (
          <div className="mt-2">
            <Honesty level="alarm" verdict="incomplete" compact>
              {recipe.uncosted_lines} ingredient{recipe.uncosted_lines === 1 ? '' : 's'} here{' '}
              {recipe.uncosted_lines === 1 ? 'has' : 'have'} no cost on record, so this batch cost — and every
              dish using this sub — is lower than the truth.
            </Honesty>
          </div>
        )}
      </section>

      <section className={cardCls}>
        <h3 className={sectionHeadCls}>What the batch makes</h3>
        <div className="mt-3 grid grid-cols-3 gap-4">
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Makes</div>
            <div
              className={`font-mono text-lg font-semibold tabular-nums ${
                unanswered ? 'text-amber-800' : 'text-stone-900'
              }`}
            >
              {recipe.output_qty}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Unit</div>
            <div className={`text-lg font-semibold ${unanswered ? 'text-amber-800' : 'text-stone-900'}`}>
              {recipe.output_unit_name}
            </div>
          </div>
          <div>
            <div className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Cost per unit</div>
            <div
              className={`font-mono text-lg font-semibold tabular-nums ${
                unanswered ? 'text-stone-400' : 'text-stone-900'
              }`}
            >
              {unanswered ? 'not stated' : formatMoneyString(recipe.cost_per_output_unit)}
            </div>
          </div>
        </div>

        {unanswered ? (
          <div className="mt-3">
            <Honesty verdict="never set" compact>
              This sub still says it makes <span className="font-semibold">1 portion</span> — which is what the
              database writes when nobody has said otherwise, not something anyone chose. Until the real batch
              size and its unit are set above, the cost per unit would just be the whole batch cost wearing a
              different name, and every dish using this sub would inherit that error. Set both and the figure
              appears.
            </Honesty>
          </div>
        ) : (
          <p className="mt-3 text-xs text-stone-500">
            Every dish line that calls for this sub is charged{' '}
            <span className="font-mono">{formatMoneyString(recipe.cost_per_output_unit)}</span> per{' '}
            {recipe.output_unit_name.toLowerCase()}. A dish line asking for 0.2 is charged a fifth of it. Sub
            lines inside a dish carry no yield of their own — the trim inside this batch was already paid for
            here.
          </p>
        )}
      </section>
    </div>
  )
}
