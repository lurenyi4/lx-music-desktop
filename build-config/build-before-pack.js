const { Arch } = require('electron-builder')
const { beforePack, copyLib } = require('./deps')

const archMap = {
  [Arch.x64]: 'x64',
  [Arch.ia32]: 'ia32',
  [Arch.arm64]: 'arm64',
  [Arch.armv7l]: 'arm',
}
module.exports = async(context) => {
  const electronVersion = context.packager?.info?._framework?.version ?? require('electron/package.json').version
  // Build while binding.gyp is present, then keep electron-builder's own
  // dependency rebuild from replacing the Electron/target-specific binding.
  await copyLib(archMap[context.arch], electronVersion)
  await beforePack()
}
