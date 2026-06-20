import { ProjectService } from '../../src/modules/project.service';
import type { ConfigService } from '../../src/modules/config.service';
import type { TaskwarriorService } from '../../src/modules/taskwarrior.service';

function makeService(opts: { persisted: string[]; live: string[] }): {
  service: ProjectService;
  store: string[];
} {
  const store = [...opts.persisted];
  const config = {
    getPersistedProjects: () => store,
    addPersistedProject: (name: string) => {
      if (!store.includes(name)) store.push(name);
    },
    removePersistedProject: (name: string) => {
      const idx = store.indexOf(name);
      if (idx >= 0) store.splice(idx, 1);
    },
  } as unknown as ConfigService;
  const tw = {
    getProjects: () => opts.live,
  } as unknown as TaskwarriorService;
  return { service: new ProjectService(config, tw), store };
}

describe('ProjectService', () => {
  it('getAllProjects returns the deduped, sorted union of persisted + live', () => {
    const { service } = makeService({
      persisted: ['Work', 'Archived'],
      live: ['Work', 'Home'],
    });
    expect(service.getAllProjects()).toEqual(['Archived', 'Home', 'Work']);
  });

  it('getAllProjects keeps a persisted project with no live tasks (survives archival)', () => {
    const { service } = makeService({ persisted: ['Orphan'], live: [] });
    expect(service.getAllProjects()).toEqual(['Orphan']);
  });

  it('addProject persists a new name', () => {
    const { service, store } = makeService({ persisted: [], live: [] });
    service.addProject('Work');
    expect(store).toEqual(['Work']);
  });

  it('addProject ignores empty / whitespace-only names', () => {
    const { service, store } = makeService({ persisted: [], live: [] });
    service.addProject('');
    service.addProject('   ');
    expect(store).toEqual([]);
  });

  it('addProject trims surrounding whitespace before persisting', () => {
    const { service, store } = makeService({ persisted: [], live: [] });
    service.addProject('  Work  ');
    expect(store).toEqual(['Work']);
  });

  it('removeProject removes the name from persistence', () => {
    const { service, store } = makeService({
      persisted: ['Work', 'Home'],
      live: [],
    });
    service.removeProject('Work');
    expect(store).toEqual(['Home']);
  });
});
