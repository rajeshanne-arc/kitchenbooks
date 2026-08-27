import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getMasters, getRestaurant } from '@/server/queries'
import {
  getDishCard,
  getRecipeDetail,
  getRecipeLines,
  getRecipeMedia,
  listCourses,
} from '@/server/recipes-queries'
import { getQtySold } from '@/server/sales-queries'
import { formatMoneyString } from '@/lib/money'
import RecipeEditor from '@/components/recipes/RecipeEditor'
import DishCardPanel from '@/components/recipes/DishCardPanel'
import SubCardPanel from '@/components/recipes/SubCardPanel'
import { StatusBadge } from '@/components/books/Badges'
import MasterActions, { ClosedNote } from '@/components/books/MasterActions'
import { pendingFor, REQUESTERS } from '@/server/approvals-queries'
import { getSessionUser } from '@/server/current-user'
import { businessMonthStart } from '@/server/business-day'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f-]{36}$/i

export default async function RecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!UUID.test(id)) notFound()
  const restaurant = await getRestaurant()
  const recipe = await getRecipeDetail(restaurant.id, id)
  if (!recipe) notFound()

  const [lines, { units }, sold, card, media, courses, open, user] = await Promise.all([
    getRecipeLines(id),
    getMasters(),
    recipe.kind === 'dish' ? getQtySold(restaurant.id, await businessMonthStart()) : Promise.resolve([]),
    recipe.kind === 'dish' ? getDishCard(restaurant.id, id) : Promise.resolve(null),
    getRecipeMedia(restaurant.id, id),
    recipe.kind === 'dish' ? listCourses(restaurant.id) : Promise.resolve([]),
    pendingFor(restaurant.id, id),
    getSessionUser(),
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
        <StatusBadge status={recipe.status} />
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

      {/* The dish card sits BELOW the lines because the lines are what it
          is made of — batch cost, then what a portion of it costs. */}
      {card !== null && (
        <div className="mt-4">
          <DishCardPanel card={card} media={media} courses={courses} />
        </div>
      )}

      {recipe.kind === 'sub' && (
        <div className="mt-4">
          <SubCardPanel recipe={recipe} />
        </div>
      )}

      {/* A CLOSED CODE STAYS RESOLVABLE — CH-001 tells you which card absorbed
          it. A dish code carries its department forever, so a duplicate coded
          twice is exactly the case a merge is for. */}
      <div className="mt-4 space-y-4">
        <ClosedNote
          status={recipe.status}
          becameHref={recipe.merged_into === null ? undefined : `/kitchen/recipes/${recipe.merged_into}`}
          becameCode={recipe.merged_into_code}
          becameName={recipe.merged_into_name}
        />
        <MasterActions
          entity="recipe"
          row={{ id: recipe.id, code: recipe.code, name: recipe.name, status: recipe.status }}
          open={open[0] ?? null}
          canRequest={user !== null && REQUESTERS.includes(user.role)}
        />
      </div>
    </div>
  )
}
