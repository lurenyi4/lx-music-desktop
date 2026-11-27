import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('actual Modal/OnlineList/Menu DOM event contracts pass without a browser', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const env = { ...process.env, LX_CATALOG_UI_OUT: path.join(root, '.validation/catalog-queue-ui', `test-${process.pid}-${Date.now()}`) }
  const build = spawnSync(process.execPath, ['node_modules/webpack-cli/bin/cli.js', '--config', 'e2e/catalogQueue/webpack.config.cjs'], { cwd: root, env, encoding: 'utf8', timeout: 30000 })
  expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0)
  const check = spawnSync(process.execPath, ['--test', 'e2e/catalogQueue/dom-check.cjs'], { cwd: root, env, encoding: 'utf8', timeout: 30000 })
  expect(check.status, `${check.stdout}\n${check.stderr}`).toBe(0)
}, 65000)
