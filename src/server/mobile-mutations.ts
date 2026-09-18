import { tsql } from '@/lib/db'

type MutationRow = { id: string; status: 'processing' | 'accepted' | 'failed'; response_json: unknown }

export async function reserveMobileMutation(input: {
  restaurantId: string
  clientMutationId: string
  operation: string
  request: unknown
  enteredBy: string
}): Promise<{ kind: 'reserved'; id: string } | { kind: 'replay'; response: unknown } | { kind: 'processing' }> {
  const existing = await tsql<MutationRow[]>`
    select id, status, response_json
    from mobile_mutations
    where restaurant_id = ${input.restaurantId} and client_mutation_id = ${input.clientMutationId}
    limit 1`
  if (existing[0]?.status === 'accepted') return { kind: 'replay', response: existing[0].response_json }
  if (existing[0]?.status === 'processing') return { kind: 'processing' }
  if (existing[0]?.status === 'failed') {
    const retried = await tsql<{ id: string }[]>`
      update mobile_mutations
      set operation = ${input.operation}, request_json = ${JSON.stringify(input.request)}::text::jsonb,
          status = 'processing', entered_by = ${input.enteredBy}, response_json = null, completed_at = null
      where restaurant_id = ${input.restaurantId} and id = ${existing[0].id} and status = 'failed'
      returning id`
    if (retried[0]) return { kind: 'reserved', id: retried[0].id }
  }

  const inserted = await tsql<{ id: string }[]>`
    insert into mobile_mutations
      (restaurant_id, client_mutation_id, operation, request_json, status, entered_by)
    values
      (${input.restaurantId}, ${input.clientMutationId}, ${input.operation}, ${JSON.stringify(input.request)}::text::jsonb, 'processing', ${input.enteredBy})
    on conflict (restaurant_id, client_mutation_id) do nothing
    returning id`
  if (inserted[0]) return { kind: 'reserved', id: inserted[0].id }

  const raced = await tsql<MutationRow[]>`
    select id, status, response_json
    from mobile_mutations
    where restaurant_id = ${input.restaurantId} and client_mutation_id = ${input.clientMutationId}
    limit 1`
  if (raced[0]?.status === 'accepted') return { kind: 'replay', response: raced[0].response_json }
  if (raced[0]?.status === 'failed') {
    const retried = await tsql<{ id: string }[]>`
      update mobile_mutations
      set operation = ${input.operation}, request_json = ${JSON.stringify(input.request)}::text::jsonb,
          status = 'processing', entered_by = ${input.enteredBy}, response_json = null, completed_at = null
      where restaurant_id = ${input.restaurantId} and id = ${raced[0].id} and status = 'failed'
      returning id`
    if (retried[0]) return { kind: 'reserved', id: retried[0].id }
  }
  return { kind: 'processing' }
}

export async function finishMobileMutation(restaurantId: string, id: string, status: 'accepted' | 'failed', response: unknown) {
  await tsql`
    update mobile_mutations
    set status = ${status}, response_json = ${JSON.stringify(response)}::text::jsonb, completed_at = now()
    where restaurant_id = ${restaurantId} and id = ${id}`
}
