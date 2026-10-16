import { describe, expect, it } from 'vitest'
import { createSafeStorageSecretStore } from './secrets'

// Chromium prefixes ciphertext with its key version: v10 is the hardcoded Linux fallback
// key, v11 a key kept in the OS keyring (libsecret, KWallet).
function fakeSafe(prefix: 'v10' | 'v11', available = true) {
  return {
    isAsyncEncryptionAvailable: async () => available,
    encryptStringAsync: async (plain: string) => Buffer.from(`${prefix}${plain}`),
    decryptStringAsync: async (cipher: Buffer) => ({
      shouldReEncrypt: false,
      result: cipher.toString().slice(3),
    }),
  }
}

describe('createSafeStorageSecretStore', () => {
  it('is not secure on Linux when Chromium falls back to its hardcoded key', async () => {
    expect((await createSafeStorageSecretStore(fakeSafe('v10'), 'linux')).isSecure()).toBe(false)
  })

  it('is secure on Linux with a keyring-backed key', async () => {
    expect((await createSafeStorageSecretStore(fakeSafe('v11'), 'linux')).isSecure()).toBe(true)
  })

  it('trusts DPAPI and Keychain outside Linux', async () => {
    expect((await createSafeStorageSecretStore(fakeSafe('v10'), 'win32')).isSecure()).toBe(true)
    expect((await createSafeStorageSecretStore(fakeSafe('v10'), 'darwin')).isSecure()).toBe(true)
  })

  it('is not secure when encryption is unavailable', async () => {
    expect((await createSafeStorageSecretStore(fakeSafe('v11', false), 'win32')).isSecure()).toBe(
      false,
    )
  })

  it('is not secure when the keyring probe throws', async () => {
    const safe = {
      ...fakeSafe('v11'),
      encryptStringAsync: async () => {
        throw new Error('dbus caído')
      },
    }
    expect((await createSafeStorageSecretStore(safe, 'linux')).isSecure()).toBe(false)
  })

  it('round-trips a secret', async () => {
    const store = await createSafeStorageSecretStore(fakeSafe('v11'), 'linux')
    expect(await store.decrypt(await store.encrypt('s3cret'))).toBe('s3cret')
  })
})
