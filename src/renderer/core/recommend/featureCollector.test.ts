import { EventEmitter } from 'node:events'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AudioFeatureCollector } from './feature'

const mocks = vi.hoisted(() => ({
  analyser: null as AnalyserNode | null,
}))
vi.mock('@renderer/plugins/player', () => ({ getAnalyser: () => mocks.analyser }))
let collector: AudioFeatureCollector
let events: EventEmitter
beforeEach(() => {
  vi.useFakeTimers()
  mocks.analyser = null
  events = new EventEmitter()
  vi.stubGlobal('window', { app_event: events })
  collector = new AudioFeatureCollector()
})
afterEach(() => { collector.stop(); vi.useRealTimers(); vi.unstubAllGlobals() })

it('播放器模块加载期间停止，不得在加载结束后留下定时器和订阅', async() => {
  const started = collector.start()
  collector.stop()
  await started
  expect(collector.isStarted()).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
  expect(events.listenerCount('musicToggled')).toBe(0)
})

it('加载期间重启仅注册新一代采集器，stop 可清理全部资源', async() => {
  const first = collector.start()
  collector.stop()
  const second = collector.start()
  await Promise.all([first, second])
  expect(vi.getTimerCount()).toBe(1)
  expect(events.listenerCount('musicToggled')).toBe(1)
  collector.stop()
  expect(vi.getTimerCount()).toBe(0)
  expect(events.listenerCount('musicToggled')).toBe(0)
  expect(events.listenerCount('stop')).toBe(0)
  expect(events.listenerCount('error')).toBe(0)
  expect(events.listenerCount('playerError')).toBe(0)
})

it('stop/error/playerError 暂停采样并清理订阅，且提前数毫秒触发的定时器不会令采样率减半', async() => {
  mocks.analyser = {
    fftSize: 8,
    frequencyBinCount: 4,
    getFloatTimeDomainData: (arr: Float32Array) => { arr.fill(0.25) },
    getFloatFrequencyData: (arr: Float32Array) => { arr.fill(-30) },
  } as unknown as AnalyserNode

  vi.setSystemTime(10_000)
  await collector.start()
  expect(events.listenerCount('stop')).toBe(1)
  expect(events.listenerCount('error')).toBe(1)
  expect(events.listenerCount('playerError')).toBe(1)

  // 通过公共定时器驱动：连续两个 1000ms 周期（第二周期系统时钟略回拨 3ms 模拟定时器提前 3ms 触发）均正常入桶
  await vi.advanceTimersByTimeAsync(1000)
  expect(collector.getBuckets()).toHaveLength(1)
  vi.setSystemTime(Date.now() - 3)
  await vi.advanceTimersByTimeAsync(1000)
  expect(collector.getBuckets()).toHaveLength(2)

  // error 事件后停止采样，后续定时器不再入桶
  events.emit('error')
  await vi.advanceTimersByTimeAsync(2000)
  expect(collector.getBuckets()).toHaveLength(2)

  collector.stop()
  expect(events.listenerCount('stop')).toBe(0)
  expect(events.listenerCount('error')).toBe(0)
  expect(events.listenerCount('playerError')).toBe(0)
})
