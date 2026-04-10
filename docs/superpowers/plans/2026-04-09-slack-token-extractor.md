# Slack Token Extractor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract Slack session tokens (xoxc + xoxd) directly from the local Slack desktop app, replacing the abandoned `slacktokens` Python package with a zero-dependency TypeScript implementation.

**Architecture:** Three-layer approach: (1) a LevelDB WAL parser reads `localConfig_v2` from Slack's localStorage to get xoxc tokens and team info, (2) a cookie decryptor reads the Chromium cookie SQLite DB and decrypts the `d` cookie using macOS Keychain + PBKDF2 + AES-128-CBC, (3) a NestJS service orchestrates both and exposes extraction to the TUI. The setup screen gains an `[a] Auto-detect` action replacing the old slacktokens instructions.

**Tech Stack:** Bun (`bun:sqlite`, `Buffer`, `crypto`), NestJS, SolidJS/OpenTUI

**Platform:** macOS only for v1 (App Store + direct download Slack). Linux support can be added later.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/modules/slack/leveldb-reader.ts` | Create | Parse LevelDB WAL `.log` files, extract `localConfig_v2` JSON |
| `src/modules/slack/cookie-decryptor.ts` | Create | Read Chromium cookie SQLite DB, decrypt AES-128-CBC cookies |
| `src/modules/slack/token-extractor.service.ts` | Create | NestJS service: detect Slack paths, orchestrate extraction, return credentials |
| `src/modules/slack/slack.module.ts` | Modify | Register TokenExtractorService |
| `src/modules/tui/bridge.ts` | Modify | Add `extractSlackTokens` to bridge |
| `src/modules/tui.service.ts` | Modify | Inject TokenExtractorService, expose on globalThis |
| `src/modules/dependency.types.ts` | Modify | Replace `slacktokensInstalled` with `slackAppDetected` |
| `src/modules/dependency.service.ts` | Modify | Add Slack app detection, remove slacktokens check |
| `src/modules/tui/components/oracle-setup-screen.tsx` | Modify | Replace Option A with `[a] Auto-detect`, add workspace selection |
| `src/modules/tui/views/oracle-view.tsx` | Modify | Add `handleAutoDetect` handler |
| `test/leveldb-reader.spec.ts` | Create | Tests for WAL parsing |
| `test/cookie-decryptor.spec.ts` | Create | Tests for cookie decryption |
| `test/token-extractor.service.spec.ts` | Create | Tests for orchestration |
| `test/dependency.service.spec.ts` | Modify | Update slacktokens → slackAppDetected assertions |

---

## Background: How Slack Stores Credentials Locally

### xoxc Token (LevelDB)

The Slack desktop app (Chromium-based) stores workspace data in a **LevelDB** database backing `localStorage`. The key `localConfig_v2` contains a JSON object:

```json
{
  "teams": {
    "T012AB3CD": {
      "name": "my-workspace",
      "url": "https://my-workspace.slack.com/",
      "token": "xoxc-...",
      ...
    }
  }
}
```

**LevelDB paths on macOS:**
- App Store: `~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Local Storage/leveldb`
- Direct download: `~/Library/Application Support/Slack/Local Storage/leveldb`

**LevelDB WAL `.log` format:**
- File divided into 32,768-byte blocks
- Each block contains records: `CRC32(4) + Length(2) + Type(1) + Data(Length)`
- Type: 1=FULL, 2=FIRST, 3=MIDDLE, 4=LAST (for records spanning blocks)
- Data is a WriteBatch: `Sequence(8) + Count(4) + Entries...`
- Each entry: `Type(1, 0x01=PUT) + VarIntLen + Key + VarIntLen + Value`
- Values have a 1-byte Chromium encoding prefix: `0x00`/`0x01`/`0x02`, then UTF-8 or UTF-16LE JSON

### xoxd Cookie (SQLite + AES)

The `d` cookie is stored in a **Chromium cookie SQLite database** with encrypted values.

**Cookie DB paths on macOS:**
- App Store: `~/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Cookies`
- Direct download: `~/Library/Application Support/Slack/Cookies`

**Decryption chain:**
1. Read encryption password from macOS Keychain: `security find-generic-password -s "Slack Safe Storage" -w`
2. Derive 16-byte key: `PBKDF2-HMAC-SHA1(password, salt="saltysalt", iterations=1003, keylen=16)`
3. Strip 3-byte version prefix (`v10` or `v11`) from `encrypted_value`
4. Decrypt: `AES-128-CBC(key, iv=16_spaces, ciphertext)`
5. PKCS7 unpad the result
6. **Schema version >= 24**: strip first 32 bytes (SHA256 domain hash) from decrypted plaintext

---

### Task 1: LevelDB WAL Reader

[@nestjs]

**Files:**
- Create: `src/modules/slack/leveldb-reader.ts`
- Create: `test/leveldb-reader.spec.ts`

This task creates pure functions (no NestJS dependency) for parsing LevelDB WAL `.log` files and extracting the `localConfig_v2` value.

- [ ] **Step 1: Write the failing test for `readVarint`**

Create `test/leveldb-reader.spec.ts`:

```typescript
import { readVarint } from '../src/modules/slack/leveldb-reader';

