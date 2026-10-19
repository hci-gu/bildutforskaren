import assert from 'node:assert/strict'
import { test, afterEach } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  canvasText, currentLanguage, displayLabel, displayTag, formatNumber,
  message, readLanguage, rememberLabels, renderMessage, scopeNote,
  setLanguage, t, translate, plural,
} from './index'
import { messages } from './messages'
import { LanguageSelector } from '../components/LanguageSelector'

afterEach(() => setLanguage('sv'))

test('Swedish is the default, including invalid and unavailable storage', () => {
  assert.equal(readLanguage({ getItem: () => null }), 'sv')
  assert.equal(readLanguage({ getItem: () => 'de' }), 'sv')
  assert.equal(readLanguage({ getItem: () => { throw new Error('Denied') } }), 'sv')
  assert.equal(readLanguage({ getItem: () => 'en' }), 'en')
})

test('selection writes browser storage and document language, including storage denial', () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  const html = { lang: 'sv' }
  try {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { localStorage: storage } })
    Object.defineProperty(globalThis, 'document', { configurable: true, value: { documentElement: html } })
    setLanguage('en')
    assert.equal(readLanguage(), 'en')
    assert.equal(html.lang, 'en')
    storage.setItem = () => { throw new Error('Denied') }
    assert.doesNotThrow(() => setLanguage('sv'))
    assert.equal(currentLanguage(), 'sv')
    assert.equal(html.lang, 'sv')
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('every message has both locales and identical interpolation parameters', () => {
  for (const [key, [sv, en]] of Object.entries(messages)) {
    assert.ok(sv.trim(), `${key}: Swedish`)
    assert.ok(en.trim(), `${key}: English`)
    assert.deepEqual([...sv.matchAll(/\{\d+\}/g)].map(item => item[0]).sort(), [...en.matchAll(/\{\d+\}/g)].map(item => item[0]).sort(), key)
  }
})

test('both old Swedish and old English UI text translate', () => {
  setLanguage('sv')
  assert.equal(t('Dataset name'), 'Datasetnamn')
  assert.equal(t('Close'), 'Stäng')
  setLanguage('en')
  assert.equal(t('Översikt'), 'Overview')
  assert.equal(t('Skapa ett nytt dataset'), 'Create a new dataset')
  assert.equal(t('Graph network'), 'Graph network')
})

test('stored messages render in the current language without changing their data', () => {
  const stored = message('Upload processing', ['Min samling'])
  assert.equal(renderMessage(stored), 'Min samling laddades upp och bearbetas nu.')
  setLanguage('en')
  assert.equal(renderMessage(stored), 'Min samling was uploaded and is now processing.')
  assert.deepEqual(stored.values, ['Min samling'])
  assert.equal(plural('selectedImages', 1), '1 image selected')
  assert.equal(plural('selectedImages', 2), '2 images selected')
})

test('changing presentation preserves canonical tag labels, IDs, scores and prompts', () => {
  const result = {
    id: 'horse', label: 'hästar', labels: { sv: 'hästar', en: 'horses' },
    score: 0.78, embedding_prompt: 'A photograph depicting horses.',
  }
  const before = JSON.stringify(result)
  rememberLabels([result])
  assert.equal(displayLabel(result), 'hästar')
  setLanguage('en')
  assert.equal(displayLabel(result), 'horses')
  assert.equal(displayTag('hästar'), 'horses')
  assert.equal(displayTag('My custom tag'), 'My custom tag')
  assert.equal(displayTag('Close'), 'Close')
  assert.equal(displayLabel({ label: 'unavailable translation' }), 'unavailable translation')
  assert.equal(JSON.stringify(result), before)
  assert.equal(canvasText('Otaggade', 'untagged_header'), 'Untagged')
  assert.equal(canvasText('Otaggade', 'tag_1'), 'Otaggade')
  assert.equal(canvasText('Tagg', 'tag_2'), 'Tagg')
  assert.equal(canvasText('Tagg', 'tag_fallback_3'), 'Tag')
  rememberLabels([{ label: 'ambiguous', labels: null }, { label: 'ambiguous', labels: { sv: 'ambiguous', en: 'different' } }])
  assert.equal(displayTag('ambiguous'), 'ambiguous')
  assert.equal(displayLabel({ label: 'ambiguous', labels: { sv: 'ambiguous', en: 'different' } }), 'different')
})

test('selector and locale-dependent text follow the same persisted preference', () => {
  setLanguage('en')
  const english = renderToStaticMarkup(createElement(LanguageSelector))
  assert.match(english, /aria-label="Language"/)
  assert.match(english, /src="\/flags\/en.svg"/)
  assert.equal(formatNumber(0.125, 3), '0.125')
  assert.match(scopeNote('Djur.'), /Original Swedish scope note: Djur\./)
  setLanguage('sv')
  const swedish = renderToStaticMarkup(createElement(LanguageSelector))
  assert.match(swedish, /aria-label="Språk"/)
  assert.match(swedish, /src="\/flags\/sv.svg"/)
  assert.equal(formatNumber(0.125, 3), '0,125')
  assert.equal(currentLanguage(), 'sv')
  assert.equal(translate('ready'), 'Klart')
})
