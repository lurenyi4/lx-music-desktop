const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { acceptAgreement, makeProfileDir } = require('./harness')
const { dismissOverlayModal } = require('./pathProbe')

function fixture({ accepted = false, missing = false } = {}) {
  const state = { lxData: { appSetting: { 'common.isAgreePact': accepted } }, acceptedClicks: 0, noticeClicks: 0 }
  const evaluate = fn => vm.runInNewContext(`(${fn.toString()})()`, { window: state, document: { querySelector: () => ({ childElementCount: 1 }) } })
  const window = {
    evaluate,
    async waitForFunction(fn) { assert.ok(evaluate(fn)) },
    getByRole(role, options) {
      if (role === 'heading') return { async waitFor() { assert.equal(state.acceptedClicks, 1) } }
      const notice = options.name === '好的 (OK)'
      if (!notice) {
        assert.ok(options.name.test('Accept (20)'), 'English locale must find the positive acceptance button')
        assert.ok(!options.name.test('Decline'), 'The decline button must never match')
      }
      const locator = {
        first() { return this },
        async waitFor() { if (missing && !notice) throw new Error('Acceptance button missing') },
        async click(options) {
          if (notice) state.noticeClicks++
          else {
            assert.equal(options.timeout, 90000, 'Click must wait for the enabled countdown state')
            state.acceptedClicks++
            state.lxData.appSetting['common.isAgreePact'] = true
          }
        },
      }
      return locator
    },
  }
  return { window, state }
}

describe('First-run agreement regression', () => {
  it('accepts the English button and confirms saved agreement and delayed notice', async() => {
    const { window, state } = fixture()
    await acceptAgreement(window)
    assert.equal(state.acceptedClicks, 1)
    assert.equal(state.noticeClicks, 1)
  })
  it('fails when agreement is required but the positive button is missing', async() => {
    await assert.rejects(acceptAgreement(fixture({ missing: true }).window), /Acceptance button missing/)
  })
  it('only skips the dialog for a profile whose agreement is already accepted', async() => {
    const { window, state } = fixture({ accepted: true })
    await acceptAgreement(window)
    assert.equal(state.acceptedClicks, 0)
  })
  it('pins Chinese UI assertions in new isolated profiles without pre-accepting the agreement', () => {
    const profile = makeProfileDir()
    const { setting } = JSON.parse(fs.readFileSync(path.join(profile, 'LxDatas/config_v2.json'), 'utf8'))
    assert.equal(setting['common.langId'], 'zh-cn')
    const defaults = fs.readFileSync(path.join(__dirname, '../src/common/defaultSetting.ts'), 'utf8')
    const schemaVersion = defaults.match(/\bversion:\s*'([^']+)'/)[1]
    assert.equal(setting.version, schemaVersion, 'Fixture schema version must match production defaults')
    assert.notEqual(setting['common.isAgreePact'], true)
    const metadataProfile = makeProfileDir({ 'common.apiSource': 'test-api' }, '2.12.6')
    const metadata = JSON.parse(fs.readFileSync(path.join(metadataProfile, 'LxDatas/config_v2.json'), 'utf8'))
    assert.equal(metadata.version, '2.12.6')
    assert.equal(metadata.setting.version, schemaVersion, 'Custom profile metadata must not replace the settings schema version')
    assert.equal(metadata.setting['common.apiSource'], 'test-api')
  })
  it('never clicks the first (decline) button of an uncompleted agreement overlay', async() => {
    let clicks = 0
    const element = {
      textContent: '许可协议',
      querySelector(selector) { return selector === 'h2' ? { textContent: '许可协议' } : { click() { clicks++ } } },
    }
    const window = {
      async evaluate(fn) {
        return vm.runInNewContext(`(${fn.toString()})()`, {
          document: { querySelectorAll: () => [element] },
          getComputedStyle: () => ({ backdropFilter: 'blur(4px)' }),
        })
      },
    }
    await assert.rejects(dismissOverlayModal(window), /禁止将协议弹窗/)
    assert.equal(clicks, 0)
  })
})
