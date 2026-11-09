// src/websocket/wizard/rootFile.ts

import * as fs from 'fs';
import { execute_argv } from '../../utils/exec';

/**
 * Atomically replace a root-owned file: write a temp file via fs (no shell),
 * back up the original, then move the temp into place with sudo.
 */
export async function writeRootFile(targetPath: string, content: string, mode: number = 0o644): Promise<void> {
  const tempFile = `/tmp/nivuus_wizard_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  fs.writeFileSync(tempFile, content, { mode });
  await execute_argv('sudo', ['cp', targetPath, `${targetPath}.backup`]);
  await execute_argv('sudo', ['mv', tempFile, targetPath]);
}
