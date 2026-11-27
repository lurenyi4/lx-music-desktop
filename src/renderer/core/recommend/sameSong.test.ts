/**
 * sameSong 同曲判定的纯函数测试。
 *
 * 背景：音乐平台对同一首歌返回的 artist 串顺序/分隔符/合作者数量可能不同
 * （如 Möbius 一条 artist="Benjamin, Laco, 薄野弘之"，另一条 "mpi, Laco, Benjamin, 薄野弘之"；
 * Inferno 两条 artist 相同但 id 不同），导致同曲以多 id/artist 变体穿过去重。
 */
import { describe, expect, it } from 'vitest'
import { includesSameSong, pushUniqueSameSong, sameSong } from './sameSong'
import { matchSeed } from './seedMatch'

describe('sameSong - 同曲判定', () => {
  it('种子接受的括号、零宽字符与双向艺人别名在同曲判断中一致', () => {
    const a = { artist: '冯沁苑（买辣椒也用券）', title: '\u200B起风了（Live）' }
    const b = { artist: '买辣椒也用券', title: '起风了 ( Live )' }
    expect(matchSeed(a, [b])).toBe(b)
    expect(matchSeed(b, [a])).toBe(a)
    expect(sameSong(a, b)).toBe(true)
    expect(sameSong(b, a)).toBe(true)
    expect(sameSong(a, { ...b, title: '起风了' })).toBe(false)
  })

  it('共享归一化不放宽种子的主艺人和时长门禁', () => {
    const target = { artist: '主艺人 / 合作者', title: '作品', intervalSec: 180 }
    const collaborator = { artist: '合作者', title: '作品', intervalSec: 180 }
    const differentRecording = { ...target, intervalSec: 300 }
    expect(sameSong(target, collaborator)).toBe(true)
    expect(matchSeed(target, [collaborator])).toBeNull()
    expect(sameSong(target, differentRecording)).toBe(true)
    expect(matchSeed(target, [differentRecording])).toBeNull()
  })

  it('截图真实变体：合作者数量/顺序不同 → true', () => {
    // act & assert
    expect(sameSong(
      { artist: 'Benjamin, Laco, 薄野弘之', title: 'Möbius' },
      { artist: 'mpi, Laco, Benjamin, 薄野弘之', title: 'Möbius' },
    )).toBe(true)
  })

  it('分隔符差异（、 vs ,） → true', () => {
    // act & assert
    expect(sameSong(
      { artist: 'Benjamin、薄野弘之、mpi', title: 'Möbius' },
      { artist: 'Benjamin, 薄野弘之, mpi', title: 'Möbius' },
    )).toBe(true)
  })

  it('大小写/首尾空格差异 → true', () => {
    // act & assert
    expect(sameSong(
      { artist: '  Adele ', title: ' Hello  ' },
      { artist: 'adele', title: 'hello' },
    )).toBe(true)
  })

  it('同名但艺人完全无交集 → false', () => {
    // act & assert
    expect(sameSong(
      { artist: '周杰伦', title: '晴天' },
      { artist: '王菲', title: '晴天' },
    )).toBe(false)
  })

  it('标题不同（含 (Live) 版本差异） → false', () => {
    // act & assert
    expect(sameSong(
      { artist: 'Adele', title: 'Hello' },
      { artist: 'Adele', title: 'Hello (Live)' },
    )).toBe(false)
  })

  it('双方 artist 均为空、title 相同 → true', () => {
    // act & assert
    expect(sameSong(
      { artist: '', title: '纯音乐' },
      { artist: '', title: '纯音乐' },
    )).toBe(true)
  })

  it('任一方 artist 为空、另一方非空 → false（同名不同艺人归属不判同曲）', () => {
    // act & assert
    expect(sameSong(
      { artist: '', title: '晴天' },
      { artist: '周杰伦', title: '晴天' },
    )).toBe(false)
  })

  it('完全相同的 id/artist/title → true', () => {
    // act & assert
    expect(sameSong(
      { artist: 'mpi, Laco, Benjamin, 薄野弘之', title: 'Möbius' },
      { artist: 'mpi, Laco, Benjamin, 薄野弘之', title: 'Möbius' },
    )).toBe(true)
  })
})

describe('includesSameSong - 列表同曲命中', () => {
  it('artist 串顺序/合作者数量不同的同曲变体命中 → true', () => {
    // act & assert
    expect(includesSameSong(
      [{ artist: 'mpi, Laco, Benjamin, 薄野弘之', title: 'Möbius' }],
      { artist: 'Benjamin, Laco, 薄野弘之', title: 'Möbius' },
    )).toBe(true)
  })

  it('空列表 → false', () => {
    // act & assert
    expect(includesSameSong([], { artist: 'Adele', title: 'Hello' })).toBe(false)
  })

  it('同名不同艺人 → false', () => {
    // act & assert
    expect(includesSameSong([{ artist: '周杰伦', title: '晴天' }], { artist: '王菲', title: '晴天' })).toBe(false)
  })
})

describe('pushUniqueSameSong - 同曲去重追加', () => {
  it('新曲追加到列表并返回 true', () => {
    // arrange
    const list = [{ artist: 'Adele', title: 'Hello' }]
    // act
    const added = pushUniqueSameSong(list, { artist: 'Coldplay', title: 'Yellow' })
    // assert
    expect(added).toBe(true)
    expect(list).toEqual([
      { artist: 'Adele', title: 'Hello' },
      { artist: 'Coldplay', title: 'Yellow' },
    ])
  })

  it('同曲变体已在列表 → false 且不追加', () => {
    // arrange
    const list = [{ artist: 'mpi, Laco, 薄野弘之', title: 'Möbius' }]
    // act
    const added = pushUniqueSameSong(list, { artist: 'Benjamin, Laco, 薄野弘之', title: 'Möbius' })
    // assert
    expect(added).toBe(false)
    expect(list).toHaveLength(1)
  })
})
