import { setLanguage, t, useLanguage, type Language } from '@/shared/i18n'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/select'

function LanguageOption({ language }: { language: Language }) {
  return (
    <span className="flex items-center gap-2" lang={language}>
      <img
        src={`/flags/${language}.svg`}
        alt=""
        aria-hidden="true"
        className="h-3.5 w-5 shrink-0 rounded-[2px]"
      />
      {language === 'sv' ? 'Svenska' : 'English'}
    </span>
  )
}

export function LanguageSelector() {
  const language = useLanguage()
  return (
    <label className="flex items-center gap-2 self-end text-sm text-slate-200">
      <span>{t('Language')}</span>
      <Select
        value={language}
        onValueChange={(value) => setLanguage(value as Language)}
      >
        <SelectTrigger aria-label={t('Language')} className="border-white/20 bg-slate-900 text-white">
          <SelectValue><LanguageOption language={language} /></SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="sv"><LanguageOption language="sv" /></SelectItem>
          <SelectItem value="en"><LanguageOption language="en" /></SelectItem>
        </SelectContent>
      </Select>
    </label>
  )
}
