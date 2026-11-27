import { afterEach, describe, expect, it } from 'vitest'
import { createI18n, messages } from './index'

const i18n = createI18n()
const keys = Object.keys(messages['zh-cn']).filter(key => key.startsWith('catalog__') || key.startsWith('player__queue') || key.startsWith('player__temporary_version') || key === 'music_toggle_pinned_version' || key === 'music_toggle_current_version' || key === 'music_toggle_original_version' || key === 'retry') as Array<keyof typeof messages['zh-cn']>
const placeholders = (text: string) => [...text.matchAll(/\{([^}]+)\}/g)].map(match => match[1]).sort()

afterEach(() => { i18n.setLanguage('zh-cn') })

describe('playback and catalog translations', () => {
  it.each(i18n.availableLocales)('keeps all messages and interpolation parameters available in %s', locale => {
    i18n.setLanguage(locale)
    for (const key of keys) {
      const message = i18n.getMessage(key)
      expect(message).not.toBe(key)
      expect(message).not.toBe('')
      expect(placeholders(message)).toEqual(placeholders(messages['zh-cn'][key]))
    }
  })
  it('formats the temporary-version notice in English', () => {
    i18n.setLanguage('en-us')
    expect(i18n.t('player__temporary_version_notice', { name: 'Song', singer: 'Artist', source: 'wy' }))
      .toBe('The selected version is temporarily unavailable. Playing Song · Artist (wy) for now; your saved song and selected version are unchanged')
  })
  it('retains the existing Chinese fallback for an untranslated message', () => {
    i18n.setLanguage('en-us')
    i18n.message = { ...i18n.message }
    Reflect.deleteProperty(i18n.message, 'player__queue_title')
    expect(i18n.t('player__queue_title')).toBe(messages['zh-cn'].player__queue_title)
  })
})
