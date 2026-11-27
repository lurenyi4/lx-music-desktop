import http from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { buildRequestDispatcher, request, setProxyByHost } from './request'
import { setProxyByHost as setProxyByHostNode16 } from './request_node16'

describe('buildRequestDispatcher - 请求级 dispatcher 构建条件', () => {
  it('不传任何选项时不构建（走全局 dispatcher）', () => {
    // act & assert
    expect(buildRequestDispatcher({})).toBeUndefined()
  })

  it('自定义 maxRedirect 时构建', () => {
    // act & assert
    expect(buildRequestDispatcher({ maxRedirect: 3 })).toBeDefined()
  })

  it('仅传 retryNum 或 maxRedirect 等于默认值 5 时也构建独立 dispatcher', () => {
    // act & assert
    expect(buildRequestDispatcher({ retryNum: 0 })).toBeDefined()
    expect(buildRequestDispatcher({ retryNum: 5 })).toBeDefined()
    expect(buildRequestDispatcher({ maxRedirect: 5, retryNum: 0 })).toBeDefined()
  })

  it('retryNum=0 且 maxRedirect=0 时不挂载 retry 拦截器，HTTP 429 POST 透传状态码与错误体', async() => {
    let hits = 0
    const server = http.createServer((_req, res) => {
      hits++
      res.writeHead(429, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'rate limit exceeded' } }))
    })
    await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
    const addr = server.address() as { port: number }
    try {
      const res = await request<{ error?: { message?: string } }>(`http://127.0.0.1:${addr.port}/chat/completions`, {
        method: 'POST',
        retryNum: 0,
        maxRedirect: 0,
        json: { model: 'test' },
      })
      expect(hits).toBe(1)
      expect(res.statusCode).toBe(429)
      expect(res.body?.error?.message).toBe('rate limit exceeded')
    } finally {
      await new Promise<void>(resolve => { server.close(() => { resolve() }) })
    }
  })
})

describe('setProxyByHost - IPv6 代理主机括号规范化（含 Win7 request_node16）', () => {
  afterEach(() => {
    setProxyByHost()
    setProxyByHostNode16()
  })

  it('裸 IPv6 与已带方括号 IPv6 均能构造合法 ProxyAgent 而不抛 Invalid URL', () => {
    for (const setter of [setProxyByHost, setProxyByHostNode16]) {
      expect(() => { setter('::1', '7890') }).not.toThrow()
      expect(() => { setter('[::1]', '7890') }).not.toThrow()
      expect(() => { setter('127.0.0.1', '7890') }).not.toThrow()
    }
  })

  it('非法代理主机或端口安全降级直连而非同步抛出 Invalid URL', () => {
    for (const setter of [setProxyByHost, setProxyByHostNode16]) {
      expect(() => { setter('127.0.0.1:', '') }).not.toThrow()
      expect(() => { setter('socks5://127.0.0.1:1080', '') }).not.toThrow()
      expect(() => { setter('127.0.0.1', 'undefined') }).not.toThrow()
      expect(() => { setter('[::1', '7890') }).not.toThrow()
    }
  })
})
