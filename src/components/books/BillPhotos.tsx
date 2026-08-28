'use client'

import { useRef, useState } from 'react'
import { compressImage } from '@/lib/compress'
import { attachPhoto } from '@/server/attachments-actions'
import { fmtDateTime } from '@/lib/format'
import Honesty from '@/components/Honesty'
import { btnGhostCls, sectionHeadCls } from '@/components/ui'

/**
 * THE PAPER. Bills run to several pages, so several photographs.
 *
 * A FILE ICON, NOT A PREVIEW. A thumbnail means server-side image processing,
 * which is explicitly out of Stage 1 — the link opens the full picture through
 * our own route, which is where the session and the matrix are checked.
 *
 * A BILL WITH NO PHOTO IS NORMAL, not an error. 330 exist already without one,
 * so there is no nag, no badge and no "bills missing photos" list anywhere.
 */

export type PhotoRow = {
  id: string
  filename: string | null
  byte_size: number | null
  uploaded_by: string | null
  created_at: string
}

const kb = (n: number | null) => (n === null ? '—' : `${Math.max(1, Math.round(n / 1024))} KB`)

type Pending = { name: string; state: 'working' | 'failed'; note: string }

export default function BillPhotos({
  purchaseId,
  initial = [],
  compact = false,
}: {
  /** null while the bill has not been saved yet — the button waits, the SAVE
   *  never does. See BillEntry: the bill is recorded first, always. */
  purchaseId: string | null
  initial?: PhotoRow[]
  /** the receive form's slimmer block, versus the bill document's section */
  compact?: boolean
}) {
  const [rows, setRows] = useState<PhotoRow[]>(initial)
  const [pending, setPending] = useState<Pending[]>([])
  const camera = useRef<HTMLInputElement>(null)
  const chooser = useRef<HTMLInputElement>(null)

  async function send(files: FileList | null) {
    if (files === null || purchaseId === null) return
    for (const original of Array.from(files)) {
      const label = original.name || 'photo'
      setPending((p) => [...p, { name: label, state: 'working', note: 'compressing…' }])
      try {
        const { file, before, after } = await compressImage(original)
        setPending((p) =>
          p.map((x) =>
            x.name === label
              ? { ...x, note: `${Math.round(before / 1024)} KB → ${Math.round(after / 1024)} KB, sending…` }
              : x,
          ),
        )
        const form = new FormData()
        form.set('entity', 'purchase')
        form.set('entityId', purchaseId)
        form.set('contentType', file.type)
        form.set('filename', file.name)
        form.set('file', file)
        const res = await attachPhoto(form)
        if (res.ok) {
          setRows((r) => [
            ...r,
            { id: res.id, filename: file.name, byte_size: after, uploaded_by: null, created_at: new Date().toISOString() },
          ])
          setPending((p) => p.filter((x) => x.name !== label))
        } else {
          setPending((p) => p.map((x) => (x.name === label ? { ...x, state: 'failed', note: res.error } : x)))
        }
      } catch {
        setPending((p) =>
          p.map((x) =>
            x.name === label
              ? {
                  ...x,
                  state: 'failed',
                  // THE BILL IS SAFE AND THE MESSAGE SAYS SO. This is the line a
                  // storeman reads when the wifi drops at the delivery door.
                  note: 'The picture did not reach us. The bill itself is saved and correct — try again from the bill.',
                }
              : x,
          ),
        )
      }
    }
  }

  return (
    <section className={compact ? '' : 'mt-4'}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={sectionHeadCls}>{compact ? 'Bill photo' : 'The paper'}</h3>
        <span className="text-xs text-stone-500">
          {compact ? 'optional' : rows.length === 0 ? 'no photograph on file' : `${rows.length} page${rows.length === 1 ? '' : 's'}`}
        </span>
      </div>

      {rows.length > 0 && (
        <ul className="mt-2 divide-y divide-rule-soft">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center justify-between gap-3 py-2">
              <a
                href={`/api/attachments/${r.id}`}
                target="_blank"
                rel="noreferrer"
                className="flex min-w-0 items-center gap-2 text-[15px] text-emerald-800 hover:underline"
              >
                <span aria-hidden className="text-stone-400">▢</span>
                <span className="truncate">Page {i + 1}</span>
              </a>
              <span className="shrink-0 text-xs text-stone-400">
                {kb(r.byte_size)}
                {r.uploaded_by !== null && ` · ${r.uploaded_by}`} · {fmtDateTime(r.created_at)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pending.length > 0 && (
        <ul className="mt-2 space-y-1">
          {pending.map((p) => (
            <li
              key={p.name}
              className={`text-xs ${p.state === 'failed' ? 'text-red-800' : 'text-stone-500'}`}
            >
              {p.name} — {p.note}
            </li>
          ))}
        </ul>
      )}

      {purchaseId === null ? (
        <p className="mt-2 text-xs text-stone-500">
          Save the bill first and the camera opens here. The photograph never holds up the save.
        </p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {/* `capture` opens the camera straight away on a phone; the plain
              chooser beside it is for a desktop user with a scan. */}
          <input
            ref={camera}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => void send(e.target.files)}
          />
          <input
            ref={chooser}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => void send(e.target.files)}
          />
          <button type="button" onClick={() => camera.current?.click()} className={btnGhostCls}>
            Take photo
          </button>
          <button type="button" onClick={() => chooser.current?.click()} className={btnGhostCls}>
            Choose file
          </button>
        </div>
      )}

      {!compact && rows.length === 0 && pending.length === 0 && (
        <div className="mt-2">
          <Honesty verdict="no photograph">
            Nothing has been photographed against this bill. That is ordinary — most bills on the books have
            none — and it only means this one cannot be checked against the paper it came from.
          </Honesty>
        </div>
      )}
    </section>
  )
}
