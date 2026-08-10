'use server'

// Write side of recipes. Recipes are MASTERS: lines are editable detail, and
// recipe_lines carries the system's only DELETE grant — removing an
// ingredient from a card is normal chef editing, not history erasure.
//
// Codes: dishes carry their SECTION — CH-001, TD-014 — the same codes as
// issues; that join is the product's spine. Subs are SUB-###. The schema
// enforces dish-requires-section; sequencing happens here, in-transaction,
// under the same per-restaurant advisory lock as every other writer.
//
// Cycle guard: before inserting a sub-recipe component, walk the component
// graph server-side and refuse anything that would loop. The view's depth
// cap is blast-radius control, not the guard.

import { z } from 'zod'
import { sql } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getRecipeDetail, getRecipeLines } from '@/server/recipes-queries'
import type {
  AddLineInput,
  CreateRecipeInput,
  CreateRecipeResult,
  RecipeMutationResult,
  UpdateRecipeInput,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'plain quantity, up to 3 decimals')
const moneyStr = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class RecipeError extends Error {}

function fail(e: unknown): { ok: false; error: string } {
  if (e instanceof RecipeError) return { ok: false, error: e.message }
  if (e instanceof z.ZodError) return { ok: false, error: 'Invalid input — nothing was saved' }
  console.error('recipe action failed', e)
  const detail = e instanceof Error ? e.message.slice(0, 200) : 'unknown error'
  return { ok: false, error: `Failed — nothing was written. (${detail})` }
}

async function freshState(restaurantId: string, recipeId: string): Promise<RecipeMutationResult> {
  const [recipe, lines] = await Promise.all([
    getRecipeDetail(restaurantId, recipeId),
    getRecipeLines(recipeId),
  ])
  if (!recipe) throw new RecipeError('Could not read the recipe back')
  return { ok: true, recipe, lines }
}

// ------------------------------------------------------------------ create

const CreateSchema = z.object({
  kind: z.enum(['dish', 'sub']),
  name: z.string().trim().min(1).max(120),
  sectionId: z.union([z.literal(''), z.string().regex(UUID)]),
  outputQty: qtyStr,
  outputUnit: z.string().trim().min(1).max(16),
  sellingPrice: z.union([z.literal(''), moneyStr]),
})

