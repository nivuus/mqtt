// src/features/updates/DockerHelper.ts

import { execute_argv } from '../../utils/exec';
import logger from '../../utils/logger';
import https from 'https';
import http from 'http';

export interface ContainerInfo {
  id: string;
  name: string;
  serviceName: string;
  image: string;
  imageId: string;
  composeFiles: string[];
  envFiles: string[];
  projectName: string;
  workingDir: string;
  composeService: string;
  installedVersion: string;
  sourceUrl: string;
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  newVersion: string;
  pullOutput: string;
}

export interface ChangelogResult {
  releaseSummary: string;
  releaseUrl: string;
}

/**
 * Lists running Docker containers with the watchtower enable label.
 */
export async function listWatchtowerContainers(): Promise<ContainerInfo[]> {
  const format = '{{.ID}}|{{.Names}}|{{.Image}}';
  const result = await execute_argv('docker', [
    'ps', '--filter', 'label=com.centurylinklabs.watchtower.enable=true', '--format', format,
  ]);

  if (result.exitCode !== 0 || !result.stdout.trim()) return [];

  const containers: ContainerInfo[] = [];

  for (const line of result.stdout.trim().split('\n')) {
    const [id, name, image] = line.split('|');
    if (!id || !name) continue;

    const info = await inspectContainer(id, name, image);
    if (info) containers.push(info);
  }

  return containers;
}

async function inspectContainer(id: string, name: string, image: string): Promise<ContainerInfo | null> {
  const format = [
    '{{index .Config.Labels "com.docker.compose.service"}}',
    '{{index .Config.Labels "com.docker.compose.project"}}',
    '{{index .Config.Labels "com.docker.compose.project.working_dir"}}',
    '{{index .Config.Labels "com.docker.compose.project.environment_file"}}',
    '{{index .Config.Labels "com.docker.compose.project.config_files"}}',
    '{{index .Config.Labels "org.opencontainers.image.version"}}',
    '{{index .Config.Labels "org.opencontainers.image.source"}}',
    '{{.Image}}',
    '{{.Config.Image}}',
  ].join('|');

  const result = await execute_argv('docker', ['inspect', '--format', format, id]);
  if (result.exitCode !== 0 || !result.stdout.trim()) return null;

  const parts = result.stdout.trim().split('|');
  const composeService = parts[0] || name;
  const projectName = parts[1] || '';
  const workingDir = parts[2] || '';
  const envFiles = splitLabelList(parts[3] || '');
  const composeFiles = splitLabelList(parts[4] || '');
  const version = parts[5] || '';
  const sourceUrl = parts[6] || '';
  const imageId = parts[7] || '';
  const configImage = parts[8] || ''; // Full image name from Config.Image

  // Use Config.Image (e.g. "linuxserver/plex:latest") instead of docker ps Image
  // which can show a short hash when the tag has moved
  const resolvedImage = configImage || image;

  return {
    id,
    name,
    serviceName: composeService,
    image: resolvedImage,
    imageId,
    composeFiles,
    envFiles,
    projectName,
    workingDir,
    composeService,
    installedVersion: version || imageId.substring(7, 19), // Fallback to short digest
    sourceUrl,
  };
}

/**
 * Splits a comma-separated compose label (config_files, environment_file)
 * into its entries, preserving label order. An absent or empty label yields
 * an empty array rather than `['']`.
 */
function splitLabelList(value: string): string[] {
  return value ? value.split(',').filter(Boolean) : [];
}

/**
 * Pulls the latest image and checks if an update is available by comparing
 * the running container's image ID with the latest pulled image ID.
 */
export async function checkContainerUpdate(container: ContainerInfo): Promise<UpdateCheckResult> {
  const result = await execute_argv('docker', ['pull', container.image], { timeoutMs: 300000 });
  const output = result.stdout + result.stderr;

  if (result.exitCode !== 0 && !/Status:/i.test(output)) {
    logger.warn(`Docker pull failed for ${container.image}: ${output}`);
    return { hasUpdate: false, newVersion: container.installedVersion, pullOutput: output };
  }

  // Compare the running container's image ID with the latest local image ID
  const latestImageId = await getImageId(container.image);
  if (latestImageId && latestImageId !== container.imageId) {
    const newVersion = await getImageVersion(container.image);
    return {
      hasUpdate: true,
      newVersion: newVersion || 'new',
      pullOutput: output,
    };
  }

  return { hasUpdate: false, newVersion: container.installedVersion, pullOutput: output };
}

