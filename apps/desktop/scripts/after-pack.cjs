// electron-builder afterPack: hardens the Electron binary with fuses (spec §5), before any
// code signing. RunAsNode and NODE_OPTIONS are off so the packaged app cannot be turned into
// a plain Node interpreter; the app can only be loaded from its asar. The CLI inspect fuse stays
// at its default (on) because Playwright drives the packaged binary through --inspect.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- electron-builder loads this hook as CommonJS
const path = require('node:path')

exports.default = async function afterPack(context) {
  const { flipFuses, FuseVersion, FuseV1Options } = await import('@electron/fuses')
  const { appOutDir, electronPlatformName, packager } = context
  const productName = packager.appInfo.productFilename
  const executable =
    electronPlatformName === 'darwin'
      ? path.join(appOutDir, `${productName}.app`)
      : electronPlatformName === 'win32'
        ? path.join(appOutDir, `${productName}.exe`)
        : path.join(appOutDir, packager.executableName)
  await flipFuses(executable, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableCookieEncryption]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  })
  console.log(`  • fuses applied  executable=${path.basename(executable)}`)
}
