import { DependencyService } from '../src/modules/dependency.service';
import { ConfigService } from '../src/modules/config.service';
import { GithubService } from '../src/modules/github.service';
import { TaskwarriorService } from '../src/modules/taskwarrior.service';
import { CalendarService } from '../src/modules/calendar.service';

// Mock Bun global (tests run under Jest/Node, not Bun runtime)
const mockBun = { spawnSync: jest.fn().mockReturnValue({ exitCode: 1 }) };

(globalThis as Record<string, unknown>).Bun = mockBun;

describe('DependencyService - Oracle checks', () => {
  let service: DependencyService;
  let mockConfigService: jest.Mocked<Partial<ConfigService>>;
  let mockGithubService: jest.Mocked<Partial<GithubService>>;
  let mockTaskwarriorService: jest.Mocked<Partial<TaskwarriorService>>;
  let mockCalendarService: jest.Mocked<Partial<CalendarService>>;

  beforeEach(() => {
    mockConfigService = {
      getOracleConfig: jest.fn().mockReturnValue({ pollIntervalSeconds: 300 }),
    };

    mockGithubService = {
      isGhInstalled: jest.fn().mockResolvedValue(true),
      isAuthenticated: jest.fn().mockResolvedValue(true),
    };

    mockTaskwarriorService = {
      isInstalled: jest.fn().mockReturnValue(true),
    };

    mockCalendarService = {
      isInstalled: jest.fn().mockResolvedValue(true),
      isAuthenticated: jest.fn().mockResolvedValue(true),
      hasCredentials: jest.fn().mockResolvedValue(true),
      getCredentialsPath: jest.fn().mockReturnValue('/tmp/fake-creds'),
    };

    // Reset Bun.spawnSync mock before each test
    mockBun.spawnSync.mockReturnValue({ exitCode: 1 });

    service = new DependencyService(
      mockGithubService as GithubService,
      mockTaskwarriorService as TaskwarriorService,
      mockCalendarService as CalendarService,
      mockConfigService as ConfigService,
    );
  });

  it('oracleReady is false when no slack tokens', async () => {
    const status = await service.checkAll();
    expect(status.slack.hasTokens).toBe(false);
    expect(status.oracleReady).toBe(false);
  });

  it('oracleReady depends on hasTokens and mempalaceInstalled', async () => {
    (mockConfigService.getOracleConfig as jest.Mock).mockReturnValue({
      pollIntervalSeconds: 300,
      slack: {
        xoxcToken: 'xoxc-xxx',
        xoxdCookie: 'xoxd-xxx',
        teamId: 'T123',
        teamName: 'Test',
      },
    });
    const status = await service.checkAll();
    expect(status.oracleReady).toBe(
      status.slack.hasTokens && status.slack.mempalaceInstalled,
    );
  });

  it('slack status includes install instructions for mempalace', async () => {
    const status = await service.checkAll();
    expect(status.slack.mempalaceInstallInstructions).toBe(
      'pipx install mempalace',
    );
    expect(status.slack).not.toHaveProperty('slacktokensInstallInstructions');
  });

  it('slack status includes slackAppDetected field', async () => {
    const status = await service.checkAll();
    expect(status.slack).toHaveProperty('slackAppDetected');
    expect(typeof status.slack.slackAppDetected).toBe('boolean');
  });

  it('slack status includes pipxInstalled field', async () => {
    const status = await service.checkAll();
    expect(status.slack).toHaveProperty('pipxInstalled');
    expect(typeof status.slack.pipxInstalled).toBe('boolean');
  });

  it('slack status includes pipxInstallInstructions', async () => {
    const status = await service.checkAll();
    expect(status.slack.pipxInstallInstructions).toBeTruthy();
  });

  it('existing dependency checks still work alongside oracle checks', async () => {
    const status = await service.checkAll();
    expect(status.gh.installed).toBe(true);
    expect(status.gh.authenticated).toBe(true);
    expect(status.task.installed).toBe(true);
    expect(status.allGood).toBe(true);
    expect(status.calendarReady).toBe(true);
    expect(status.slack).toBeDefined();
    expect(status.oracleReady).toBeDefined();
  });

  describe('installPipxPackage', () => {
    const mockBunSpawn = jest.fn();

    beforeEach(() => {
      (globalThis as Record<string, unknown>).Bun = {
        ...mockBun,
        spawn: mockBunSpawn,
      };
    });

    afterEach(() => {
      (globalThis as Record<string, unknown>).Bun = mockBun;
    });

    it('returns success when pipx install succeeds', async () => {
      mockBunSpawn.mockReturnValue({
        exited: Promise.resolve(0),
        stdout: new ReadableStream(),
        stderr: new ReadableStream(),
      });

      const result = await service.installPipxPackage('mempalace');
      expect(result.success).toBe(true);
      expect(mockBunSpawn).toHaveBeenCalledWith(
        ['pipx', 'install', 'mempalace'],
        expect.objectContaining({ stdout: 'pipe', stderr: 'pipe' }),
      );
    });

    it('returns error when pipx install fails', async () => {
      const errorStream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('Package not found'));
          controller.close();
        },
      });
      mockBunSpawn.mockReturnValue({
        exited: Promise.resolve(1),
        stdout: new ReadableStream(),
        stderr: errorStream,
      });

      const result = await service.installPipxPackage('mempalace');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Package not found');
    });
  });
});
