import { Injectable, Logger } from '@nestjs/common';
import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  extractLocalConfig,
  extractLocalConfigFromSst,
} from './leveldb-reader';
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

  // eslint-disable-next-line @typescript-eslint/require-await
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
        error: 'Could not decrypt Slack cookie. Check keychain access.',
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

    this.logger.log(`Extracted tokens for ${workspaces.length} workspace(s)`);
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
        cookies: join(home, 'Library/Application Support/Slack/Cookies'),
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

  /** Read and parse localConfig_v2 from LevelDB WAL and SST files */
  private readLocalConfig(
    leveldbDir: string,
  ): ReturnType<typeof extractLocalConfig> {
    const files = readdirSync(leveldbDir);

    // Try WAL .log files first (most recent data)
    const logFiles = files
      .filter((f) => f.endsWith('.log'))
      .sort()
      .reverse();
    for (const file of logFiles) {
      const buf = readFileSync(join(leveldbDir, file));
      const config = extractLocalConfig(Buffer.from(buf));
      if (config) return config;
    }

    // Fall back to SST .ldb files
    const sstFiles = files
      .filter((f) => f.endsWith('.ldb'))
      .sort()
      .reverse();
    for (const file of sstFiles) {
      const buf = readFileSync(join(leveldbDir, file));
      const config = extractLocalConfigFromSst(Buffer.from(buf));
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