/**
 * Gets the full image ID (sha256:...) of a local image.
 */
async function getImageId(image: string): Promise<string> {
  const result = await execute_argv('docker', ['inspect', '--format', '{{.Id}}', image]);
  return result.exitCode === 0 ? result.stdout.trim() : '';
}

/**
 * Reads the version label from a pulled image (not a running container).
 */
async function getImageVersion(image: string): Promise<string> {
  const result = await execute_argv('docker', [
    'inspect', '--format', '{{index .Config.Labels "org.opencontainers.image.version"}}', image,
  ]);
  const version = result.stdout.trim();
  return version && version !== '<no value>' ? version : '';
}

/**
 * Fetches changelog from GitHub releases API.
 */
export async function fetchChangelog(sourceUrl: string): Promise<ChangelogResult> {
  const empty: ChangelogResult = { releaseSummary: '', releaseUrl: '' };
  if (!sourceUrl) return empty;

  // Extract owner/repo from GitHub URL
  const match = sourceUrl.match(/github\.com\/([^/]+\/[^/]+)/);
  if (!match) return empty;

  const ownerRepo = match[1].replace(/\.git$/, '');
  const releaseUrl = `https://github.com/${ownerRepo}/releases`;

  try {
    const apiUrl = `https://api.github.com/repos/${ownerRepo}/releases/latest`;
    const body = await httpGet(apiUrl);
    const data = JSON.parse(body);

    if (data.body) {
      return { releaseSummary: data.body, releaseUrl };
    }
  } catch (error: any) {
    logger.debug(`Failed to fetch changelog for ${ownerRepo}: ${error.message}`);
  }

  return { releaseSummary: '', releaseUrl };
}

/**
 * Builds the `docker compose` argv prefix that replays a container's original
 * invocation, from its compose labels: project name, working directory,
 * every env file and every compose file, in label order.
 *
 * An explicit `-f` makes compose ignore every other file, including a
 * `COMPOSE_FILE` the project sets in its own `.env` — passing only the first
 * config_files entry (the previous behaviour) silently dropped every overlay
 * a project layered on top of its base compose file. Replaying the full
 * argv is what every compose invocation below (pull, up, config, ps,
 * restart) must share, so this is the single place that builds it.
 */
function buildComposeBaseArgv(container: ContainerInfo): string[] {
  const argv: string[] = ['compose'];

  if (container.projectName) {
    argv.push('-p', container.projectName);
  }
  if (container.workingDir) {
    argv.push('--project-directory', container.workingDir);
  }
  for (const envFile of container.envFiles) {
    argv.push('--env-file', envFile);
  }
  for (const composeFile of container.composeFiles) {
    argv.push('-f', composeFile);
  }

  return argv;
}

/**
 * Recreates a container via docker compose, then restarts dependent services.
 */
