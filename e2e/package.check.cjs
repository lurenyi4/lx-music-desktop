const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { extractFile } = require('@electron/asar')
const { readBinaryFileArch } = require('read-binary-file-arch')

async function readArch(filename) {
  // The shared reader does not recognize `file`'s uppercase "ARM, EABI5"
  // description. Decode the ELF machine field for ARMv7 directly.
  const bytes = fs.readFileSync(filename)
  if (bytes.length >= 20 && bytes.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) {
    const machine = bytes[5] === 1 ? bytes.readUInt16LE(18) : bytes.readUInt16BE(18)
    if (machine === 40) return 'arm'
  }
  return readBinaryFileArch(filename)
}

async function check() {
  const expected = { armv7l: 'arm', x86: 'ia32' }[process.argv[2]] ?? process.argv[2]
  assert.ok(['x64', 'arm64', 'arm', 'ia32'].includes(expected), 'Pass the expected package architecture')
  const archives = []
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name)
      if (entry.isDirectory()) walk(filename)
      else if (entry.isFile() && entry.name === 'app.asar') archives.push(filename)
    }
  }
  walk(path.resolve('build'))
  assert.equal(archives.length, 1, 'Each validation job must build one architecture')
  const archive = archives[0]
  // Inspect bytes actually packed in ASAR, not just a source file or filename.
  const artifact = fs.mkdtempSync(path.join(os.tmpdir(), 'lx-ci-package-'))
  const binding = path.join(artifact, 'better_sqlite3.node')
  fs.writeFileSync(binding, extractFile(archive, path.join('node_modules', 'better-sqlite3', 'build', 'Release', 'better_sqlite3.node')))
  assert.equal(await readArch(binding), expected, 'Packaged SQLite architecture')
  const resources = path.dirname(archive)
  const executable = process.platform === 'darwin'
    ? path.join(resources, '../MacOS/lx-music-desktop')
    : path.join(resources, '..', process.platform === 'win32' ? 'lx-music-desktop.exe' : 'lx-music-desktop')
  assert.equal(await readArch(executable), expected, 'Packaged Electron architecture')
  console.log(`Packaged Electron and SQLite: ${expected} OK (${archive})`)
}

if (require.main === module) check().catch(error => { console.error(error); process.exitCode = 1 })
module.exports = { readArch }
