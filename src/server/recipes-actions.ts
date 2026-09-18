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
import type postgres from 'postgres'
import { tsql, txn } from '@/lib/db'
import { getRestaurant } from '@/server/queries'
import { getSessionUser } from '@/server/current-user'
import { getRecipeDetail, getRecipeLines } from '@/server/recipes-queries'
import type {
  AddLineInput,
  CreateRecipeInput,
  CreateRecipeResult,
  RecipeMutationResult,
  SaveDishCardInput,
  UpdateRecipeInput,
} from '@/lib/types'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const qtyStr = z.string().regex(/^\d{1,5}(\.\d{1,3})?$/, 'plain quantity, up to 3 decimals')
const moneyStr = z.string().regex(/^\d{1,5}(\.\d{1,2})?$/, 'plain amount, up to 2 decimals')

class RecipeError extends Error {}

const trimOrNull = (v: string): string | null => (v.trim() === '' ? null : v.trim())

/** Record the complete recipe as it exists after one successful edit. The
 * snapshot is the effective recipe at this instant; subsequent edits never
 * mutate it. Keeping the live card as the editing surface avoids breaking the
 * existing kitchen screens while giving production and review a durable
 * version history. */
async function snapshotRecipe(tx: postgres.TransactionSql, restaurantId: string, recipeId: string, by: string) {
  const [recipe] = await tx<{
    id: string; code: string; name: string; kind: string; section_id: string | null
    output_qty: string; output_unit: string; selling_price: string | null
    pos_code: string | null; course: string | null; diet: string | null
    portions: string | null; portion_size: string | null; portion_unit: string | null
    overhead_pct: string; photo_url: string | null; video_url: string | null
  }[]>`
    select id, code, name, kind, section_id, output_qty::text as output_qty,
           output_unit, selling_price::text as selling_price, pos_code, course,
           diet, portions::text as portions, portion_size::text as portion_size,
           portion_unit, overhead_pct::text as overhead_pct, photo_url, video_url
    from recipes where id = ${recipeId} and restaurant_id = ${restaurantId}
  `
  if (!recipe) throw new RecipeError('Recipe disappeared before its version was recorded')
  const lines = await tx<{ component_item_id: string | null; component_recipe_id: string | null; qty: string; yield_pct: string; note: string | null }[]>`
    select component_item_id, component_recipe_id, qty::text as qty,
           yield_pct::text as yield_pct, note
    from recipe_lines
    where recipe_id = ${recipeId} and restaurant_id = ${restaurantId}
    order by id
  `
  const substitutions = await tx<{ recipe_line_id: string; substitute_item_id: string; quantity_ratio: string; note: string | null }[]>`
    select recipe_line_id, substitute_item_id, quantity_ratio::text, note
    from recipe_line_substitutions
    where restaurant_id = ${restaurantId} and recipe_line_id in (select id from recipe_lines where restaurant_id = ${restaurantId} and recipe_id = ${recipeId})
    order by recipe_line_id, id`
  const [previous] = await tx<{ version_no: number }[]>`
    select version_no from recipe_versions
    where restaurant_id = ${restaurantId} and recipe_id = ${recipeId}
    order by version_no desc limit 1
    for update
  `
  if (previous) {
    await tx`
      update recipe_versions set effective_to = now()
      where restaurant_id = ${restaurantId} and recipe_id = ${recipeId} and effective_to is null
    `
  }
  await tx`
    insert into recipe_versions
      (restaurant_id, recipe_id, version_no, effective_from, snapshot, recorded_by)
    values (${restaurantId}, ${recipeId}, ${(previous?.version_no ?? 0) + 1}, now(),
      ${JSON.stringify({ recipe, lines, substitutions })}::text::jsonb, ${by})
  `
}

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

    const unit = await tsql<{ code: string }[]>`select code from units where code = ${input.outputUnit}`
    if (!unit[0]) throw new RecipeError(`Unknown unit “${input.outputUnit}”`)

    const created = await txn(async (tx) => {
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
      await snapshotRecipe(tx, rid, r.id, (await getSessionUser())?.username ?? 'system')
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

    const existing = await tsql<{ kind: 'dish' | 'sub'; status: string }[]>`
      select kind, status from recipes where id = ${id} and restaurant_id = ${rid}`
    if (!existing[0]) throw new RecipeError('Recipe not found')
    // A CLOSED CARD CANNOT BE EDITED BACK OPEN. The status select offers only
    // Active and Retired, so a merged card would post 'active' and quietly
    // revive itself — a form is never the check, and this is the check.
    if (existing[0].status === 'merged' || existing[0].status === 'discarded') {
      throw new RecipeError(
        `This card was ${existing[0].status} and is kept so the code still resolves — it cannot be edited back open`,
      )
    }
    if (existing[0].kind === 'sub' && input.sellingPrice !== '') {
      throw new RecipeError('Sub-recipes have no selling price')
    }
    const unit = await tsql<{ code: string }[]>`select code from units where code = ${input.outputUnit}`
    if (!unit[0]) throw new RecipeError(`Unknown unit “${input.outputUnit}”`)

    // Only the column-granted fields ever appear in this SET.
    await txn(async (tx) => {
      const rows = await tx<{ id: string }[]>`
        update recipes set
          name = ${input.name},
          output_qty = ${input.outputQty}::numeric,
          output_unit = ${input.outputUnit},
          selling_price = ${input.sellingPrice === '' ? null : input.sellingPrice}::numeric,
          status = ${input.status}
        where id = ${id} and restaurant_id = ${rid}
        returning id`
      if (!rows[0]) throw new RecipeError('Recipe not found — nothing was changed')
      await snapshotRecipe(tx, rid, id, (await getSessionUser())?.username ?? 'system')
    })

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

    await txn(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtextextended('kitchenbooks:save:' || ${rid}, 0))`
      const recipe = await tx<{ id: string; name: string }[]>`
        select id, name from recipes where id = ${input.recipeId} and restaurant_id = ${rid}`
      if (!recipe[0]) throw new RecipeError('Recipe not found')

      if (input.component.kind === 'item') {
        const item = await tx<{ id: string }[]>`
          select id from items where id = ${input.component.id} and restaurant_id = ${rid} and status = 'active'`
        if (!item[0]) throw new RecipeError('Item not found')
        await tx`
          insert into recipe_lines (restaurant_id, recipe_id, component_item_id, qty)
          values (${rid}, ${input.recipeId}, ${input.component.id}, ${input.qty}::numeric)`
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
          insert into recipe_lines (restaurant_id, recipe_id, component_recipe_id, qty)
          values (${rid}, ${input.recipeId}, ${input.component.id}, ${input.qty}::numeric)`
      }
      await snapshotRecipe(tx, rid, input.recipeId, (await getSessionUser())?.username ?? 'system')
    })

    return await freshState(rid, input.recipeId)
  } catch (e) {
    return fail(e)
  }
}

