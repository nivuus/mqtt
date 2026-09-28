// src/features/updates/__tests__/DockerHelper.test.ts

import * as execModule from '../../../utils/exec';
import { listWatchtowerContainers, updateContainer, ContainerInfo } from '../DockerHelper';
import logger from '../../../utils/logger';

jest.mock('../../../utils/exec');

const mockedExec = execModule as jest.Mocked<typeof execModule>;

interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function ok(stdout: string = ''): CommandResult {
  return { stdout, stderr: '', exitCode: 0 };
}

// The compose flags that take a value, so the routing helper below can skip
// past them to find the actual subcommand (pull/up/config/ps/restart).
const COMPOSE_FLAGS_WITH_VALUE = new Set(['-p', '--project-directory', '--env-file', '-f']);

/**
 * Finds the compose subcommand in an argv built by the base-argv builder
 * (e.g. ['compose', '-p', 'x', '-f', 'a.yml', 'up', '-d', ...] -> 'up'),
 * so assertions don't depend on how many -f/--env-file flags precede it.
 */
function composeSubcommand(args: string[]): string | undefined {
  if (args[0] !== 'compose') return undefined;
  let i = 1;
  while (i < args.length) {
    const token = args[i];
    if (COMPOSE_FLAGS_WITH_VALUE.has(token)) {
      i += 2;
      continue;
    }
    return token;
  }
  return undefined;
}

interface Routing {
  psWatchtower?: string; // stdout for the top-level `docker ps --filter ...`
  inspectLabels?: string; // stdout for `docker inspect --format <labels> <id>`
  running?: boolean; // shorthand for serviceStates: 'running' or 'exited'
  serviceStates?: string; // stdout for the state lookup `docker ps -a --filter <compose labels> --format {{.State}}`
  stateLookupResult?: CommandResult; // overrides the state lookup with an arbitrary result (failure)
  staleIds?: string[]; // container ids that no longer exist: any `docker inspect` naming one fails
  configJson?: string; // stdout for `compose ... config --format json`
  runningServices?: string; // stdout for `compose ... ps --services --status running`
  restartResult?: CommandResult; // result of `compose ... restart ...` (default: success)
}

/**
 * Builds an execute_argv implementation that answers each call shape used by
 * DockerHelper, so each test only has to say what matters for that scenario.
 */
function routeExecuteArgv(routing: Routing) {
  return async (file: string, args: string[]): Promise<CommandResult> => {
    if (file !== 'docker') return ok();

    if (args[0] === 'ps' && args[1] === '-a') {
      if (routing.stateLookupResult) return routing.stateLookupResult;
      return ok(routing.serviceStates ?? (routing.running ? 'running' : 'exited'));
    }
    if (args[0] === 'ps') {
      return ok(routing.psWatchtower ?? '');
    }
    const staleId = args[0] === 'inspect' ? routing.staleIds?.find(id => args.includes(id)) : undefined;
    if (staleId) {
      return { stdout: '', stderr: `Error: No such object: ${staleId}`, exitCode: 1 };
    }
    if (args[0] === 'inspect' && args[1] === '--format') {
      return ok(routing.inspectLabels ?? '');
    }

    const sub = composeSubcommand(args);
    if (sub === 'config') {
      return ok(routing.configJson ?? '{"services": {}}');
    }
    if (sub === 'ps') {
      return ok(routing.runningServices ?? '');
    }
    if (sub === 'restart' && routing.restartResult) {
      return routing.restartResult;
    }

    // pull, up, restart: generic success.
    return ok();
  };
}

function findCall(predicate: (args: string[]) => boolean): string[] | undefined {
  const call = mockedExec.execute_argv.mock.calls.find(
    ([file, args]) => file === 'docker' && predicate(args as string[])
  );
  return call ? (call[1] as string[]) : undefined;
}

function buildContainer(overrides: Partial<ContainerInfo> = {}): ContainerInfo {
  return {
    id: 'abc123',
    name: 'mediamanager-plex-1',
    serviceName: 'plex',
    image: 'lscr.io/linuxserver/plex:latest',
    imageId: 'sha256:deadbeef',
    composeFiles: ['docker-compose.yml'],
    envFiles: [],
    projectName: 'mediamanager',
    workingDir: '/stack',
    composeService: 'plex',
    installedVersion: '1.0.0',
    sourceUrl: '',
    ...overrides,
  };
}

