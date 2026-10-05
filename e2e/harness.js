/**
 * e2e 启动器：用 playwright-core 的 _electron 驱动 dist 生产构建。
 * 每次启动使用隔离的 user-data-dir（不触碰真实 LxDatas）。
 */
const { _electron } = require('playwright-core')
const path = require('path')
const fs = require('fs')
const os = require('os')

const APP_ROOT = path.resolve(__dirname, '..')
const ART_DIR = path.resolve(process.env.RUNNER_TEMP ?? os.tmpdir(), 'lx-e2e-artifacts')

function makeProfileDir(extraSettings, appVersion = null) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-e2e-profile-'))
  // 预置设置：关闭「显示更新日志」弹窗（首启时版本信息网络返回后延迟弹出，
  // 时机不定，会拦截后续点击导致 e2e 随机级联超时；其余设置走默认值）
  const lxDataDir = path.join(dir, 'LxDatas')
  fs.mkdirSync(lxDataDir, { recursive: true })
  fs.writeFileSync(
    path.join(lxDataDir, 'config_v2.json'),
    // Configuration schema version from src/common/defaultSetting.ts; the outer
    // version is app metadata and does not protect settings from legacy migration.
    JSON.stringify({ version: appVersion, setting: { version: '2.1.0', 'common.showChangeLog': false, 'common.langId': 'zh-cn', ...(extraSettings ?? {}) } }),
    'utf8',
  )
  return dir
}

/** 等待主窗口（file://…/index.html）。Playwright 驱动可能先创建 DevTools 窗口，不能依赖 firstWindow。 */
async function waitMainWindow(app, timeoutMs = 90000) {
  const start = Date.now()
  let lastError = null
  while (Date.now() - start < timeoutMs) {
    for (const w of app.windows()) {
      let url = ''
      try { url = w.url() ?? '' } catch {}
      if (url.startsWith('file://') && url.includes('index.html')) return w
    }
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  try {
    return await app.firstWindow()
  } catch (e) {
    lastError = e
  }
  throw new Error(`未找到主窗口: ${lastError?.message ?? '无窗口'}`)
}

/** 校验 dist 是生产构建（曾被 dev 构建覆盖过：dev main 会开 DevTools 并加载 localhost:9080 导致白屏）。
 * 注意压缩器会把 'development' 转义（如 \u0064evelopment），单查字面量会漏判，需覆盖转义变体与入口特征。 */
function assertProdBuild() {
  const mainJs = path.join(__dirname, '..', 'dist', 'main.js')
  if (!fs.existsSync(mainJs)) return
  const content = fs.readFileSync(mainJs, 'utf8')
  const devMarkers = [
    '"development"',
    "'development'",
    '\\u0064evelopment',
    '\\x64evelopment',
    'localhost:9080',
    'index-dev',
  ]
  const hit = devMarkers.find(marker => content.includes(marker))
  if (hit) {
    throw new Error(`dist/main.js 是 dev 构建（命中标记 ${hit}），请先执行 npm run build:main && npm run build:renderer`)
  }
}

/**
 * @param {object} [opts]
 * @param {string[]} [opts.args] 额外 electron 参数
 * @param {NodeJS.ProcessEnv} [opts.extraEnv]
 * @param {string} [opts.profileDir] 复用已有 profile（否则新建）
 * @param {Record<string, unknown>} [opts.extraSettings] 预写入 profile 的额外设置项
 * @returns {Promise<{app: import('playwright-core').ElectronApplication, window: import('playwright-core').Page, profileDir: string}>}
 */
async function launchApp(opts = {}) {
  fs.mkdirSync(ART_DIR, { recursive: true })
  assertProdBuild()
  // macOS 上 Electron 的 userData 不跟随 $HOME，必须用 --user-data-dir 才能隔离
  const profileDir = opts.profileDir ?? makeProfileDir(opts.extraSettings)
  const electronPath = require('electron')
  const logPath = path.join(ART_DIR, `${path.basename(process.argv[1] ?? 'electron')}-${path.basename(profileDir)}.log`)
  const log = message => fs.appendFileSync(logPath, `${new Date().toISOString()} ${message}\n`, 'utf8')
  log(`profile=${profileDir}`)
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [APP_ROOT, `--user-data-dir=${profileDir}`, ...(opts.args ?? [])],
    env: {
      ...process.env,
      ...opts.extraEnv,
    },
    timeout: 180000,
  }).catch(error => { log(`[launch failed] ${error.stack ?? error.message}`); throw error })
  for (const stream of ['stdout', 'stderr']) app.process()[stream]?.on('data', data => log(`[${stream}] ${data.toString()}`))
  app.on('console', message => log(`[main ${message.type()}] ${message.text()}`))
  app.on('close', () => log('[app closed]'))
  const capture = page => {
    page.on('console', message => log(`[renderer ${message.type()}] ${message.text()}`))
    page.on('pageerror', error => log(`[pageerror] ${error.stack ?? error.message}`))
    page.on('crash', () => log('[renderer crashed]'))
    page.on('close', () => log('[window closed]'))
  }
  app.on('window', capture)
  for (const page of app.windows()) capture(page)
  try {
    const window = await waitMainWindow(app)
    await window.waitForLoadState('domcontentloaded')
    return { app, window, profileDir }
  } catch (error) {
    log(`[startup failed] ${error.stack ?? error.message}`)
    await app.close().catch(() => {})
    throw error
  }
}

/** Complete the real first-run agreement; absence is only valid after acceptance. */
async function acceptAgreement(window) {
  await window.waitForFunction(() => window.lxData?.appSetting != null && document.querySelector('#root')?.childElementCount > 0, null, { timeout: 30000 })
  if (await window.evaluate(() => window.lxData.appSetting['common.isAgreePact'] === true)) return
  const button = window.getByRole('button', { name: /^(接受|Accept|동의)(?:\s|$)/ }).first()
  await button.waitFor({ state: 'visible', timeout: 30000 })
  // Playwright waits for the actual enabled state, including slow timer ticks.
  await button.click({ timeout: 90000 })
  await window.waitForFunction(() => window.lxData.appSetting['common.isAgreePact'] === true, null, { timeout: 15000 })
  await window.getByRole('heading', { name: '许可协议', exact: true }).waitFor({ state: 'hidden', timeout: 15000 })
  const notice = window.getByRole('button', { name: '好的 (OK)', exact: true }).first()
  await notice.waitFor({ state: 'visible', timeout: 15000 })
  await notice.click()
  await notice.waitFor({ state: 'hidden', timeout: 15000 })
}

/** 页面错误采集器：收集 console error / pageerror。 */
function collectErrors(window) {
  const errors = []
  window.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[console] ${msg.text()}`)
  })
  window.on('pageerror', err => {
    errors.push(`[pageerror] ${err.message}`)
  })
  return errors
}

async function screenshot(window, name) {
  const file = path.join(ART_DIR, `${name}.png`)
  await window.screenshot({ path: file }).catch(error => {
    fs.writeFileSync(`${file}.txt`, `Screenshot failed: ${error.stack ?? error.message}\n`, 'utf8')
  })
  return file
}

module.exports = { launchApp, collectErrors, screenshot, acceptAgreement, makeProfileDir, ART_DIR }
