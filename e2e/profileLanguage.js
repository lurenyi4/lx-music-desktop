const assert = require('node:assert/strict')
const { launchApp, makeProfileDir } = require('./harness')

// Load real dist through production settings migration and renderer init.
// Force the system locale to English so a lost Chinese override cannot hide.
;(async() => {
  for (const [name, options, expected] of [
    ['default profile', {}, 'zh-cn'],
    ['explicit English profile', { extraSettings: { 'common.langId': 'en-us' } }, 'en-us'],
    ['current-app metadata profile', { profileDir: makeProfileDir({}, require('../package.json').version) }, 'zh-cn'],
  ]) {
    const { app, window } = await launchApp({ ...options, args: ['--lang=en-US'] })
    try {
      await window.waitForFunction(() => document.querySelector('#root')?.childElementCount > 0, null, { timeout: 30000 })
      const state = await window.evaluate(() => ({
        language: window.lxData.appSetting['common.langId'],
        agreed: window.lxData.appSetting['common.isAgreePact'],
      }))
      assert.equal(state.language, expected, `${name} must survive production migration on an English system`)
      assert.equal(state.agreed, false, 'Language fixtures must still require the real first-run agreement')
      await window.getByRole('button', { name: expected === 'zh-cn' ? /^接受(?:\s|$)/ : /^Accept(?:\s|$)/ }).first().waitFor({ state: 'visible' })
      console.log(`PASS | ${name} actual renderer language=${state.language}, agreement=${state.agreed}`)
    } finally {
      await app.close()
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1 })
