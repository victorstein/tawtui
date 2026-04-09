import { pbkdf2Sync, createDecipheriv } from 'crypto';

/**
 * Derive an AES-128 key from a password using PBKDF2-HMAC-SHA1.
 * Chromium uses salt "saltysalt", 1003 iterations on macOS, 1 on Linux.
 */
export function deriveKey(password: string, iterations: number): Buffer {
  return pbkdf2Sync(password, 'saltysalt', iterations, 16, 'sha1');
}

/**
 * Decrypt a Chromium encrypted cookie value.
 *
 * Format: "v10" or "v11" prefix (3 bytes) + AES-128-CBC ciphertext.
 * IV is 16 space characters (0x20).
 * Schema version >= 24: decrypted plaintext has a 32-byte SHA256 hash prefix to strip.
 */
export function decryptValue(
  encryptedValue: Buffer,
  key: Buffer,
  schemaVersion: number,
): string {
  // Strip version prefix (v10 or v11 — 3 bytes)
  const ciphertext = encryptedValue.subarray(3);
  const iv = Buffer.alloc(16, 0x20); // 16 spaces

  const decipher = createDecipheriv('aes-128-cbc', key, iv);
  const decrypted = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]);

  // Schema v24+: first 32 bytes are a SHA256 domain hash — skip them
  const plaintext = schemaVersion >= 24 ? decrypted.subarray(32) : decrypted;
  return plaintext.toString('utf-8');
}

/**
 * Read the `d` cookie for slack.com from a Chromium cookie SQLite database.
 * Returns the encrypted value as a Buffer, or null if not found.
 */
export function readEncryptedCookie(
  cookieDbPath: string,
): { encryptedValue: Buffer; schemaVersion: number } | null {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
  const db = new Database(cookieDbPath, { readonly: true });

  try {
    const meta = db
      .query<{ value: string }, []>('SELECT value FROM meta WHERE key = ?')
      .get('version');
    const schemaVersion = meta ? parseInt(meta.value, 10) : 0;

    const row = db
      .query<
        { encrypted_value: Uint8Array },
        []
      >("SELECT encrypted_value FROM cookies WHERE name = 'd' AND host_key LIKE '%slack.com%' LIMIT 1")
      .get();

    if (!row) return null;

    return {
      encryptedValue: Buffer.from(row.encrypted_value),
      schemaVersion,
    };
  } finally {
    db.close();
  }
}

/**
 * Read the Slack encryption password from macOS Keychain.
 * Uses the `security` CLI tool.
 */
export function readKeychainPassword(serviceName: string): string | null {
  const result = Bun.spawnSync(
    ['security', 'find-generic-password', '-s', serviceName, '-w'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}
