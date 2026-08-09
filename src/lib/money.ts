// Exact money math — no floats anywhere near stored values.
//   rates / GST / transport  -> integer paise           (2 dp)
//   quantities               -> integer milli-units     (3 dp)
//   line values              -> bigint 10^-5 rupees     (milli × paise)
// Decimal strings cross the wire; Postgres numeric holds the truth.

export function parseDecimal(raw: string, maxDp: number, maxIntDigits: number): number | null {
  const s = raw.trim()
  if (!new RegExp(`^\\d{1,${maxIntDigits}}(\\.\\d{1,${maxDp}})?$`).test(s)) return null
  const [int, frac = ''] = s.split('.')
  const n = Number(int + frac.padEnd(maxDp, '0'))
  return Number.isSafeInteger(n) ? n : null
}

/** "12.5" -> 1250 paise; null unless a plain amount with ≤2 dp */
export const parseMoney = (s: string): number | null => parseDecimal(s, 2, 5)

/** "2.5" -> 2500 milli-units; null unless a plain quantity with ≤3 dp */
export const parseQty = (s: string): number | null => parseDecimal(s, 3, 5)

/** Scaled integer back to a decimal string: (833325n, 5) -> "8.33325", (4000, 3) -> "4". dp must be ≥ 1. */
export function scaledToString(n: number | bigint, dp: number): string {
  const s = n.toString().padStart(dp + 1, '0')
  const int = s.slice(0, -dp)
  const frac = s.slice(-dp).replace(/0+$/, '')
  return frac ? `${int}.${frac}` : int
}

export const paiseToString = (p: number): string => scaledToString(p, 2)
export const microToString = (v: bigint): string => scaledToString(v, 5)

/** qty (milli) × rate (paise) -> exact line value in 10^-5 rupees */
export const lineValueMicro = (qtyMilli: number, ratePaise: number): bigint =>
  BigInt(qtyMilli) * BigInt(ratePaise)

export const sumMicro = (values: bigint[]): bigint => values.reduce((a, b) => a + b, 0n)

/** 10^-5 rupees -> paise, rounded half up */
export const microToPaise = (v: bigint): number => Number((2n * v + 1000n) / 2000n)

/**
 * Pro-rata transport split by line value, in whole paise.
 * Each share rounds half-up to 2 dp; the leftover paise land on the largest
 * line (first of ties) so the parts always sum to exactly `transportPaise`.
 */
export function allocateTransport(valuesMicro: bigint[], transportPaise: number): number[] {
  if (valuesMicro.length === 0) return []
  if (transportPaise === 0) return valuesMicro.map(() => 0)
  const total = sumMicro(valuesMicro)
  if (total === 0n) {
    const shares = valuesMicro.map(() => 0)
    shares[0] = transportPaise
    return shares
  }
  const tp = BigInt(transportPaise)
  const shares = valuesMicro.map((v) => Number((2n * tp * v + total) / (2n * total)))
  let largest = 0
  valuesMicro.forEach((v, i) => {
    if (v > valuesMicro[largest]) largest = i
  })
  shares[largest] += transportPaise - shares.reduce((a, b) => a + b, 0)
  return shares
}

/** Postgres numeric::text (any precision, optional sign) -> paise, rounded half up. NaN if unparseable. */
export function decimalStringToPaise(s: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s.trim())
  if (!m) return NaN
  const [, sign, int, frac = ''] = m
  const f = frac.padEnd(2, '0')
  let p = BigInt(int) * 100n + BigInt(f.slice(0, 2))
  if ((f.charCodeAt(2) || 0) >= 53) p += 1n // third decimal ≥ '5' rounds away from zero
  return Number(sign ? -p : p)
}

function groupIndian(int: string): string {
  if (int.length <= 3) return int
  const head = int.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')
  return `${head},${int.slice(-3)}`
}

/** 123456789 paise -> "₹12,34,567.89" (Indian digit grouping, exact) */
export function formatPaise(paise: number): string {
  if (!Number.isFinite(paise)) return '—'
  const neg = paise < 0
  const s = Math.abs(paise).toString().padStart(3, '0')
  return `${neg ? '-' : ''}₹${groupIndian(s.slice(0, -2))}.${s.slice(-2)}`
}

/** Format a numeric::text straight from the database */
export const formatMoneyString = (s: string): string => formatPaise(decimalStringToPaise(s))

export const formatMicro = (v: bigint): string => formatPaise(microToPaise(v))
