import { TokenExtractorService } from '../../src/modules/slack/token-extractor.service';

// Mock Bun global
const mockSpawnSync = jest.fn();
(globalThis as Record<string, unknown>).Bun = { spawnSync: mockSpawnSync };

// Mock fs
// eslint-disable-next-line @typescript-eslint/no-unsafe-return
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  existsSync: jest.fn(),
  readFileSync: jest.fn(),
  readdirSync: jest.fn(),
}));

// Mock the leveldb-reader module
jest.mock('../../src/modules/slack/leveldb-reader', () => ({
  extractLocalConfig: jest.fn(),
}));

// Mock the cookie-decryptor module
jest.mock('../../src/modules/slack/cookie-decryptor', () => ({
  readEncryptedCookie: jest.fn(),
  readKeychainPassword: jest.fn(),
  deriveKey: jest.fn(),
  decryptValue: jest.fn(),
}));

import { existsSync, readFileSync, readdirSync } from 'fs';
import { extractLocalConfig } from '../../src/modules/slack/leveldb-reader';
import {
  readEncryptedCookie,
  readKeychainPassword,
  deriveKey,
  decryptValue,
} from '../../src/modules/slack/cookie-decryptor';

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<
  typeof readFileSync
>;
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
const mockDecryptValue = decryptValue as jest.MockedFunction<
  typeof decryptValue
>;

describe('TokenExtractorService', () => {
  let service: TokenExtractorService;

  beforeEach(() => {
    service = new TokenExtractorService();
    jest.clearAllMocks();
  });

  it('extracts tokens from Slack App Store installation', async () => {
    // Slack app directories exist (App Store path)
    mockExistsSync.mockImplementation((p: string) => {
      return p.includes('com.tinyspeck.slackmacgap');
    });

    // LevelDB has one .log file
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<
      typeof readdirSync
    >);
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
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockReadFileSync.mockReturnValue(Buffer.from('empty'));
    mockExtractLocalConfig.mockReturnValue(null);

    const result = await service.extractTokens();
    expect(result.success).toBe(false);
    expect(result.error).toContain('Could not find Slack tokens');
  });

  it('returns error when keychain password unavailable', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue(['000001.log'] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockReadFileSync.mockReturnValue(Buffer.from('fake'));
    mockExtractLocalConfig.mockReturnValue({
      teams: {
        T1: { name: 'ws', url: 'https://ws.slack.com/', token: 'xoxc-x' },
      },
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
