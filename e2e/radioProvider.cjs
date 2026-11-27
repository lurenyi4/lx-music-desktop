const http = require('node:http')

// Provider wire data only: production SDK parsing/search cache, queues and radio
// planning remain untouched. This fixture is enabled only for R9 and R10.
const catalog = Array.from({ length: 40 }, (_, index) => ({
  MUSICRID: `MUSIC_${88000000 + index}`,
  SONGNAME: `固定电台歌曲${index + 1}`,
  ARTIST: '电台测试歌手',
  ALBUM: '电台测试专辑',
  ALBUMID: '880000',
  DURATION: '180',
  N_MINFO: 'level:standard,bitrate:128,format:mp3,size:5.0Mb',
}))

async function startRadioProvider() {
  let offline = false
  const requests = []
  const server = http.createServer((request, response) => {
    const target = new URL(request.url, 'http://localhost').searchParams.get('target')
    const url = new URL(target)
    const tip = url.hostname === 'tips.kuwo.cn'
    const search = url.hostname === 'search.kuwo.cn'
    requests.push({ target, offline, tip, search })
    request.resume()
    response.setHeader('Content-Type', 'application/json')
    if (tip) return response.end(JSON.stringify({ WORDITEMS: [] }))
    if (offline || !search) {
      response.statusCode = 503
      response.end(JSON.stringify({ error: 'fixture provider unavailable' }))
      return
    }
    response.end(JSON.stringify({ TOTAL: String(catalog.length), SHOW: '1', abslist: catalog }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const baseURL = `http://127.0.0.1:${server.address().port}`
  return {
    baseURL,
    requests,
    setOffline(value) { offline = value },
    async close() {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    },
  }
}

// Runs in the renderer's Node environment. Needle uses these genuine HTTP
// clients; browser-only CDP blocking does not cover Node provider requests.
function installTransport(baseURL) {
  const http = require('node:http')
  const https = require('node:https')
  if (window.__restoreRadioProvider) window.__restoreRadioProvider()
  const originals = { http: http.request, https: https.request }
  const hosts = new Set(['search.kuwo.cn', 'tips.kuwo.cn', 'songsearch.kugou.com', 'interface.music.163.com', 'u.y.qq.com', 'jadeite.migu.cn'])
  const endpoint = new URL(baseURL)
  for (const [name, client] of [['http', http], ['https', https]]) {
    client.request = function(options, ...args) {
      // Needle supplies an options object; leave unrelated request signatures
      // and application traffic alone.
      if (!options || typeof options !== 'object' || !hosts.has(options.hostname ?? options.host)) return originals[name].call(this, options, ...args)
      const target = `${options.protocol ?? `${name}:`}//${options.hostname ?? options.host}${options.path ?? '/'}`
      return originals.http.call(http, {
        ...options,
        protocol: 'http:',
        hostname: endpoint.hostname,
        host: endpoint.hostname,
        port: endpoint.port,
        path: '/provider?target=' + encodeURIComponent(target),
        agent: undefined,
      }, ...args)
    }
  }
  window.__restoreRadioProvider = () => { http.request = originals.http; https.request = originals.https }
}

const initScript = baseURL => `(${installTransport.toString()})(${JSON.stringify(baseURL)})`
const install = (window, baseURL) => window.evaluate(installTransport, baseURL)
module.exports = { startRadioProvider, install, initScript }
