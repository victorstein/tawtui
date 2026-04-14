import {
  deriveKey,
  decryptValue,
  readEncryptedCookie,
  readKeychainPassword,
} from '../../src/modules/slack/cookie-decryptor';
import { createCipheriv } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('Cookie Decryptor', () => {
  describe('deriveKey', () => {
    it('derives a 16-byte key from password using PBKDF2', () => {
      const key = deriveKey('test-password', 1003);
      expect(key).toBeInstanceOf(Buffer);
      expect(key.length).toBe(16);
    });

    it('produces deterministic output', () => {
      const k1 = deriveKey('test-password', 1003);
      const k2 = deriveKey('test-password', 1003);
      expect(k1.equals(k2)).toBe(true);
    });

    it('different passwords produce different keys', () => {
      const k1 = deriveKey('password-a', 1003);
      const k2 = deriveKey('password-b', 1003);
      expect(k1.equals(k2)).toBe(false);
    });
  });

  describe('decryptValue', () => {
    it('decrypts a v10 encrypted cookie value', () => {
      const plaintext = 'xoxd-test-cookie-value';
      const password = 'test-encryption-key';
      const key = deriveKey(password, 1003);
      const iv = Buffer.alloc(16, 0x20); // 16 spaces

      // Encrypt with PKCS7 padding (Node's default for AES-CBC)
      const cipher = createCipheriv('aes-128-cbc', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf-8'),
        cipher.final(),
      ]);

      // Prepend v10 prefix
      const encryptedValue = Buffer.concat([Buffer.from('v10'), encrypted]);

      const result = decryptValue(encryptedValue, key, 0);
      expect(result).toBe(plaintext);
    });

    it('handles schema version >= 24 (strips 32-byte hash prefix)', () => {
      const plaintext = 'xoxd-test-value';
      const password = 'test-key';
      const key = deriveKey(password, 1003);
      const iv = Buffer.alloc(16, 0x20);

      // Schema v24+: plaintext has 32-byte hash prefix
      const hashPrefix = Buffer.alloc(32, 0xab);
      const fullPlain = Buffer.concat([hashPrefix, Buffer.from(plaintext)]);

      const cipher = createCipheriv('aes-128-cbc', key, iv);
      const encrypted = Buffer.concat([
        cipher.update(fullPlain),
        cipher.final(),
      ]);
      const encryptedValue = Buffer.concat([Buffer.from('v10'), encrypted]);

      const result = decryptValue(encryptedValue, key, 24);
      expect(result).toBe(plaintext);
    });
  });

  describe('readEncryptedCookie', () => {
    let tmpDir: string;

    function createTestDb(dbPath: string, sql: string): void {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
      const db = new Database(dbPath);
      db.exec(sql);
      db.close();
    }

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-cookie-test-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true });
    });

    it('reads encrypted cookie from SQLite database', () => {
      const dbPath = join(tmpDir, 'Cookies');
      createTestDb(
        dbPath,
        [
          'CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);',
          "INSERT INTO meta VALUES('version', '24');",
          'CREATE TABLE cookies(',
          '  creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,',
          '  top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,',
          '  value TEXT NOT NULL, encrypted_value BLOB NOT NULL,',
          '  path TEXT NOT NULL, expires_utc INTEGER NOT NULL,',
          '  is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,',
          '  last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,',
          '  is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL,',
          '  samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,',
          '  source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,',
          '  source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL',
          ');',
          'INSERT INTO cookies VALUES(',
          "  0, '.slack.com', '', 'd', '',",
          "  X'763130AABBCCDD', '/', 0, 1, 1, 0, 1, 1, 1, 0, 2, 443, 0, 0, 0",
          ');',
        ].join('\n'),
      );

      const result = readEncryptedCookie(dbPath);
      expect(result).not.toBeNull();
      expect(result!.schemaVersion).toBe(24);
      expect(result!.encryptedValue.subarray(0, 3).toString()).toBe('v10');
    });

    it('returns null when no slack cookie exists', () => {
      const dbPath = join(tmpDir, 'EmptyCookies');
      createTestDb(
        dbPath,
        [
          'CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);',
          "INSERT INTO meta VALUES('version', '24');",
          'CREATE TABLE cookies(',
          '  creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,',
          '  top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,',
          '  value TEXT NOT NULL, encrypted_value BLOB NOT NULL,',
          '  path TEXT NOT NULL, expires_utc INTEGER NOT NULL,',
          '  is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,',
          '  last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,',
          '  is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL,',
          '  samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,',
          '  source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,',
          '  source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL',
          ');',
        ].join('\n'),
      );

      const result = readEncryptedCookie(dbPath);
      expect(result).toBeNull();
    });
  });

  describe('readKeychainPassword', () => {
    const mockSpawnSync = jest.fn();

    beforeEach(() => {
      (globalThis as Record<string, unknown>).Bun = {
        spawnSync: mockSpawnSync,
      };
    });

    afterEach(() => {
      (globalThis as Record<string, unknown>).Bun = {
        spawnSync: jest.fn(),
      };
    });

    it('returns trimmed password on success', () => {
      mockSpawnSync.mockReturnValue({
        exitCode: 0,
        stdout: Buffer.from('  my-password  \n'),
      });
      const result = readKeychainPassword('Slack Safe Storage');
      expect(result).toBe('my-password');
    });

    it('returns null when keychain lookup fails', () => {
      mockSpawnSync.mockReturnValue({
        exitCode: 44,
        stdout: Buffer.from(''),
      });
      const result = readKeychainPassword('Slack Safe Storage');
      expect(result).toBeNull();
    });
  });
});
