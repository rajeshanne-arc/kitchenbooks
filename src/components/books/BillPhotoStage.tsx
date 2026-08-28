'use client'

import { useRef } from 'react'
import { compressImage } from '@/lib/compress'
import { attachPhoto } from '@/server/attachments-actions'
import { btnGhostCls, cardCls, sectionHeadCls } from '@/components/ui'

/**
 * PHOTOGRAPHS PICKED WHILE THE BILL IS TYPED, SENT AFTER IT SAVES.
 *
 * The paper is in the storeman's hand at the moment of entry, so that is when
 * the camera should open — but there is no purchase_id to attach to until the
 * bill exists. So they are staged here, compressed on pick, and uploaded
 * against the saved id afterwards.
 *
 * NOTHING HERE CAN DELAY OR BLOCK THE SAVE. This component owns no disabled
 * state that BillEntry reads; `canSave` does not know it exists.
 */

export type StagedPhoto = { file: File; before: number; after: number }

const kb = (n: number) => `${Math.max(1, Math.round(n / 1024))} KB`

/** Returns how many FAILED. Never throws — a lost photo must not surface as a
 *  broken save, because the save was not broken. */
export async function uploadStaged(staged: StagedPhoto[], purchaseId: string): Promise<number> {
  let failed = 0
  for (const p of staged) {
    try {
      const form = new FormData()
      form.set('entity', 'purchase')
      form.set('entityId', purchaseId)
      form.set('contentType', p.file.type)
      form.set('filename', p.file.name)
      form.set('file', p.file)
      const res = await attachPhoto(form)
      if (!res.ok) failed += 1
    } catch {
      failed += 1
    }
  }
  return failed
}

export default function BillPhotoStage({
  staged,
  onChange,
  note,
}: {
  staged: StagedPhoto[]
  onChange: (next: StagedPhoto[]) => void
  /** what happened to the LAST bill's photos, if anything went wrong */
  note: string | null
}) {
  const camera = useRef<HTMLInputElement>(null)
  const chooser = useRef<HTMLInputElement>(null)

  async function pick(files: FileList | null) {
    if (files === null) return
    const next: StagedPhoto[] = []
    for (const f of Array.from(files)) {
      try {
        next.push(await compressImage(f))
      } catch {
        // an unreadable file is not a reason to lose the others
      }
    }
    onChange([...staged, ...next])
  }

  return (
    <section className={`${cardCls} mt-4`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={sectionHeadCls}>Bill photo</h3>
        <span className="text-xs text-stone-500">optional</span>
      </div>
      <p className="mt-1 text-sm text-stone-600">
        Photograph the paper and it is filed with the bill — one picture per page. It uploads after the bill
        saves, and never holds the save up.
      </p>

      {staged.length > 0 && (
        <ul className="mt-2 divide-y divide-rule-soft">
          {staged.map((p, i) => (
            <li key={`${p.file.name}-${i}`} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-stone-700">
                <span aria-hidden className="mr-2 text-stone-400">▢</span>
                Page {i + 1}
              </span>
              <span className="shrink-0 text-xs text-stone-400">
                {kb(p.before)} → {kb(p.after)}
                <button
                  type="button"
                  onClick={() => onChange(staged.filter((_, j) => j !== i))}
                  className="ml-3 text-stone-400 underline hover:text-stone-700"
                >
                  remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {note !== null && <p className="mt-2 text-xs text-red-800">{note}</p>}

      <div className="mt-2 flex flex-wrap gap-2">
        {/* `capture` opens the camera directly on a phone; the chooser beside
            it is for a desktop user with a scan. */}
        <input
          ref={camera}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => void pick(e.target.files)}
        />
        <input
          ref={chooser}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => void pick(e.target.files)}
        />
        <button type="button" onClick={() => camera.current?.click()} className={btnGhostCls}>
          Take photo
        </button>
        <button type="button" onClick={() => chooser.current?.click()} className={btnGhostCls}>
          Choose file
        </button>
      </div>
    </section>
  )
}
