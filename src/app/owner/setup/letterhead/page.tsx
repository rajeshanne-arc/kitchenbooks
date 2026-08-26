import { getRestaurant } from '@/server/queries'
import { getLetterhead } from '@/server/po-queries'
import { getSettingValue } from '@/server/settings'
import LetterheadEditor from '@/components/settings/LetterheadEditor'
import { DOCUMENT_STYLES, type DocumentStyle } from '@/lib/types'
import { pageSubCls, pageTitleCls } from '@/components/ui'

export const dynamic = 'force-dynamic'

export default async function LetterheadPage() {
  const restaurant = await getRestaurant()
  const [letterhead, styleRaw] = await Promise.all([
    getLetterhead(restaurant.id),
    getSettingValue(restaurant.id, 'document_style'),
  ])
  const style: DocumentStyle = DOCUMENT_STYLES.includes(styleRaw as DocumentStyle)
    ? (styleRaw as DocumentStyle)
    : 'classic'
  return (
    <>
      <header className="pb-4">
        <h1 className={pageTitleCls}>Letterhead</h1>
        <p className={pageSubCls}>
          {restaurant.name} — what a vendor sees at the top of a purchase order. Nothing here changes a figure
          in the books; it changes whose name is on the paper.
        </p>
      </header>
      <LetterheadEditor initial={letterhead} initialStyle={style} />
    </>
  )
}
