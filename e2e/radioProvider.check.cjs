const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const { startRadioProvider } = require('./radioProvider.cjs')

it('real KW SDK parses deterministic HTTP provider data, loses candidates offline and recovers', async() => {
  const provider = await startRadioProvider()
  const module = { exports: {} }
  const dependencies = {
    '../../request': { httpFetch: target => ({ promise: fetch(`${provider.baseURL}/provider?target=${encodeURIComponent(target)}`).then(async response => ({ body: await response.json(), statusCode: response.status })) }) },
    '../../index': { formatPlayTime: () => '03:00', decodeName: value => value },
    './util': { formatSinger: value => value },
  }
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/utils/musicSdk/kw/musicSearch.js'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name], console })
  const sdk = module.exports.default
  try {
    const online = await sdk.search('林俊杰', 1, 30)
    assert.equal(online.list.length, 40)
    assert.equal(online.list[0].songmid, '88000000')
    assert.equal(online.list[0].source, 'kw')
    assert.equal(online.list[0].types[0].type, '128k')
    provider.setOffline(true)
    assert.equal((await sdk.search('电台测试歌手', 1, 10)).list.length, 0)
    assert.ok(provider.requests.some(request => request.offline && request.search))
    provider.setOffline(false)
    assert.equal((await sdk.search('电台测试歌手', 1, 10)).list.length, 40)
  } finally {
    await provider.close()
  }
})

it('R9 rejects real Node provider traffic and preserves the production radio assertions', () => {
  const script = fs.readFileSync(path.join(__dirname, 'radio.js'), 'utf8')
  assert.match(script, /await startRadioProvider\(\)/)
  assert.match(script, /await installRadioProvider\(window, provider.baseURL\)/)
  assert.match(script, /provider.setOffline\(true\)/)
  assert.match(script, /provider.setOffline\(false\)/)
  assert.match(script, /if \(!blocked.length\) throw new Error/)
  assert.match(script, /offlineFailures.length < 3/)
  assert.match(script, /if \(!revived\) throw new Error/)
})
