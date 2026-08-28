// src/homeassistant/discovery/discoveryTopic.ts
//
// Home Assistant matches every discovery topic against
//   (?P<component>\w+)/(?:(?P<node_id>[a-zA-Z0-9_-]+)/)?(?P<object_id>[a-zA-Z0-9_-]+)/config
// (homeassistant/components/mqtt/discovery.py, TOPIC_MATCHER; documented at
// https://www.home-assistant.io/integrations/mqtt/#discovery-topic). A message
// on any other topic is dropped with "Received message on illegal discovery
// topic" — a SILENT failure for the agent: the broker accepts the publish, HA
// discards it, and the entity never appears.
//
// Object ids often carry a raw system value — a firewalld zone
// ("internal (default)"), a VLAN interface ("enp6s0.835"), a disk or room name
// written in any script. Mapping them onto [a-zA-Z0-9_-] must not merge two
// distinct values into one id, or one entity silently overwrites the other.

import { createHash } from 'crypto';

const LEGAL_SEGMENT = /^[a-zA-Z0-9_-]+$/;
const ILLEGAL_CHAR = /[^a-zA-Z0-9_-]/g;
const COMBINING_MARK = /\p{M}/gu;
// 32 bits of SHA-256: collision odds are negligible for the few hundred
// entities a single agent publishes, and the id stays short enough to read.
const DIGEST_LENGTH = 8;

/**
 * Turn any string into a legal discovery topic segment.
 *
 * - A value that is already legal is returned unchanged, so entities that
 *   Home Assistant has registered keep their unique_id.
 * - Any other value gets a readable part (compatibility-decomposed, combining
 *   marks dropped so "Système" reads "Systeme", every remaining illegal
 *   character replaced by "_") followed by a digest of the ORIGINAL value. The
 *   readable part is lossy — two names in a non-Latin script of the same length
 *   read the same — and the digest is what keeps distinct inputs distinct.
 */
export function toTopicSegment(value: string): string {
  if (LEGAL_SEGMENT.test(value)) return value;
  const readable = value
    .normalize('NFKD')
    .replace(COMBINING_MARK, '')
    .replace(ILLEGAL_CHAR, '_');
  const digest = createHash('sha256').update(value, 'utf8').digest('hex').slice(0, DIGEST_LENGTH);
  return readable.length > 0 ? `${readable}_${digest}` : digest;
}

/** Build the retained config topic for one entity, with both ids made legal. */
export function discoveryTopic(component: string, nodeId: string, objectId: string): string {
  return `homeassistant/${component}/${toTopicSegment(nodeId)}/${toTopicSegment(objectId)}/config`;
}
