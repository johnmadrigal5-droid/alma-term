import type { SafeStorage } from 'electron'

export interface SecretStore {
  isSecure(): boolean
  encrypt(plain: string): Promise<Buffer>
  decrypt(cipher: Buffer): Promise<string>
}

type SafeStorageLike = Pick<
  SafeStorage,
  'isAsyncEncryptionAvailable' | 'encryptStringAsync' | 'decryptStringAsync'
>

// Chromium tags ciphertext with its key version. On Linux, v10 means the hardcoded fallback
// key (no keyring: obfuscation, not encryption) and v11 a key held by libsecret or KWallet.
const KEYRING_PREFIX = 'v11'

/**
 * Uses the asynchronous safeStorage API: in Electron 44 the synchronous one reports
 * encryption as unavailable on Linux. Security is probed once with a real round trip.
 */
export async function createSafeStorageSecretStore(
  safe: SafeStorageLike,
  platform: NodeJS.Platform,
): Promise<SecretStore> {
  let secure = false
  if (await safe.isAsyncEncryptionAvailable()) {
    if (platform !== 'linux') secure = true
    else {
      try {
        const probe = await safe.encryptStringAsync('alma-probe')
        secure = probe.subarray(0, 3).toString('latin1') === KEYRING_PREFIX
      } catch {
        // A broken keyring (no D-Bus, locked) must not block startup: just never remember.
      }
    }
  }
  return {
    isSecure: () => secure,
    encrypt: (plain) => safe.encryptStringAsync(plain),
    decrypt: async (cipher) => (await safe.decryptStringAsync(cipher)).result,
  }
}
