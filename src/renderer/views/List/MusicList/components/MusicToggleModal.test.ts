import fs from 'node:fs'
import vm from 'node:vm'
import { expect, it, vi } from 'vitest'
import useMusicToggle from '../useMusicToggle'
import { restartSelectedVersion } from '@renderer/core/player'
import { updateListMusics } from '@renderer/store/list/action'
import { getPreferredMusicInfo, getVersionPreference, createManualVersion } from '@renderer/core/music/version'

// Exercise the actual Options API script, without Electron or a parallel chooser implementation.
const source = fs.readFileSync(process.env.MUSIC_MODAL_FIXTURE ?? new URL('./MusicToggleModal.vue', import.meta.url), 'utf8')
const script = source.match(/<script>([\s\S]*?)<\/script>/)![1].replace(/^import .*$/gm, '').replace('export default', 'result =')
const pending: any[] = []
const state: any = vi.hoisted(() => ({ musicInfo: null, listId: null, isTempPlay: false }))
vi.mock('@renderer/store/player/state', () => ({ playMusicInfo: state }))
vi.mock('@renderer/core/player', () => ({ restartSelectedVersion: vi.fn() }))
vi.mock('@renderer/store/list/action', () => ({ updateListMusics: vi.fn(async() => {}) }))
const sandbox: any = {
  LIST_IDS: { PLAY_LATER: 'playLater' },
  addTempPlayList: (list: any[]) => pending.unshift(...list),
  playNext: async() => { Object.assign(state, pending.shift(), { isTempPlay: true }) },
  playMusicInfo: state,
  getPreferredMusicInfo,
  getVersionPreference,
  createManualVersion,
}
vm.runInNewContext(script, sandbox)
const modal = sandbox.result
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
it('A selected as B displays B and enables selecting A again', () => {
  const original = song('a')
  const b = song('b')
  const pinned = createManualVersion(original, b)
  const preferred = modal.computed.preferredMusicInfo.call({ musicInfo: pinned })
  expect(preferred.id).toBe('b')
  const disabled = source.match(/:disabled="([^"]+)"/)![1]
  const isDisabled = (musicInfo: LX.Music.MusicInfo, preferredMusicInfo: LX.Music.MusicInfo, toggleMusicInfo: LX.Music.MusicInfo) => vm.runInNewContext(disabled, { musicInfo, preferredMusicInfo, toggleMusicInfo })
  expect(isDisabled(pinned, preferred, original)).toBe(false)
  expect(isDisabled(pinned, preferred, b)).toBe(true)
  const restored = createManualVersion(pinned, original)
  expect(getPreferredMusicInfo(restored).id).toBe('a')
  expect(restored.meta.toggleMusicInfo).toBeNull()
  expect(getVersionPreference(restored)).toBe('manual')
})
it('the actual preview method notifies ownership before changing playback identity', async() => {
  const a = song('a')
  const b = song('b')
  Object.assign(state, { musicInfo: a, listId: 'love', isTempPlay: false })
  const emit = vi.fn((event: string) => {
    if (event === 'preview') expect(state.musicInfo).toBe(a)
  })
  const context: any = { $emit: emit, toggleMusicInfo: null }
  modal.methods.handlePlay.call(context, b)
  expect(emit).toHaveBeenCalledWith('preview', b)
  expect(state.musicInfo).toBe(b)
  modal.methods.handleConfirm.call(context)
  expect(emit).toHaveBeenCalledWith('toggle', b)
})

it('actual preview and confirm methods reach the collection hook with the original owner and chosen version', async() => {
  const a = song('a')
  const b = song('b')
  Object.assign(state, { musicInfo: a, listId: 'love', isTempPlay: false })
  const hook = useMusicToggle({ listId: 'love' }, { value: [a] })
  hook.handleShowMusicToggleModal(0)
  let confirmation: Promise<void> | undefined
  const context: any = {
    toggleMusicInfo: null,
    $emit: (event: string, info: LX.Music.MusicInfo) => {
      if (event === 'preview') hook.handlePreviewVersion(info)
      if (event === 'toggle') confirmation = hook.toggleSource(info)
    },
  }
  modal.methods.handlePlay.call(context, b)
  expect(state.musicInfo).toBe(b)
  modal.methods.handleConfirm.call(context)
  await confirmation
  const saved = vi.mocked(updateListMusics).mock.lastCall![0][0].musicInfo
  expect(saved.id).toBe('a')
  expect(saved.meta.toggleMusicInfo?.id).toBe('b')
  expect(restartSelectedVersion).toHaveBeenLastCalledWith('love', saved, { musicInfo: b, isTempPlay: false })
})

it('candidate duration uses the candidate version when A and B have different lengths', () => {
  const musicInfo = { ...song('a'), interval: '03:10' }
  const toggleMusicInfo = { ...song('b'), interval: '04:25' }
  const candidateLabel = source.match(/<span[^>]*>{{ toggleMusicInfo.source }} ([\s\S]*?)<\/span>/)![1]
  const rendered = candidateLabel.replace(/{{ (.*?) }}/g, (_, expression: string) => vm.runInNewContext(expression, { musicInfo, toggleMusicInfo }))
  expect(rendered).toBe('04:25')
})
