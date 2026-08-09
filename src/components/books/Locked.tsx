/** A field that exists, is visible, and deliberately cannot be edited. */
export function LockedField({ label, value, reason }: { label: string; value: string; reason: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-stone-500">{label}</span>
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-stone-400">
          <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            <path d="M4 7V5a4 4 0 1 1 8 0v2h.5A1.5 1.5 0 0 1 14 8.5v5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 13.5v-5A1.5 1.5 0 0 1 3.5 7H4Zm2 0h4V5a2 2 0 1 0-4 0v2Z" />
          </svg>
          locked
        </span>
      </div>
      <div className="mt-0.5 text-[15px] font-medium text-stone-900">{value}</div>
      <p className="mt-1 text-xs text-stone-500">{reason}</p>
    </div>
  )
}
