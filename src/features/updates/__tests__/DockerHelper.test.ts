// src/features/updates/__tests__/DockerHelper.test.ts

import * as execModule from '../../../utils/exec';
import { listWatchtowerContainers, updateContainer, ContainerInfo } from '../DockerHelper';

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
  running?: boolean; // for `docker inspect -f '{{.State.Running}}' <id>`
  configJson?: string; // stdout for `compose ... config --format json`
  runningServices?: string; // stdout for `compose ... ps --services --status running`
}

/**
 * Builds an execute_argv implementation that answers each call shape used by
 * DockerHelper, so each test only has to say what matters for that scenario.
 */
function routeExecuteArgv(routing: Routing) {
  return async (file: string, args: string[]): Promise<CommandResult> => {
    if (file !== 'docker') return ok();

    if (args[0] === 'ps') {
      return ok(routing.psWatchtower ?? '');
    }
    if (args[0] === 'inspect' && args[1] === '--format') {
      return ok(routing.inspectLabels ?? '');
    }
    if (args[0] === 'inspect' && args[1] === '-f') {
      return ok(routing.running ? 'true' : 'false');
    }

    const sub = composeSubcommand(args);
    if (sub === 'config') {
      return ok(routing.configJson ?? '{"services": {}}');
    }
    if (sub === 'ps') {
      return ok(routing.runningServices ?? '');
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

  describe('restarting dependents', () => {
    it('restarts only the dependent that is running, never the stopped one', async () => {
      const container = buildContainer();
      mockedExec.execute_argv.mockImplementation(routeExecuteArgv({
        running: true,
        configJson: JSON.stringify({
          services: {
            plex: {},
            tautulli: { depends_on: ['plex'] },
            tdarr: { depends_on: ['plex'] },
          },
        }),
        runningServices: 'tautulli',
      }));

      const success = await updateContainer(container);

      expect(success).toBe(true);
      expect(findCall(args => composeSubcommand(args) === 'ps')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'ps', '--services', '--status', 'running',
      ]);
      expect(findCall(args => composeSubcommand(args) === 'restart')).toEqual([
        'compose', '-p', 'mediamanager', '--project-directory', '/stack', '-f', 'docker-compose.yml',
        'restart', 'tautulli',
      ]);
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
