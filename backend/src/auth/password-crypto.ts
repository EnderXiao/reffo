import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  constants,
  type KeyObject,
} from 'node:crypto'
import { env } from '@/config/env'

const ENVELOPE_VERSION = 1
const TIMESTAMP_TOLERANCE_MS = 2 * 60 * 1000
const NONCE_TTL_MS = 5 * 60 * 1000

export interface EncryptedPasswordPayload {
  version: number
  key_id: string
  encrypted_key: string
  iv: string
  ciphertext: string
  timestamp: number
  nonce: string
}

export class PasswordCryptoError extends Error {
  constructor(
    public readonly code: 'AUTH_ENCRYPTION_REQUIRED' | 'AUTH_ENCRYPTION_INVALID' | 'AUTH_ENCRYPTION_EXPIRED',
    message: string,
  ) {
    super(message)
    this.name = 'PasswordCryptoError'
  }
}

interface KeyMaterial {
  privateKey: KeyObject
  publicKeyPem: string
  keyId: string
}

let generatedKeyMaterial: KeyMaterial | null = null
const usedNonces = new Map<string, number>()

function base64UrlEncode(value: Uint8Array) {
  return Buffer.from(value).toString('base64url')
}

function base64UrlDecode(value: string) {
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证载荷格式无效')
  }
}

function getKeyMaterial(): KeyMaterial {
  const configuredPrivateKey = env.AUTH_PASSWORD_ENCRYPTION_PRIVATE_KEY.trim()
  if (configuredPrivateKey) {
    const privateKeyPem = configuredPrivateKey.replace(/\\n/g, '\n')
    const privateKey = createPrivateKey(privateKeyPem)
    const publicKey = createPublicKey(privateKeyPem)
    const publicKeyDer = publicKey.export({type: 'spki', format: 'der'})
    const keyId = createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16)

    return {
      privateKey,
      publicKeyPem: publicKey.export({type: 'spki', format: 'pem'}).toString(),
      keyId,
    }
  }

  if (!generatedKeyMaterial) {
    const keyPair = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {type: 'spki', format: 'pem'},
      privateKeyEncoding: {type: 'pkcs8', format: 'pem'},
    })
    const privateKey = createPrivateKey(keyPair.privateKey)
    const publicKey = createPublicKey(keyPair.privateKey)
    const publicKeyDer = publicKey.export({type: 'spki', format: 'der'})

    generatedKeyMaterial = {
      privateKey,
      publicKeyPem: keyPair.publicKey,
      keyId: createHash('sha256').update(publicKeyDer).digest('hex').slice(0, 16),
    }
  }

  return generatedKeyMaterial
}

function assertEnvelope(value: unknown): asserts value is EncryptedPasswordPayload {
  if (!value || typeof value !== 'object') {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_REQUIRED', '密码必须使用加密载荷传输')
  }

  const envelope = value as Partial<EncryptedPasswordPayload>
  const validStrings = [envelope.key_id, envelope.encrypted_key, envelope.iv, envelope.ciphertext, envelope.nonce]
    .every(item => typeof item === 'string' && item.length > 0)

  if (
    envelope.version !== ENVELOPE_VERSION ||
    !validStrings ||
    typeof envelope.timestamp !== 'number' ||
    !Number.isSafeInteger(envelope.timestamp)
  ) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证载荷格式无效')
  }
}

function cleanupNonces(now: number) {
  usedNonces.forEach((expiresAt, nonce) => {
    if (expiresAt <= now) {
      usedNonces.delete(nonce)
    }
  })
}

function parseDecryptedPayload(value: Buffer) {
  try {
    return JSON.parse(value.toString('utf8')) as unknown
  } catch {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证载荷内容无效')
  }
}

export function getPasswordEncryptionConfig() {
  const material = getKeyMaterial()

  return {
    version: ENVELOPE_VERSION,
    key_id: material.keyId,
    algorithm: 'RSA-OAEP-256+A256GCM',
    public_key: material.publicKeyPem,
  }
}

export function decryptPasswordPayload(value: unknown) {
  assertEnvelope(value)

  const now = Date.now()
  cleanupNonces(now)

  if (Math.abs(now - value.timestamp) > TIMESTAMP_TOLERANCE_MS) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_EXPIRED', '认证载荷已过期，请重试')
  }

  const material = getKeyMaterial()
  if (value.key_id !== material.keyId) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证密钥已更新，请重试')
  }

  if (usedNonces.has(value.nonce)) {
    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证请求已使用，请重试')
  }

  try {
    const encryptedKey = base64UrlDecode(value.encrypted_key)
    const iv = base64UrlDecode(value.iv)
    const encryptedPayload = base64UrlDecode(value.ciphertext)

    if (iv.byteLength !== 12 || encryptedPayload.byteLength <= 16) {
      throw new Error('invalid payload length')
    }

    const aesKey = privateDecrypt({
      key: material.privateKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256',
    }, encryptedKey)
    const authTag = encryptedPayload.subarray(-16)
    const ciphertext = encryptedPayload.subarray(0, -16)
    const aad = Buffer.from(`${value.key_id}.${value.timestamp}.${value.nonce}`)
    const decipher = createDecipheriv('aes-256-gcm', aesKey, iv)
    decipher.setAAD(aad)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])

    usedNonces.set(value.nonce, now + NONCE_TTL_MS)
    return parseDecryptedPayload(plaintext)
  } catch (error) {
    if (error instanceof PasswordCryptoError) {
      throw error
    }

    throw new PasswordCryptoError('AUTH_ENCRYPTION_INVALID', '认证载荷解密失败')
  }
}

// Used by backend tests only; production callers should use Web Crypto in frontend.
export function encryptPasswordPayloadForTest(payload: unknown) {
  const material = getKeyMaterial()
  const aesKey = randomBytes(32)
  const iv = randomBytes(12)
  const timestamp = Date.now()
  const nonce = randomBytes(16).toString('base64url')
  const aad = Buffer.from(`${material.keyId}.${timestamp}.${nonce}`)
  const cipher = createCipheriv('aes-256-gcm', aesKey, iv)
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
  const encryptedPayload = Buffer.concat([ciphertext, cipher.getAuthTag()])
  const encryptedKey = publicEncrypt({
    key: material.publicKeyPem,
    padding: constants.RSA_PKCS1_OAEP_PADDING,
    oaepHash: 'sha256',
  }, aesKey)

  return {
    version: ENVELOPE_VERSION,
    key_id: material.keyId,
    encrypted_key: base64UrlEncode(encryptedKey),
    iv: base64UrlEncode(iv),
    ciphertext: base64UrlEncode(encryptedPayload),
    timestamp,
    nonce,
  } satisfies EncryptedPasswordPayload
}