export async function createRecipe(raw: CreateRecipeInput): Promise<CreateRecipeResult> {
  try {
    const input = CreateSchema.parse(raw)
    if (Number(input.outputQty) <= 0) throw new RecipeError('Output must be more than zero')
    if (input.kind === 'dish' && input.sectionId === '') {
      throw new RecipeError('Pick a section — the dish code is built from it')
    }
    if (input.kind === 'sub' && input.sellingPrice !== '') {
      throw new RecipeError('Sub-recipes have no selling price')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const unit = await sql<{ code: string }[]>`select code from units where code = ${input.outputUnit}`
    if (!unit[0]) throw new RecipeError(`Unknown unit “${input.outputUnit}”`)

    const created = await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`

      let prefix: string
      let sectionId: string | null = null
      if (input.kind === 'dish') {
        const sec = await tx<{ id: string; code: string }[]>`
          select id, code from sections
          where id = ${input.sectionId} and restaurant_id = ${rid} and status = 'active'`
        if (!sec[0]) throw new RecipeError('Section not found')
        prefix = sec[0].code
        sectionId = sec[0].id
      } else {
        prefix = 'SUB'
      }

      const [{ next }] = await tx<{ next: number }[]>`
        select coalesce(max(nullif(split_part(code, '-', 2), '')::int), 0) + 1 as next
        from recipes
        where restaurant_id = ${rid} and code like ${prefix + '-%'}`
      const code = `${prefix}-${String(next).padStart(3, '0')}`

      const [r] = await tx<{ id: string; code: string }[]>`
        insert into recipes (restaurant_id, code, name, kind, section_id, output_qty, output_unit, selling_price)
        values (${rid}, ${code}, ${input.name}, ${input.kind}, ${sectionId},
                ${input.outputQty}::numeric, ${input.outputUnit},
                ${input.sellingPrice === '' ? null : input.sellingPrice}::numeric)
        returning id, code`
      return r
    })

    const check = await getRecipeDetail(rid, created.id)
    if (!check) throw new RecipeError('Could not verify the save — recipe missing after commit')
    return { ok: true, id: created.id, code: created.code }
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------------ update

const UpdateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  outputQty: qtyStr,
  outputUnit: z.string().trim().min(1).max(16),
  sellingPrice: z.union([z.literal(''), moneyStr]),
  status: z.enum(['active', 'inactive']),
})

export async function updateRecipe(id: string, raw: UpdateRecipeInput): Promise<RecipeMutationResult> {
  try {
    if (!UUID.test(id)) throw new RecipeError('Malformed recipe id')
    const input = UpdateSchema.parse(raw)
    if (Number(input.outputQty) <= 0) throw new RecipeError('Output must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const existing = await sql<{ kind: 'dish' | 'sub' }[]>`
      select kind from recipes where id = ${id} and restaurant_id = ${rid}`
    if (!existing[0]) throw new RecipeError('Recipe not found')
    if (existing[0].kind === 'sub' && input.sellingPrice !== '') {
      throw new RecipeError('Sub-recipes have no selling price')
    }
    const unit = await sql<{ code: string }[]>`select code from units where code = ${input.outputUnit}`
    if (!unit[0]) throw new RecipeError(`Unknown unit “${input.outputUnit}”`)

    // Only the column-granted fields ever appear in this SET.
    const updated = await sql<{ id: string }[]>`
      update recipes set
        name = ${input.name},
        output_qty = ${input.outputQty}::numeric,
        output_unit = ${input.outputUnit},
        selling_price = ${input.sellingPrice === '' ? null : input.sellingPrice}::numeric,
        status = ${input.status}
      where id = ${id} and restaurant_id = ${rid}
      returning id`
    if (!updated[0]) throw new RecipeError('Recipe not found — nothing was changed')

    return await freshState(rid, id)
  } catch (e) {
    return fail(e)
  }
}

// ------------------------------------------------------------------- lines

const AddLineSchema = z.object({
  recipeId: z.string().regex(UUID),
  component: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('item'), id: z.string().regex(UUID) }),
    z.object({ kind: z.literal('sub'), id: z.string().regex(UUID) }),
  ]),
  qty: qtyStr,
})

export async function addLine(raw: AddLineInput): Promise<RecipeMutationResult> {
  try {
    const input = AddLineSchema.parse(raw)
    if (Number(input.qty) <= 0) throw new RecipeError('Quantity must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const recipe = await tx<{ id: string; name: string }[]>`
        select id, name from recipes where id = ${input.recipeId} and restaurant_id = ${rid}`
      if (!recipe[0]) throw new RecipeError('Recipe not found')

      if (input.component.kind === 'item') {
        const item = await tx<{ id: string }[]>`
          select id from items where id = ${input.component.id} and restaurant_id = ${rid} and status = 'active'`
        if (!item[0]) throw new RecipeError('Item not found')
        await tx`
          insert into recipe_lines (recipe_id, component_item_id, qty)
          values (${input.recipeId}, ${input.component.id}, ${input.qty}::numeric)`
      } else {
        const sub = await tx<{ id: string; name: string }[]>`
          select id, name from recipes
          where id = ${input.component.id} and restaurant_id = ${rid} and kind = 'sub' and status = 'active'`
        if (!sub[0]) throw new RecipeError('Sub-recipe not found')
        if (sub[0].id === input.recipeId) throw new RecipeError('A recipe cannot contain itself')

        // The cycle walk: everything the candidate component contains,
        // transitively. If the target recipe is in there, refuse.
        const loop = await tx<{ found: boolean }[]>`
          with recursive walk as (
            select ${input.component.id}::uuid as id
            union
            select rl.component_recipe_id
            from recipe_lines rl
            join walk w on rl.recipe_id = w.id
            where rl.component_recipe_id is not null
          )
          select exists(select 1 from walk where id = ${input.recipeId}) as found`
        if (loop[0]?.found) {
          throw new RecipeError(
            `That would loop — “${sub[0].name}” already contains “${recipe[0].name}” (directly or through another sub-recipe)`,
          )
        }
        await tx`
          insert into recipe_lines (recipe_id, component_recipe_id, qty)
          values (${input.recipeId}, ${input.component.id}, ${input.qty}::numeric)`
      }
    })

    return await freshState(rid, input.recipeId)
  } catch (e) {
    return fail(e)
  }
}

export async function updateLineQty(lineId: string, qty: string): Promise<RecipeMutationResult> {
  try {
    if (!UUID.test(lineId)) throw new RecipeError('Malformed line id')
    const parsed = qtyStr.parse(qty)
    if (Number(parsed) <= 0) throw new RecipeError('Quantity must be more than zero')

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    const updated = await sql<{ recipe_id: string }[]>`
      update recipe_lines rl set qty = ${parsed}::numeric
      from recipes r
      where rl.id = ${lineId} and r.id = rl.recipe_id and r.restaurant_id = ${rid}
      returning rl.recipe_id`
    if (!updated[0]) throw new RecipeError('Line not found — nothing was changed')

    return await freshState(rid, updated[0].recipe_id)
  } catch (e) {
    return fail(e)
  }
}

export async function deleteLine(lineId: string): Promise<RecipeMutationResult> {
  try {
    if (!UUID.test(lineId)) throw new RecipeError('Malformed line id')
    const restaurant = await getRestaurant()
    const rid = restaurant.id

    // The system's only DELETE: a recipe line is master detail, not an event.
    const deleted = await sql<{ recipe_id: string }[]>`
      delete from recipe_lines rl
      using recipes r
      where rl.id = ${lineId} and r.id = rl.recipe_id and r.restaurant_id = ${rid}
      returning rl.recipe_id`
    if (!deleted[0]) throw new RecipeError('Line not found — nothing was removed')

    return await freshState(rid, deleted[0].recipe_id)
  } catch (e) {
    return fail(e)
  }
}
