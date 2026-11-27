import { expect, it, vi } from 'vitest'
import updateLists from './listAutoUpdate'

const mocks = vi.hoisted(() => ({ sync: vi.fn(async(_list: LX.List.UserListInfo) => {}) }))
vi.mock('@renderer/store/list/syncSourceList', () => ({ default: mocks.sync }))
vi.mock('@renderer/store/list/state', () => ({
  userLists: [
    { id: 'missing-record', source: 'wy', sourceListId: '1' },
    { id: 'missing-setting', source: 'wy', sourceListId: '2' },
    { id: 'enabled', source: 'wy', sourceListId: '3' },
    { id: 'disabled', source: 'wy', sourceListId: '4' },
    { id: 'local' },
  ],
}))
vi.mock('@renderer/utils/data', () => ({
  getListUpdateInfo: async() => ({
    'missing-setting': { updateTime: 0 },
    enabled: { isAutoUpdate: true },
    disabled: { isAutoUpdate: false },
  }),
}))

it('缺记录或缺开关时默认启动同步，只跳过显式关闭和本地列表', async() => {
  updateLists()
  await vi.waitFor(() => { expect(mocks.sync).toHaveBeenCalledTimes(3) })
  expect(mocks.sync.mock.calls.map(([list]) => list.id)).toEqual(['missing-record', 'missing-setting', 'enabled'])
})
