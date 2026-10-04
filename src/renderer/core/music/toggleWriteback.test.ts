import { beforeEach, describe, expect, it, vi } from 'vitest'
import { playMusicInfo } from '@renderer/store/player/state'
import { writebackToggleMusicInfo } from './toggleWriteback'

vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: { musicInfo: null, listId: 'love', isTempPlay: false } }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => { Object.assign(playMusicInfo, { musicInfo: null, resolvedMusicInfo: undefined, versionNotice: undefined }) })
describe('temporary rescue preserves identity', () => {
  it.each([true, false])('never replaces the original saved or temporary item (temporary=%s)', async(isTempPlay) => {
    const original = song('original')
    const selected = song('selected')
    original.meta = { ...original.meta, toggleMusicInfo: selected, manualVersionPinned: true }
    const replacement = song('rescue')
    const savedList = [original, selected]
    const before = JSON.stringify(savedList)
    Object.assign(playMusicInfo, { musicInfo: original, isTempPlay })
    await writebackToggleMusicInfo(original, replacement)
    expect(playMusicInfo.musicInfo).toBe(original)
    expect(playMusicInfo.resolvedMusicInfo).toBe(replacement)
    expect(JSON.stringify(savedList)).toBe(before)
    expect(playMusicInfo.versionNotice).toContain('临时播放')
  })
  it('clears the rescue notice when the selected version is available', async() => {
    const original = song('original')
    const selected = song('selected')
    original.meta.toggleMusicInfo = selected
    playMusicInfo.musicInfo = original
    playMusicInfo.versionNotice = 'old rescue'
    await writebackToggleMusicInfo(original, selected)
    expect(playMusicInfo.versionNotice).toBeUndefined()
  })
  it('ignores a late result from a previous track', async() => {
    playMusicInfo.musicInfo = song('current')
    await writebackToggleMusicInfo(song('old'), song('rescue'))
    expect(playMusicInfo.resolvedMusicInfo).toBeUndefined()
  })
})
