import {
  readVarint,
  parseLogRecords,
  extractLocalConfig,
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
});
