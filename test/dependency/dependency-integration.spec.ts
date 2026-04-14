import { DependencyService } from '../../src/modules/dependency.service';
import { ConfigService } from '../../src/modules/config.service';
import { GithubService } from '../../src/modules/github.service';
import { TaskwarriorService } from '../../src/modules/taskwarrior.service';
import { CalendarService } from '../../src/modules/calendar.service';
import { MempalaceService } from '../../src/modules/slack/mempalace.service';
import { NotificationService } from '../../src/modules/notification.service';
import { TerminalTestHelper } from '../helpers/terminal-test.helper';

// Mock Bun global
const mockSpawnSync = jest.fn().mockReturnValue({ exitCode: 1 });
const mockSpawn = jest.fn();
(globalThis as Record<string, unknown>).Bun = {
  spawnSync: mockSpawnSync,
  spawn: mockSpawn,
};

describe('DependencyService Integration', () => {
  let service: DependencyService;
  let mockGithub: jest.Mocked<Partial<GithubService>>;
  let mockTaskwarrior: jest.Mocked<Partial<TaskwarriorService>>;
  let mockCalendar: jest.Mocked<Partial<CalendarService>>;
  let mockConfig: jest.Mocked<Partial<ConfigService>>;
  let mockMempalace: jest.Mocked<Partial<MempalaceService>>;
  let mockNotification: jest.Mocked<Partial<NotificationService>>;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGithub = {
      isGhInstalled: jest.fn().mockResolvedValue(true),
      isAuthenticated: jest.fn().mockResolvedValue(true),
    };

    mockTaskwarrior = {
      isInstalled: jest.fn().mockReturnValue(true),
    };

    mockCalendar = {
      isInstalled: jest.fn().mockResolvedValue(true),
      isAuthenticated: jest.fn().mockResolvedValue(true),
      hasCredentials: jest.fn().mockResolvedValue(true),
      getCredentialsPath: jest.fn().mockReturnValue('/tmp/fake-creds'),
    };

    mockConfig = {
      getOracleConfig: jest.fn().mockReturnValue({ pollIntervalSeconds: 300 }),
    };

    mockMempalace = {
      isInitialized: jest.fn().mockReturnValue(true),
    };

    mockNotification = {
      isInstalled: jest.fn().mockResolvedValue(true),
    };

    mockSpawnSync.mockReturnValue({ exitCode: 0 });
    mockSpawn.mockReset();

    service = new DependencyService(
      mockGithub as GithubService,
      mockTaskwarrior as TaskwarriorService,
      mockCalendar as CalendarService,
      mockConfig as ConfigService,
      mockMempalace as MempalaceService,
      mockNotification as NotificationService,
    );
  });

  describe('Aggregate Failure Handling', () => {
    it('DS-AF-1: should propagate when one async service rejects', async () => {
      mockGithub.isGhInstalled = jest
        .fn()
        .mockRejectedValue(new Error('gh crashed'));

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      await expect(service.checkAll()).rejects.toThrow('gh crashed');
    });

    it('DS-AF-2: should report all-false when everything is missing', async () => {
      mockGithub.isGhInstalled = jest.fn().mockResolvedValue(false);
      mockGithub.isAuthenticated = jest.fn().mockResolvedValue(false);
      mockTaskwarrior.isInstalled = jest.fn().mockReturnValue(false);
      mockCalendar.isInstalled = jest.fn().mockResolvedValue(false);
      mockCalendar.isAuthenticated = jest.fn().mockResolvedValue(false);
      mockCalendar.hasCredentials = jest.fn().mockResolvedValue(false);
      mockMempalace.isInitialized = jest.fn().mockReturnValue(false);
      mockNotification.isInstalled = jest.fn().mockResolvedValue(false);
      mockConfig.getOracleConfig = jest
        .fn()
        .mockReturnValue({ pollIntervalSeconds: 300 });
      mockSpawnSync.mockReturnValue({ exitCode: 1 });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.allGood).toBe(false);
      expect(result.calendarReady).toBe(false);
      expect(result.oracleReady).toBe(false);
      expect(result.notificationsReady).toBe(false);
      expect(result.gh.installed).toBe(false);
      expect(result.gh.authenticated).toBe(false);
      expect(result.task.installed).toBe(false);
      expect(result.notification.installed).toBe(false);
      expect(result.slack.hasTokens).toBe(false);
      expect(result.slack.mempalaceInstalled).toBe(false);
      expect(result.slack.pipxInstalled).toBe(false);
      expect(result.slack.slackAppDetected).toBe(false);
      expect(result.oracleInitialized).toBe(false);
    });

    it('DS-AF-3: should report all-true happy path', async () => {
      mockConfig.getOracleConfig = jest.fn().mockReturnValue({
        pollIntervalSeconds: 300,
        slack: { xoxcToken: 'xoxc-test', xoxdCookie: 'xoxd-test' },
      });
      mockSpawnSync.mockReturnValue({ exitCode: 0 });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.allGood).toBe(true);
      expect(result.calendarReady).toBe(true);
      expect(result.oracleReady).toBe(true);
      expect(result.notificationsReady).toBe(true);
    });
  });

  describe('Package Installation', () => {
    it('DS-PI-1: should succeed for allowed package', async () => {
      const spawnMock = TerminalTestHelper.mockSpawn('', '', 0);
      (globalThis as Record<string, unknown>).Bun = {
        spawnSync: mockSpawnSync,
        spawn: spawnMock,
      };

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.installPipxPackage('mempalace');

      expect(result).toEqual({ success: true });
      expect(spawnMock).toHaveBeenCalledWith(
        ['pipx', 'install', 'mempalace'],
        expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
      );
    });

    it('DS-PI-2: should block disallowed package without spawning', async () => {
      const spawnMock = jest.fn();
      (globalThis as Record<string, unknown>).Bun = {
        spawnSync: mockSpawnSync,
        spawn: spawnMock,
      };

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.installPipxPackage('malicious-pkg');

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/not allowed/);
      expect(spawnMock).not.toHaveBeenCalled();
    });

    it('DS-PI-3: should return error when pipx install fails', async () => {
      const spawnMock = TerminalTestHelper.mockSpawn(
        '',
        'No such package',
        1,
      );
      (globalThis as Record<string, unknown>).Bun = {
        spawnSync: mockSpawnSync,
        spawn: spawnMock,
      };

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.installPipxPackage('mempalace');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No such package');
    });
  });

  describe('Slack Detection', () => {
    it('DS-SD-1: should report hasTokens false when no slack tokens configured', async () => {
      mockConfig.getOracleConfig = jest
        .fn()
        .mockReturnValue({ pollIntervalSeconds: 300 });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.slack.hasTokens).toBe(false);
    });

    it('DS-SD-2: should report hasTokens true when slack tokens present', async () => {
      mockConfig.getOracleConfig = jest.fn().mockReturnValue({
        pollIntervalSeconds: 300,
        slack: { xoxcToken: 'xoxc-test', xoxdCookie: 'xoxd-test' },
      });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.slack.hasTokens).toBe(true);
    });

    it('DS-SD-3: should report slackAppDetected false when neither path exists', async () => {
      mockSpawnSync.mockReturnValue({ exitCode: 1 });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.slack.slackAppDetected).toBe(false);
    });

    it('DS-SD-4: should handle slackAppDetected gracefully when spawn throws', async () => {
      mockSpawnSync.mockImplementation(() => {
        throw new Error('spawn failed');
      });

      service = new DependencyService(
        mockGithub as GithubService,
        mockTaskwarrior as TaskwarriorService,
        mockCalendar as CalendarService,
        mockConfig as ConfigService,
        mockMempalace as MempalaceService,
        mockNotification as NotificationService,
      );

      const result = await service.checkAll();

      expect(result.slack.slackAppDetected).toBe(false);
      expect(result.slack.mempalaceInstalled).toBe(false);
      expect(result.slack.pipxInstalled).toBe(false);
    });
  });

  describe('Platform Instructions', () => {
    it('DS-PL-1: should include non-empty platform-specific install instructions', async () => {
      const result = await service.checkAll();

      expect(result.gh.instructions).toBeTruthy();
      expect(result.gh.instructions.length).toBeGreaterThan(0);

      expect(result.task.instructions).toBeTruthy();
      expect(result.task.instructions.length).toBeGreaterThan(0);

      expect(result.gog.instructions).toBeTruthy();
      expect(result.gog.instructions.length).toBeGreaterThan(0);

      // Instructions should contain recognizable install commands
      const allInstructions = [
        result.gh.instructions,
        result.task.instructions,
        result.gog.instructions,
      ].join(' ');
      expect(allInstructions).toMatch(/brew|apt|http/i);
    });

    it('DS-PL-2: should include correct platform value', async () => {
      const result = await service.checkAll();

      expect(result.platform).toBe(process.platform);
    });
  });
});
