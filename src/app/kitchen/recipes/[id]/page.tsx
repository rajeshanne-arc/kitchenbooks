import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMasters, getRestaurant } from '@/server/queries'
import { getRecipeDetail, getRecipeLines } from '@/server/recipes-queries'
import { getQtySold } from '@/server/sales-queries'
import { monthStartIST } from '@/server/store-queries'
import { formatMoneyString } from '@/lib/money'
import RecipeEditor from '@/components/recipes/RecipeEditor'
import { RetiredBadge } from '@/components/books/Badges'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const recipe = await getRecipeDetail(restaurant.id, id)
  if (!recipe) notFound()

  const [lines, { units }, sold] = await Promise.all([
    getRecipeLines(id),
    getMasters(),
    recipe.kind === 'dish' ? getQtySold(restaurant.id, monthStartIST()) : Promise.resolve([]),
  ])
  const soldRow = sold.find((s) => s.recipe_id === id) ?? null

  return (
    <div className="mt-4">
      <Link href="/kitchen/recipes" className="inline-block text-sm font-medium text-stone-500 hover:text-stone-800">
        ← Recipes
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="rounded bg-stone-900 px-2 py-0.5 font-mono text-xs font-medium text-white">{recipe.code}</code>
        <h2 className="text-lg font-bold text-stone-900">{recipe.name}</h2>
        {recipe.status === 'inactive' && <RetiredBadge />}
        <span className="text-xs text-stone-400">
          {recipe.kind === 'dish' ? (
            <>
              dish · {recipe.section_name} — the code carries the section, same family as its issues; both are
              permanent
            </>
          ) : (
            'sub-recipe · code and kind are permanent'
          )}
        </span>
      </div>
      {soldRow !== null && (
        <p className="mt-2 text-sm text-stone-600">
          Sold this month: <span className="font-semibold tabular-nums">{soldRow.qty_sold}</span> ·{' '}
          {formatMoneyString(soldRow.sales_value)}{' '}
          <span className="text-xs text-stone-400">from mapped POS lines, latest fetches</span>
        </p>
      )}
      <RecipeEditor key={recipe.id} initialRecipe={recipe} initialLines={lines} units={units} />
    </div>
  )
}
