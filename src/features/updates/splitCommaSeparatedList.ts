// src/features/updates/splitCommaSeparatedList.ts

/**
 * Splits a comma-separated compose value -- a container's config_files /
 * environment_file label (DockerHelper), or a `docker compose ls --format
 * json` project's ConfigFiles field (AptUpdates) -- into its entries,
 * preserving order. Each entry is trimmed, and empty entries (including
 * whitespace-only ones, once trimmed) are dropped; an absent or empty value
 * yields an empty array rather than `['']`.
 */
export function splitCommaSeparatedList(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(',').map(entry => entry.trim()).filter(Boolean);
}