describe('LevelDB Reader', () => {
  describe('readVarint', () => {
    it('reads single-byte varint', () => {
      const buf = Buffer.from([0x05]);
      const [value, offset] = readVarint(buf, 0);
      expect(value).toBe(5);
      expect(offset).toBe(1);
    });

    it('reads multi-byte varint', () => {
      // 300 = 0b100101100 → varint bytes: 0xAC 0x02
      const buf = Buffer.from([0xac, 0x02]);
      const [value, offset] = readVarint(buf, 0);
      expect(value).toBe(300);
      expect(offset).toBe(2);
    });

    it('reads varint at offset', () => {
      const buf = Buffer.from([0xff, 0xff, 0x0a]);
      const [value, offset] = readVarint(buf, 2);
      expect(value).toBe(10);
      expect(offset).toBe(3);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Create `leveldb-reader.ts` with `readVarint`**

Create `src/modules/slack/leveldb-reader.ts`:

```typescript
/**
 * Read a LevelDB-style varint (unsigned, little-endian, 7 bits per byte).
 * Returns [value, nextOffset].
 */
export function readVarint(buf: Buffer, offset: number): [number, number] {
  let result = 0;
  let shift = 0;
  while (offset < buf.length) {
    const byte = buf[offset++];
    result |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }
  return [result, offset];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: 3 tests pass.

- [ ] **Step 5: Write failing test for `parseLogRecords`**

Add to `test/leveldb-reader.spec.ts`:

```typescript
import { readVarint, parseLogRecords } from '../src/modules/slack/leveldb-reader';

// ... existing tests ...

describe('parseLogRecords', () => {
  function buildLogRecord(type: number, data: Buffer): Buffer {
    // Record format: CRC32(4) + Length(2) + Type(1) + Data
    const header = Buffer.alloc(7);
    header.writeUInt32LE(0, 0); // CRC32 placeholder (we skip validation)
    header.writeUInt16LE(data.length, 4);
    header[6] = type;
    return Buffer.concat([header, data]);
  }

  it('extracts full records (type 1)', () => {
    const data = Buffer.from('hello world');
    const record = buildLogRecord(1, data);
    const results = parseLogRecords(record);
    expect(results).toHaveLength(1);
    expect(results[0].toString()).toBe('hello world');
  });

  it('reassembles fragmented records (types 2+4)', () => {
    const first = buildLogRecord(2, Buffer.from('hello '));
    const last = buildLogRecord(4, Buffer.from('world'));
    const buf = Buffer.concat([first, last]);
    const results = parseLogRecords(buf);
    expect(results).toHaveLength(1);
    expect(results[0].toString()).toBe('hello world');
  });

  it('handles multiple records', () => {
    const r1 = buildLogRecord(1, Buffer.from('aaa'));
    const r2 = buildLogRecord(1, Buffer.from('bbb'));
    const buf = Buffer.concat([r1, r2]);
    const results = parseLogRecords(buf);
    expect(results).toHaveLength(2);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: FAIL — `parseLogRecords` not exported.

- [ ] **Step 7: Implement `parseLogRecords`**

Add to `src/modules/slack/leveldb-reader.ts`:

```typescript
const BLOCK_SIZE = 32768;
const HEADER_SIZE = 7; // CRC32(4) + Length(2) + Type(1)

/**
 * Parse LevelDB WAL log records from a buffer.
 * Returns an array of reassembled record payloads.
 *
 * Log format: 32KB blocks, each containing records.
 * Record: CRC32(4) + Length(2, LE) + Type(1) + Data(Length).
 * Type: 1=FULL, 2=FIRST, 3=MIDDLE, 4=LAST.
 */
export function parseLogRecords(buf: Buffer): Buffer[] {
  const results: Buffer[] = [];
  let fragments: Buffer[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= buf.length) {
    const blockOffset = offset % BLOCK_SIZE;
    const blockRemaining = BLOCK_SIZE - blockOffset;

    // Not enough room for a header in this block — skip to next
    if (blockRemaining < HEADER_SIZE) {
      offset += blockRemaining;
      continue;
    }

    const length = buf.readUInt16LE(offset + 4);
    const type = buf[offset + 6];

    if (offset + HEADER_SIZE + length > buf.length) break;

    const data = buf.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + length);
    offset += HEADER_SIZE + length;

    switch (type) {
      case 1: // FULL
        results.push(Buffer.from(data));
        break;
      case 2: // FIRST
        fragments = [Buffer.from(data)];
        break;
      case 3: // MIDDLE
        fragments.push(Buffer.from(data));
        break;
      case 4: // LAST
        fragments.push(Buffer.from(data));
        results.push(Buffer.concat(fragments));
        fragments = [];
        break;
    }
  }

  return results;
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: All 6 tests pass.

- [ ] **Step 9: Write failing test for `extractLocalConfig`**

Add to `test/leveldb-reader.spec.ts`:

```typescript
import {
  readVarint,
  parseLogRecords,
  extractLocalConfig,
} from '../src/modules/slack/leveldb-reader';

// ... existing tests ...

describe('extractLocalConfig', () => {
  function encodeVarint(n: number): Buffer {
    const bytes: number[] = [];
    while (n > 0x7f) {
      bytes.push((n & 0x7f) | 0x80);
      n >>>= 7;
    }
    bytes.push(n);
    return Buffer.from(bytes);
  }

  function buildWriteBatch(key: Buffer, value: Buffer): Buffer {
    const seq = Buffer.alloc(8, 0); // sequence number
    const count = Buffer.alloc(4);
    count.writeUInt32LE(1, 0);
    const putType = Buffer.from([0x01]);
    const keyLen = encodeVarint(key.length);
    const valLen = encodeVarint(value.length);
    return Buffer.concat([seq, count, putType, keyLen, key, valLen, value]);
  }

  function buildLogRecord(type: number, data: Buffer): Buffer {
    const header = Buffer.alloc(7);
    header.writeUInt32LE(0, 0);
    header.writeUInt16LE(data.length, 4);
    header[6] = type;
    return Buffer.concat([header, data]);
  }

  it('extracts teams from localConfig_v2 value', () => {
    const config = JSON.stringify({
      teams: {
        T012AB3CD: {
          name: 'test-workspace',
          url: 'https://test-workspace.slack.com/',
          token: 'xoxc-test-token-123',
        },
      },
    });
    // Chromium localStorage key: _https://app.slack.com\x00\x01localConfig_v2
    const key = Buffer.from(
      '_https://app.slack.com\x00\x01localConfig_v2',
    );
    // Value: 1-byte encoding prefix (0x01 = Latin-1/UTF-8) + JSON
    const value = Buffer.concat([Buffer.from([0x01]), Buffer.from(config)]);

    const batch = buildWriteBatch(key, value);
    const logBuf = buildLogRecord(1, batch);

    const result = extractLocalConfig(logBuf);
    expect(result).not.toBeNull();
    expect(result!.teams).toBeDefined();
    expect(result!.teams['T012AB3CD'].token).toBe('xoxc-test-token-123');
    expect(result!.teams['T012AB3CD'].name).toBe('test-workspace');
  });

  it('returns null when localConfig_v2 is not present', () => {
    const key = Buffer.from('_https://app.slack.com\x00\x01someOtherKey');
    const value = Buffer.concat([
      Buffer.from([0x01]),
      Buffer.from('{}'),
    ]);
    const batch = buildWriteBatch(key, value);
    const logBuf = buildLogRecord(1, batch);

    const result = extractLocalConfig(logBuf);
    expect(result).toBeNull();
  });

  it('handles multiple teams', () => {
    const config = JSON.stringify({
      teams: {
        T111: { name: 'ws-one', url: 'https://one.slack.com/', token: 'xoxc-1' },
        T222: { name: 'ws-two', url: 'https://two.slack.com/', token: 'xoxc-2' },
      },
    });
    const key = Buffer.from('_https://app.slack.com\x00\x01localConfig_v2');
    const value = Buffer.concat([Buffer.from([0x01]), Buffer.from(config)]);
    const batch = buildWriteBatch(key, value);
    const logBuf = buildLogRecord(1, batch);

    const result = extractLocalConfig(logBuf);
    expect(result).not.toBeNull();
    expect(Object.keys(result!.teams)).toHaveLength(2);
  });
});
```

- [ ] **Step 10: Run test to verify it fails**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: FAIL — `extractLocalConfig` not exported.

- [ ] **Step 11: Implement `extractLocalConfig`**

Add to `src/modules/slack/leveldb-reader.ts`:

```typescript
export interface SlackTeamConfig {
  name: string;
  url: string;
  token: string;
}

export interface SlackLocalConfig {
  teams: Record<string, SlackTeamConfig>;
}

/**
 * Parse the `localConfig_v2` value from a LevelDB WAL buffer.
 *
 * Scans all log records for a WriteBatch PUT entry whose key
 * contains `localConfig_v2`. Extracts and parses the JSON value.
 *
 * Returns the parsed config or null if not found.
 */
export function extractLocalConfig(
  logBuffer: Buffer,
): SlackLocalConfig | null {
  const records = parseLogRecords(logBuffer);
  const TARGET_KEY = 'localConfig_v2';

  for (const record of records) {
    const entries = parseWriteBatchPuts(record);
    for (const [key, value] of entries) {
      if (key.includes(TARGET_KEY)) {
        return parseConfigValue(value);
      }
    }
  }

  return null;
}

/**
 * Extract PUT entries from a WriteBatch payload.
 * Format: Sequence(8) + Count(4) + Entries...
 * Each PUT entry: 0x01 + VarInt(keyLen) + key + VarInt(valLen) + value
 */
function parseWriteBatchPuts(
  batch: Buffer,
): Array<[key: string, value: Buffer]> {
  const results: Array<[string, Buffer]> = [];
  // Skip sequence number (8 bytes) + count (4 bytes)
  let offset = 12;

  while (offset < batch.length) {
    const type = batch[offset++];
    if (type === 0x01) {
      // PUT
      const [keyLen, keyStart] = readVarint(batch, offset);
      offset = keyStart;
      if (offset + keyLen > batch.length) break;
      const key = batch.subarray(offset, offset + keyLen).toString('utf-8');
      offset += keyLen;

      const [valLen, valStart] = readVarint(batch, offset);
      offset = valStart;
      if (offset + valLen > batch.length) break;
      const value = batch.subarray(offset, offset + valLen);
      offset += valLen;

      results.push([key, Buffer.from(value)]);
    } else if (type === 0x00) {
      // DELETE — skip key
      const [keyLen, keyStart] = readVarint(batch, offset);
      offset = keyStart + keyLen;
    } else {
      // Unknown type — stop parsing
      break;
    }
  }

  return results;
}

/**
 * Parse the Chromium localStorage value for `localConfig_v2`.
 * Strips the 1-byte encoding prefix, tries UTF-8 then UTF-16LE.
 */
function parseConfigValue(raw: Buffer): SlackLocalConfig | null {
  // Strip Chromium encoding prefix (0x00, 0x01, or 0x02)
  const data = raw[0] <= 0x02 ? raw.subarray(1) : raw;

  // Try UTF-8 first
  try {
    const text = data.toString('utf-8');
    const parsed = JSON.parse(text) as SlackLocalConfig;
    if (parsed.teams) return parsed;
  } catch {
    // fall through
  }

  // Try UTF-16LE
  try {
    const text = data.toString('utf16le');
    const parsed = JSON.parse(text) as SlackLocalConfig;
    if (parsed.teams) return parsed;
  } catch {
    // fall through
  }

  return null;
}
```

- [ ] **Step 12: Run all tests**

Run: `bun run test -- test/leveldb-reader.spec.ts`
Expected: All 9 tests pass.

- [ ] **Step 13: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 14: Commit**

```bash
git add src/modules/slack/leveldb-reader.ts test/leveldb-reader.spec.ts
git commit -m "feat(oracle): add LevelDB WAL reader for Slack token extraction"
```

---

### Task 2: Cookie Decryptor

[@nestjs]

**Files:**
- Create: `src/modules/slack/cookie-decryptor.ts`
- Create: `test/cookie-decryptor.spec.ts`

Pure functions for reading Slack's Chromium cookie SQLite database and decrypting the `d` cookie. Uses `bun:sqlite` and Node's built-in `crypto` module.

- [ ] **Step 1: Write failing tests for `deriveKey` and `decryptValue`**

Create `test/cookie-decryptor.spec.ts`:

```typescript
import { deriveKey, decryptValue } from '../src/modules/slack/cookie-decryptor';
import { pbkdf2Sync, createCipheriv } from 'crypto';

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
      const encryptedValue = Buffer.concat([
        Buffer.from('v10'),
        encrypted,
      ]);

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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/cookie-decryptor.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `deriveKey` and `decryptValue`**

Create `src/modules/slack/cookie-decryptor.ts`:

```typescript
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
      .query<{ encrypted_value: Uint8Array }, []>(
        "SELECT encrypted_value FROM cookies WHERE name = 'd' AND host_key LIKE '%slack.com%' LIMIT 1",
      )
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
export function readKeychainPassword(
  serviceName: string,
): string | null {
  const result = Bun.spawnSync(
    ['security', 'find-generic-password', '-s', serviceName, '-w'],
    { stdout: 'pipe', stderr: 'pipe' },
  );
  if (result.exitCode !== 0) return null;
  return result.stdout.toString().trim();
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/cookie-decryptor.spec.ts`
Expected: All 5 tests pass.

- [ ] **Step 5: Write failing test for `readEncryptedCookie`**

Add to `test/cookie-decryptor.spec.ts`:

```typescript
import {
  deriveKey,
  decryptValue,
  readEncryptedCookie,
} from '../src/modules/slack/cookie-decryptor';
import { pbkdf2Sync, createCipheriv } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// ... existing tests ...

describe('readEncryptedCookie', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tawtui-cookie-test-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true });
  });

  it('reads encrypted cookie from SQLite database', () => {
    const dbPath = join(tmpDir, 'Cookies');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES('version', '24');
      CREATE TABLE cookies(
        creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
        top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
        value TEXT NOT NULL, encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
        last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,
        is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL,
        samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,
        source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,
        source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL
      );
      INSERT INTO cookies VALUES(
        0, '.slack.com', '', 'd', '',
        X'763130AABBCCDD', '/', 0, 1, 1, 0, 1, 1, 1, 0, 2, 443, 0, 0, 0
      );
    `);
    db.close();

    const result = readEncryptedCookie(dbPath);
    expect(result).not.toBeNull();
    expect(result!.schemaVersion).toBe(24);
    expect(result!.encryptedValue.subarray(0, 3).toString()).toBe('v10');
  });

  it('returns null when no slack cookie exists', () => {
    const dbPath = join(tmpDir, 'EmptyCookies');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT);
      INSERT INTO meta VALUES('version', '24');
      CREATE TABLE cookies(
        creation_utc INTEGER NOT NULL, host_key TEXT NOT NULL,
        top_frame_site_key TEXT NOT NULL, name TEXT NOT NULL,
        value TEXT NOT NULL, encrypted_value BLOB NOT NULL,
        path TEXT NOT NULL, expires_utc INTEGER NOT NULL,
        is_secure INTEGER NOT NULL, is_httponly INTEGER NOT NULL,
        last_access_utc INTEGER NOT NULL, has_expires INTEGER NOT NULL,
        is_persistent INTEGER NOT NULL, priority INTEGER NOT NULL,
        samesite INTEGER NOT NULL, source_scheme INTEGER NOT NULL,
        source_port INTEGER NOT NULL, last_update_utc INTEGER NOT NULL,
        source_type INTEGER NOT NULL, has_cross_site_ancestor INTEGER NOT NULL
      );
    `);
    db.close();

    const result = readEncryptedCookie(dbPath);
    expect(result).toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun run test -- test/cookie-decryptor.spec.ts`
Expected: All 7 tests pass. (These should pass since the implementation was written in Step 3.)

- [ ] **Step 7: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/modules/slack/cookie-decryptor.ts test/cookie-decryptor.spec.ts
git commit -m "feat(oracle): add Chromium cookie decryptor for Slack xoxd extraction"
```

---

### Task 3: Token Extractor Service + Module Wiring

[@nestjs]

**Files:**
- Create: `src/modules/slack/token-extractor.service.ts`
- Create: `test/token-extractor.service.spec.ts`
- Modify: `src/modules/slack/slack.module.ts`
- Modify: `src/modules/tui/bridge.ts`
- Modify: `src/modules/tui.service.ts`

NestJS service that orchestrates token extraction by detecting Slack installation paths, calling the LevelDB reader and cookie decryptor, and returning extracted credentials.

- [ ] **Step 1: Write the failing test**

Create `test/token-extractor.service.spec.ts`:

```typescript
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment */
import { TokenExtractorService } from '../src/modules/slack/token-extractor.service';

// Mock Bun global
const mockSpawnSync = jest.fn();
(globalThis as Record<string, unknown>).Bun = { spawnSync: mockSpawnSync };

// Mock fs
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

// Mock the leveldb-reader module
jest.mock('../src/modules/slack/leveldb-reader', () => ({
  extractLocalConfig: jest.fn(),
}));

// Mock the cookie-decryptor module
jest.mock('../src/modules/slack/cookie-decryptor', () => ({
  readEncryptedCookie: jest.fn(),
  readKeychainPassword: jest.fn(),
  deriveKey: jest.fn(),
  decryptValue: jest.fn(),
}));

import { existsSync, readFileSync, readdirSync } from 'fs';
import { extractLocalConfig } from '../src/modules/slack/leveldb-reader';
import {
  readEncryptedCookie,
  readKeychainPassword,
  deriveKey,
  decryptValue,
} from '../src/modules/slack/cookie-decryptor';

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockExtractLocalConfig = extractLocalConfig as jest.MockedFunction<
  typeof extractLocalConfig
>;
const mockReadEncryptedCookie = readEncryptedCookie as jest.MockedFunction<
  typeof readEncryptedCookie
>;
const mockReadKeychainPassword = readKeychainPassword as jest.MockedFunction<
  typeof readKeychainPassword
>;
const mockDeriveKey = deriveKey as jest.MockedFunction<typeof deriveKey>;
const mockDecryptValue = decryptValue as jest.MockedFunction<typeof decryptValue>;

describe('TokenExtractorService', () => {
  let service: TokenExtractorService;

  beforeEach(() => {
    service = new TokenExtractorService();
    jest.clearAllMocks();
  });

  it('extracts tokens from Slack App Store installation', async () => {
    // Slack app directories exist (App Store path)
    mockExistsSync.mockImplementation((p: string) => {
      return (p as string).includes('com.tinyspeck.slackmacgap');
    });

    // LevelDB has one .log file
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(Buffer.from('fake-log'));

    // extractLocalConfig finds teams
    mockExtractLocalConfig.mockReturnValue({
      teams: {
        T123: {
          name: 'test-ws',
          url: 'https://test-ws.slack.com/',
          token: 'xoxc-test-token',
        },
      },
    });

    // Cookie extraction
    mockReadEncryptedCookie.mockReturnValue({
      encryptedValue: Buffer.from('v10encrypted'),
      schemaVersion: 24,
    });
    mockReadKeychainPassword.mockReturnValue('keychain-pass');
    mockDeriveKey.mockReturnValue(Buffer.alloc(16));
    mockDecryptValue.mockReturnValue('xoxd-test-cookie');

    const result = await service.extractTokens();
    expect(result.success).toBe(true);
    expect(result.workspaces).toHaveLength(1);
    expect(result.workspaces[0]).toMatchObject({
      teamId: 'T123',
      teamName: 'test-ws',
      xoxcToken: 'xoxc-test-token',
      xoxdCookie: 'xoxd-test-cookie',
    });
  });

  it('returns error when Slack app is not detected', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await service.extractTokens();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Slack desktop app not found');
  });

  it('returns error when no tokens found in LevelDB', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(Buffer.from('empty'));
    mockExtractLocalConfig.mockReturnValue(null);

    const result = await service.extractTokens();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find Slack tokens');
  });

  it('returns error when keychain password unavailable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<typeof readdirSync>);
    mockReadFileSync.mockReturnValue(Buffer.from('fake'));
    mockExtractLocalConfig.mockReturnValue({
      teams: { T1: { name: 'ws', url: 'https://ws.slack.com/', token: 'xoxc-x' } },
    });
    mockReadEncryptedCookie.mockReturnValue({
      encryptedValue: Buffer.from('v10abc'),
      schemaVersion: 24,
    });
    mockReadKeychainPassword.mockReturnValue(null);

    const result = await service.extractTokens();
    expect(result.success).toBe(false);
    expect(result.error).toContain('keychain');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- test/token-extractor.service.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `TokenExtractorService`**

Create `src/modules/slack/token-extractor.service.ts`:

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { extractLocalConfig } from './leveldb-reader';
import {
  readEncryptedCookie,
  readKeychainPassword,
  deriveKey,
  decryptValue,
} from './cookie-decryptor';

export interface ExtractedWorkspace {
  teamId: string;
  teamName: string;
  xoxcToken: string;
  xoxdCookie: string;
}

export interface ExtractionResult {
  success: boolean;
  workspaces: ExtractedWorkspace[];
  error?: string;
}

interface SlackPaths {
  leveldb: string;
  cookies: string;
  keychainService: string;
}

const KEYCHAIN_SERVICE = 'Slack Safe Storage';

@Injectable()
export class TokenExtractorService {
  private readonly logger = new Logger(TokenExtractorService.name);

  async extractTokens(): Promise<ExtractionResult> {
    const paths = this.detectSlackPaths();
    if (!paths) {
      return {
        success: false,
        workspaces: [],
        error: 'Slack desktop app not found. Make sure Slack is installed.',
      };
    }

    // Step 1: Read xoxc tokens from LevelDB
    const localConfig = this.readLocalConfig(paths.leveldb);
    if (!localConfig) {
      return {
        success: false,
        workspaces: [],
        error:
          'Could not find Slack tokens in local storage. Try opening Slack first.',
      };
    }

    // Step 2: Read and decrypt xoxd cookie
    const xoxdCookie = this.decryptXoxdCookie(
      paths.cookies,
      paths.keychainService,
    );
    if (!xoxdCookie) {
      return {
        success: false,
        workspaces: [],
        error:
          'Could not decrypt Slack cookie. Check keychain access.',
      };
    }

    // Step 3: Combine into workspace credentials
    const workspaces: ExtractedWorkspace[] = [];
    for (const [teamId, team] of Object.entries(localConfig.teams)) {
      if (team.token) {
        workspaces.push({
          teamId,
          teamName: team.name || teamId,
          xoxcToken: team.token,
          xoxdCookie,
        });
      }
    }

    if (workspaces.length === 0) {
      return {
        success: false,
        workspaces: [],
        error: 'No Slack workspaces with tokens found.',
      };
    }

    this.logger.log(
      `Extracted tokens for ${workspaces.length} workspace(s)`,
    );
    return { success: true, workspaces };
  }

  /** Detect which Slack installation path exists */
  private detectSlackPaths(): SlackPaths | null {
    const home = homedir();
    const candidates: SlackPaths[] = [
      {
        // App Store
        leveldb: join(
          home,
          'Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Local Storage/leveldb',
        ),
        cookies: join(
          home,
          'Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Cookies',
        ),
        keychainService: KEYCHAIN_SERVICE,
      },
      {
        // Direct download
        leveldb: join(
          home,
          'Library/Application Support/Slack/Local Storage/leveldb',
        ),
        cookies: join(
          home,
          'Library/Application Support/Slack/Cookies',
        ),
        keychainService: KEYCHAIN_SERVICE,
      },
    ];

    for (const paths of candidates) {
      if (existsSync(paths.leveldb) && existsSync(paths.cookies)) {
        return paths;
      }
    }

    return null;
  }

  /** Read and parse localConfig_v2 from LevelDB WAL files */
  private readLocalConfig(
    leveldbDir: string,
  ): ReturnType<typeof extractLocalConfig> {
    const files = readdirSync(leveldbDir)
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse(); // Most recent first

    for (const file of files) {
      const buf = readFileSync(join(leveldbDir, file));
      const config = extractLocalConfig(Buffer.from(buf));
      if (config) return config;
    }

    return null;
  }

  /** Read and decrypt the xoxd cookie from the Cookies SQLite DB */
  private decryptXoxdCookie(
    cookieDbPath: string,
    keychainService: string,
  ): string | null {
    const cookieData = readEncryptedCookie(cookieDbPath);
    if (!cookieData) return null;

    const password = readKeychainPassword(keychainService);
    if (!password) return null;

    try {
      const key = deriveKey(password, 1003);
      return decryptValue(
        cookieData.encryptedValue,
        key,
        cookieData.schemaVersion,
      );
    } catch (err) {
      this.logger.error('Cookie decryption failed', err);
      return null;
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun run test -- test/token-extractor.service.spec.ts`
Expected: All 4 tests pass.

- [ ] **Step 5: Register in SlackModule**

In `src/modules/slack/slack.module.ts`, add:

```typescript
import { TokenExtractorService } from './token-extractor.service';
```

Add `TokenExtractorService` to both `providers` and `exports` arrays.

- [ ] **Step 6: Add to TUI bridge**

In `src/modules/tui/bridge.ts`, add to the `TawtuiBridge` interface:

```typescript
extractSlackTokens: () => Promise<ExtractionResult>;
```

Import `ExtractionResult` from `../slack/token-extractor.service`.

Add the getter:

```typescript
export function getExtractSlackTokens(): TawtuiBridge['extractSlackTokens'] | null {
  return getBridge()?.extractSlackTokens ?? null;
}
```

- [ ] **Step 7: Wire in TuiService**

In `src/modules/tui.service.ts`:

1. Import `TokenExtractorService`:
```typescript
import { TokenExtractorService } from './slack/token-extractor.service';
```

2. Add to constructor:
```typescript
private readonly tokenExtractorService: TokenExtractorService,
```

3. Add to the `g.__tawtui` object:
```typescript
extractSlackTokens: () => this.tokenExtractorService.extractTokens(),
```

4. Update the `TawtuiGlobal` interface to include the new method with proper types.

- [ ] **Step 8: Run all tests**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 9: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 10: Commit**

```bash
git add src/modules/slack/token-extractor.service.ts test/token-extractor.service.spec.ts \
  src/modules/slack/slack.module.ts src/modules/tui/bridge.ts src/modules/tui.service.ts
git commit -m "feat(oracle): add TokenExtractorService with module wiring and bridge"
```

---

### Task 4: Update Types and DependencyService

[@nestjs]

**Files:**
- Modify: `src/modules/dependency.types.ts`
- Modify: `src/modules/dependency.service.ts`
- Modify: `test/dependency.service.spec.ts`

Remove `slacktokensInstalled`/`slacktokensInstallInstructions` from `SlackDepStatus`. Add `slackAppDetected` for detecting the local Slack desktop app. Remove `slacktokens` from `ALLOWED_PACKAGES`.

- [ ] **Step 1: Update tests first**

In `test/dependency.service.spec.ts`:

Replace the `'slack status includes install instructions'` test:

```typescript
it('slack status includes install instructions for mempalace', async () => {
  const status = await service.checkAll();
  expect(status.slack.mempalaceInstallInstructions).toBe(
    'pipx install mempalace',
  );
  expect(status.slack).not.toHaveProperty('slacktokensInstallInstructions');
});
```

Add a new test for `slackAppDetected`:

```typescript
it('slack status includes slackAppDetected field', async () => {
  const status = await service.checkAll();
  expect(status.slack).toHaveProperty('slackAppDetected');
  expect(typeof status.slack.slackAppDetected).toBe('boolean');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun run test -- test/dependency.service.spec.ts`
Expected: Failures — `slacktokensInstallInstructions` still exists, `slackAppDetected` missing.

- [ ] **Step 3: Update `SlackDepStatus` type**

In `src/modules/dependency.types.ts`, replace the `SlackDepStatus` interface:

```typescript
export interface SlackDepStatus {
  /** xoxc + xoxd tokens exist in config */
  hasTokens: boolean;
  /** mempalace CLI is available */
  mempalaceInstalled: boolean;
  /** Slack desktop app is installed locally (tokens can be auto-detected) */
  slackAppDetected: boolean;
  /** pipx CLI is available for auto-install */
  pipxInstalled: boolean;
  /** Install instruction for mempalace */
  mempalaceInstallInstructions: string;
  /** Install instruction for pipx itself (platform-aware) */
  pipxInstallInstructions: string;
}
```

- [ ] **Step 4: Update `DependencyService`**

In `src/modules/dependency.service.ts`:

1. Remove `'slacktokens'` from `ALLOWED_PACKAGES`:
```typescript
private static readonly ALLOWED_PACKAGES = new Set(['mempalace']);
```

2. Update `checkSlack()`:
```typescript
private checkSlack(): SlackDepStatus {
  const platform = process.platform;
  const oracleConfig = this.configService.getOracleConfig();
  const hasTokens =
    !!oracleConfig.slack?.xoxcToken && !!oracleConfig.slack?.xoxdCookie;

  const mempalaceInstalled = this.isPythonPackageAvailable(
    'mempalace',
    'status',
  );
  const pipxInstalled = this.isCommandAvailable('pipx');
  const slackAppDetected = this.detectSlackApp();

  return {
    hasTokens,
    mempalaceInstalled,
    slackAppDetected,
    pipxInstalled,
    mempalaceInstallInstructions: 'pipx install mempalace',
    pipxInstallInstructions: this.getPipxInstallInstructions(platform),
  };
}

private detectSlackApp(): boolean {
  const home = process.env.HOME ?? '';
  const paths = [
    `${home}/Library/Containers/com.tinyspeck.slackmacgap/Data/Library/Application Support/Slack/Local Storage/leveldb`,
    `${home}/Library/Application Support/Slack/Local Storage/leveldb`,
  ];
  return paths.some((p) => {
    try {
      return Bun.spawnSync(['test', '-d', p], {
        stdout: 'pipe',
        stderr: 'pipe',
      }).exitCode === 0;
    } catch {
      return false;
    }
  });
}
```

3. Remove the old `isPythonPackageAvailable('slacktokens')` call.

- [ ] **Step 5: Run tests**

Run: `bun run test -- test/dependency.service.spec.ts`
Expected: All tests pass.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/dependency.types.ts src/modules/dependency.service.ts test/dependency.service.spec.ts
git commit -m "feat(oracle): replace slacktokens with slackAppDetected in dependency checks"
```

---

### Task 5: Update OracleSetupScreen

[@tui]

**Files:**
- Modify: `src/modules/tui/components/oracle-setup-screen.tsx`

Replace "Option A (automatic)" slacktokens instructions with `[a] Auto-detect from Slack app`. Add workspace selection UI for multi-workspace extraction.

**Context:** The `SlackDepStatus` type no longer has `slacktokensInstalled` or `slacktokensInstallInstructions`. It now has `slackAppDetected: boolean`. The `onAutoDetect` callback returns an `ExtractionResult` with `workspaces: ExtractedWorkspace[]`.

**Import types needed:**
```typescript
import type { ExtractedWorkspace, ExtractionResult } from '../../slack/token-extractor.service';
```

- [ ] **Step 1: Add `onAutoDetect` prop and detection state signals**

Update the props interface:

```typescript
interface OracleSetupScreenProps {
  slackStatus: SlackDepStatus;
  onRecheck: () => Promise<void>;
  onTokensSubmit: (
    xoxc: string,
    xoxd: string,
    teamId: string,
    teamName: string,
  ) => Promise<void>;
  onInstallDeps: () => Promise<{ success: boolean; error?: string }>;
  onAutoDetect: () => Promise<ExtractionResult>;
}
```

Add new signals:

```typescript
const [detecting, setDetecting] = createSignal(false);
const [detectedWorkspaces, setDetectedWorkspaces] = createSignal<ExtractedWorkspace[]>([]);
```

- [ ] **Step 2: Add `[a]` key handler and workspace selection**

In the `useKeyboard` callback, add in the normal mode section:

```typescript
// Auto-detect tokens from Slack app
if (
  key.name === 'a' &&
  !props.slackStatus.hasTokens &&
  props.slackStatus.slackAppDetected &&
  !detecting()
) {
  key.preventDefault();
  setDetecting(true);
  setInstallError(null);
  void props.onAutoDetect().then((result) => {
    setDetecting(false);
    if (!result.success) {
      setInstallError(result.error ?? 'Auto-detect failed');
    } else if (result.workspaces.length === 1) {
      const ws = result.workspaces[0];
      void props.onTokensSubmit(
        ws.xoxcToken,
        ws.xoxdCookie,
        ws.teamId,
        ws.teamName,
      );
    } else {
      setDetectedWorkspaces(result.workspaces);
    }
  });
  return;
}

// Workspace selection (1-9) when multiple workspaces detected
if (detectedWorkspaces().length > 0) {
  const idx = parseInt(key.sequence ?? '', 10);
  if (idx >= 1 && idx <= detectedWorkspaces().length) {
    key.preventDefault();
    const ws = detectedWorkspaces()[idx - 1];
    void props.onTokensSubmit(
      ws.xoxcToken,
      ws.xoxdCookie,
      ws.teamId,
      ws.teamName,
    );
    setDetectedWorkspaces([]);
    return;
  }
  if (key.name === 'escape') {
    key.preventDefault();
    setDetectedWorkspaces([]);
    return;
  }
}
```

- [ ] **Step 3: Replace "Option A (automatic)" UI**

Replace the entire "Option A (automatic)" section (the `<Show>` block showing slacktokens instructions) with:

```tsx
<Show when={!props.slackStatus.hasTokens}>
  <box height={1} />

  {/* Auto-detect from Slack app */}
  <Show when={props.slackStatus.slackAppDetected}>
    <text fg={FG_DIM}>{'    Option A (automatic):'}</text>
    <Show
      when={!detecting()}
      fallback={
        <text fg={ORACLE_GRAD[0]} attributes={1}>
          {'      Detecting Slack tokens...'}
        </text>
      }
    >
      <box flexDirection="row">
        <text>{'      '}</text>
        <text fg={ACCENT_PRIMARY} attributes={1}>
          {'[a]'}
        </text>
        <text fg={FG_DIM}>{' Auto-detect from Slack desktop app'}</text>
      </box>
    </Show>
    <box height={1} />
  </Show>

  {/* Workspace selection */}
  <Show when={detectedWorkspaces().length > 0}>
    <text fg={FG_NORMAL} attributes={1}>
      {'    Select a workspace:'}
    </text>
    <For each={detectedWorkspaces()}>
      {(ws, i) => (
        <box flexDirection="row">
          <text>{'      '}</text>
          <text fg={ACCENT_PRIMARY} attributes={1}>
            {`[${i() + 1}]`}
          </text>
          <text fg={FG_NORMAL}>{` ${ws.teamName}`}</text>
          <text fg={FG_DIM}>{` (${ws.teamId})`}</text>
        </box>
      )}
    </For>
    <box flexDirection="row">
      <text>{'      '}</text>
      <text fg={FG_MUTED}>{'[Esc] cancel'}</text>
    </box>
    <box height={1} />
  </Show>

  {/* Manual entry — always available */}
  <text fg={FG_DIM}>
    {props.slackStatus.slackAppDetected
      ? '    Option B (manual):'
      : '    Enter tokens manually:'}
  </text>
  <text fg={FG_DIM}>
    {'      1. Open Slack in your browser (not the desktop app)'}
  </text>
  <text fg={FG_DIM}>
    {'      2. Open DevTools → Application → Cookies'}
  </text>
  <text fg={FG_DIM}>
    {'      3. Copy the "d" cookie value (xoxd-...)'}
  </text>
  <text fg={FG_DIM}>
    {'      4. Open DevTools → Console → run: window.prompt("token", (await (await fetch("/api/auth.findSession", {method: "POST"})).json()).token_id)'}
  </text>
  <text fg={FG_DIM}>
    {'      5. Copy the xoxc-... token from the prompt'}
  </text>
  <box height={1} />

  <box flexDirection="row">
    <text>{'    '}</text>
    <text fg={ACCENT_PRIMARY} attributes={1}>
      {'[t]'}
    </text>
    <text fg={FG_DIM}>{' Enter tokens manually'}</text>
  </box>
</Show>
```

- [ ] **Step 4: Update key hints to include `[a]`**

In the key hints section, add the auto-detect hint:

```tsx
<Show
  when={
    !props.slackStatus.hasTokens &&
    props.slackStatus.slackAppDetected &&
    !detecting() &&
    detectedWorkspaces().length === 0
  }
>
  <text>{'    '}</text>
  <text fg={ACCENT_PRIMARY} attributes={1}>
    {'[a]'}
  </text>
  <text fg={FG_DIM}>{' Auto-detect'}</text>
</Show>
```

- [ ] **Step 5: Remove all references to `slacktokensInstalled` and `slacktokensInstallInstructions`**

Search the file for any remaining references to `slacktokens` and remove them. The `SlackDepStatus` type no longer has these fields.

- [ ] **Step 6: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/tui/components/oracle-setup-screen.tsx
git commit -m "feat(oracle): replace slacktokens UI with auto-detect from Slack desktop app"
```

---

### Task 6: Wire OracleView with Auto-Detect Handler

[@tui]

**Files:**
- Modify: `src/modules/tui/views/oracle-view.tsx`

Add `handleAutoDetect` callback and pass it to `OracleSetupScreen`.

- [ ] **Step 1: Add the handler function**

In `src/modules/tui/views/oracle-view.tsx`, add this function after `handleInstallDeps`:

```typescript
async function handleAutoDetect(): Promise<ExtractionResult> {
  const extractTokens = getExtractSlackTokens();
  if (!extractTokens) {
    return {
      success: false,
      workspaces: [],
      error: 'Token extractor not available',
    };
  }

  return extractTokens();
}
```

Import `ExtractionResult` from the token extractor service and `getExtractSlackTokens` from the bridge:

```typescript
import type { ExtractionResult } from '../../slack/token-extractor.service';
import { getExtractSlackTokens } from '../bridge';
```

(Note: `getExtractSlackTokens` was added to the bridge in Task 3.)

- [ ] **Step 2: Pass `onAutoDetect` prop to OracleSetupScreen**

Update the `<OracleSetupScreen>` JSX:

```tsx
<OracleSetupScreen
  slackStatus={depStatus()!.slack}
  onRecheck={handleRecheck}
  onTokensSubmit={handleTokensSubmit}
  onInstallDeps={handleInstallDeps}
  onAutoDetect={handleAutoDetect}
/>
```

- [ ] **Step 3: Run all tests**

Run: `bun run test`
Expected: All tests pass.

- [ ] **Step 4: Run lint**

Run: `bun run lint`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/tui/views/oracle-view.tsx
git commit -m "feat(oracle): wire auto-detect handler from OracleView to OracleSetupScreen"
```

---

## Summary of Changes

| Before | After |
|--------|-------|
| Depends on abandoned `slacktokens` Python package | Built-in TypeScript token extraction |
| `pip install slacktokens` instructions | `[a] Auto-detect from Slack desktop app` |
| Requires user to leave TUI for token extraction | One-keypress extraction from local Slack app |
| No workspace selection | Multi-workspace support with numbered selection |
| Python 3.12+ incompatible | Zero Python dependency for token extraction |
