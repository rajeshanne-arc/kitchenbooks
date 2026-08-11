import CreateRecipe from '@/components/recipes/CreateRecipe'
import { getMasters, getRestaurant } from '@/server/queries'
import { getDishCodingSections } from '@/server/kitchen-queries'

export const dynamic = 'force-dynamic'

export default async function NewRecipePage({ searchParams }: { searchParams: Promise<{ kind?: string }> }) {
  const { kind: rawKind } = await searchParams
  const kind = rawKind === 'sub' ? 'sub' : 'dish'
  const restaurant = await getRestaurant()
  const [sections, { units }] = await Promise.all([getDishCodingSections(restaurant.id), getMasters()])

  return (
    <div className="mt-4">
      <h2 className="text-lg font-bold text-stone-900">{kind === 'dish' ? 'New dish' : 'New sub-recipe'}</h2>
      <CreateRecipe kind={kind} sections={sections} units={units} />
    </div>
  )
}
