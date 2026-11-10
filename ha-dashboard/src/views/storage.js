// "Storage": filesystems by mount point, then each disk's health and I/O.

import { heading, tile, gaugeTile, trendTile, section, view } from '../cards.js';

export function storage(m, t) {
  const s = m.storage;
  return view('storage', t('view.storage'), 'mdi:harddisk', [
    section([
      heading(t('section.filesystems'), 'mdi:folder-multiple'),
      ...s.filesystems.flatMap((fs) => [
        gaugeTile(fs.usage, { name: fs.mount, icon: 'mdi:folder' }),
        tile(fs.available, { name: t('name.freeOn', { mount: fs.mount }) }),
      ]),
    ], { column_span: 2 }),
    section([
      heading(t('section.hardware'), 'mdi:alert-octagon-outline'),
      tile(s.hardwareErrors, { name: t('name.hardwareErrors') }),
    ]),
    ...s.disks.map((d) => disk(d, t)),
    windowsDisk(s.windowsDisk, t),
  ]);
}

function disk(d, t) {
  return section([
    heading(t.disk(d.name), 'mdi:harddisk'),
    tile(d.health, { name: t('name.smart') }),
    trendTile(d.read, { name: t('name.read') }, 6),
    trendTile(d.write, { name: t('name.write') }, 6),
    tile(d.totalRead, { name: t('name.totalRead') }),
    tile(d.totalWritten, { name: t('name.totalWritten') }),
  ]);
}

function windowsDisk(w, t) {
  return section([
    heading(t('section.windowsDisk'), 'mdi:microsoft-windows'),
    gaugeTile(w.usage, { name: t('name.usage') }),
    tile(w.available, { name: t('name.free') }),
    tile(w.read, { name: t('name.read') }),
    tile(w.write, { name: t('name.write') }),
  ]);
}
