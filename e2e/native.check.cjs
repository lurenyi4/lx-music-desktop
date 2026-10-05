const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')

// Execute the real binding under Electron's Node ABI before GUI regression.
const result = spawnSync(require('electron'), ['-e', `
  const Database = require('better-sqlite3')
  const nativeBinding = require('node:path').resolve('node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  const db = new Database(':memory:', { nativeBinding })
  db.exec('create table smoke (value text)')
  db.prepare('insert into smoke values (?)').run('electron-native-ok')
  if (db.prepare('select value from smoke').get().value !== 'electron-native-ok') process.exit(1)
  db.close()
  console.log('Electron', process.versions.electron, 'ABI', process.versions.modules, process.arch, 'SQLite OK')
`], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 60000,
})
process.stdout.write(result.stdout ?? '')
process.stderr.write(result.stderr ?? '')
assert.ifError(result.error)
assert.equal(result.status, 0, 'Electron SQLite binding must load and execute SQL')