/** The line's yield. Editable here and nowhere else — it belongs to this
 *  line of this recipe, not to the item. Sub-recipe lines are refused: the
 *  yields inside the sub were already applied, and trimming again would
 *  charge the same loss twice. */
export async function updateLineYield(lineId: string, yieldPct: string): Promise<RecipeMutationResult> {
  try {
    if (!UUID.test(lineId)) throw new RecipeError('Malformed line id')
    const n = Number(yieldPct)
    if (!Number.isFinite(n) || n <= 0) throw new RecipeError('Yield must be more than zero')
    if (n > 100) throw new RecipeError('Yield is a percentage of what you bought — 100 is the most it can be')

    const restaurant = await getRestaurant()
    const rid = restaurant.id
    const [line] = await tsql<{ recipe_id: string; is_sub: boolean }[]>`
      select rl.recipe_id, (rl.component_recipe_id is not null) as is_sub
      from recipe_lines rl
      join recipes r on r.id = rl.recipe_id
      where rl.id = ${lineId} and r.restaurant_id = ${rid}`
    if (!line) throw new RecipeError('Line not found')
    if (line.is_sub) {
      throw new RecipeError('A sub-recipe line has no yield of its own — the trim inside it is already costed')
    }
    await txn(async (tx) => {
      const changed = await tx<{ id: string }[]>`update recipe_lines set yield_pct = ${yieldPct}::numeric
                where id = ${lineId} and restaurant_id = ${rid} returning id`
      if (!changed[0]) throw new RecipeError('Line not found — nothing was changed')
      await snapshotRecipe(tx, rid, line.recipe_id, (await getSessionUser())?.username ?? 'system')
    })
    return await freshState(rid, line.recipe_id)
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

    const updated = await txn(async (tx) => {
      const rows = await tx<{ recipe_id: string }[]>`
        update recipe_lines rl set qty = ${parsed}::numeric
        from recipes r
        where rl.id = ${lineId} and r.id = rl.recipe_id and r.restaurant_id = ${rid}
        returning rl.recipe_id`
      if (!rows[0]) throw new RecipeError('Line not found — nothing was changed')
      await snapshotRecipe(tx, rid, rows[0].recipe_id, (await getSessionUser())?.username ?? 'system')
      return rows
    })

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
    const deleted = await txn(async (tx) => {
      const rows = await tx<{ recipe_id: string }[]>`
        delete from recipe_lines rl
        using recipes r
        where rl.id = ${lineId} and r.id = rl.recipe_id and r.restaurant_id = ${rid}
        returning rl.recipe_id`
      if (!rows[0]) throw new RecipeError('Line not found — nothing was removed')
      await snapshotRecipe(tx, rid, rows[0].recipe_id, (await getSessionUser())?.username ?? 'system')
      return rows
    })

    return await freshState(rid, deleted[0].recipe_id)
  } catch (e) {
    return fail(e)
  }
}

