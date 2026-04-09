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

  it('slack status includes install instructions', async () => {
    const status = await service.checkAll();
    expect(status.slack.mempalaceInstallInstructions).toBe(
      'pipx install mempalace',
    );
    expect(status.slack.slacktokensInstallInstructions).toBe(
      'pipx install slacktokens',
    );
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
});
