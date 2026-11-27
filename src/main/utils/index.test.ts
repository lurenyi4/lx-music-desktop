import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import defaultSetting from '@common/defaultSetting'
import { getProxy, mergeSetting } from './index'

vi.mock('electron', () => ({
  nativeTheme: { shouldUseDarkColors: false },
  powerSaveBlocker: { isStarted: () => false, start: () => 1, stop: () => {} },
}))
vi.mock('@main/utils/store', () => ({ default: () => ({ get: () => null, set: () => {} }) }))
vi.mock('./migrate', () => ({
  migrateDataJson: vi.fn(),
  migrateHotKey: vi.fn(),
  migrateUserApi: vi.fn(),
  parseDataFile: vi.fn(),
}))

describe('mergeSetting - 数组值相等与类型安全', () => {
  it('元素完全相同的数组不触发脏更新，修改数组则浅拷贝隔离外部引用', () => {
    const origin: LX.AppSetting = {
      ...defaultSetting,
      'common.apiSource': 'user_api_primary',
      'common.apiSourceBackups': ['user_api_backup'],
    }
    const sameRes = mergeSetting(origin, { 'common.apiSourceBackups': ['user_api_backup'] })
    expect(sameRes.updatedSettingKeys).toEqual([])
    expect(sameRes.updatedSetting).toEqual({})

    const incoming = ['user_api_backup_2']
    const diffRes = mergeSetting(origin, { 'common.apiSourceBackups': incoming })
    expect(diffRes.updatedSettingKeys).toEqual(['common.apiSourceBackups'])
    incoming.push('mutated')
    expect(diffRes.setting['common.apiSourceBackups']).toEqual(['user_api_backup_2'])
  })

  it('禁止数组覆盖原始类型设置或原始类型覆盖数组设置', () => {
    const origin: LX.AppSetting = {
      ...defaultSetting,
      'common.apiSource': 'temp',
      'common.apiSourceBackups': ['user_api_backup'],
    }
    const res = mergeSetting(origin, {
      'common.apiSource': ['bad-array'] as any,
      'common.apiSourceBackups': 'bad-string' as any,
    })
    expect(res.updatedSettingKeys).toEqual([])
    expect(res.setting['common.apiSource']).toBe('temp')
    expect(res.setting['common.apiSourceBackups']).toEqual(['user_api_backup'])
  })
})

describe('getProxy - 内嵌端口主机规范化解析', () => {
  beforeEach(() => {
    vi.stubGlobal('lx', {
      appSetting: {
        ...defaultSetting,
        'network.proxy.enable': false,
        'network.proxy.host': '',
        'network.proxy.port': '',
      },
    })
    vi.stubGlobal('envParams', { cmdParams: {} })
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('host 内嵌端口且 port 为空时正确解析端口而非强行拼默认 80', () => {
    global.lx.appSetting['network.proxy.enable'] = true
    global.lx.appSetting['network.proxy.host'] = '127.0.0.1:7890'
    global.lx.appSetting['network.proxy.port'] = ''
    expect(getProxy()).toEqual({ host: '127.0.0.1', port: 7890 })
  })

  it('仅配置 host 无端口时沿用默认 80 兜底', () => {
    global.lx.appSetting['network.proxy.enable'] = true
    global.lx.appSetting['network.proxy.host'] = '127.0.0.1'
    global.lx.appSetting['network.proxy.port'] = ''
    expect(getProxy()).toEqual({ host: '127.0.0.1', port: 80 })
  })

  it('IPv6 主机（带方括号或内嵌端口）正确解析为规范 host 与 port', () => {
    global.lx.appSetting['network.proxy.enable'] = true
    global.lx.appSetting['network.proxy.host'] = '[::1]'
    global.lx.appSetting['network.proxy.port'] = '7890'
    expect(getProxy()).toEqual({ host: '::1', port: 7890 })

    global.lx.appSetting['network.proxy.host'] = '[::1]:7891'
    global.lx.appSetting['network.proxy.port'] = ''
    expect(getProxy()).toEqual({ host: '::1', port: 7891 })
  })

  it('非法代理配置或环境变量返回 null 而非透传原始字符串或 NaN 端口', () => {
    global.lx.appSetting['network.proxy.enable'] = true
    for (const [host, port] of [
      ['127.0.0.1:', ''],
      ['[::1', '7890'],
      ['socks5://127.0.0.1:1080', ''],
      ['127.0.0.1', 'abc'],
      ['127.0.0.1:7890;https=evil.example:443', ''],
    ]) {
      global.lx.appSetting['network.proxy.host'] = host
      global.lx.appSetting['network.proxy.port'] = port
      expect(getProxy()).toBeNull()
    }

    global.lx.appSetting['network.proxy.enable'] = false
    envParams.cmdParams['proxy-server'] = 'http://127.0.0.1:7890'
    expect(getProxy()).toEqual({ host: '127.0.0.1', port: 7890 })
    envParams.cmdParams['proxy-server'] = 'socks5://127.0.0.1:1080'
    expect(getProxy()).toBeNull()
  })
})