const SubstitutionSchema = z.object({ lineId: z.string().regex(UUID), substituteItemId: z.string().regex(UUID), ratio: z.string().regex(/^\d{1,5}(\.\d{1,4})?$/), note: z.string().trim().max(200) })

export async function addRecipeSubstitution(raw: { lineId: string; substituteItemId: string; ratio: string; note: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const input = SubstitutionSchema.parse(raw)
    if (Number(input.ratio) <= 0) throw new RecipeError('The substitution ratio must be more than zero')
    const user = await getSessionUser()
    if (!user || !['chef', 'manager', 'owner'].includes(user.role)) throw new RecipeError('Only kitchen leads can record recipe substitutions')
    const rid = (await getRestaurant()).id
    await txn(async (tx) => {
      const [line] = await tx<{ recipe_id: string; component_item_id: string | null }[]>`select recipe_id, component_item_id from recipe_lines where restaurant_id = ${rid} and id = ${input.lineId}`
      if (!line || line.component_item_id === null) throw new RecipeError('Choose an ingredient line, not a sub-recipe line')
      if (line.component_item_id === input.substituteItemId) throw new RecipeError('The substitute must differ from the primary ingredient')
      const [item] = await tx`select id from items where restaurant_id = ${rid} and id = ${input.substituteItemId} and status = 'active'`
      if (!item) throw new RecipeError('Substitute item not found')
      await tx`insert into recipe_line_substitutions (restaurant_id, recipe_line_id, substitute_item_id, quantity_ratio, note, entered_by) values (${rid}, ${input.lineId}, ${input.substituteItemId}, ${input.ratio}, ${input.note.trim() || null}, ${user.username})`
      await snapshotRecipe(tx, rid, line.recipe_id, user.username)
    })
    return { ok: true }
  } catch (e) { return fail(e) }
}

