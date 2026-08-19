export interface PasswordEncryptionConfig {
  version: number
  key_id: string
  algorithm: 'RSA-OAEP-256+A256GCM'
  public_key: string
}

export interface EncryptedPasswordPayload {
  version: number
  key_id: string
  encrypted_key: string
  iv: string
  ciphertext: string
  timestamp: number
  nonce: string
}

function getCrypto() {
  const cryptoApi = globalThis.crypto

  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== 'function') {
    throw new Error('当前环境不支持密码加密，请改用邮箱验证码登录')
  }

  return cryptoApi
}

function getBase64Encoder() {
  if (typeof globalThis.btoa !== 'function') {
    throw new Error('当前环境不支持密码加密，请改用邮箱验证码登录')
  }

  return globalThis.btoa.bind(globalThis)
}

function getBase64Decoder() {
  if (typeof globalThis.atob !== 'function') {
    throw new Error('当前环境不支持密码加密，请改用邮箱验证码登录')
  }

  return globalThis.atob.bind(globalThis)
}

function toBase64Url(value: ArrayBuffer | Uint8Array) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  const binary = Array.from(bytes, byte => String.fromCharCode(byte)).join('')

  return getBase64Encoder()(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

function pemToArrayBuffer(publicKeyPem: string) {
  const normalized = publicKeyPem
    .replace('-----BEGIN PUBLIC KEY-----', '')
    .replace('-----END PUBLIC KEY-----', '')
    .replace(/\s/g, '')
  const binary = getBase64Decoder()(normalized)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))

  return bytes.buffer
}

export async function encryptPasswordPayload(
  config: PasswordEncryptionConfig,
  payload: Record<string, unknown>,
): Promise<EncryptedPasswordPayload> {
  const cryptoApi = getCrypto()
  const encoder = new TextEncoder()
  const publicKey = await cryptoApi.subtle.importKey(
    'spki',
    pemToArrayBuffer(config.public_key),
    {name: 'RSA-OAEP', hash: 'SHA-256'},
    false,
    ['encrypt'],
  )
  const aesKey = await cryptoApi.subtle.generateKey(
    {name: 'AES-GCM', length: 256},
    true,
    ['encrypt'],
  )
  const rawAesKey = await cryptoApi.subtle.exportKey('raw', aesKey)
  const encryptedKey = await cryptoApi.subtle.encrypt(
    {name: 'RSA-OAEP'},
    publicKey,
    rawAesKey,
  )
  const iv = cryptoApi.getRandomValues(new Uint8Array(12))
  const nonce = cryptoApi.getRandomValues(new Uint8Array(16))
  const timestamp = Date.now()
  const nonceText = toBase64Url(nonce)
  const aad = `${config.key_id}.${timestamp}.${nonceText}`
  const ciphertext = await cryptoApi.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(aad),
      tagLength: 128,
    },
    aesKey,
    encoder.encode(JSON.stringify(payload)),
  )

  return {
    version: config.version,
    key_id: config.key_id,
    encrypted_key: toBase64Url(encryptedKey),
    iv: toBase64Url(iv),
    ciphertext: toBase64Url(ciphertext),
    timestamp,
    nonce: nonceText,
  }
}