export async function updateContainer(container: ContainerInfo): Promise<boolean> {
  if (container.composeFiles.length === 0 || !container.composeService) {
    logger.error(`Cannot update ${container.name}: missing compose info`);
    return false;
  }

  const baseArgv = buildComposeBaseArgv(container);

  // Pull the service image via compose
  const pullResult = await execute_argv('docker', [
    ...baseArgv, 'pull', container.composeService,
  ], { timeoutMs: 300000 });
  if (pullResult.exitCode !== 0) {
    logger.error(`Failed to pull ${container.composeService}: ${pullResult.stderr}`);
    return false;
  }

  // `up -d` alone also (re)starts a container that was deliberately left
  // stopped (e.g. a Tdarr node paused by the console VM's libvirt hooks), so
  // the recreate must replay the container's own running state instead of
  // assuming it should end up started. `--no-deps` keeps it from also
  // converging every dependency, which previously produced a burst of
  // concurrent `up` commands and "container name already in use" conflicts.
  //
  // When that state can't be read at all (daemon busy, permission error,
  // transient failure, or an answer that is neither "true" nor "false"),
  // guessing "stopped" would leave a container that was actually running
  // stopped right after the pull, with nothing logged. So this aborts
  // instead of guessing: the pulled image stays unused until the next
  // attempt, same as any other failed step in this function.
  const wasRunning = await isContainerRunning(container.id);
  if (wasRunning === null) {
    logger.error(`Cannot recreate ${container.name}: unable to read its running state`);
    return false;
  }

  const upArgs = wasRunning
    ? [...baseArgv, 'up', '-d', '--no-deps', container.composeService]
    : [...baseArgv, 'up', '--no-start', '--no-deps', container.composeService];

  const upResult = await execute_argv('docker', upArgs, { timeoutMs: 300000 });
  if (upResult.exitCode !== 0) {
    logger.error(`Failed to recreate ${container.composeService}: ${upResult.stderr}`);
    return false;
  }

  logger.info(`Successfully updated container ${container.name}`);

  // Only restart dependents that were already running: compose `restart`
  // also starts stopped services, which would undo an intentional stop.
  const dependents = await getDependentServices(baseArgv, container.composeService);
  const runningDependents = await filterRunningServices(baseArgv, dependents);
  if (runningDependents.length > 0) {
    logger.info(`Restarting dependent services: ${runningDependents.join(', ')}`);
    await execute_argv('docker', [
      ...baseArgv, 'restart', ...runningDependents,
    ], { timeoutMs: 300000 });
  }

  return true;
}

/**
 * Checks whether a container is currently running, so a recreate can replay
 * that state instead of unconditionally starting it. Returns null when the
 * state can't be determined (docker inspect failed, or its output was
 * neither "true" nor "false") -- the caller must treat that as a failure,
 * never as "not running".
 */
async function isContainerRunning(id: string): Promise<boolean | null> {
  const result = await execute_argv('docker', ['inspect', '-f', '{{.State.Running}}', id]);
  if (result.exitCode !== 0) {
    logger.warn(`docker inspect failed for container ${id}: ${result.stderr}`);
    return null;
  }

  const state = result.stdout.trim();
  if (state === 'true') return true;
  if (state === 'false') return false;

  logger.warn(`docker inspect returned an unexpected running state for container ${id}: "${state}"`);
  return null;
}

/**
 * Finds services that depend on the given service in the compose project.
 */
async function getDependentServices(baseArgv: string[], serviceName: string): Promise<string[]> {
  const result = await execute_argv('docker', [...baseArgv, 'config', '--format', 'json']);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];

  try {
    const config = JSON.parse(result.stdout);
    const dependents: string[] = [];

    for (const [name, service] of Object.entries(config.services || {})) {
      const deps = (service as any).depends_on;
      if (!deps) continue;

      // depends_on can be an array or an object
      const depNames = Array.isArray(deps) ? deps : Object.keys(deps);
      if (depNames.includes(serviceName)) {
        dependents.push(name);
      }
    }

    return dependents;
  } catch (error: any) {
    logger.warn(`Failed to parse compose config: ${error.message}`);
    return [];
  }
}

/**
 * Narrows a list of service names down to the ones currently running, so a
 * stopped dependent (e.g. paused on purpose) is never restarted.
 */
async function filterRunningServices(baseArgv: string[], services: string[]): Promise<string[]> {
  if (services.length === 0) return [];

  const result = await execute_argv('docker', [...baseArgv, 'ps', '--services', '--status', 'running']);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];

  const running = new Set(result.stdout.trim().split('\n').map(line => line.trim()).filter(Boolean));
  return services.filter(service => running.has(service));
}

function httpGet(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const req = client.get(url, { headers: { 'User-Agent': 'NivuusAgent/1.0' } }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpGet(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode && res.statusCode >= 400) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => resolve(data));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}
