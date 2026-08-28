import { notFound } from 'next/navigation'
import { getRestaurant } from '@/server/queries'
import { getLetterhead, getPurchaseOrder } from '@/server/po-queries'
import { getSettingValue } from '@/server/settings'
import PoDocument from '@/components/store/PoDocument'
import PrintButton from '@/components/accountant/PrintButton'
import { DOCUMENT_STYLES, type DocumentStyle } from '@/lib/types'

export const dynamic = 'force-dynamic'

// THE DOCUMENT ITSELF. It prints through the browser — `globals.css` already
// says app furniture does not print, this page carries none of it, and "save
// as PDF" in the print dialog is the PDF. A library would add a second layout
// to keep in step with this one for no gain a vendor could see.

export default async function PrintOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const restaurant = await getRestaurant()
  const found = await getPurchaseOrder(restaurant.id, id)
  if (found === null) notFound()

  const [letterhead, styleRaw] = await Promise.all([
    getLetterhead(restaurant.id),
    getSettingValue(restaurant.id, 'document_style'),
  ])
  const style: DocumentStyle = DOCUMENT_STYLES.includes(styleRaw as DocumentStyle)
    ? (styleRaw as DocumentStyle)
    : 'classic'

  return (
    <div className="min-h-screen bg-stone-100 py-6 print:bg-white print:py-0">
      <div className="mx-auto mb-3 flex max-w-[210mm] items-center justify-between px-6 print:hidden">
        <span className="text-sm text-stone-600">
          {style} layout — change it under Owner → Setup → Letterhead
        </span>
        <PrintButton />
      </div>
      <PoDocument po={found.po} lines={found.lines} letterhead={letterhead} style={style} />
    </div>
  )
}