export async function deleteRecipeSubstitution(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    if (!UUID.test(id)) throw new RecipeError('Malformed substitution id')
    const user = await getSessionUser()
    if (!user || !['chef', 'manager', 'owner'].includes(user.role)) throw new RecipeError('Only kitchen leads can remove recipe substitutions')
    const rid = (await getRestaurant()).id
    await txn(async (tx) => {
      const [row] = await tx<{ recipe_id: string }[]>`select rl.recipe_id from recipe_line_substitutions s join recipe_lines rl on rl.restaurant_id = s.restaurant_id and rl.id = s.recipe_line_id where s.restaurant_id = ${rid} and s.id = ${id}`
      if (!row) throw new RecipeError('Substitution not found')
      await tx`delete from recipe_line_substitutions where restaurant_id = ${rid} and id = ${id}`
      await snapshotRecipe(tx, rid, row.recipe_id, user.username)
    })
    return { ok: true }
  } catch (e) { return fail(e) }
}

/** The dish card's header strip and inputs.
 *
 * Every one of these is an INPUT — a thing a human decides. The ANSWERS
 * (cost per portion, food cost %, margin, the flag) are dish_costs' and are
 * never written here. Overhead % is manual on purpose: labour and fuel are
 * a pricing judgement, not a measurement, and the app does not pretend to
 * know them.
 */
const DishCardSchema = z.object({
  posCode: z.string().trim().max(40),
  course: z.string().trim().max(40),
  diet: z.string().trim().max(20),
  photoUrl: z.string().trim().max(500),
  videoUrl: z.string().trim().max(500),
  portions: z.union([z.literal(''), z.string().regex(/^\d{1,5}(\.\d{1,2})?$/)]),
  portionSize: z.union([z.literal(''), z.string().regex(/^\d{1,6}(\.\d{1,3})?$/)]),
  portionUnit: z.string().trim().max(20),
  overheadPct: z.union([z.literal(''), z.string().regex(/^\d{1,3}(\.\d{1,2})?$/)]),
  sellingPrice: z.union([z.literal(''), z.string().regex(/^\d{1,7}(\.\d{1,2})?$/)]),
})

const httpish = (u: string) => u === '' || /^https?:\/\//i.test(u)

export async function updateDishCard(
  recipeId: string,
  raw: SaveDishCardInput,
): Promise<RecipeMutationResult> {
  try {
    if (!UUID.test(recipeId)) throw new RecipeError('Malformed recipe id')
    const input = DishCardSchema.parse(raw)
    if (input.overheadPct !== '' && Number(input.overheadPct) > 100) {
      throw new RecipeError('Overhead is a percentage — 100 is the most it can be')
    }
    if (input.portions !== '' && Number(input.portions) <= 0) {
      throw new RecipeError('A batch makes at least one portion')
    }
    if (!httpish(input.photoUrl) || !httpish(input.videoUrl)) {
      throw new RecipeError('A link should start with http:// or https://')
    }

    const restaurant = await getRestaurant()
    const rid = restaurant.id

    await txn(async (tx) => {
      const updated = await tx<{ id: string }[]>`
        update recipes set
          pos_code = ${trimOrNull(input.posCode)},
          course = ${trimOrNull(input.course)},
          diet = ${trimOrNull(input.diet)},
          photo_url = ${trimOrNull(input.photoUrl)},
          video_url = ${trimOrNull(input.videoUrl)},
          portions = ${input.portions === '' ? null : input.portions}::numeric,
          portion_size = ${input.portionSize === '' ? null : input.portionSize}::numeric,
          portion_unit = ${trimOrNull(input.portionUnit)},
          -- NOT NULL DEFAULT 0. Blank means "no overhead applied", which is
          -- 0 and not NULL; writing NULL here threw a not-null violation and
          -- made the whole card unsaveable whenever the field was left empty.
          overhead_pct = ${input.overheadPct === '' ? '0' : input.overheadPct}::numeric,
          selling_price = ${input.sellingPrice === '' ? null : input.sellingPrice}::numeric
        where id = ${recipeId} and restaurant_id = ${rid}
        returning id`
      if (!updated[0]) throw new RecipeError('Dish not found — nothing was changed')
      await snapshotRecipe(tx, rid, recipeId, (await getSessionUser())?.username ?? 'system')
    })

    return await freshState(rid, recipeId)
  } catch (e) {
    return fail(e)
  }
}
