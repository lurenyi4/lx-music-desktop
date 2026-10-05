const fs = require('fs')
const path = require('path')
const bindingFilePath = path.join(__dirname, '../node_modules/better-sqlite3/binding.gyp')
const bindingBakFilePath = path.join(__dirname, '../node_modules/better-sqlite3/binding.gyp.bak')
exports.beforePack = async() => {
  if (fs.existsSync(bindingFilePath)) fs.renameSync(bindingFilePath, bindingBakFilePath)
}
exports.afterPack = async() => {
  if (!fs.existsSync(bindingFilePath) && fs.existsSync(bindingBakFilePath)) fs.renameSync(bindingBakFilePath, bindingFilePath)
}

// Use the locked package's N-API binding when available. The application and
// packager both explicitly load build/Release, unlike SQLite's default loader.
exports.copyLib = async(arch = process.arch, electronVersion = require('electron/package.json').version) => {
  const target = path.join(__dirname, '../node_modules/better-sqlite3/build/Release/better_sqlite3.node')
  // Windows 7 packages intentionally use Electron 22 and the legacy bindings.
  if (parseInt(electronVersion) === 22 && process.platform === 'win32') {
    const source = path.join(__dirname, `lib/better_sqlite3_win32-${arch}.node`)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.copyFile(source, target)
    return
  }
  await exports.afterPack()
  const prebuild = path.join(__dirname, `../node_modules/better-sqlite3/prebuilds/${process.platform}-${arch}.node`)
  if (fs.existsSync(prebuild)) {
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.copyFile(prebuild, target)
    return
  }
  const { rebuild } = await import('@electron/rebuild')
  const crossCompiler = process.platform === 'linux' && arch !== process.arch
    ? { arm64: 'aarch64-linux-gnu', arm: 'arm-linux-gnueabihf' }[arch]
    : null
  const previous = { CC: process.env.CC, CXX: process.env.CXX, GYP_DEFINES: process.env.GYP_DEFINES }
  // better-sqlite3 otherwise skips compilation when the host has a prebuild,
  // even if the requested target architecture (e.g. ARMv7) has none.
  process.env.GYP_DEFINES = `${previous.GYP_DEFINES ?? ''} force_build=1`.trim()
  if (crossCompiler) {
    process.env.CC = `${crossCompiler}-gcc`
    process.env.CXX = `${crossCompiler}-g++`
  }
  try {
    await rebuild({
      buildPath: path.resolve(__dirname, '..'),
      electronVersion,
      arch,
      onlyModules: ['better-sqlite3'],
      force: true,
    })
  } finally {
    for (const key of ['CC', 'CXX', 'GYP_DEFINES']) {
      if (previous[key] === undefined) delete process.env[key]
      else process.env[key] = previous[key]
    }
  }
  if (!fs.existsSync(target)) throw new Error(`SQLite binding missing after rebuild: ${process.platform}-${arch}`)
}
