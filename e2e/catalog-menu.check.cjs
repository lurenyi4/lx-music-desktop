const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const read = path => fs.readFileSync(path, 'utf8')
test('root menus stack above modal containers and support keyboard activation', () => {
  const menu = read('src/renderer/components/base/Menu.vue')
  const modal = read('src/renderer/components/material/Modal.vue')
  assert.ok(Number(menu.match(/z-index: (\d+)/)[1]) > Number(modal.match(/z-index: (\d+)/)[1]))
  assert.match(menu, /@keydown.enter.prevent/)
  assert.match(menu, /@keydown.space.prevent/)
})
test('catalog hides its mounted list immediately on close, clearing teleported menus', () => {
  assert.match(read('src/renderer/components/common/MusicCatalogModal.vue'), /v-if="catalogState.show && catalogState.target"/)
})
test('menu lifecycle dismisses on Escape, scrolling and resize', () => {
  const menu = read('src/renderer/utils/compositions/useMenuLocation.js')
  for (const event of ['keydown', 'scroll', 'resize']) {
    assert.match(menu, new RegExp(`addEventListener\\('${event}'`))
    assert.match(menu, new RegExp(`removeEventListener\\('${event}'`))
  }
})
test('a closed or reopened modal ignores late transition lifecycle callbacks', () => {
  const modal = read('src/renderer/components/material/Modal.vue')
  assert.match(modal, /if \(!this\.show \|\| !this\.\$refs\.dom_container\) return/)
  assert.match(modal, /if \(!this\.show\) this\.showModal = false/)
})
