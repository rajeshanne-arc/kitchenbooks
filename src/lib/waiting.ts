// WHO IS HOLDING IT, AND FOR HOW LONG — in the words somebody says out loud.
//
// A request that has been sitting for three days is answered by walking up to
// a person, so the row has to name one. "PENDING" names nobody and reads as a
// property of the request rather than a fact about somebody's morning.
//
// PURE, AND SEPARATE FROM THE COMPONENT, so it can be asserted by value. The
// day count itself is NOT computed here: it arrives from SQL, where
// business_date reads the restaurant's own timezone and cutover. This turns a
// number into a sentence and never works one out.

/** `assigned_to` is a ROLE, never a username — the queue belongs to whoever
 *  holds that job today, which is why a refusal finds its way home even after
 *  somebody changes role. */
const HOLDER: Record<string, string> = {
  owner: 'the owner',
  accountant: 'the accountant',
  store: 'the store',
  manager: 'the manager',
  chef: 'the kitchen',
  cashier: 'the cashier',
}

/**
 * A NULL HOLDER IS A REAL STATE AND GETS ITS OWN SENTENCE.
 *
 * It means the request is open and in nobody's queue — which is not "waiting
 * on somebody" and must not be dressed as it. A row that says "with nobody"
 * is a finding; one that quietly says "with the owner" because null fell
 * through to a default would be a lie about a named person.
 */
export function holder(assignedTo: string | null): string {
  if (assignedTo === null || assignedTo === '') return 'nobody'
  return HOLDER[assignedTo] ?? `the ${assignedTo}`
}

/**
 * HOW LONG, IN DAYS, AS A PHRASE.
 *
 * Today reads "since today" rather than "0 days": a count of zero is a number
 * to decode, and the thing being said is that it has only just gone.
 *
 * Negative is possible and is not silently clamped — a request whose last act
 * carries a timestamp ahead of the business day means the clock or the cutover
 * setting disagrees with the data, and that is worth seeing rather than
 * rendering as "since today".
 */
export function heldText(days: number): string {
  if (days < 0) return 'dated ahead of today'
  if (days === 0) return 'since today'
  if (days === 1) return 'since yesterday'
  return `${days} days`
}

/** True where a request has been sitting long enough to be worth chasing.
 *  THREE DAYS, and the threshold never appears in the sentence — the row says
 *  how long THIS one has been waiting, which is the only number somebody can
 *  act on. A strip that fires on this morning's request is one people learn to
 *  scroll past, which is what the cross-vendor price chip cost. */
export const CHASE_AFTER = 3
export const worthChasing = (days: number) => days >= CHASE_AFTER

/**
 * WHAT IS STILL TRUE AFTER A WITHDRAWAL.
 *
 * THE WHOLE RISK OF THIS ACT IS THAT IT READS AS "HANDLED". He raised the
 * request because he had promised a vendor something; taking it back changes
 * nothing whatsoever for that vendor, and a bare "Withdrawn." invites him to
 * stop chasing a debt that is exactly where it was.
 *
 * So the sentence carries two facts he cannot see anywhere else on that
 * screen — what they are still owed, and whether ANYBODY is still holding a
 * request for them. The second is CHECKED rather than assumed: the exclusion
 * constraint only forbids two open requests over OVERLAPPING bill ranges, so
 * two requests over two different ranges for one vendor are perfectly legal,
 * and claiming nobody holds one while somebody does would have him promise the
 * same vendor twice.
 *
 * PURE, so the wording is asserted by value rather than read off a screen.
 */
export type Standing = { vendor_name: string; balance: string; open_requests: number }

export function withdrawnMessage(
  kind: string,
  standing: Standing | null,
  money: (v: string) => string,
): string {
  // NOT A PAYMENT: there is no vendor and no balance, so there is nothing to
  // say beyond the act. Borrowing the payment sentence here would be the
  // `words()` fault — a wrong sentence reads as a fact.
  if (kind !== 'payment') return 'Withdrawn. Nothing was changed.'
  // A BROKEN READ IS NOT AN EMPTY ONE. The withdrawal certainly happened; the
  // vendor certainly did not stop being owed. Saying "they are owed nothing"
  // here would be an honest-looking empty state absorbing a failed lookup.
  if (standing === null) {
    return 'Withdrawn. The vendor’s balance would not read, so check it before you promise anything.'
  }
  // THE DIRECTION OF THE DEBT, AND THE FIRST WORDING HAD IT BACKWARDS.
  // `vendor_dues.balance` is opening + purchased − paid: what WE owe THEM. It
  // read "<vendor> still owes ₹X", which says the vendor is in debt to us —
  // the opposite, on the one sentence somebody acts on before deciding
  // whether to keep chasing a supplier. The app's own phrasing was two files
  // away and already correct: PayOrAsk's pay acknowledgement says "They are
  // now owed ₹X". Matching it rather than inventing a third form.
  const owed =
    Number(standing.balance) === 0
      ? `${standing.vendor_name} is owed nothing`
      : `${standing.vendor_name} is still owed ${money(standing.balance)}`
  const held =
    standing.open_requests === 0
      ? 'nobody is holding a request for them'
      : standing.open_requests === 1
        ? 'there is still one other request open for them'
        : `there are still ${standing.open_requests} other requests open for them`
  return `Withdrawn. ${owed} and ${held}.`
}
