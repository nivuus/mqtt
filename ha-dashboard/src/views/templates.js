// Markdown cards rendered by Home Assistant's template engine (server side,
// pushed live). They show the list attributes the agent publishes, which no
// stock card can lay out. Labels come from the caller's translations.

const cell = (s) => String(s).replace(/\|/g, '\\|');

/**
 * Clients seen on a bridge: name, IP, MAC, vendor. The agent writes
 * 'Unknown' when it cannot name a host or a vendor. Rows are ordered by IP
 * numerically (.24 before .117), not as text.
 */
export function devicesTable(entity, t) {
  return `{% macro known(v) %}{{ v if v and v != 'Unknown' else '—' }}{% endmacro %}{% set devices = state_attr('${entity}', 'devices') or [] %}
{% if devices | count == 0 %}${t('empty.devices')}{% else %}
| ${cell(t('col.name'))} | ${cell(t('col.ip'))} | ${cell(t('col.mac'))} | ${cell(t('col.vendor'))} |
|:--|:--|:--|:--|
{%- set ns = namespace(rows=[]) %}{% for d in devices %}{% set ns.rows = ns.rows + [dict(d, order=d.ip.split('.') | map('int') | list)] %}{% endfor %}
{% for d in ns.rows | sort(attribute='order') -%}
| {{ known(d.hostname) }} | {{ d.ip }} | \`{{ d.mac }}\` | {{ known(d.vendor) }} |
{% endfor %}{% endif %}`;
}

/** Services, open ports and port forwards of one firewalld zone. */
export function zoneRules(zone, t) {
  const list = (entity, attr) => `{% set items = state_attr('${entity}', '${attr}') or [] %}{% if items | count == 0 %}—{% else %}{% for i in items %}\`{{ i }}\` {% endfor %}{% endif %}`;
  const parts = [];
  if (zone.services) parts.push(`**${t('col.services')}**  \n${list(zone.services, 'services')}`);
  if (zone.ports) parts.push(`**${t('col.ports')}**  \n${list(zone.ports, 'ports')}`);
  if (zone.forwards) {
    parts.push(`**${t('col.forwards')}**  \n{% set fw = state_attr('${zone.forwards}', 'forwards') or [] %}{% if fw | count == 0 %}—{% else %}
| ${cell(t('col.port'))} | ${cell(t('col.protocol'))} | ${cell(t('col.destination'))} |
|:--|:--|:--|
{% for f in fw -%}
| {{ f.port }} | {{ f.proto }} | {{ f.toaddr }}:{{ f.toport }} |
{% endfor %}{% endif %}`);
  }
  return parts.join('\n\n');
}

/** Debian packages waiting for an upgrade. */
export function packagesList(entity, t) {
  return `{% set pkgs = state_attr('${entity}', 'packages') or [] %}{% if pkgs | count == 0 %}${t('empty.packages')}{% else %}{% for p in pkgs %}\`{{ p }}\` {% endfor %}{% endif %}`;
}

/** The detail behind each "last security event" sensor. */
export function securityDetails(s, t) {
  const line = (entity, label, fields) => entity && `**${label}**  \n{% set a = states['${entity}'].attributes if states['${entity}'] else {} %}${fields}`;
  return [
    line(s.sshLogin, t('name.lastSsh'), `{{ a.user or '—' }} · {{ a.ip or '—' }} · {{ a.method or '—' }}`),
    line(s.fail2ban, t('name.lastBan'), `{{ a.ip or '—' }}`),
    line(s.virus, t('name.lastVirus'), `{{ a.virus_name or '—' }}  \n\`{{ a.file or '—' }}\``),
    line(s.syslogError, t('name.lastSyslogError'), `{{ (a.message or '—') | truncate(200) }}`),
    line(s.event, t('name.lastEvent'), `{{ a.type or '—' }} · {{ a.unit or '' }} {{ a.result or '' }}`),
  ].filter(Boolean).join('\n\n');
}
