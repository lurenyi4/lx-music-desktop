// Actual compiled Modal/OnlineList/Menu + hooks in a DOM emulator. No browser/hit-testing/audio claim.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { Script } = require('node:vm')
const { JSDOM, VirtualConsole } = require('jsdom')
const root = path.resolve(__dirname, '../..')
const bundle = fs.readFileSync(path.join(process.env.LX_CATALOG_UI_OUT || path.join(root, '.validation/catalog-queue-ui'), 'app.js'), 'utf8')
const fixture = async() => {
  const errors = []
  const virtualConsole = new VirtualConsole()
  virtualConsole.on('jsdomError', error => errors.push(error.message))
  const dom = new JSDOM('<!doctype html><div id="root"><div id="app"></div></div>', {
    runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://fixture.invalid/', virtualConsole,
  })
  const { window } = dom
  const document = window.document
  const clickCaptures = new Set()
  const add = document.addEventListener.bind(document)
  const remove = document.removeEventListener.bind(document)
  document.addEventListener = (type, listener, options) => {
    if (type === 'click' && (options === true || options?.capture)) clickCaptures.add(listener)
    return add(type, listener, options)
  }
  document.removeEventListener = (type, listener, options) => {
    if (type === 'click' && (options === true || options?.capture)) clickCaptures.delete(listener)
    return remove(type, listener, options)
  }
  new Script(bundle).runInContext(dom.getInternalVMContext())
  const flush = async() => { for (let i = 0; i < 5; i++) await window.fixture.flush() }
  const click = node => { assert.ok(node); node.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })) }
  const open = async() => {
    click(document.querySelector('#open-catalog')); await flush()
    document.querySelector('.list-item').dispatchEvent(new window.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: 80 }))
    await flush()
    assert.equal(document.querySelector('[role=menu]').getAttribute('aria-hidden'), 'false')
    assert.equal(document.querySelectorAll('.list-item.selected').length, 1)
  }
  const close = async() => { window.fixture.unmount(); await flush(); dom.window.close(); assert.deepEqual(errors, []) }
  return { window, document, flush, click, open, close, clickCaptures }
}
for (const target of ['title', 'footer', 'another row']) {
  test(`real Modal click.stop cannot block outside dismissal on ${target}; OnlineList unlocks`, async() => {
    const f = await fixture()
    try {
      await f.open()
      let bubbled = 0
      f.document.addEventListener('click', () => { bubbled++ })
      const outside = target === 'title' ? f.document.querySelector('h2') : target === 'footer' ? f.document.querySelector('#catalog-footer') : f.document.querySelectorAll('.list-item')[1]
      f.click(outside); await f.flush()
      assert.equal(bubbled, 0, 'actual Modal content must still stop click bubbling')
      assert.equal(f.document.querySelector('[role=menu]').getAttribute('aria-hidden'), 'true')
      assert.equal(f.document.querySelectorAll('.list-item.selected').length, 0)
      const before = f.window.fixture.listEvents.selections.length
      f.click(f.document.querySelector('.list-item')); await f.flush()
      f.click(f.document.querySelector('.list-item')); await f.flush()
      assert.equal(f.window.fixture.listEvents.selections.length, before + 2)
      assert.equal(f.window.fixture.listEvents.plays.length, 1, 'real double-click playback hook must be reachable again')
    } finally { await f.close() }
  })
}
test('a real menu action is not prematurely dismissed by capture and fires exactly once', async() => {
  const f = await fixture()
  try {
    await f.open()
    f.click(f.document.querySelector('[role=menuitem]')); await f.flush()
    assert.equal(f.window.fixture.listEvents.plays.length, 1)
    assert.equal(f.window.fixture.listEvents.plays[0], 0)
    assert.equal(f.document.querySelector('[role=menu]').getAttribute('aria-hidden'), 'true')
    assert.equal(f.document.querySelectorAll('.list-item.selected').length, 0)
  } finally { await f.close() }
})
test('catalog close/reopen removes and reinstalls exactly one capture listener', async() => {
  const f = await fixture()
  try {
    for (let i = 0; i < 2; i++) {
      await f.open()
      assert.equal(f.clickCaptures.size, 1)
      f.click(f.document.querySelector('header button')); await f.flush()
      assert.equal(f.clickCaptures.size, 0)
      assert.equal(f.document.querySelector('[role=menu]'), null)
    }
  } finally { await f.close() }
})
for (const file of ['common.js', 'userApiBackups.js']) {
  test(`${file} E2E menu helper selects one visible real menu action and rejects a hidden menu`, async() => {
    const f = await fixture()
    try {
      const source = fs.readFileSync(path.join(root, 'e2e', file), 'utf8')
      const helperSource = source.match(/async function clickOpenMenuItem\(window, label\) \{[\s\S]*?\n\}/)?.[0]
      assert.ok(helperSource, 'Exercise the actual E2E helper rather than a copied selector')
      const helper = f.window.eval(`(${helperSource})`)
      const browserPage = { evaluate: async(fn, arg) => fn(arg), waitForTimeout: async() => f.flush() }
      await f.open()
      const label = f.document.querySelector('[role=menuitem]').getAttribute('aria-label')
      await helper(browserPage, label)
      assert.equal(f.window.fixture.listEvents.plays.length, 1)
      assert.equal(f.document.querySelector('[role=menu]').getAttribute('aria-hidden'), 'true')
      await assert.rejects(helper(browserPage, label), /菜单未打开或菜单项不存在/)
      assert.equal(f.window.fixture.listEvents.plays.length, 1)
    } finally { await f.close() }
  })
}
