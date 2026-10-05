const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function searchFixture(includeSecondSource = false) {
  const offline = new Set()
  let calls = 0
  const row = { id: 'kw_1', name: 'Song', singer: 'Artist' }
  const sdk = {
    kw: {
      musicSearch: {
        async search() {
          calls++
          if (offline.has('kw')) throw new Error('offline')
          return { list: [row], allPage: 1, limit: 30, total: 1, source: 'kw' }
        },
      },
    },
  }
  if (includeSecondSource) {
    sdk.wy = {
      musicSearch: {
        async search() {
          calls++
          if (offline.has('wy')) throw new Error('offline')
          return { list: [{ ...row, id: 'wy_1' }], allPage: 1, limit: 30, total: 1, source: 'wy' }
        },
      },
    }
  }
  const info = () => ({ list: [], limit: 30, page: 1, key: null })
  const state = { sources: includeSecondSource ? ['kw', 'wy', 'all'] : ['kw', 'all'], maxPages: {}, listInfos: { all: info(), kw: info() } }
  const module = { exports: {} }
  const dependencies = {
    '@common/utils/vueTools': { markRaw: value => value },
    '@renderer/utils/musicSdk': { default: sdk },
    '@renderer/utils': { deduplicationList: value => value, toNewMusicInfo: value => value },
    '@common/utils/common': { sortInsert: (array, item) => array.push(item), similar: () => 1 },
    './state': state,
  }
  // Execute the production cache branch; substitute only network/data adapters.
  const source = fs.readFileSync(path.join(__dirname, '../src/renderer/store/search/music/action.ts'), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name], window: { i18n: { t: value => value } }, console: { log() {} } })
  return { search: module.exports.search, disconnect: (source = 'kw') => { offline.add(source) }, reconnect: () => { offline.clear() }, calls: () => calls, info: () => state.listInfos.all }
}

it('R9 selects a production search cache that survives returning while offline', async() => {
  const script = fs.readFileSync(path.join(__dirname, 'radio.js'), 'utf8')
  const selected = script.match(/const OFFLINE_SEARCH_SOURCE = '(\w+)'/)?.[1] ?? 'all'
  const fixture = searchFixture()
  await fixture.search('Artist', 1, selected)
  fixture.disconnect()
  assert.equal((await fixture.search('Artist', 1, selected)).length, 1)
  assert.equal(fixture.calls(), 1, 'Returning offline must not reload search rows from the network')
  assert.match(script, /source: OFFLINE_SEARCH_SOURCE/)
  assert.ok((script.match(/await nav\(window, offlineSearchRoute\)/g) ?? []).length >= 3, 'Initial, failure rounds and revival must use the identical cached query')
})

it('complete aggregate results survive an identical offline return without a new request', async() => {
  const fixture = searchFixture()
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 1)
  fixture.disconnect()
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 1)
  assert.equal(fixture.calls(), 1, 'Only a completed error-free query may serve its cached rows')
  assert.equal(fixture.info().error, '')
})

it('a new aggregate query failure preserves earlier rows and is explicitly retryable', async() => {
  const fixture = searchFixture()
  await fixture.search('Artist', 1, 'all')
  fixture.disconnect()
  assert.equal((await fixture.search('New artist', 1, 'all')).length, 0, 'Failure resolves without inventing new results')
  assert.equal(fixture.calls(), 2, 'A different query must reach the provider')
  assert.equal(fixture.info().list.length, 1, 'Previously successful visible rows are retained')
  assert.equal(fixture.info().error, 'list__load_failed')
  assert.equal((await fixture.search('New artist', 1, 'all')).length, 0)
  assert.equal(fixture.calls(), 3, 'A failed attempt must not become a complete cache entry')
  fixture.reconnect()
  assert.equal((await fixture.search('New artist', 1, 'all')).length, 1)
  assert.equal(fixture.calls(), 4)
  assert.equal(fixture.info().error, '')
})

it('partial aggregate results expose provider failure and retry instead of using the complete cache', async() => {
  const fixture = searchFixture(true)
  fixture.disconnect('wy')
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 1)
  assert.equal(fixture.calls(), 2)
  assert.match(fixture.info().error, /wy/)
  fixture.reconnect()
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 2)
  assert.equal(fixture.calls(), 4, 'Partial success must requery rather than conceal the failed provider')
  assert.equal(fixture.info().error, '')
})
