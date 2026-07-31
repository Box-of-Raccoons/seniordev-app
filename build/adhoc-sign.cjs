// electron-builder `afterPack` hook: ad-hoc code-sign the packaged macOS .app.
//
// electron-builder skips code signing when no Apple "Developer ID Application"
// identity is present. On Apple Silicon that leaves an unsigned / incompletely
// signed bundle, which Gatekeeper flags as "damaged / possibly malware" and
// offers to move to the Trash — so the app cannot be launched by double-click.
//
// A deep ad-hoc signature (`codesign --sign -`) satisfies arm64's requirement
// that executable code carry *some* valid signature, and — because a locally
// built bundle has no `com.apple.quarantine` attribute — the app then launches
// without the Gatekeeper dialog.
//
// This is a LOCAL-RUN convenience only. Distributing the app to other machines
// still requires a real Developer ID signature + Apple notarization (pending an
// Apple developer account); a downloaded ad-hoc app stays quarantined and
// blocked. Signing here (afterPack, before the dmg is assembled) means the dmg
// ships the signed .app.
const { execFileSync } = require('node:child_process')
const path = require('node:path')

module.exports = async function adhocSign(context) {
  if (context.electronPlatformName !== 'darwin') return

  // When a real Developer ID Application identity is available (CI release with
  // the imported cert, or a dev machine with the cert in its keychain), skip the
  // ad-hoc signature entirely: electron-builder will Dev ID sign + notarize the
  // bundle, and an ad-hoc signature applied first would only get in the way. The
  // ad-hoc path stays for local builds with no Dev ID identity present.
  try {
    const identities = execFileSync('security', ['find-identity', '-v', '-p', 'codesigning'], {
      encoding: 'utf8',
    })
    if (identities.includes('Developer ID Application')) {
      console.log('[afterPack] Developer ID identity present — skipping ad-hoc sign (electron-builder will Dev ID sign)')
      return
    }
  } catch {
    // `security` unavailable/failed — fall through to ad-hoc signing.
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = path.join(context.appOutDir, `${appName}.app`)

  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], {
    stdio: 'inherit',
  })
  console.log(`[afterPack] ad-hoc signed ${appPath}`)
}
