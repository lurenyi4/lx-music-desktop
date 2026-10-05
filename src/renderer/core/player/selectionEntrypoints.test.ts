import { ref } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import useDownloadPlay from '@renderer/views/Download/usePlay'
import useLocalPlay from '@renderer/views/List/MusicList/usePlay'
import useOnlinePlay from '@renderer/components/material/OnlineList/usePlay'
import { playList, playMusicSelection } from './index'
import { addTempPlayList } from '@renderer/store/player/action'
import { addListMusics } from '@renderer/store/list/action'
vi.mock('./index', () => ({ playList: vi.fn(), playMusicSelection: vi.fn() }))
vi.mock('@renderer/store/player/action', () => ({ addTempPlayList: vi.fn() }))
vi.mock('@renderer/store/list/state', () => ({ defaultList: { id: 'default' } }))
vi.mock('@renderer/store/list/action', () => ({ addListMusics: vi.fn(async() => {}), getListMusics: vi.fn(async() => [song('old'), song('a'), song('b'), song('c')]) }))
vi.mock('@renderer/store/setting', () => ({ appSetting: {} }))
const song = (id: string): LX.Music.MusicInfoOnline => ({ id, name: id, singer: 'Artist', source: 'kw', interval: null, meta: { songId: id, albumName: '', qualitys: [], _qualitys: {} } })
beforeEach(() => { vi.clearAllMocks() })
it.each(['local', 'online'])('%s selection uses visible sorted order rather than click order or default list positions', async(kind) => {
  const list = [song('c'), song('b'), song('a')]
  const selectedList = ref([list[2], list[0]])
  const removeAllSelect = vi.fn()
  const hook = kind === 'local'
    ? useLocalPlay({ props: { listId: 'user' }, selectedList, list: { value: list }, removeAllSelect })
    : useOnlinePlay({ props: { list }, selectedList, removeAllSelect, emit: vi.fn() })
  await hook.handlePlayMusic(0, false)
  expect(playMusicSelection).toHaveBeenCalledWith([list[0], list[2]], kind === 'local' ? 'user' : 'default')
  expect(playList).not.toHaveBeenCalled()
  expect(removeAllSelect).toHaveBeenCalledOnce()
  if (kind === 'online') expect(addListMusics).toHaveBeenCalledWith('default', [list[0], list[2]])
})
it.each(['local', 'online'])('%s explicit single click does not enqueue the selection', async(kind) => {
  const list = [song('a'), song('b')]
  const options = { selectedList: ref([list[1]]), removeAllSelect: vi.fn() }
  const hook = kind === 'local'
    ? useLocalPlay({ ...options, props: { listId: 'user' }, list: { value: list } })
    : useOnlinePlay({ ...options, props: { list }, emit: vi.fn() })
  await hook.handlePlayMusic(0, true)
  expect(playMusicSelection).not.toHaveBeenCalled()
  expect(playList).toHaveBeenCalledWith(kind === 'local' ? 'user' : 'default', kind === 'local' ? 0 : 1)
})
it('play later also follows the visible list order', () => {
  const list = [song('a'), song('b'), song('c')]
  const hook = useLocalPlay({ props: { listId: 'user' }, list: { value: list }, selectedList: { value: [list[2], list[0]] }, removeAllSelect: vi.fn() })
  hook.handlePlayMusicLater(0, false)
  expect(addTempPlayList).toHaveBeenCalledWith([{ listId: 'user', musicInfo: list[0] }, { listId: 'user', musicInfo: list[2] }])
})

it('download multi-selection uses visible order and omits unfinished downloads', () => {
  const list = [{ id: 'a', isComplate: true }, { id: 'incomplete', isComplate: false }, { id: 'b', isComplate: true }]
  const hook = useDownloadPlay({ selectedList: { value: [...list].reverse() }, list: { value: list }, listAll: { value: [...list].reverse() }, removeAllSelect: vi.fn() })
  hook.handlePlayMusic(0)
  expect(playMusicSelection).toHaveBeenCalledWith([list[0], list[2]], 'download')
})
