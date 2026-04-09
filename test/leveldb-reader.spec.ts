import {
  readVarint,
  parseLogRecords,
  extractLocalConfig,
  decompressSnappy,
  extractLocalConfigFromSst,
} from '../src/modules/slack/leveldb-reader';

describe('LevelDB Reader', () => {
  function buildLogRecord(type: number, data: Buffer): Buffer {
    // Record format: CRC32(4) + Length(2) + Type(1) + Data
    const header = Buffer.alloc(7);
    header.writeUInt32LE(0, 0); // CRC32 placeholder (we skip validation)
    header.writeUInt16LE(data.length, 4);
    header[6] = type;
    return Buffer.concat([header, data]);
  }

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

  describe('parseLogRecords', () => {
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
      const key = Buffer.from('_https://app.slack.com\x00\x01localConfig_v2');
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
      const value = Buffer.concat([Buffer.from([0x01]), Buffer.from('{}')]);
      const batch = buildWriteBatch(key, value);
      const logBuf = buildLogRecord(1, batch);

      const result = extractLocalConfig(logBuf);
      expect(result).toBeNull();
    });

    it('handles multiple teams', () => {
      const config = JSON.stringify({
        teams: {
          T111: {
            name: 'ws-one',
            url: 'https://one.slack.com/',
            token: 'xoxc-1',
          },
          T222: {
            name: 'ws-two',
            url: 'https://two.slack.com/',
            token: 'xoxc-2',
          },
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

  describe('decompressSnappy', () => {
    it('decompresses a literal-only snappy block', () => {
      // Snappy format: uncompressed_len(varint) + literal tag + data
      // For "hello" (5 bytes): len=5, tag=0x10 (literal, len=(0x10>>2)+1=5), data="hello"
      const compressed = Buffer.from([
        0x05, // uncompressed length = 5
        0x10, // literal tag: type=0, length=(0x10>>2)+1=5
        0x68,
        0x65,
        0x6c,
        0x6c,
        0x6f, // "hello"
      ]);
      const result = decompressSnappy(compressed);
      expect(result.toString()).toBe('hello');
    });

    it('handles empty input', () => {
      const empty = Buffer.from([0x00]); // uncompressed length = 0
      const result = decompressSnappy(empty);
      expect(result.length).toBe(0);
    });

    it('decompresses with copy type 1 references', () => {
      // Build: "abcabc" = literal "abc" + copy type1 offset=3 length=4 (need 3 more)
      // Actually let's do "aaa" = literal "a" + copy type1 len=4 offset=1
      // But copy type 1 min length is 4, so output would be "aaaaa" (1 literal + 4 copy)
      // literal "a": tag=0x00 (type=0, len=(0>>2)+1=1), data=0x61
      // copy type 1: len=((tag>>2)&7)+4=4, offset=((tag>>5)<<8)|next
      //   we want len=4, offset=1: (tag>>2)&7=0, tag>>5=0, next=1
      //   tag = 0b_000_000_01 = 0x01
      const compressed = Buffer.from([
        0x05, // uncompressed length = 5
        0x00,
        0x61, // literal "a" (tag=0x00, type=0, len=1)
        0x01,
        0x01, // copy type 1 (tag=0x01, len=4, offset=1)
      ]);
      const result = decompressSnappy(compressed);
      expect(result.toString()).toBe('aaaaa');
    });

    it('decompresses with copy type 2 references', () => {
      // "abcabc" = literal "abc" + copy type2 offset=3 length=3
      // literal "abc": tag = (3-1)<<2 | 0 = 0x08, data = "abc"
      // copy type 2: len=(tag>>2)+1=3, offset=3 as 2 bytes LE
      //   tag>>2 = 2, so tag = (2<<2)|2 = 0x0A
      const compressed = Buffer.from([
        0x06, // uncompressed length = 6
        0x08,
        0x61,
        0x62,
        0x63, // literal "abc"
        0x0a,
        0x03,
        0x00, // copy type 2: len=3, offset=3
      ]);
      const result = decompressSnappy(compressed);
      expect(result.toString()).toBe('abcabc');
    });
  });

  describe('extractLocalConfigFromSst', () => {
    function encodeVarintBuf(n: number): Buffer {
      const bytes: number[] = [];
      while (n > 0x7f) {
        bytes.push((n & 0x7f) | 0x80);
        n >>>= 7;
      }
      bytes.push(n);
      return Buffer.from(bytes);
    }

    function buildMinimalSst(userKey: Buffer, value: Buffer): Buffer {
      // Build internal key: userKey + 8-byte suffix (sequence=1, type=1)
      // Packed as (sequence << 8) | type in little-endian
      const seqType = Buffer.alloc(8);
      seqType.writeUInt32LE(0x0101, 0);
      seqType.writeUInt32LE(0, 4);
      const fullInternalKey = Buffer.concat([userKey, seqType]);

      // Data block entry: shared=0, non_shared=keyLen, value_len, key, value
      const entry = Buffer.concat([
        encodeVarintBuf(0),
        encodeVarintBuf(fullInternalKey.length),
        encodeVarintBuf(value.length),
        fullInternalKey,
        value,
      ]);

      // Data block: entries + restart section + num_restarts
      const restartOffset = Buffer.alloc(4);
      restartOffset.writeUInt32LE(0, 0);
      const numRestarts = Buffer.alloc(4);
      numRestarts.writeUInt32LE(1, 0);
      const dataBlock = Buffer.concat([entry, restartOffset, numRestarts]);

      // Block trailer: compression_type(1) + CRC(4)
      const dataTrailer = Buffer.alloc(5);

      // Index block: one entry pointing to the data block
      const dataBlockHandle = Buffer.concat([
        encodeVarintBuf(0), // data block offset
        encodeVarintBuf(dataBlock.length), // data block size
      ]);
      const indexEntry = Buffer.concat([
        encodeVarintBuf(0),
        encodeVarintBuf(fullInternalKey.length),
        encodeVarintBuf(dataBlockHandle.length),
        fullInternalKey,
        dataBlockHandle,
      ]);
      const indexBlock = Buffer.concat([
        indexEntry,
        Buffer.alloc(4, 0), // restart offset = 0
        numRestarts,
      ]);
      const indexTrailer = Buffer.alloc(5);

      // Metaindex block (empty)
      const emptyMetaBlock = Buffer.concat([
        Buffer.alloc(4), // restart offset
        Buffer.from([1, 0, 0, 0]), // num_restarts = 1
      ]);
      const metaTrailer = Buffer.alloc(5);

      // Calculate offsets
      const metaStart = dataBlock.length + dataTrailer.length;
      const indexStart = metaStart + emptyMetaBlock.length + metaTrailer.length;

      // Footer: metaindex_handle + index_handle + padding + magic
      const metaHandle = Buffer.concat([
        encodeVarintBuf(metaStart),
        encodeVarintBuf(emptyMetaBlock.length),
      ]);
      const indexHandle = Buffer.concat([
        encodeVarintBuf(indexStart),
        encodeVarintBuf(indexBlock.length),
      ]);
      const handleData = Buffer.concat([metaHandle, indexHandle]);
      const padding = Buffer.alloc(40 - handleData.length);
      const magic = Buffer.from('57fb808b247547db', 'hex');
      const footer = Buffer.concat([handleData, padding, magic]);

      return Buffer.concat([
        dataBlock,
        dataTrailer,
        emptyMetaBlock,
        metaTrailer,
        indexBlock,
        indexTrailer,
        footer,
      ]);
    }

    it('extracts config from a minimal SST file', () => {
      const config = JSON.stringify({
        teams: {
          T123: {
            name: 'test-ws',
            url: 'https://test.slack.com/',
            token: 'xoxc-test',
          },
        },
      });
      const userKey = Buffer.from(
        '_https://app.slack.com\x00\x01localConfig_v2',
      );
      const value = Buffer.concat([Buffer.from([0x01]), Buffer.from(config)]);

      const sst = buildMinimalSst(userKey, value);
      const result = extractLocalConfigFromSst(sst);
      expect(result).not.toBeNull();
      expect(result!.teams['T123'].token).toBe('xoxc-test');
    });

    it('returns null for empty buffer', () => {
      const result = extractLocalConfigFromSst(Buffer.alloc(0));
      expect(result).toBeNull();
    });

    it('returns null for buffer with invalid magic', () => {
      const result = extractLocalConfigFromSst(Buffer.alloc(48, 0xff));
      expect(result).toBeNull();
    });

    it('returns null when key is not found', () => {
      const userKey = Buffer.from('some_other_key');
      const value = Buffer.from([0x01, 0x7b, 0x7d]); // {0x01}{}
      const sst = buildMinimalSst(userKey, value);
      const result = extractLocalConfigFromSst(sst);
      expect(result).toBeNull();
    });

    it('handles multiple teams in SST', () => {
      const config = JSON.stringify({
        teams: {
          T111: {
            name: 'ws-one',
            url: 'https://one.slack.com/',
            token: 'xoxc-1',
          },
          T222: {
            name: 'ws-two',
            url: 'https://two.slack.com/',
            token: 'xoxc-2',
          },
        },
      });
      const userKey = Buffer.from(
        '_https://app.slack.com\x00\x01localConfig_v2',
      );
      const value = Buffer.concat([Buffer.from([0x01]), Buffer.from(config)]);

      const sst = buildMinimalSst(userKey, value);
      const result = extractLocalConfigFromSst(sst);
      expect(result).not.toBeNull();
      expect(Object.keys(result!.teams)).toHaveLength(2);
      expect(result!.teams['T111'].token).toBe('xoxc-1');
      expect(result!.teams['T222'].token).toBe('xoxc-2');
    });
  });
});