describe('DockerHelper', () => {
  beforeEach(() => {
    // Pristine test output: every log line goes to a silent spy. A test that
    // asserts on a log reads the same spy (jest.spyOn returns the existing mock).
    jest.spyOn(logger, 'debug').mockImplementation(() => {});
    jest.spyOn(logger, 'info').mockImplementation(() => {});
    jest.spyOn(logger, 'warn').mockImplementation(() => {});
    jest.spyOn(logger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('replaying the compose invocation from labels', () => {
    it('carries -p, --project-directory, --env-file and both -f (in label order) on pull, up and config', async () => {
      const id = 'abc123';
      const psLine = `${id}|mediamanager-plex-1|lscr.io/linuxserver/plex:latest`;
      const labelsLine = [
        'plex', // com.docker.compose.service
        'mediamanager', // com.docker.compose.project
        '/opt/nivuus/media-manager/stack', // com.docker.compose.project.working_dir
        '/opt/nivuus/media-manager/stack/.env', // com.docker.compose.project.environment_file
        '/opt/nivuus/media-manager/stack/docker-compose.yml,/opt/nivuus/media-manager/stack/docker-compose.qsv.yml', // config_files
        '1.41.3.9314-b8b6d8e14', // org.opencontainers.image.version
        'https://github.com/linuxserver/docker-plex', // org.opencontainers.image.source
        'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', // .Image
        'lscr.io/linuxserver/plex:latest', // .Config.Image
      ].join('|');

      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        psWatchtower: psLine,
        inspectLabels: labelsLine,
        running: true,
        configJson: '{"services": {}}',
      }));

      const [container] = await listWatchtowerContainers();
      expect(container.composeFiles).toEqual([
        '/opt/nivuus/media-manager/stack/docker-compose.yml',
        '/opt/nivuus/media-manager/stack/docker-compose.qsv.yml',
      ]);
      expect(container.envFiles).toEqual(['/opt/nivuus/media-manager/stack/.env']);
      expect(container.projectName).toBe('mediamanager');
      expect(container.workingDir).toBe('/opt/nivuus/media-manager/stack');

      const success = await updateContainer(container);
      expect(success).toBe(true);

      const expectedBase = [
        'compose',
        '-p', 'mediamanager',
        '--project-directory', '/opt/nivuus/media-manager/stack',
        '--env-file', '/opt/nivuus/media-manager/stack/.env',
        '-f', '/opt/nivuus/media-manager/stack/docker-compose.yml',
        '-f', '/opt/nivuus/media-manager/stack/docker-compose.qsv.yml',
      ];

      expect(findCall(args => composeSubcommand(args) === 'pull')).toEqual([...expectedBase, 'pull', 'plex']);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual([...expectedBase, 'up', '-d', '--no-deps', 'plex']);
      expect(findCall(args => composeSubcommand(args) === 'config')).toEqual([...expectedBase, 'config', '--format', 'json']);
    });

    it('still works with a single compose-file label and no env file', async () => {
      const container = buildContainer(); // composeFiles: ['docker-compose.yml'], envFiles: []
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: true, configJson: '{"services": {}}' }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'pull')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'pull', 'plex',
      ]);
    });
  });

  describe('recreating without changing whether the container is running', () => {
    it('recreates a running container with `up -d --no-deps <service>`', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: true, configJson: '{"services": {}}' }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'up', '-d', '--no-deps', 'plex',
      ]);
    });

    it('recreates a stopped container with `up --no-start --no-deps <service>` and never restarts it back on', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: false, configJson: '{"services": {}}' }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'up', '--no-start', '--no-deps', 'plex',
      ]);
      expect(findCall(args => composeSubcommand(args) === 'restart')).toBeUndefined();
    });

  });

  describe('reading the running state from compose labels', () => {
    it('looks the state up by compose project and service labels, never by the cached container id', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: true }));

      await updateContainer(container);

      expect(findCall(args => args[0] === 'ps' && args[1] === '-a')).toEqual([
        'ps', '-a',
        '--filter', 'label=com.docker.compose.project=mediamanager',
        '--filter', 'label=com.docker.compose.service=plex',
        '--format', '{{.State}}',
      ]);
      expect(findCall(args => args.includes(container.id))).toBeUndefined();
    });

    it('recreates a container that was recreated since the last check, whose cached id no longer exists', async () => {
      const container = buildContainer({ id: 'gone42' });
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: true, staleIds: ['gone42'] }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual(expect.arrayContaining(['up', '-d', '--no-deps', 'plex']));
    });

    // Split the way docker itself sets State.Running, which is the answer the
    // recreate replays: a restarting or paused container still counts as running.
    it.each(['running', 'restarting', 'paused'])('recreates a "%s" container started (`up -d`)', async state => {
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ serviceStates: state }));

      expect(await updateContainer(buildContainer())).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual(expect.arrayContaining(['up', '-d', '--no-deps', 'plex']));
    });

    it.each(['created', 'exited', 'dead', 'removing'])('recreates a "%s" container left stopped (`up --no-start`)', async state => {
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ serviceStates: state }));

      expect(await updateContainer(buildContainer())).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual(expect.arrayContaining(['up', '--no-start', '--no-deps', 'plex']));
    });

    it('recreates started when every replica of the service is running', async () => {
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ serviceStates: 'running\nrunning\n' }));

      expect(await updateContainer(buildContainer())).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'up')).toEqual(expect.arrayContaining(['up', '-d', '--no-deps', 'plex']));
    });

    // In every case below the image is already pulled; only the recreate is
    // skipped, so a running container is never guessed into "stopped" and
    // left down, and a stopped one is never guessed into "running".
    it.each<[string, Routing]>([
      ['no container matches the labels', { serviceStates: '' }],
      ['docker ps fails', { stateLookupResult: { stdout: '', stderr: 'Cannot connect to the Docker daemon', exitCode: 1 } }],
      ['docker ps answers a state docker does not define', { serviceStates: '<no value>' }],
      ['the replicas disagree, some running and some stopped', { serviceStates: 'running\nexited' }],
    ])('aborts without recreating when %s', async (_case, routing) => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv(routing));

      const success = await updateContainer(container);

      expect(findCall(args => composeSubcommand(args) === 'pull')).toBeDefined();
      expect(success).toBe(false);
      expect(findCall(args => composeSubcommand(args) === 'up')).toBeUndefined();
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining(container.name));
    });
  });

  describe('restarting dependents', () => {
    // plex has two dependents; only tautulli is running.
    const PLEX_WITH_DEPENDENTS = JSON.stringify({
      services: {
        plex: {},
        tautulli: { depends_on: ['plex'] },
        tdarr: { depends_on: ['plex'] },
      },
    });

    it('restarts only the dependent that is running, never the stopped one, and nothing that depends on it', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        running: true,
        configJson: PLEX_WITH_DEPENDENTS,
        runningServices: 'tautulli',
      }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'ps')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'ps', '--services', '--status', 'running',
      ]);
      // Without --no-deps, compose would also restart -- and start -- the
      // services declaring `depends_on: {tautulli: {restart: true}}`.
      expect(findCall(args => composeSubcommand(args) === 'restart')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'restart', '--no-deps', 'tautulli',
      ]);
    });

    it('leaves the dependents alone when the updated container was left stopped', async () => {
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        running: false,
        configJson: PLEX_WITH_DEPENDENTS,
        runningServices: 'tautulli',
      }));

      expect(await updateContainer(buildContainer())).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'restart')).toBeUndefined();
    });

    it('says so in the success log when the container was left stopped, and only then', async () => {
      const container = buildContainer();
      const leftStoppedLog = expect.stringMatching(new RegExp(`${container.name}.*left stopped`));

      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: false }));
      await updateContainer(container);
      expect(logger.info).toHaveBeenCalledWith(leftStoppedLog);

      jest.mocked(logger.info).mockClear();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({ running: true }));
      await updateContainer(container);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining(`Successfully updated container ${container.name}`));
      expect(logger.info).not.toHaveBeenCalledWith(leftStoppedLog);
    });

    it('logs an error with stderr when restarting the dependents fails, and still reports the container updated', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        running: true,
        configJson: PLEX_WITH_DEPENDENTS,
        runningServices: 'tautulli',
        restartResult: { stdout: '', stderr: 'Error response from daemon: Cannot restart container', exitCode: 1 },
      }));

      const success = await updateContainer(container);

      // The container itself was recreated on the new image: reporting a
      // failed update would keep offering an update that is already installed.
      expect(success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(expect.stringMatching(
        new RegExp(`${container.name}.*tautulli.*Cannot restart container`)
      ));
    });

    it('issues no restart command when no dependent is running', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        running: true,
        configJson: JSON.stringify({
          services: {
            plex: {},
            tdarr: { depends_on: ['plex'] },
          },
        }),
        runningServices: '',
      }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'restart')).toBeUndefined();
    });
  });

  describe('guard clause', () => {
    it('refuses to update a container with no compose config_files label', async () => {
      const container = buildContainer({ composeFiles: [] });
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({}));

      const success = await updateContainer(container);

      expect(success).toBe(false);
      expect(mockedExec.execute_argv).not.toHaveBeenCalled();
    });
  });
});
