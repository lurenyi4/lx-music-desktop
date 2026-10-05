/* eslint-disable no-template-curly-in-string -- GitHub expressions are literal YAML values. */
const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const yaml = require('js-yaml')
const { spawnSync } = require('node:child_process')
const read = name => yaml.load(fs.readFileSync(path.join(__dirname, '../.github/workflows', name), 'utf8'))

describe('CI release gate', () => {
  it('prepares and verifies the SQLite CLI before Electron E2E on every OS', () => {
    const steps = read('validate.yml').jobs.test.steps
    const windows = steps.findIndex(step => step.if === "runner.os == 'Windows'" && /choco install sqlite/.test(step.run ?? ''))
    const linux = steps.find(step => step.if === "runner.os == 'Linux'" && /apt-get install/.test(step.run ?? ''))
    const verify = steps.findIndex(step => step.run === 'sqlite3 --version')
    const e2e = steps.findIndex(step => /npm run test:e2e:/.test(step.run ?? ''))
    assert.ok(windows >= 0 && verify > windows && e2e > verify)
    assert.match(steps[windows].run, /if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/)
    assert.match(steps[windows].run, /GITHUB_PATH/)
    assert.match(steps[windows].run, /--source=https:\/\/community\.chocolatey\.org\/api\/v2\//)
    assert.match(linux.run, /\bsqlite3\b/)
    assert.equal(steps[verify].if, undefined, 'macOS must also verify its system SQLite CLI')
    if (process.platform === 'win32') {
      const mocked = steps[windows].run.replace(/^choco install[^\n]+/m, `& '${process.execPath.replace(/'/g, "''")}' -e 'process.exit(1)'`)
      const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', mocked], { encoding: 'utf8' })
      assert.ifError(child.error)
      assert.equal(child.status, 1, 'Failed SQLite installation must stop before PATH changes')
    }
  })
  it('does not hide an earlier Windows E2E failure behind a later success', () => {
    const suites = read('validate.yml').jobs.test.steps.filter(step => step.if !== "runner.os == 'Linux'" && /npm run test:e2e:/.test(step.run ?? ''))
    assert.equal(suites.length, 4, 'Each Windows E2E suite must have its own step')
    for (const step of suites) assert.equal(step.run.trim().split('\n').length, 1)
    if (process.platform !== 'win32') return
    for (const failedSuite of [0, 1, 2]) {
      let result = 0
      const visited = []
      for (let index = 0; index < suites.length; index++) {
        const command = suites[index].run.replace(/npm run test:e2e:[\w-]+/g, `& '${process.execPath.replace(/'/g, "''")}' -e 'process.exit(${index === failedSuite ? 1 : 0})'`)
        // Execute the runner's LASTEXITCODE wrapper for each actual YAML step.
        const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${command}\nif (Test-Path variable:\\LASTEXITCODE) { exit $LASTEXITCODE }`], { encoding: 'utf8' })
        assert.ifError(child.error)
        visited.push(index)
        result = child.status
        if (result !== 0) break
      }
      assert.equal(result, 1)
      assert.deepEqual(visited, Array.from({ length: failedSuite + 1 }, (_, index) => index), 'A failed suite must stop subsequent success steps')
    }
  })
  it('requires all native tests and package jobs before accepting success', () => {
    const workflow = read('validate.yml')
    assert.deepEqual(workflow.jobs.test.strategy.matrix.os.sort(), ['macos-latest', 'ubuntu-latest', 'windows-latest'])
    const commands = workflow.jobs.test.steps.map(step => step.run ?? '').join('\n')
    for (const command of ['npm run test:ci', 'npm run lint', 'npm run typecheck', 'npm test', 'npm run build', 'npm run test:e2e:platform', 'npm run test:e2e:radio', 'npm run test:e2e:sync', 'npm run test:e2e:user-api']) assert.ok(commands.includes(command), command)
    assert.deepEqual(workflow.jobs.gate.needs, ['test', 'package'])
    assert.equal(workflow.jobs.gate.if, '${{ always() }}')
    assert.equal(workflow.jobs.gate.steps[0].run, 'test "$TEST_RESULT" = success && test "$PACKAGE_RESULT" = success')
    assert.equal(workflow.jobs.gate.steps[0].env.TEST_RESULT, '${{ needs.test.result }}')
    assert.equal(workflow.jobs.gate.steps[0].env.PACKAGE_RESULT, '${{ needs.package.result }}')
    const packages = workflow.jobs.package.strategy.matrix.include
    assert.equal(packages.length, 7)
    assert.ok(packages.some(item => item.target === 'linux' && item.arch === 'armv7l' && item.cxx))
    assert.ok(workflow.jobs.package.steps.some(step => step.run?.includes('publish=never')))
    assert.ok(workflow.jobs.package.steps.some(step => step.run === 'node e2e/package.check.cjs ${{ matrix.arch }}'))
    for (const job of Object.values(workflow.jobs)) {
      assert.ok(!job['continue-on-error'])
      for (const step of job.steps ?? []) assert.ok(!step['continue-on-error'])
    }
  })
  for (const file of ['release.yml', 'beta-pack.yml']) {
    it(`${file} gates every publishing job on same-run validation`, () => {
      const jobs = read(file).jobs
      assert.ok(Object.keys(jobs).length >= 5)
      assert.equal(jobs.validate.uses, './.github/workflows/validate.yml')
      for (const [name, job] of Object.entries(jobs)) {
        if (name !== 'validate') assert.equal(job.needs, 'validate', name)
      }
    })
    it(`${file} fails immediately on every Windows native command error`, () => {
      const jobs = read(file).jobs
      for (const job of [jobs.Windows, jobs.Windows_7]) {
        for (const step of job.steps) {
          if (!step.run || step.shell === 'bash') continue
          const lines = step.run.trim().split('\n')
          for (let index = 0; index < lines.length; index++) {
            if (/^(npm |pip\.exe |git |\$npmCache = npm )/.test(lines[index].trim()) && index < lines.length - 1) {
              assert.equal(lines[index + 1].trim(), 'if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }', `${step.name}: ${lines[index]}`)
            }
          }
          if (process.platform !== 'win32') continue
          const native = /(?:npm |pip\.exe |git |\$npmCache = npm )/
          if (lines.filter(line => native.test(line)).length < 2) continue
          let commandIndex = 0
          const mocked = lines.map(line => /^(npm |pip\.exe |git )/.test(line.trim())
            ? `& '${process.execPath.replace(/'/g, "''")}' -e 'process.exit(${commandIndex++ === 0 ? 1 : 0})'`
            : line).join('\n')
          const child = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${mocked}\nif (Test-Path variable:\\LASTEXITCODE) { exit $LASTEXITCODE }`], { encoding: 'utf8' })
          assert.ifError(child.error)
          assert.equal(child.status, 1, `${step.name} must retain the first failure`)
        }
      }
    })
  }
})

describe('SQLite binding preparation', () => {
  const { copyLib } = require('../build-config/deps')
  for (const arch of ['x64', 'arm64']) {
    it(`copies the locked package ${arch} binding to the worker path`, async(test) => {
      test.mock.method(fs, 'existsSync', filename => filename.includes('prebuilds'))
      test.mock.method(fs.promises, 'mkdir', async() => {})
      const copy = test.mock.method(fs.promises, 'copyFile', async() => {})
      await copyLib(arch, '42.11.6')
      const [source, target] = copy.mock.calls[0].arguments
      assert.ok(source.endsWith(path.join('prebuilds', `${process.platform}-${arch}.node`)))
      assert.ok(target.endsWith(path.join('build', 'Release', 'better_sqlite3.node')))
    })
  }
  it('propagates preparation failure rather than leaving a stale binding', async(test) => {
    test.mock.method(fs, 'existsSync', filename => filename.includes('prebuilds'))
    test.mock.method(fs.promises, 'mkdir', async() => {})
    test.mock.method(fs.promises, 'copyFile', async() => { throw new Error('copy failed') })
    await assert.rejects(copyLib('arm64', '42.11.6'), /copy failed/)
  })
})

it('recognizes an ARM ELF machine field independently of its filename', async(test) => {
  const { readArch } = require('./package.check.cjs')
  const bytes = Buffer.alloc(20)
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes)
  bytes[5] = 1
  bytes.writeUInt16LE(40, 18)
  test.mock.method(fs, 'readFileSync', () => bytes)
  assert.equal(await readArch('wrong-name-x64.node'), 'arm')
})
