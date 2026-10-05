const { it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function searchFixture() {
  let offline = false
  let calls = 0
  const row = { id: 'kw_1', name: 'Song', singer: 'Artist' }
  const sdk = {
    kw: {
      musicSearch: {
        async search() {
          calls++
          if (offline) throw new Error('offline')
          return { list: [row], allPage: 1, limit: 30, total: 1, source: 'kw' }
        },
      },
    },
  }
  const info = () => ({ list: [], limit: 30, page: 1, key: null })
  const state = { sources: ['kw', 'all'], maxPages: {}, listInfos: { all: info(), kw: info() } }
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
  return { search: module.exports.search, disconnect: () => { offline = true }, calls: () => calls }
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

it('aggregate search really refetches and loses rows on an offline return', async() => {
  const fixture = searchFixture()
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 1)
  fixture.disconnect()
  assert.equal((await fixture.search('Artist', 1, 'all')).length, 0)
  assert.equal(fixture.calls(), 2)
})
