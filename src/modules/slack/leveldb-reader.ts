/**
 * Read a LevelDB-style varint (unsigned, little-endian, 7 bits per byte).
 * Returns [value, nextOffset].
 *
 * Note: Uses JavaScript bitwise OR, which operates on 32-bit signed integers.
 * Values above 2^31-1 (2,147,483,647) will be incorrect. This is acceptable
 * for the current use case where varints encode key/value lengths.
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

    const data = buf.subarray(
      offset + HEADER_SIZE,
      offset + HEADER_SIZE + length,
    );
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
export function extractLocalConfig(logBuffer: Buffer): SlackLocalConfig | null {
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
  const data = raw.length > 0 && raw[0] <= 0x02 ? raw.subarray(1) : raw;

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
