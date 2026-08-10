// Labels for the five staff-facing forms — Issue, store Wastage, Kitchen
// closing, Kitchen wastage, Count — in English and Telugu. LABELS ONLY: the
// explanatory sentences stay English. One dictionary, typed so every
// language carries every key; adding Hindi later is adding data, not code.

export type Lang = 'en' | 'te'
export const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'te', label: 'తె' },
]

const en = {
  date: 'Date',
  section: 'Section',
  item: 'Item',
  quantity: 'Quantity',
  unit: 'Unit',
  reason: 'Reason',
  note: 'Note',
  optional: 'optional',
  save: 'Save',
  saving: 'Saving…',
  refile: 'Re-file',
  issue_title: 'Issue to a section',
  save_issue: 'Save issue',
  add_item: 'Add item',
  wastage_title: 'Record wastage',
  record_wastage: 'Record wastage',
  value_lost: 'Value lost (₹)',
  kitchen_wastage_title: 'Kitchen wastage',
  record_kitchen_wastage: 'Record kitchen wastage',
  closing_title: 'Closing values',
  closing_value: 'Closing value',
  not_closed: 'not closed',
  count_date: 'Count date',
  filter_items: 'Filter items',
  save_count: 'Save count',
  counted: 'Counted',
} as const

export type LabelKey = keyof typeof en

const te: Record<LabelKey, string> = {
  date: 'తేదీ',
  section: 'విభాగం',
  item: 'వస్తువు',
  quantity: 'పరిమాణం',
  unit: 'యూనిట్',
  reason: 'కారణం',
  note: 'గమనిక',
  optional: 'ఐచ్ఛికం',
  save: 'భద్రపరచు',
  saving: 'భద్రపరుస్తోంది…',
  refile: 'మళ్లీ నమోదు',
  issue_title: 'విభాగానికి జారీ',
  save_issue: 'జారీ భద్రపరచు',
  add_item: 'వస్తువు చేర్చు',
  wastage_title: 'వృథా నమోదు',
  record_wastage: 'వృథా నమోదు చేయి',
  value_lost: 'నష్టం విలువ (₹)',
  kitchen_wastage_title: 'వంటగది వృథా',
  record_kitchen_wastage: 'వంటగది వృథా నమోదు',
  closing_title: 'ముగింపు విలువలు',
  closing_value: 'ముగింపు విలువ',
  not_closed: 'ముగించలేదు',
  count_date: 'లెక్కింపు తేదీ',
  filter_items: 'వస్తువులు వెతకండి',
  save_count: 'లెక్క భద్రపరచు',
  counted: 'లెక్కించినది',
}

export const DICT: Record<Lang, Record<LabelKey, string>> = { en, te }

export const LANG_COOKIE = 'kb_lang'

export function t(lang: Lang, key: LabelKey): string {
  return DICT[lang][key] ?? en[key]
}
