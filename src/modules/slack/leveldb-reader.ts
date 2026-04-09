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
 * Decompress a Snappy-compressed buffer.
 *
 * Snappy format:
 * - Varint: uncompressed length
 * - Elements (tag byte + data):
 *   - Type 0 (literal): length from tag, then raw bytes
 *   - Type 1 (copy, 1-byte offset): length + offset from tag + 1 extra byte
 *   - Type 2 (copy, 2-byte offset): length from tag, offset from 2 extra bytes
 */
export function decompressSnappy(src: Buffer): Buffer {
  let pos = 0;

  // Read uncompressed length
  let uncompressedLen = 0;
  let shift = 0;
  while (pos < src.length) {
    const byte = src[pos++];
    uncompressedLen |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7;
  }

  const output = Buffer.alloc(uncompressedLen);
  let outPos = 0;

  while (pos < src.length && outPos < uncompressedLen) {
    const tag = src[pos++];
    const type = tag & 0x03;

    if (type === 0) {
      // Literal
      let length = (tag >> 2) + 1;
      if (length === 61) {
        length = src[pos++] + 1;
      } else if (length === 62) {
        length = src.readUInt16LE(pos) + 1;
        pos += 2;
      } else if (length === 63) {
        length = (src[pos] | (src[pos + 1] << 8) | (src[pos + 2] << 16)) + 1;
        pos += 3;
      } else if (length === 64) {
        length = src.readUInt32LE(pos) + 1;
        pos += 4;
      }
      src.copy(output, outPos, pos, pos + length);
      pos += length;
      outPos += length;
    } else if (type === 1) {
      // Copy with 1-byte offset
      const length = ((tag >> 2) & 0x07) + 4;
      const offset = ((tag >> 5) << 8) | src[pos++];
      for (let i = 0; i < length; i++) {
        output[outPos + i] = output[outPos - offset + i];
      }
      outPos += length;
    } else if (type === 2) {
      // Copy with 2-byte offset
      const length = (tag >> 2) + 1;
      const offset = src.readUInt16LE(pos);
      pos += 2;
      for (let i = 0; i < length; i++) {
        output[outPos + i] = output[outPos - offset + i];
      }
      outPos += length;
    } else {
      // Type 3: copy with 4-byte offset
      const length = (tag >> 2) + 1;
      const offset = src.readUInt32LE(pos);
      pos += 4;
      for (let i = 0; i < length; i++) {
        output[outPos + i] = output[outPos - offset + i];
      }
      outPos += length;
    }
  }

  return output.subarray(0, outPos);
}

/**
 * Parse prefix-compressed entries from a LevelDB block.
 *
 * Block format:
 * - Entries: shared_len(varint) + non_shared_len(varint) + value_len(varint)
 *            + key_delta[non_shared_len] + value[value_len]
 * - Restart offsets: num_restarts * 4 bytes (uint32 LE each)
 * - Last 4 bytes: num_restarts (uint32 LE)
 */
function parseBlockEntries(block: Buffer): Array<[key: Buffer, value: Buffer]> {
  const results: Array<[Buffer, Buffer]> = [];
  if (block.length < 4) return results;

  const numRestarts = block.readUInt32LE(block.length - 4);
  const restartsSectionSize = numRestarts * 4 + 4;
  const entriesEnd = block.length - restartsSectionSize;

  let offset = 0;
  let currentKey = Buffer.alloc(0);

  while (offset < entriesEnd) {
    const [sharedLen, o1] = readVarint(block, offset);
    const [nonSharedLen, o2] = readVarint(block, o1);
    const [valueLen, o3] = readVarint(block, o2);

    if (o3 + nonSharedLen + valueLen > block.length) break;

    const keyDelta = block.subarray(o3, o3 + nonSharedLen);
    const value = Buffer.from(
      block.subarray(o3 + nonSharedLen, o3 + nonSharedLen + valueLen),
    );

    // Reconstruct key from shared prefix + delta
    currentKey = Buffer.concat([currentKey.subarray(0, sharedLen), keyDelta]);

    results.push([Buffer.from(currentKey), value]);
    offset = o3 + nonSharedLen + valueLen;
  }

  return results;
}

/**
 * Read a block from an SST file, decompressing if necessary.
 * The block trailer (1-byte compression + 4-byte CRC) follows the block data.
 */
function readSstBlock(
  sst: Buffer,
  blockOffset: number,
  blockSize: number,
): Buffer {
  const raw = sst.subarray(blockOffset, blockOffset + blockSize);
  const compressionType = sst[blockOffset + blockSize];

  if (compressionType === 1) {
    return decompressSnappy(Buffer.from(raw));
  }

  return Buffer.from(raw);
}

/**
 * Extract localConfig_v2 from a LevelDB SST (.ldb) file.
 *
 * SST file structure:
 * - Data blocks (key-value entries)
 * - Meta blocks (filter, stats)
 * - Metaindex block (points to meta blocks)
 * - Index block (points to data blocks)
 * - Footer (last 48 bytes): metaindex_handle + index_handle + padding + magic
 *
 * Magic number (last 8 bytes): 0x57fb808b247547db
 */
export function extractLocalConfigFromSst(
  sstBuffer: Buffer,
): SlackLocalConfig | null {
  try {
    if (sstBuffer.length < 48) return null;

    // Parse footer (last 48 bytes)
    const footerStart = sstBuffer.length - 48;
    const footer = sstBuffer.subarray(footerStart);

    // Verify magic number (last 8 bytes)
    const magic = footer.subarray(40, 48);
    const expectedMagic = Buffer.from('57fb808b247547db', 'hex');
    if (!magic.equals(expectedMagic)) return null;

    // Read metaindex handle (skip it) and index handle from footer
    const fpos = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_metaOffset, f1] = readVarint(footer, fpos);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [_metaSize, f2] = readVarint(footer, f1);
    const [indexOffset, f3] = readVarint(footer, f2);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [indexSize, _f4] = readVarint(footer, f3);

    // Read index block
    const indexBlock = readSstBlock(sstBuffer, indexOffset, indexSize);
    const indexEntries = parseBlockEntries(indexBlock);

    const TARGET_KEY = 'localConfig_v2';

    // Iterate over data blocks referenced by the index
    for (const [, handleBuf] of indexEntries) {
      const [dataOffset, h1] = readVarint(handleBuf, 0);
      const [dataSize] = readVarint(handleBuf, h1);

      const dataBlock = readSstBlock(sstBuffer, dataOffset, dataSize);
      const dataEntries = parseBlockEntries(dataBlock);

      for (const [rawKey, value] of dataEntries) {
        // Strip 8-byte internal key suffix (sequence number + type)
        const userKey =
          rawKey.length > 8 ? rawKey.subarray(0, rawKey.length - 8) : rawKey;
        const keyStr = userKey.toString('utf-8');

        if (keyStr.includes(TARGET_KEY)) {
          return parseConfigValue(value);
        }
      }
    }

    return null;
  } catch {
    return null;
  }
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
