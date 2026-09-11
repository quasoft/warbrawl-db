/* WarBrawl database viewer.

   Everything is driven by the SECTIONS table below: each section says where its
   rows come from, which columns the table shows, which facets filter it and how
   one row expands into the detail pane. Adding a category to the exporter means
   adding one entry here - no other file changes.

   No framework and no build step on purpose: the whole site is three files plus
   generated data, so it opens from the filesystem as readily as from a host. */

'use strict';

const DB = window.WBDB || {};
const TICK = (DB.config && DB.config.tickRate) || 60;
// A public build ships without frame data or asset paths; every block that shows
// them checks this rather than assuming the fields are there.
const INTERNAL = !!(DB.meta && DB.meta.internal);

/* ---- tiny DOM helpers ---------------------------------------------------- */
function h(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  }
  // flat(Infinity): builders pass arrays of nodes as single arguments, and an
  // un-flattened array would be stringified - an <a> would render as its href.
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

const $ = (id) => document.getElementById(id);
const byKey = (list) => new Map((list || []).map((row) => [row.key, row]));

function indexOf(sectionId, key) {
  const section = SECTION_BY_ID[sectionId];
  return section ? section.index.get(key) : null;
}

/* An internal link that navigates the hash router rather than reloading. It
   carries the target's icon when there is one, so a reference to Bleed looks
   like Bleed wherever it appears. */
function link(sectionId, key, label, className) {
  const target = indexOf(sectionId, key);
  if (!target) return h('span', { class: 'muted' }, label || key || '-');
  return h('a', { class: `ref ${className || ''}`, href: `#${sectionId}/${key}` },
    smallIcon(target.icon), h('span', {}, label || target.name || key));
}

function smallIcon(icon) {
  if (!hasIcon(icon)) return null;
  const node = iconEl(icon);
  node.classList.add('small');
  return node;
}

function hasIcon(icon) {
  return !!(icon && (icon.file || icon.frame));
}

function iconEl(icon, big) {
  const node = h('div', { class: 'icon' + (big ? ' big' : '') });
  if (!hasIcon(icon)) {
    node.classList.add('placeholder');
    node.textContent = '?';
    return node;
  }
  if (icon.frame) {
    // Ability nodes are drawn as a slot background with the icon inset in it,
    // the way the ability screen draws them. Two background layers, art on top.
    const layers = [icon.file && `url("${icon.file}")`, `url("${icon.frame}")`];
    node.style.backgroundImage = layers.filter(Boolean).join(', ');
    node.style.backgroundSize = icon.file ? '58%, 100%' : '100%';
    node.style.backgroundRepeat = 'no-repeat';
    node.style.backgroundPosition = 'center';
    node.classList.add('framed');
    return node;
  }
  if (icon.tint) {
    // Tinted icons are silhouettes the game recolours at runtime; masking keeps
    // that colour instead of baking whatever grey the source texture holds.
    node.style.maskImage = `url("${icon.file}")`;
    node.style.webkitMaskImage = `url("${icon.file}")`;
    node.style.maskSize = node.style.webkitMaskSize = '86%';
    node.style.maskRepeat = node.style.webkitMaskRepeat = 'no-repeat';
    node.style.maskPosition = node.style.webkitMaskPosition = 'center';
    node.style.backgroundColor = icon.tint;
  } else {
    node.style.backgroundImage = `url("${icon.file}")`;
  }
  return node;
}

function nameCell(row) {
  // A blank tile rather than a "?" placeholder: plenty of rows legitimately have
  // no art (light attacks, unfinished trees) and a column of question marks reads
  // as breakage. The tile keeps the names aligned.
  const icon = hasIcon(row.icon)
    ? iconEl(row.icon) : h('div', { class: 'icon blank' });
  return h('div', { class: 'cell-name' }, icon, h('strong', {}, row.name));
}

/* Sidebar glyphs. Flat 24x24 line art drawn inline - one more file to fetch is
   one more thing that can 404 on a static host, and these are ten paths. */
const NAV_ICONS = {
  perks: [['c', [12, 12, 8.2]], ['fc', [12, 12, 3.4]]],
  statuses: [
    ['p', 'M8.4 3.2l1.5 3.9 3.9 1.5-3.9 1.5-1.5 3.9-1.5-3.9L3 8.6l3.9-1.5z'],
    ['p', 'M16.6 13.4l1 2.5 2.5 1-2.5 1-1 2.5-1-2.5-2.5-1 2.5-1z'],
  ],
  labels: [['p', 'M3.6 12.9 12.5 4h7.1v7.1l-8.9 8.9z'], ['c', [16.3, 7.7, 1.2]]],
  abilities: [['p', 'M12 2.8 19.8 7.4v9.2L12 21.2 4.2 16.6V7.4z']],
  trees: [['p', 'M12 5.6v4.2M12 9.8 6.6 14M12 9.8 17.4 14'],
          ['c', [12, 3.8, 1.9]], ['c', [5.4, 15.6, 1.9]], ['c', [18.6, 15.6, 1.9]]],
  attacks: [
    ['c', [12, 12, 6.4]], ['c', [12, 12, 2]],
    ['p', 'M12 2.2v3.2M12 18.6v3.2M2.2 12h3.2M18.6 12h3.2'],
  ],
  weapons: [['p', 'M7 3.2a12.5 12.5 0 0 1 0 17.6'], ['p', 'M7 3.2v17.6'],
            ['p', 'M4 12h12.6M13.4 8.8 16.6 12l-3.2 3.2']],
  gearSlots: [['p', 'M12 3.2 19.2 6v6.1c0 4.2-3.1 7.3-7.2 9.1-4.1-1.8-7.2-4.9-7.2-9.1V6z']],
  damage: [
    ['p', 'M12 3.2v17.6M6.6 20.8h10.8'],
    ['p', 'M4.4 7.4h15.2M7.4 7.4 4.4 13.4h6zM16.6 7.4l3 6h-6z'],
  ],
  config: [
    ['p', 'M3.4 7h7M16 7h4.6M3.4 12h9.6M18.6 12h2M3.4 17h3M11.6 17h9'],
    ['c', [13.2, 7, 2.2]], ['c', [15.8, 12, 2.2]], ['c', [8.8, 17, 2.2]],
  ],
};

/* Inline glyphs used next to values rather than in the sidebar. */
const GLYPHS = {
  // Stacked layers - the usual way a stack count is marked.
  layers: [
    ['p', 'M12 2.6 2.6 7.4 12 12.2l9.4-4.8z'],
    ['p', 'M2.6 12 12 16.8l9.4-4.8'],
    ['p', 'M2.6 16.6 12 21.4l9.4-4.8'],
  ],
};

function glyph(name) {
  const svg = svgIcon(GLYPHS[name]);
  if (svg) svg.classList.add('glyph');
  return svg;
}

/* A stack count with its layers glyph, for a table cell or a detail row. */
function stackCount(count, unit) {
  return h('span', { class: 'stack-count' }, glyph('layers'),
    h('span', {}, `${count}${unit ? ` ${unit}${count === 1 ? '' : 's'}` : ''}`));
}

function navIcon(sectionId) {
  return svgIcon(NAV_ICONS[sectionId]);
}

function svgIcon(spec) {
  if (!spec) return null;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  for (const [kind, value] of spec) {
    if (kind === 'p') {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', value);
      svg.append(path);
    } else {
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', value[0]);
      circle.setAttribute('cy', value[1]);
      circle.setAttribute('r', value[2]);
      if (kind === 'fc') {
        circle.setAttribute('fill', 'currentColor');
        circle.setAttribute('stroke', 'none');
      }
      svg.append(circle);
    }
  }
  return svg;
}

function chips(values, className) {
  return (values || []).map((value) =>
    h('span', { class: 'chip ' + (className || String(value).toLowerCase()) }, value));
}

/* A chip that filters a table instead of navigating: clicking a perk's
   "offense" tag, or a slot in "Equippable in", narrows the list to everything
   that shares it. Clicking the same chip again clears that filter. */
function facetChip(sectionId, facetLabel, value, className, icon) {
  // A chip that carries its own colour class (a tag) never takes the amber
  // active treatment - that colour is information about the tag, not about the
  // filter. The facet bar above the table is where the active filter shows.
  const active = !className
    && SECTION_BY_ID[sectionId] === state.section
    && state.facets[facetLabel] && state.facets[facetLabel].has(value);
  return h('span', {
    class: `chip filter ${icon ? 'ref ' : ''}${className || ''}${active ? ' on' : ''}`,
    title: `Show every entry with ${facetLabel.toLowerCase()}: ${value}`,
    onclick: (event) => { event.stopPropagation(); applyFacet(sectionId, facetLabel, value); },
  }, smallIcon(icon), h('span', {}, value));
}

/* Each exclusive label gets a colour of its own, assigned by position rather
   than by name - a label added later is coloured automatically instead of
   falling back to grey. */
const LABEL_TONE = Object.fromEntries(
  (DB.labels || []).map((label, i) => [label.key, `tone-label${i % 6}`]));
const LABEL_TONE_BY_NAME = Object.fromEntries(
  (DB.labels || []).map((label, i) => [label.name, `tone-label${i % 6}`]));

const SLOT_BY_KEY = Object.fromEntries((DB.gearSlots || []).map((s) => [s.key, s]));
const SLOT_NAME = Object.fromEntries((DB.gearSlots || []).map((s) => [s.key, s.name]));
const tagChips = (row) => (row.tags || []).map((tag) =>
  facetChip('perks', 'Tag', tag, String(tag).toLowerCase()));

function kv(rows) {
  return h('table', { class: 'kv' }, h('tbody', {},
    rows.filter(Boolean).map(([label, value]) =>
      h('tr', {}, h('td', {}, label), h('td', {}, value)))));
}

function block(title, ...content) {
  if (!content.flat(Infinity).filter(Boolean).length) return null;
  return h('div', { class: 'block' }, title && h('h3', {}, title), content);
}

function miniTable(headers, rows) {
  if (!rows.length) return null;
  return h('table', { class: 'mini' },
    h('thead', {}, h('tr', {}, headers.map((label) => h('th', {}, label)))),
    h('tbody', {}, rows.map((cells) => h('tr', {}, cells.map((cell) => h('td', {}, cell))))));
}

const yesNo = (value) => (value ? 'Yes' : 'No');
const dash = (value) => (value === null || value === undefined || value === '' ? '-' : value);
/* Gear perks stack by equipping copies, ability perks by ranking a node up -
   different mechanics, so each names its own unit and only the real stack count
   gets the layers glyph. */
function stackingCell(row) {
  return row.kind === 'Ability perk'
    ? `${row.ranks.length} rank${row.ranks.length === 1 ? '' : 's'}`
    : stackCount(row.stackLimit || 1, 'stack');
}

function stackingSort(row) {
  return row.kind === 'Ability perk' ? row.ranks.length : (row.stackLimit || 1);
}

const seconds = (t) => (t ? `${+(t / TICK).toFixed(2)} sec` : '0 sec');

/* ---- section definitions ------------------------------------------------- */
function configRows() {
  const config = DB.config || {};
  const rows = [];
  const push = (group, label, value) => rows.push({
    key: `${group}-${label}`.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name: label, group, value: String(value),
  });
  push('Catalogue', 'Simulation tick rate', `${config.tickRate} Hz`);
  push('Catalogue', 'Attribute pool', config.attributePool);
  push('Catalogue', 'Attribute maximum', config.attributeMax);
  push('Catalogue', 'Threshold step', config.thresholdStep);
  push('Catalogue', 'Attributes', (config.attributes || []).join(', '));
  (config.statusConfig || []).forEach((row) => push('StatusConfig', row.label, row.value));
  (config.statsConfig || []).forEach((row) => push('StatsConfig', row.label, row.value));
  (config.weightClasses || []).forEach((weight) => {
    push('Weight classes', `${weight.name} armor rating`, weight.armorRating);
    push('Weight classes', `${weight.name} damage factor`, weight.damageFactor);
  });
  return rows;
}

/* Gear perks and ability-tree perks are one catalogue as far as a reader is
   concerned - the same effect vocabulary, reached two different ways - so they
   share a page and the Source facet separates them. */
const ALL_PERKS = [
  ...(DB.perks || []).map((perk) => ({ ...perk, kind: 'Gear perk', origin: perk.source })),
  ...(DB.abilityPerks || []).map((perk) => ({
    ...perk, kind: 'Ability perk', origin: 'Ability tree',
    tags: [], exclusiveLabels: [], slots: [], stackLimit: null,
  })),
];

const SECTIONS = [
  {
    id: 'perks',
    label: 'Perks',
    rows: ALL_PERKS,
    columns: [
      { key: 'name', label: 'Name', get: nameCell, sort: (r) => r.name },
      { key: 'description', label: 'Description', cls: 'wrap-desc', get: (r) => r.description },
      { key: 'origin', label: 'Source', get: (r) => r.origin, sort: (r) => r.origin },
      { key: 'tags', label: 'Tags',
        get: (r) => (r.tags.length ? tagChips(r) : h('span', { class: 'muted' }, '-')),
        sort: (r) => r.tags.join(',') },
      { key: 'trigger', label: 'Trigger', get: (r) => (r.effect ? r.effect.triggerName : '-'),
        sort: (r) => (r.effect ? r.effect.triggerName : '') },
      { key: 'stack', label: 'Stacking', get: stackingCell, sort: stackingSort },
      { key: 'label', label: 'Exclusive label',
        get: (r) => (r.exclusiveLabels.length
          ? r.exclusiveLabels.map((l) => link('labels', l.key, l.name, `chip ${LABEL_TONE[l.key] || ''}`))
          : h('span', { class: 'muted' }, '-')),
        sort: (r) => r.exclusiveLabels.map((l) => l.name).join(',') },
    ],
    facets: [
      { label: 'Source', get: (r) => [r.origin] },
      { label: 'Tag', get: (r) => r.tags, tone: (v) => `tone-${String(v).toLowerCase()}` },
      { label: 'Trigger', get: (r) => (r.effect ? [r.effect.triggerName] : []) },
      { label: 'Exclusive label', get: (r) => r.exclusiveLabels.map((l) => l.name),
        tone: (v) => LABEL_TONE_BY_NAME[v] || '' },
      { label: 'Tree', get: (r) => (r.tree ? [r.tree] : []) },
      { label: 'Scope', get: (r) => (r.scope ? [r.scope] : []) },
      { label: 'Slot', get: (r) => r.slots.map((key) => SLOT_NAME[key]) },
    ],
    detail: (row) => (row.kind === 'Ability perk' ? abilityPerkDetail(row) : perkDetail(row)),
  },
  {
    id: 'statuses',
    label: 'Status effects',
    rows: DB.statuses || [],
    columns: [
      { key: 'name', label: 'Name', get: nameCell, sort: (r) => r.name },
      { key: 'kind', label: 'Kind', get: (r) => r.kind, sort: (r) => r.kind },
      { key: 'axis', label: 'Affects', get: (r) => r.axis, sort: (r) => r.axis },
      { key: 'cap', label: 'Cap', cls: 'num', get: (r) => dash(r.capText), sort: (r) => r.cap || 0 },
      { key: 'stacks', label: 'Max stacks', cls: 'num', get: (r) => dash(r.maxStacks), sort: (r) => r.maxStacks || 0 },
      { key: 'sources', label: 'Sources', cls: 'num', get: (r) => r.appliedBy.length, sort: (r) => r.appliedBy.length },
    ],
    facets: [{ label: 'Kind', get: (r) => [r.kind] }],
    detail: statusDetail,
  },
  {
    id: 'trees',
    label: 'Ability trees',
    rows: DB.trees || [],
    columns: [],
    facets: [],
    custom: treesPage,
    detail: () => null,
  },
  {
    id: 'abilities',
    label: 'Abilities',
    rows: DB.abilities || [],
    columns: [
      { key: 'name', label: 'Name', get: nameCell, sort: (r) => r.name },
      { key: 'tree', label: 'Tree', get: (r) => r.tree, sort: (r) => r.tree },
      { key: 'category', label: 'Category', get: (r) => r.category, sort: (r) => r.category },
      { key: 'rank', label: 'Max rank', cls: 'num', get: (r) => r.maxRank, sort: (r) => r.maxRank },
      { key: 'cost', label: 'Points to max', cls: 'num', get: (r) => r.totalCost, sort: (r) => r.totalCost },
      { key: 'payload', label: 'Payload',
        get: (r) => (r.attack ? link('attacks', r.attack, 'Attack')
          : r.abilityPerk ? link('perks', r.abilityPerk, 'Perk')
          : h('span', { class: 'muted' }, 'none')),
        sort: (r) => (r.attack ? 'attack' : r.abilityPerk ? 'perk' : 'zz') },
    ],
    facets: [
      { label: 'Tree', get: (r) => [r.tree] },
      { label: 'Category', get: (r) => [r.category] },
      { label: 'Equippable', get: (r) => [r.canEquip ? 'Equippable' : 'Passive node'] },
    ],
    detail: abilityDetail,
  },
  {
    id: 'attacks',
    label: 'Attacks',
    rows: DB.attacks || [],
    columns: [
      { key: 'name', label: 'Name', get: nameCell, sort: (r) => r.name },
      { key: 'kind', label: 'Kind', get: (r) => r.kind, sort: (r) => r.kind },
      { key: 'damage', label: 'Damage', cls: 'num', get: (r) => r.damage, sort: (r) => r.damage },
      ...(INTERNAL ? [
        { key: 'windup', label: 'Windup', cls: 'num', get: (r) => r.windupTicks, sort: (r) => r.windupTicks },
        { key: 'active', label: 'Active', cls: 'num', get: (r) => r.activeTicks, sort: (r) => r.activeTicks },
        { key: 'recovery', label: 'Recovery', cls: 'num', get: (r) => r.recoveryTicks, sort: (r) => r.recoveryTicks },
        { key: 'total', label: 'Total', cls: 'num', get: (r) => seconds(r.totalTicks), sort: (r) => r.totalTicks },
      ] : []),
      { key: 'cooldown', label: 'Cooldown', cls: 'num', get: (r) => r.cooldownText, sort: (r) => r.cooldownTicks },
      { key: 'used', label: 'Used by', cls: 'wrap-desc',
        get: (r) => r.usedBy.map((u) => `${u.owner} - ${u.role}`).join('; '),
        sort: (r) => (r.usedBy[0] ? r.usedBy[0].owner : '') },
    ],
    facets: [
      { label: 'Kind', get: (r) => r.kinds },
      { label: 'Owner', get: (r) => [...new Set(r.usedBy.map((u) => u.owner))] },
    ],
    detail: attackDetail,
  },
  {
    id: 'weapons',
    label: 'Weapons',
    rows: DB.weapons || [],
    columns: [
      { key: 'name', label: 'Name', get: nameCell, sort: (r) => r.name },
      { key: 'index', label: 'Index', cls: 'num', get: (r) => r.index, sort: (r) => r.index },
      { key: 'scaling', label: 'Scaling',
        get: (r) => `${r.primaryAttribute} ${r.primaryCoefficient}`
          + (r.secondaryCoefficient ? ` / ${r.secondaryAttribute} ${r.secondaryCoefficient}` : ''),
        sort: (r) => r.primaryAttribute },
      { key: 'combo', label: 'Light combo', cls: 'num', get: (r) => r.lightCombo.length, sort: (r) => r.lightCombo.length },
    ],
    facets: [],
    detail: weaponDetail,
  },
  {
    id: 'gearSlots',
    label: 'Gear slots',
    rows: DB.gearSlots || [],
    columns: [
      { key: 'name', label: 'Slot', get: nameCell, sort: (r) => r.name },
      { key: 'group', label: 'Group', get: (r) => r.groupName, sort: (r) => r.groupName },
      { key: 'tags', label: 'Accepts', get: (r) => chips(r.allowedTags), sort: (r) => r.allowedTags.join(',') },
      { key: 'capacity', label: 'Perks', cls: 'num', get: (r) => r.perkCapacity, sort: (r) => r.perkCapacity },
    ],
    facets: [{ label: 'Group', get: (r) => [r.groupName] }],
    detail: gearSlotDetail,
  },
  {
    id: 'labels',
    label: 'Exclusive labels',
    rows: DB.labels || [],
    columns: [
      { key: 'name', label: 'Label', get: (r) => h('div', { class: 'cell-name' }, h('strong', {}, r.name)), sort: (r) => r.name },
      { key: 'count', label: 'Perks', cls: 'num', get: (r) => r.perks.length, sort: (r) => r.perks.length },
      { key: 'perks', label: 'Carried by',
        get: (r) => r.perks.map((key) => link('perks', key, null, 'chip ref')),
        sort: (r) => r.perks.join(',') },
    ],
    facets: [],
    detail: labelDetail,
  },
  {
    id: 'damage',
    label: 'Damage',
    rows: [],
    columns: [],
    facets: [],
    custom: damagePage,
    detail: () => null,
  },
  {
    id: 'config',
    label: 'Tuning values',
    rows: configRows(),
    columns: [
      { key: 'name', label: 'Setting', get: (r) => r.name, sort: (r) => r.name },
      { key: 'group', label: 'Asset', get: (r) => r.group, sort: (r) => r.group },
      { key: 'value', label: 'Value', cls: 'num', get: (r) => r.value, sort: (r) => r.value },
    ],
    facets: [{ label: 'Asset', get: (r) => [r.group] }],
    detail: (row) => h('div', {}, h('div', { class: 'detail-head' },
      h('div', {}, h('h2', {}, row.name), h('div', { class: 'kicker' }, row.group))),
      kv([['Value', row.value]])),
  },
];

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((s) => [s.id, s]));
SECTIONS.forEach((section) => { section.index = byKey(section.rows); });

/* ---- detail builders ----------------------------------------------------- */
function effectBlocks(effect) {
  if (!effect) return [h('p', { class: 'muted' }, 'No effect payload on this perk.')];
  const out = [];
  out.push(block('Effect', kv([
    ['Trigger', effect.triggerName],
    ['Applies to', effect.grantsApplyToSelf ? 'Yourself' : 'The target you hit'],
    ['Internal cooldown', effect.internalCooldownText],
    effect.flatDamage ? ['Flat damage', `${effect.flatDamage} ${effect.flatDamageSchool}`] : null,
    effect.freedomCcReduction ? ['Crowd-control reduction', `${+(effect.freedomCcReduction * 100).toFixed(2)}%`] : null,
    effect.auraDamagePerEnemy ? ['Aura damage per enemy', effect.auraDamagePerEnemy] : null,
    effect.auraRadius ? ['Aura radius', `${effect.auraRadius} m`] : null,
    effect.projectileGravityReduction ? ['Arrow gravity reduction', `${+(effect.projectileGravityReduction * 100).toFixed(2)}%`] : null,
  ]),
    // Inside the block rather than after it, so the block's own bottom margin
    // separates it from the next heading.
    effect.triggerHelp
      ? h('p', { class: 'note', style: { marginTop: '10px' } }, effect.triggerHelp)
      : null));
  if (effect.grants.length) {
    out.push(block('Statuses applied', miniTable(
      ['Status', 'Amount', 'Duration'],
      effect.grants.map((g) => [link('statuses', g.status, g.statusName), g.summary, g.durationText]))));
  }
  return out;
}

function assetBlock(...paths) {
  const real = paths.filter(Boolean);
  if (!real.length) return null;
  return block('Source assets', real.map((path) => h('div', { class: 'path' }, path)));
}

function detailHead(row, kicker) {
  return h('div', { class: 'detail-head' },
    iconEl(row.icon, true),
    h('div', {}, h('h2', {}, row.name), kicker && h('div', { class: 'kicker' }, kicker)));
}

/* The practical half of an exclusive label: which other perks it locks you out
   of when you slot this one. */
function labelSiblings(perk) {
  const others = perk.exclusiveLabels.flatMap((label) => {
    const record = indexOf('labels', label.key);
    return record ? record.perks.filter((key) => key !== perk.key) : [];
  });
  if (!others.length) return null;
  const names = perk.exclusiveLabels.map((label) => label.name).join(', ');
  return block('Cannot share a slot with',
    others.map((key) => link('perks', key, null, 'chip ref')),
    h('p', { class: 'note' },
      `Same exclusive label (${names}). They can still be equipped together as `
      + 'long as they go in different slots.'));
}

function perkDetail(perk) {
  const effect = perk.effect || {};
  return h('div', {},
    detailHead(perk, `${perk.source} perk${perk.perkId ? ` - id ${perk.perkId}` : ''}`),
    perk.description && h('p', { class: 'detail-desc' }, perk.description),
    block('Tags', tagChips(perk)),
    // Always rendered, "None" included: an absent block reads as "this page does
    // not cover labels" rather than "this perk has none".
    block('Exclusive label', perk.exclusiveLabels.length
      ? perk.exclusiveLabels.map((l) => link('labels', l.key, l.name, `chip ${LABEL_TONE[l.key] || 'label'}`))
      : h('span', { class: 'muted' }, 'None')),
    ...effectBlocks(perk.effect),
    block('Rules', kv([
      // Equipping N copies IS the stacking mechanic, so say it in those terms.
      ['Stackable', yesNo(perk.stackLimit > 1)],
      ['Stacks', stackCount(perk.stackLimit || 1)],
      perk.mutuallyExclusiveGroup ? ['Mutually exclusive group', perk.mutuallyExclusiveGroup] : null,
      perk.threshold ? ['Granted at', `${perk.threshold.points} ${perk.threshold.attribute}`] : null,
    ])),
    labelSiblings(perk),
    perk.threshold
      ? block('How you get it', h('p', { class: 'note' },
          `Granted automatically once you put ${perk.threshold.points} points into `
          + `${perk.threshold.attribute}. It cannot be slotted into gear.`))
      // Slot chips filter the perk list rather than jumping to the slot page:
      // the question they answer is "what else goes here", not "what is a Helm".
      : block('Equippable in',
          perk.slots.map((key) => facetChip(
            'perks', 'Slot', SLOT_NAME[key], null, (SLOT_BY_KEY[key] || {}).icon)),
          h('p', { class: 'note' }, 'Click a slot to see every perk it accepts.')),
    assetBlock(perk.assetPath, effect.assetPath));
}

function abilityPerkDetail(perk) {
  return h('div', {},
    detailHead(perk, `${perk.tree} ability tree - ${perk.category} node`),
    perk.description && h('p', { class: 'detail-desc' }, perk.description),
    block('Scope', kv([
      ['Rides on', perk.scope],
      perk.scopeHelp ? ['Which hits', perk.scopeHelp] : null,
      ['Ranks', perk.ranks.length],
      ['Ability node', link('abilities', perk.ability)],
    ])),
    block('Per rank', miniTable(['Rank', 'Effect'],
      perk.ranks.map((rank) => [rank.rank, rank.summary]))),
    ...effectBlocks(perk.effect),
    assetBlock(perk.effect && perk.effect.assetPath));
}

function statusDetail(status) {
  const bySource = { perk: 'Gear perk', abilityPerk: 'Ability perk', attack: 'Attack' };
  return h('div', {},
    detailHead(status, `${status.kind} - ${status.axis}`),
    h('p', { class: 'detail-desc' }, status.description),
    block('Numbers', kv([
      status.capText ? ['Cap on the net value', status.capText] : null,
      status.maxStacks ? ['Maximum stacks', stackCount(status.maxStacks)] : null,
      status.tickIntervalText ? ['Tick interval', status.tickIntervalText] : null,
      status.actionLockText ? ['Action lock', status.actionLockText] : null,
      status.school ? ['Damage type', status.school] : null,
      ['Slot index', status.type],
      status.opposes ? ['Nets against', link('statuses', status.opposes)] : null,
    ])),
    block(`Applied by (${status.appliedBy.length})`, miniTable(
      ['Source', 'Kind', 'Amount', 'Duration'],
      status.appliedBy.map((source) => [
        link(source.kind === 'attack' ? 'attacks' : 'perks', source.key, source.name),
        bySource[source.kind] + (source.extra ? ` (${source.extra})` : ''),
        source.summary,
        source.durationText,
      ]))) || block('Applied by', h('p', { class: 'muted' }, 'Nothing applies this yet.')));
}

/* One builder for both places an ability is described: the Abilities table's
   detail pane, and the tree page's node tooltip. `onTree` drops the two things
   the tree itself already says - the rank, which is written on the node and in
   the tooltip's own subtitle, and what a node leads to, which is what the wires
   out of it are. Everything else, perk payload and all, is the same in both. */
/* The effect summary with its status names turned back into links.

   The sentence itself is the exporter's - one place builds that prose - so the
   names are found inside the finished string rather than the clauses being
   rebuilt here. They are the only part of it worth following, and a second row
   repeating them beside it says the same thing twice. */
function effectText(perk) {
  const summary = perk.effectSummary || '';
  const grants = ((perk.effect || {}).grants || []).filter((g) => g.statusName);
  if (!grants.length) return summary;
  // Longest first, so a name that contains another is matched whole.
  const names = [...new Set(grants.map((g) => g.statusName))]
    .sort((a, b) => b.length - a.length);
  const out = [];
  let rest = summary;
  while (rest) {
    let hit = null;
    for (const name of names) {
      const at = rest.indexOf(name);
      if (at >= 0 && (!hit || at < hit.at)) hit = { at, name };
    }
    if (!hit) { out.push(rest); break; }
    if (hit.at) out.push(rest.slice(0, hit.at));
    const grant = grants.find((g) => g.statusName === hit.name);
    out.push(link('statuses', grant.status, grant.statusName));
    rest = rest.slice(hit.at + hit.name.length);
  }
  return out;
}

function abilityDetail(ability, options) {
  const opts = options || {};
  const attack = ability.attack ? indexOf('attacks', ability.attack) : null;
  const perk = ability.abilityPerk ? indexOf('perks', ability.abilityPerk) : null;
  return h('div', {},
    detailHead(ability, opts.kicker || `${ability.tree} tree - ${ability.category}`),
    ability.description && h('p', { class: 'detail-desc' }, ability.description),
    // Whether a node can be slotted is what Category already says - every Active
    // can, nothing else can - and its row is a fact about the drawing, not about
    // the ability. Rank and what a node leads to are dropped on the tree page
    // alone, where the node's own label and the wires out of it say both.
    block('Node', kv([
      ['Category', ability.category],
      opts.onTree ? null : ['Maximum rank', ability.maxRank],
      ['Cost per rank', ability.costPerRank.join(' + ') || '-'],
      ['Points to max', ability.totalCost],
      ability.isGroupPrerequisite ? ['Unlocks its branch group', 'Yes'] : null,
      ability.nodeId !== null ? ['Simulation node id', ability.nodeId] : null,
    ])),
    ability.parent && block('Requires', link('abilities', ability.parent)),
    !opts.onTree && ability.children.length ? block('Leads to',
      ability.children.map((key) => link('abilities', key, null, 'chip link'))) : null,
    // An ability is talked about in seconds and in the damage it is authored
    // with; the tick counts behind both live on the attack's own page.
    attack && block('Attack', kv([
      ['Move', link('attacks', attack.key, attack.name)],
      ['Base damage', attack.damage],
      INTERNAL ? ['Windup / active / recovery',
        `${attack.windupTicks} / ${attack.activeTicks} / ${attack.recoveryTicks} ticks`] : null,
      ['Cooldown', attack.cooldownTicks ? seconds(attack.cooldownTicks) : 'None'],
    ])),
    perk && block('Perk payload', kv([
      ['Perk', link('perks', ability.abilityPerk)],
      ['Effect', effectText(perk)],
    ])),
    assetBlock(ability.assetPath));
}

function phaseBar(attack) {
  const total = attack.totalTicks || 1;
  const pct = (t) => `${(t / total) * 100}%`;
  return h('div', {},
    h('div', { class: 'phases' },
      h('div', { class: 'phase-windup', style: { width: pct(attack.windupTicks) } }, attack.windupTicks),
      h('div', { class: 'phase-active', style: { width: pct(attack.activeTicks) } }, attack.activeTicks),
      h('div', { class: 'phase-recovery', style: { width: pct(attack.recoveryTicks) } }, attack.recoveryTicks)),
    h('div', { class: 'phase-legend' },
      h('span', {}, 'Windup'), h('span', {}, 'Active (hits land)'), h('span', {}, 'Recovery'),
      h('span', {}, `total ${seconds(attack.totalTicks)}`)));
}

function attackDetail(attack) {
  const box = attack.hitbox;
  const shapeSize = box.shape === 'Sphere' ? `radius ${box.sphereRadius} m`
    : box.shape === 'Capsule' ? `radius ${box.capsuleRadius} m, height ${box.capsuleHeight} m`
    : box.shape === 'Box' ? `extents ${box.boxExtents.x} / ${box.boxExtents.y} / ${box.boxExtents.z} m`
    : '-';
  return h('div', {},
    detailHead(attack, `${attack.kind} attack${attack.weapon ? ` - ${attack.weapon}` : ''}`),
    INTERNAL ? block('Timing', phaseBar(attack)) : null,
    block('Numbers', kv([
      ['Damage', attack.damage],
      ...(INTERNAL ? [
        ['Windup', attack.windupText],
        ['Active', attack.activeText],
        ['Recovery', attack.recoveryText],
        ['Total', attack.totalText],
      ] : []),
      ['Cooldown', attack.cooldownText],
      ['Cancelable during', attack.cancelWindow],
      INTERNAL && attack.rehitTicks && attack.rehitTicks.length
        ? ['Extra hits at active tick', attack.rehitTicks.join(', ')] : null,
    ])),
    block('Movement', kv([
      ['Speed during windup', attack.moveSpeedFactor < 0 ? 'inherit' : `${attack.moveSpeedFactor}x`],
      ['Speed during active', attack.activeMoveSpeedFactor < 0 ? 'inherits windup' : `${attack.activeMoveSpeedFactor}x`],
      ['Speed during recovery', `${attack.recoveryMoveSpeedFactor}x`],
      ['Stops on contact', yesNo(attack.stopMovementOnHit)],
      INTERNAL && attack.airborneWindupTicks
        ? ['Airborne windup', `${attack.airborneWindupTicks} ticks`] : null,
      INTERNAL && attack.rootMotionTicks
        ? ['Baked root motion', `${attack.rootMotionTicks} ticks, scale ${attack.rootMotionScale}`]
        : null,
    ])),
    block('Magnetism', kv([
      ['Homing range', `${attack.homingRange} m`],
      ['Homing cone', `${attack.homingConeDegrees} deg`],
      ['Magnet pull', attack.disableMagnetPull ? 'Disabled' : 'Enabled'],
    ])),
    block('Hit volume', kv([['Shape', box.shape], ['Size', shapeSize],
      ['Offset', `${box.offset.x} / ${box.offset.y} / ${box.offset.z} m`]])),
    attack.appliedStatuses.length ? block('Statuses applied', miniTable(
      ['Status', 'Amount', 'Duration'],
      attack.appliedStatuses.map((g) => [link('statuses', g.status, g.statusName), g.summary, g.durationText]))) : null,
    block('Used by', miniTable(['Owner', 'Role'],
      attack.usedBy.map((use) => [use.owner, use.role]))),
    assetBlock(attack.assetPath));
}

function weaponDetail(weapon) {
  return h('div', {},
    detailHead(weapon, `Weapon index ${weapon.index}`),
    block('Attribute scaling', kv([
      ['Primary', `${weapon.primaryAttribute} x ${weapon.primaryCoefficient}`],
      ['Secondary', weapon.secondaryCoefficient
        ? `${weapon.secondaryAttribute} x ${weapon.secondaryCoefficient}`
        : 'none (single-attribute weapon)'],
    ])),
    block('Light combo', weapon.lightCombo.map((key, i) =>
      link('attacks', key, `${i + 1}. ${indexOf('attacks', key).name}`, 'chip link'))),
    weapon.heavyAttack && block('Heavy attack', link('attacks', weapon.heavyAttack, null, 'chip link')),
    assetBlock(weapon.assetPath));
}

function labelDetail(label) {
  return h('div', {},
    h('div', { class: 'detail-head' },
      h('div', {}, h('h2', {}, label.name),
        h('div', { class: 'kicker' }, 'Exclusive label'))),
    h('p', { class: 'detail-desc' },
      `Only one perk carrying the ${label.name} label may occupy a single gear `
      + 'slot. Equipping a second one in that slot is rejected; putting it in a '
      + 'different slot is allowed.'),
    block('Carried by', label.perks.map((key) => link('perks', key, null, 'chip ref'))),
    block('Identity', kv([
      ['Perks with this label', label.perks.length],
      label.labelId ? ['Label id', h('span', { class: 'path' }, label.labelId)] : null,
    ])),
    assetBlock(label.assetPath));
}

function gearSlotDetail(slot) {
  return h('div', {},
    detailHead(slot, `${slot.groupName} slot`),
    block('Rules', kv([
      ['Group', slot.groupName],
      ['Perks it holds', slot.perkCapacity],
      ['Accepts tags', slot.allowedTags.join(', ')],
      ['Bound weapon', slot.weapon || 'none - always active'],
    ])),
    slot.weapon && h('p', { class: 'note' },
      `Perks in this slot do nothing while a weapon other than the ${slot.weapon} is drawn.`),
    block(`Perks that fit (${slot.perks.length})`,
      slot.perks.map((key) => link('perks', key, null, 'chip link'))));
}

/* ---- damage page ---------------------------------------------------------
   Not a table: a short statement of the pipeline, the two curves that shape it,
   and a calculator that runs the real steps. Every constant comes from the same
   assets the simulation reads, so this page cannot drift from the game. */
const DMG = (DB.config && DB.config.damage) || {};
const WEIGHTS = (DB.config && DB.config.weightClasses) || [];
const ATTRS = (DB.config && DB.config.attributes) || [];
const ATTR_SHORT = {
  Strength: 'STR', Dexterity: 'DEX', Intelligence: 'INT',
  Focus: 'FOC', Constitution: 'CON',
};

/* Piecewise linear through (0, floor), every knee in order, then
   (attributeMax, max). Any number of knees, including none. */
const CURVE_KNOTS = [
  { points: 0, value: DMG.statScalarFloor },
  ...(DMG.statScalarKnees || []),
  { points: DMG.attributeMax, value: DMG.statScalarMax },
];

function statScalar(points) {
  const p = Math.max(0, Math.min(DMG.attributeMax, points));
  for (let i = 1; i < CURVE_KNOTS.length; i++) {
    const a = CURVE_KNOTS[i - 1];
    const b = CURVE_KNOTS[i];
    if (p <= b.points) {
      const span = b.points - a.points;
      return span <= 0 ? b.value : a.value + (b.value - a.value) * ((p - a.points) / span);
    }
  }
  return DMG.statScalarMax;
}

const resisted = (armour, k) => armour / (armour + (k || DMG.mitigationK));

function svgChart(opts) {
  const NS = 'http://www.w3.org/2000/svg';
  const W = 470;
  const H = 200;
  const pad = { l: 46, r: 14, t: 14, b: 28 };
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
  svg.setAttribute('class', 'chart');
  const x = (v) => pad.l + (v / opts.xMax) * (W - pad.l - pad.r);
  const y = (v) => H - pad.b - (v / opts.yMax) * (H - pad.t - pad.b);
  const add = (tag, attrs, text) => {
    const el = document.createElementNS(NS, tag);
    for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, value);
    if (text !== undefined) el.textContent = text;
    svg.append(el);
    return el;
  };
  for (const tick of opts.yTicks) {
    add('line', { x1: pad.l, x2: W - pad.r, y1: y(tick), y2: y(tick), class: 'grid' });
    add('text', { x: pad.l - 8, y: y(tick) + 4, class: 'tick end' }, opts.yLabel(tick));
  }
  for (const tick of opts.xTicks) {
    add('text', { x: x(tick), y: H - 9, class: 'tick mid' }, String(tick));
  }
  const points = [];
  for (let i = 0; i <= 80; i++) {
    const vx = (opts.xMax * i) / 80;
    points.push(x(vx) + ',' + y(opts.f(vx)));
  }
  add('polyline', { points: points.join(' '), class: 'curve' });
  for (const mark of opts.marks || []) {
    add('circle', { cx: x(mark.x), cy: y(mark.y), r: 3.5, class: 'mark' });
    add('text', { x: x(mark.x) + 8, y: y(mark.y) - 8, class: 'mark-label' }, mark.label);
  }
  return svg;
}

function field(label, control, className) {
  return h('label', { class: 'field ' + (className || '') },
    h('span', { class: 'field-label' }, label), control);
}

function numberInput(value, min, max, step, onInput) {
  const input = h('input', { type: 'number', value, min, max, step: step || 1 });
  input.addEventListener('input', () => onInput(parseFloat(input.value) || 0));
  return input;
}

function selectInput(options, value, onChange) {
  const node = h('select', {}, options.map((option) => h('option', {
    value: option.value,
    selected: option.value === value ? 'selected' : null,
  }, option.label)));
  node.addEventListener('change', () => onChange(node.value));
  return node;
}

function damagePage() {
  const weapons = DB.weapons || [];
  const attacks = DB.attacks || [];
  // Pick by identity, not by index: the assets happen to sort Heavy first, and
  // an index here silently made Heavy the calculator's baseline.
  const named = (name) => WEIGHTS.find((w) => (w.name || '').toLowerCase() === name);
  const light = named('light') || WEIGHTS.find((w) => w.damageFactor === 1)
    || WEIGHTS[0] || { name: 'Light', damageFactor: 1, armorRating: 50 };
  const heavy = named('heavy') || WEIGHTS.find((w) => w !== light) || light;
  const attacksFor = (weapon) => attacks.filter((a) => a.weapon === (weapon || {}).name);

  // Every attribute is present whether or not the chosen weapon scales off it -
  // the coefficient decides that, so the row stays put when the weapon changes.
  const attrs = {};
  for (const attr of ATTRS) attrs[attr] = 0;
  attrs.Strength = 25;
  attrs.Dexterity = 25;

  const model = {
    weapon: weapons[0],
    attack: null,
    attrs,
    weight: light,
    empower: 0,
    weaken: 0,
    // The defender only needs what changes the incoming number: armour comes
    // from the weight class, Fortify and Rend move that rating, and Constitution
    // sets the health bar for hits-to-kill.
    defenderWeight: light,
    defenderFortify: 0,
    defenderRend: 0,
    defenderCon: 0,
  };
  model.attack = attacksFor(model.weapon)[0] || null;

  const out = h('div', { class: 'calc-out' });
  const attackHost = h('span', { class: 'field-control' });
  const attrHost = h('div', { class: 'attr-row' });

  function recalc() {
    const weapon = model.weapon || {};
    const base = (model.attack || {}).damage || 0;
    const points = (model.attrs[weapon.primaryAttribute] || 0) * (weapon.primaryCoefficient || 0)
      + (model.attrs[weapon.secondaryAttribute] || 0) * (weapon.secondaryCoefficient || 0);
    const scalar = statScalar(points);
    const weight = (model.weight || {}).damageFactor;
    const weightFactor = weight === undefined ? 1 : weight;
    const buffs = Math.max(-DMG.weakenCap, Math.min(DMG.empowerCap,
      (model.empower - model.weaken) / 100));
    const armourNet = Math.max(-DMG.rendCap, Math.min(DMG.fortifyCap,
      (model.defenderFortify - model.defenderRend) / 100));
    const rating = Math.max(0,
      ((model.defenderWeight || {}).armorRating || 0) * (1 + armourNet));
    const cut = resisted(rating, DMG.mitigationK);
    const final = base * scalar * weightFactor * (1 + buffs) * (1 - cut);
    const health = DMG.baseMaxHealth * (1 + DMG.perPointHealth * model.defenderCon);

    const row = (label, value, note) => h('tr', {},
      h('td', {}, label), h('td', { class: 'num' }, value),
      h('td', { class: 'muted' }, note || ''));
    out.replaceChildren(h('div', { class: 'result-card' },
      h('table', { class: 'mini calc-steps' }, h('tbody', {},
        row('Base damage', base.toFixed(1), (model.attack || {}).name || ''),
        row('x stat scalar', scalar.toFixed(2), points.toFixed(1) + ' weighted points'),
        row('x weight class', weightFactor.toFixed(2), (model.weight || {}).name),
        row('x buffs', (1 + buffs).toFixed(2), 'net ' + Math.round(buffs * 100) + '%'),
        row('- armour', '-' + (cut * 100).toFixed(1) + '%', 'rating ' + rating.toFixed(0)))),
      h('div', { class: 'calc-total' },
        h('span', {}, 'Damage per hit'), h('strong', {}, final.toFixed(1))),
      h('div', { class: 'calc-total sub' },
        h('span', {}, 'Hits to kill (' + health.toFixed(0) + ' health)'),
        h('strong', {}, final > 0 ? String(Math.ceil(health / final)) : '-'))));
  }

  function rebuildAttackSelect() {
    const list = attacksFor(model.weapon);
    if (!list.length) {
      attackHost.replaceChildren(h('span', { class: 'field-note' }, 'no attacks in data'));
      return;
    }
    attackHost.replaceChildren(selectInput(
      list.map((a) => ({ value: a.key, label: a.name + ' (' + a.damage + ')' })),
      (model.attack || {}).key,
      (key) => { model.attack = list.find((a) => a.key === key); recalc(); }));
  }

  // Marks the attributes the chosen weapon scales off, so a complete row still
  // shows which of them are doing the work.
  function rebuildAttrs() {
    const weapon = model.weapon || {};
    const scales = (attr) =>
      (weapon.primaryAttribute === attr && weapon.primaryCoefficient)
      || (weapon.secondaryAttribute === attr && weapon.secondaryCoefficient);
    attrHost.replaceChildren(...ATTRS.map((attr) => field(
      ATTR_SHORT[attr] || attr,
      numberInput(model.attrs[attr], 0, DMG.attributeMax, 1,
        (v) => { model.attrs[attr] = v; recalc(); }),
      scales(attr) ? 'attr scales' : 'attr')));
  }

  rebuildAttackSelect();
  rebuildAttrs();

  const attackerPanel = h('div', { class: 'calc-panel' },
    h('h4', {}, 'Attacker'),
    h('div', { class: 'calc-inputs' },
      field('Weapon', selectInput(
        weapons.map((w) => ({ value: w.key, label: w.name })),
        (model.weapon || {}).key,
        (key) => {
          model.weapon = weapons.find((w) => w.key === key);
          model.attack = attacksFor(model.weapon)[0] || null;
          rebuildAttackSelect();
          rebuildAttrs();
          recalc();
        })),
      field('Attack', attackHost),
      // The two ends of one axis sit together; the odd field out goes last so no
      // pair is split across rows.
      field('Empower %', numberInput(model.empower, 0, 100, 5,
        (v) => { model.empower = v; recalc(); })),
      field('Weaken %', numberInput(model.weaken, 0, 100, 5,
        (v) => { model.weaken = v; recalc(); })),
      field('Weight class', selectInput(
        WEIGHTS.map((w) => ({ value: w.key, label: w.name })),
        (model.weight || {}).key,
        (key) => { model.weight = WEIGHTS.find((w) => w.key === key); recalc(); }))),
    h('div', { class: 'attr-label' }, 'Attributes'),
    attrHost);

  const defenderPanel = h('div', { class: 'calc-panel' },
    h('h4', {}, 'Defender'),
    h('div', { class: 'calc-inputs' },
      field('Weight class', selectInput(
        WEIGHTS.map((w) => ({ value: w.key, label: w.name })),
        (model.defenderWeight || {}).key,
        (key) => {
          model.defenderWeight = WEIGHTS.find((w) => w.key === key);
          recalc();
        })),
      field('Constitution', numberInput(model.defenderCon, 0, DMG.attributeMax, 1,
        (v) => { model.defenderCon = v; recalc(); })),
      field('Fortify %', numberInput(model.defenderFortify, 0, 100, 5,
        (v) => { model.defenderFortify = v; recalc(); })),
      field('Rend %', numberInput(model.defenderRend, 0, 100, 5,
        (v) => { model.defenderRend = v; recalc(); }))),
    h('p', { class: 'note' },
      'Armour comes from the weight class. Fortify raises that rating and Rend '
      + 'lowers it, before the mitigation curve. Constitution sets the health bar.'));

  const steps = [
    ['1. attack base damage', ''],
    ['2. x stat scalar', 'Stat modifier - Stat curve'],
    ['3. x weight class', 'Light ' + light.damageFactor + ', Heavy ' + heavy.damageFactor + '.'],
    ['4. x buffs', 'Empower minus Weaken, capped at '
      + Math.round(DMG.empowerCap * 100) + '%.'],
    ['5. - armour', WEIGHTS.map((w) => w.name + ' ' + w.armorRating).join(', ')],
  ];

  const page = h('div', { class: 'page' },
    block('Damage Formula',
      h('table', { class: 'mini' }, h('tbody', {}, steps.map(([step, what]) =>
        h('tr', {}, h('td', {}, step), h('td', { class: 'muted' }, what))))),
      h('pre', { class: 'formula' },
        'damage = base x statScalar x weightFactor x (1 + empower - weaken)\n'
        + '                x (1 - armour / (armour + ' + DMG.mitigationK + '))')),

    block('The two curves',
      h('div', { class: 'charts' },
        h('div', { class: 'chart-box' },
          h('h4', {}, 'Stat scalar by weighted attribute points'),
          svgChart({
            xMax: DMG.attributeMax,
            yMax: DMG.statScalarMax,
            xTicks: [...new Set([0, 10, ...CURVE_KNOTS.map((k) => k.points),
              DMG.attributeMax])].sort((x, y) => x - y),
            yTicks: [0, 0.5, 1, 1.5],
            yLabel: (v) => 'x' + v,
            f: statScalar,
            marks: (DMG.statScalarKnees || []).map((knee) => ({
              x: knee.points, y: knee.value, label: 'x' + knee.value,
            })),
          }),
          h('p', { class: 'note' },
            'Floor x' + DMG.statScalarFloor + ' at zero points, x'
            + DMG.statScalarMax + ' at ' + DMG.attributeMax)),
        h('div', { class: 'chart-box' },
          h('h4', {}, 'Damage resisted by armour rating'),
          svgChart({
            xMax: 300,
            yMax: 1,
            xTicks: [0, 50, 100, 150, 200, 300],
            yTicks: [0, 0.25, 0.5, 0.75, 1],
            yLabel: (v) => (v * 100) + '%',
            f: (v) => resisted(v, DMG.mitigationK),
            marks: WEIGHTS.map((weight) => ({
              x: weight.armorRating,
              y: resisted(weight.armorRating, DMG.mitigationK),
              label: weight.name,
            })),
          })))),

    block('Calculator',
      h('div', { class: 'calc-sides' }, attackerPanel, defenderPanel),
      out));

  recalc();
  return page;
}

/* ---- ability trees ------------------------------------------------------- */
/* The in-game ability screen, rebuilt from the data it is itself drawn from.

   Three things have to agree with the game or the page is a lie: the structural
   layout (branch columns, depth rows, sibling spread - computed by the exporter's
   port of the package's AbilityTreeLayout, never the authored EditorPosition), the
   art and state colours (AbilityTreeTheme, exported as data.abilityTheme), and the
   rules below, which mirror AbilityPrerequisites and AbilityTreeService: what a
   click buys, what a refund cascades into, and what may sit in a slot.

   That last part is the point of the page. Twenty points, six branches and three
   slots is a question a player answers by trying, and trying it here costs no
   launch. */

const TREES = DB.trees || [];
const TREE_THEME = DB.abilityTheme || {};
const TREE_DIAMETERS = TREE_THEME.diameters || {};
const TREE_COLORS = TREE_THEME.colors || {};
const TREE_LINES = TREE_THEME.connection || {};

/* One draft per weapon, kept for the session the way the screen's draft session
   keeps every tree: switching tabs and coming back finds the build as it was. */
const treeDrafts = new Map();

function treeDraft(tree) {
  let draft = treeDrafts.get(tree.key);
  if (!draft) {
    draft = { ranks: new Map(), slots: tree.slots.map(() => null) };
    treeDrafts.set(tree.key, draft);
  }
  return draft;
}

const treeNodes = (tree) =>
  tree.nodes.map((key) => indexOf('abilities', key)).filter(Boolean);

/* ---- rules (ported; keep in step with the package) ----------------------- */
const rankOf = (draft, node) => (node ? draft.ranks.get(node.key) || 0 : 0);

function costOfRank(node, rank) {
  if (rank < 1 || rank > node.maxRank || !node.costPerRank.length) return -1;
  return node.costPerRank[Math.min(rank - 1, node.costPerRank.length - 1)];
}

function costUpToRank(node, rank) {
  let total = 0;
  for (let r = 1; r <= rank; r += 1) {
    const cost = costOfRank(node, r);
    if (cost < 0) return -1;
    total += cost;
  }
  return total;
}

function spentPoints(tree, draft) {
  return treeNodes(tree).reduce((sum, node) => {
    const cost = costUpToRank(node, rankOf(draft, node));
    return sum + (cost > 0 ? cost : 0);
  }, 0);
}

/* The single purchase gate (AbilityPrerequisites.Check). Returns the reason a node
   is locked, or null when it is not. */
function prerequisiteBlocker(tree, draft, node) {
  if (node.isGroupPrerequisite) {
    // Row 0 is freely purchasable, like a branch root.
    if (node.row <= 0) return null;
    const satisfied = treeNodes(tree).some((other) => other.key !== node.key
      && other.group === node.group && other.row === node.row - 1
      && rankOf(draft, other) >= 1);
    return satisfied ? null : 'Needs any ability of the row above bought first';
  }
  if (!node.parent) return null;
  const parent = indexOf('abilities', node.parent);
  if (!parent) return 'Its parent node is missing';
  if (rankOf(draft, parent) >= node.requiredParentRank) return null;
  return node.requiredParentRank > 1
    ? `Requires ${parent.name} at rank ${node.requiredParentRank}`
    : `Requires ${parent.name}`;
}

function purchaseBlocker(tree, draft, node) {
  const rank = rankOf(draft, node);
  if (rank >= node.maxRank) return 'Already at maximum rank';
  const cost = costOfRank(node, rank + 1);
  if (cost < 0) return 'This node has no valid cost';
  const gate = prerequisiteBlocker(tree, draft, node);
  if (gate) return gate;
  if (cost > tree.pointBudget - spentPoints(tree, draft)) return 'Not enough points left';
  return null;
}

function nodeVisualState(tree, draft, node) {
  const rank = rankOf(draft, node);
  // MaxRank is the fully-invested accent, and only means something where investment
  // is graded: a one-rank node at 1/1 is simply Purchased.
  if (rank >= node.maxRank && node.maxRank > 1) return 'MaxRank';
  if (rank > 0) return 'Purchased';
  return purchaseBlocker(tree, draft, node) ? 'Locked' : 'Available';
}

/* Emptying a node empties everything that depended on it: the same fixed-point
   pass the service runs, driven by re-checking each purchase rather than by
   walking the graph, so a group-gated node falls with the row it stood on. */
function refundNode(tree, draft, node) {
  draft.ranks.set(node.key, 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (const other of treeNodes(tree)) {
      if (rankOf(draft, other) < 1) continue;
      if (!prerequisiteBlocker(tree, draft, other)) continue;
      draft.ranks.set(other.key, 0);
      changed = true;
    }
  }
  if ((tree.loadoutRules || {}).autoUnequipInvalidated !== false) {
    draft.slots = draft.slots.map((key) =>
      (key && rankOf(draft, indexOf('abilities', key)) >= 1 ? key : null));
  }
}

/* Clicking a node cycles it: buy the next rank when that is possible, otherwise
   empty a node that holds points, so a click loops 0 -> 1 -> ... -> max -> 0 with
   no separate remove control. */
function clickNode(tree, draft, node) {
  if (!purchaseBlocker(tree, draft, node)) {
    draft.ranks.set(node.key, rankOf(draft, node) + 1);
    return;
  }
  if (rankOf(draft, node) > 0) refundNode(tree, draft, node);
}

function equipBlocker(tree, draft, node) {
  const rules = tree.loadoutRules || {};
  if (rankOf(draft, node) < 1) return 'Buy it first';
  if (!node.canEquip) return 'This node is a modifier, not a slotted ability';
  if ((rules.allowedCategories || []).length
      && !rules.allowedCategories.includes(node.category)) {
    return `${node.category} abilities do not go in a slot`;
  }
  return null;
}

/* Picking a node that already occupies another slot swaps the two, the way the
   screen's assign does; picking nothing clears the slot. */
function equipNode(tree, draft, slotIndex, key) {
  const rules = tree.loadoutRules || {};
  const held = key ? draft.slots.indexOf(key) : -1;
  if (held >= 0 && held !== slotIndex && !rules.allowDuplicateNode) {
    draft.slots[held] = draft.slots[slotIndex];
  }
  draft.slots[slotIndex] = key;
}

/* ---- share codes --------------------------------------------------------- */
/* A build is a rank per node in tree order plus one base-36 slot index each, so a
   link is short enough to paste into chat. It is replayed through the purchase
   rules rather than trusted: a code made before the tree changed shape then loses
   whatever no longer holds instead of producing a build the game would reject. */
function buildCode(tree, draft) {
  const nodes = treeNodes(tree);
  // Trailing unbought nodes are dropped rather than spelled out as zeroes; the
  // reader treats a missing digit as one.
  const ranks = nodes.map((node) => Math.min(9, rankOf(draft, node)))
    .join('').replace(/0+$/, '');
  const slots = draft.slots
    .map((key) => (key ? nodes.findIndex((n) => n.key === key) : -1))
    .map((index) => (index < 0 ? 'z' : index.toString(36))).join('');
  return /[1-9]/.test(ranks) ? `${ranks}-${slots}` : '';
}

function applyBuildCode(tree, draft, code) {
  const nodes = treeNodes(tree);
  const [ranks = '', slots = ''] = String(code || '').split('-');
  draft.ranks.clear();
  draft.slots = tree.slots.map(() => null);

  // Shallow rows first, so a parent is bought before the child that needs it; the
  // rules then decide, and anything unaffordable or unreachable simply stays out.
  const wanted = nodes
    .map((node, index) => ({ node, rank: parseInt(ranks[index], 10) || 0 }))
    .filter((entry) => entry.rank > 0)
    .sort((a, b) => a.node.row - b.node.row);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const entry of wanted) {
      while (rankOf(draft, entry.node) < entry.rank
             && !purchaseBlocker(tree, draft, entry.node)) {
        draft.ranks.set(entry.node.key, rankOf(draft, entry.node) + 1);
        progressed = true;
      }
    }
  }

  [...slots].forEach((char, slotIndex) => {
    const node = nodes[parseInt(char, 36)];
    if (node && slotIndex < draft.slots.length && !equipBlocker(tree, draft, node)) {
      equipNode(tree, draft, slotIndex, node.key);
    }
  });
}

/* ---- geometry ------------------------------------------------------------ */
const ownIcon = (node) =>
  (node.icon && node.icon.file && !node.icon.inherited ? node.icon.file : null);

const nodeDiameter = (node) => TREE_DIAMETERS[node.size] || TREE_DIAMETERS.StandardSmall || 90;

/* Ratio the caption strip is measured with; the stylesheet's .tree-band-label
   line-height must match it, or the reserved strip and the drawn text disagree. */
const BAND_LABEL_LINE_HEIGHT = 1.2;

/* One striped band per branch group: horizontal extent from that group's node
   positions, vertical extent shared by all bands so they align like columns, and
   the gap between neighbours carved out of the facing edges only. A named group
   draws its caption in a strip reserved at the top of EVERY band, named or not, so
   the bands keep one top edge and no caption sits on the first row of nodes. */
function groupBands(nodes, tree) {
  const style = TREE_THEME.groupBands || {};
  if (!style.show && !style.showLabels) return [];
  const spans = new Map();
  let minY = Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    if (node.group < 0) continue;
    const span = spans.get(node.group);
    if (span) {
      span.min = Math.min(span.min, node.x);
      span.max = Math.max(span.max, node.x);
    } else {
      spans.set(node.group, { min: node.x, max: node.x });
    }
    minY = Math.min(minY, node.y);
    maxY = Math.max(maxY, node.y);
  }
  const groups = [...spans.keys()].sort((a, b) => a - b);
  const pad = style.padding || 0;
  const halfGap = (style.spacing || 0) / 2;
  const names = (tree && tree.groupNames) || [];
  const captionOf = (group) => (style.showLabels && names[group] ? names[group] : '');
  const labelSize = style.labelFontSize || 0;
  const labelHeight = labelSize * BAND_LABEL_LINE_HEIGHT;
  const strip = groups.some(captionOf) ? labelHeight + (style.labelSpacing || 0) : 0;
  return groups.map((group, index) => {
    const span = spans.get(group);
    const x0 = span.min - pad + (index > 0 ? halfGap : 0);
    const y1 = maxY + pad + strip;
    return {
      x0,
      x1: Math.max(span.max + pad - (index < groups.length - 1 ? halfGap : 0), x0),
      y0: minY - pad,
      y1,
      color: style.show ? (group % 2 === 0 ? style.colorA : style.colorB) : null,
      label: captionOf(group),
      labelTop: y1 - (style.labelInset || 0),
      labelHeight,
      labelSize,
      labelColor: style.labelColor,
    };
  });
}

function treeGeometry(tree) {
  const nodes = treeNodes(tree);
  const bands = groupBands(nodes, tree);
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const swallow = (x0, y0, x1, y1) => {
    box.minX = Math.min(box.minX, x0); box.maxX = Math.max(box.maxX, x1);
    box.minY = Math.min(box.minY, y0); box.maxY = Math.max(box.maxY, y1);
  };
  for (const node of nodes) {
    const half = nodeDiameter(node) / 2;
    swallow(node.x - half, node.y - half, node.x + half, node.y + half);
  }
  for (const band of bands) swallow(band.x0, band.y0, band.x1, band.y1);
  if (!nodes.length) swallow(0, 0, 1, 1);
  // Screen space: x grows right as in the layout, y flips because the layout puts
  // up at +y and rows descend into -y.
  return {
    nodes,
    bands,
    width: box.maxX - box.minX,
    height: box.maxY - box.minY,
    left: (x) => x - box.minX,
    top: (y) => box.maxY - y,
  };
}

/* ---- the page ------------------------------------------------------------ */
function treesPage(treeKey, code) {
  if (!TREES.length) {
    return h('p', { class: 'muted' }, 'This build carries no ability trees.');
  }
  const tree = TREES.find((t) => t.key === treeKey) || TREES[0];
  const draft = treeDraft(tree);
  if (code) applyBuildCode(tree, draft, code);

  const geometry = treeGeometry(tree);
  const points = h('span', { class: 'tree-points' });
  const stage = h('div', { class: 'tree-stage' });
  const canvas = h('div', { class: 'tree-canvas', style: {
    width: `${geometry.width}px`, height: `${geometry.height}px` } });
  // The canvas keeps its authored size and is scaled; this box carries the scaled
  // size, so the stage scrolls by what is drawn rather than by what was authored.
  const fitBox = h('div', { class: 'tree-fit' }, canvas);
  const links = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  links.setAttribute('class', 'tree-links');
  links.setAttribute('viewBox', `0 0 ${geometry.width} ${geometry.height}`);
  const slotRow = h('div', { class: 'tree-slots' });
  const status = h('div', { class: 'tree-status' });
  const nodeViews = [];

  // Bands, then wires, then nodes: the same order the screen stacks them in.
  for (const band of geometry.bands) {
    if (band.color) {
      canvas.append(h('div', { class: 'tree-band', style: {
        left: `${geometry.left(band.x0)}px`,
        top: `${geometry.top(band.y1)}px`,
        width: `${band.x1 - band.x0}px`,
        height: `${band.y1 - band.y0}px`,
        background: band.color,
      } }));
    }
    if (band.label) {
      canvas.append(h('div', { class: 'tree-band-label', style: {
        left: `${geometry.left(band.x0)}px`,
        top: `${geometry.top(band.labelTop)}px`,
        width: `${band.x1 - band.x0}px`,
        height: `${band.labelHeight}px`,
        fontSize: `${band.labelSize}px`,
        color: band.labelColor,
      } }, band.label));
    }
  }
  canvas.append(links);

  for (const node of geometry.nodes) {
    const parent = node.parent ? indexOf('abilities', node.parent) : null;
    if (parent) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('x1', geometry.left(parent.x));
      line.setAttribute('y1', geometry.top(parent.y));
      line.setAttribute('x2', geometry.left(node.x));
      line.setAttribute('y2', geometry.top(node.y));
      line.setAttribute('stroke-width', TREE_LINES.width || 4);
      links.append(line);
      nodeViews.push({ node, line });
    } else {
      nodeViews.push({ node, line: null });
    }
  }

  for (const view of nodeViews) {
    const node = view.node;
    const size = nodeDiameter(node);
    // A ranked node gives the bottom of its plate over to the rank readout, so its
    // symbol shrinks and lifts to leave that strip clear.
    const ranked = node.maxRank > 1;
    const inset = `${(TREE_THEME.iconInset || 0) * 100 + (ranked ? 8 : 0)}%`;
    // Only art the node itself carries: the exporter lends a modifier its branch
    // root's icon so the abilities table reads well, but the screen draws a
    // borrowed icon nowhere, and this page is that screen.
    const art = h('span', { class: 'tnode-art' },
      layer('tnode-frame', node.icon && node.icon.frame),
      tintLayer('tnode-frame-tint', node.icon && node.icon.frame),
      layer('tnode-icon', ownIcon(node), inset),
      TREE_THEME.tintIconWithState
        ? tintLayer('tnode-icon-tint', ownIcon(node), inset) : null);
    const rank = h('span', { class: 'tnode-rank' });
    // Sized off the node, the way the screen sizes it: a percentage here would
    // measure against the button's font size, not its diameter.
    rank.style.fontSize = `${Math.max(11, size * 0.18)}px`;
    const badge = h('span', { class: 'tnode-badge' });
    const el = h('button', {
      type: 'button',
      class: 'tnode' + (ranked ? ' ranked' : ''),
      style: {
        width: `${size}px`,
        height: `${size}px`,
        left: `${geometry.left(node.x) - size / 2}px`,
        top: `${geometry.top(node.y) - size / 2}px`,
      },
      'aria-label': node.name,
      onclick: () => { clickNode(tree, draft, node); refresh(); },
      // The tooltip is anchored to the node, not to the pointer, so entering is
      // the only move that has anything to say.
      onmouseenter: () => showTreeTip(el, tree, draft, node),
      onmouseleave: hideTreeTip,
      onfocus: () => showTreeTip(el, tree, draft, node),
      onblur: hideTreeTip,
    }, art, rank, badge);
    view.el = el;
    view.rank = rank;
    view.badge = badge;
    canvas.append(el);
  }

  stage.append(fitBox);

  function refresh() {
    const spent = spentPoints(tree, draft);
    points.replaceChildren(h('b', {}, `${spent}`), ` / ${tree.pointBudget} points`);
    for (const view of nodeViews) {
      const node = view.node;
      const visual = nodeVisualState(tree, draft, node);
      const rank = rankOf(draft, node);
      const slot = draft.slots.indexOf(node.key);
      // What a node IS and what a node LOOKS LIKE part ways for one case: a passive
      // that has merely become affordable is painted as though it were still locked.
      // Lit has to mean bought and nothing else - a passive is never named in the
      // slot bar, so its plate is the only place the page can say so, and a plate
      // that brightens the moment a node becomes reachable spends that signal on
      // something the player has not done. Everything the paint reaches follows this
      // (tint, dim, saturation, icon opacity, rank colour, the wire into it); the
      // purchase rules go on reading the real state.
      const paint = visual === 'Available' && !node.canEquip ? 'Locked' : visual;
      view.el.dataset.state = visual;
      view.el.dataset.paint = paint;
      view.el.style.setProperty('--tint', TREE_COLORS[paint] || '#ffffff');
      // A ranked node lights up as it fills rather than jumping to full on the
      // first point: rank 1 sits a step above the unbought dim and the last rank
      // reaches the brightness the theme paints a bought node at. Clearing the
      // properties hands the node back to the per-state rules in the stylesheet.
      // Passives start that climb higher than actives do, for the same reason the
      // paint above holds them dark until they are bought: an active is named again
      // in the slot bar, while a passive has only its plate to say it. At the old
      // floor a bought 1/3 came out darker than the very same node had looked
      // unbought, so passives now open where a hover used to have to reveal them.
      if (node.maxRank > 1 && rank > 0) {
        const filled = (rank - 1) / (node.maxRank - 1);
        const dimFloor = node.canEquip ? 0.55 : 0.74;
        const satFloor = node.canEquip ? 0.6 : 0.82;
        view.el.style.setProperty('--dim', (dimFloor + (1 - dimFloor) * filled).toFixed(3));
        view.el.style.setProperty('--sat', (satFloor + (1 - satFloor) * filled).toFixed(3));
      } else {
        view.el.style.removeProperty('--dim');
        view.el.style.removeProperty('--sat');
      }
      view.rank.textContent = node.maxRank > 1 ? `${rank}/${node.maxRank}` : '';
      view.badge.textContent = slot >= 0 ? (tree.slots[slot].binding || '') : '';
      if (view.line) {
        // A wire reads as its child's state: bought, reachable, or neither.
        view.line.setAttribute('stroke', rank > 0 ? TREE_LINES.Purchased
          : paint === 'Available' ? TREE_LINES.Available : TREE_LINES.Locked);
      }
    }
    renderTreeSlots(slotRow, tree, draft, refresh);
    if (treeTipFor && treeTipFor.isConnected) {
      const view = nodeViews.find((v) => v.el === treeTipFor);
      if (view) showTreeTip(view.el, tree, draft, view.node);
    }
  }

  function fit() {
    // Fit to width like the screen's static fit, but never past 1 - the icons are
    // 128px and blow up badly - and never below the floor either: on a phone a
    // tree scaled to a fifth is unreadable, so it stays legible and scrolls.
    const available = stage.clientWidth - 2;
    if (available <= 0 || !geometry.width) return;
    const scale = Math.max(0.45, Math.min(1, available / geometry.width));
    canvas.style.transform = `scale(${scale})`;
    fitBox.style.width = `${geometry.width * scale}px`;
    fitBox.style.height = `${geometry.height * scale}px`;
  }

  const page = h('div', { class: 'tree-page' },
    h('div', { class: 'tree-bar' },
      h('div', { class: 'tree-tabs' }, TREES.map((entry) => h('a', {
        class: 'tree-tab' + (entry === tree ? ' on' : ''),
        href: `#trees/${entry.key}`,
      }, entry.name))),
      h('div', { class: 'tree-bar-right' },
        points,
        h('button', {
          type: 'button', class: 'tree-btn',
          onclick: () => {
            draft.ranks.clear();
            draft.slots = tree.slots.map(() => null);
            status.textContent = '';
            refresh();
          },
        }, 'Reset'),
        h('button', {
          type: 'button', class: 'tree-btn',
          onclick: (event) => copyBuildLink(tree, draft, event.currentTarget, status),
        }, 'Copy build link'))),
    stage,
    h('div', { class: 'tree-footer' },
      h('div', { class: 'tree-footer-label' }, 'Loadout'),
      slotRow, status));

  page.style.setProperty('--tnode-locked-icon', TREE_THEME.lockedIconOpacity || 0.35);
  refresh();
  fit();
  // The custom pane is built before it is measured on first paint, and the stage
  // width moves with the sidebar, the drawer and the window.
  requestAnimationFrame(fit);
  if (window.ResizeObserver) new ResizeObserver(fit).observe(stage);
  else window.addEventListener('resize', fit);
  return page;
}

/* An image layer of a node: the shape plate, or the ability art inset in it. */
function layer(className, file, inset) {
  if (!file) return null;
  return h('span', { class: className, style: {
    backgroundImage: `url("${file}")`,
    inset: inset || '0',
  } });
}

/* The state colour, multiplied into the layer beneath and masked to its art so it
   tints the shape rather than a square - which is what the screen's Image.color
   does to the same sprite. */
function tintLayer(className, file, inset) {
  if (!file) return null;
  const el = h('span', { class: className, style: { inset: inset || '0' } });
  el.style.maskImage = el.style.webkitMaskImage = `url("${file}")`;
  return el;
}

/* ---- loadout slots ------------------------------------------------------- */
function renderTreeSlots(host, tree, draft, refresh) {
  host.replaceChildren(...tree.slots.map((slot, index) => {
    const node = draft.slots[index] ? indexOf('abilities', draft.slots[index]) : null;
    const plate = h('button', {
      type: 'button',
      class: 'tslot' + (node ? ' filled' : ''),
      title: node ? `${node.name} - click to change` : `${slot.name} - click to equip`,
      onclick: (event) => {
        event.stopPropagation();
        openSlotPicker(event.currentTarget, tree, draft, index, refresh);
      },
    });
    if (node) {
      const shape = (TREE_THEME.slotSprites || {})[node.shape];
      if (shape) plate.append(layer('tslot-shape', shape));
      if (node.icon && node.icon.file) plate.append(layer('tslot-icon', node.icon.file, '18%'));
      plate.append(h('span', { class: 'tslot-key filled' }, slot.binding || ''));
    } else {
      plate.append(h('span', { class: 'tslot-key' }, slot.binding || '?'));
    }
    return h('div', { class: 'tslot-wrap' }, plate,
      h('div', { class: 'tslot-name' }, node ? node.name : 'Empty'));
  }));
}

let openPicker = null;

function closeSlotPicker() {
  if (openPicker) openPicker.remove();
  openPicker = null;
}

function openSlotPicker(anchor, tree, draft, slotIndex, refresh) {
  closeSlotPicker();
  const choices = treeNodes(tree).filter((node) => !equipBlocker(tree, draft, node));
  const pick = (key) => {
    equipNode(tree, draft, slotIndex, key);
    closeSlotPicker();
    refresh();
  };
  const menu = h('div', { class: 'tslot-picker', onclick: (e) => e.stopPropagation() },
    h('div', { class: 'tslot-picker-head' },
      `${tree.slots[slotIndex].name} (${tree.slots[slotIndex].binding})`),
    choices.length ? choices.map((node) => h('button', {
      type: 'button',
      class: 'tslot-choice' + (draft.slots[slotIndex] === node.key ? ' on' : ''),
      onclick: () => pick(node.key),
    }, iconEl(node.icon), h('span', {}, node.name),
       draft.slots.includes(node.key) && draft.slots[slotIndex] !== node.key
         ? h('small', {}, 'equipped') : null))
      : h('div', { class: 'tslot-empty' },
          'Buy an active ability first.'),
    draft.slots[slotIndex] ? h('button', {
      type: 'button', class: 'tslot-choice clear', onclick: () => pick(null),
    }, 'Clear slot') : null);
  anchor.parentElement.append(menu);
  openPicker = menu;
}

function copyBuildLink(tree, draft, button, status) {
  const code = buildCode(tree, draft);
  const link = `${location.origin}${location.pathname}#trees/${tree.key}${code ? `/${code}` : ''}`;
  const done = (ok) => {
    status.textContent = ok ? 'Build link copied to the clipboard.' : link;
    button.textContent = ok ? 'Copied' : 'Copy build link';
    if (ok) setTimeout(() => { button.textContent = 'Copy build link'; }, 1600);
  };
  // navigator.clipboard is unavailable on file:// in some browsers; showing the
  // link to copy by hand beats a button that silently does nothing.
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(link).then(() => done(true), () => done(false));
  } else {
    done(false);
  }
}

const pointsText = (n) => `${n} point${n === 1 ? '' : 's'}`;

/* ---- node tooltip -------------------------------------------------------- */
/* The screen's tooltip is name + description; this one adds what a planner wants
   in front of them - cost, payload, and the reason a locked node is locked. */
let treeTip = null;
let treeTipFor = null;
let treeTipTimer = null;

function showTreeTip(anchor, tree, draft, node) {
  if (!treeTip) {
    treeTip = h('div', {
      class: 'tree-tip',
      // Crossing the gap from node to tooltip must not dismiss it, or a link
      // inside could never be reached.
      onmouseenter: () => clearTimeout(treeTipTimer),
      onmouseleave: hideTreeTip,
    });
    document.body.append(treeTip);
  }
  clearTimeout(treeTipTimer);
  treeTipFor = anchor;
  const blocker = purchaseBlocker(tree, draft, node);
  const rank = rankOf(draft, node);
  const cost = costOfRank(node, rank + 1);
  // A branch usually takes its name from the ability at its root, and repeating
  // that under the title says nothing; the category always does.
  const kicker = [node.category,
    node.branchName && node.branchName !== node.name ? `${node.branchName} branch` : null,
    node.maxRank > 1 ? `rank ${rank}/${node.maxRank}` : null].filter(Boolean).join(' - ');

  treeTip.replaceChildren(
    abilityDetail(node, { onTree: true, kicker }),
    // What a click would actually do, in the order clickNode decides it: the next
    // rank when one is affordable, otherwise emptying a node that holds points.
    h('div', { class: 'tree-tip-foot' },
      !blocker
        ? h('span', { class: 'ok' },
            `Click to ${rank > 0 ? `raise to rank ${rank + 1}` : 'buy'} - ${pointsText(cost)}`)
        : rank > 0
          ? h('span', { class: 'ok' },
              `Bought for ${pointsText(costUpToRank(node, rank))}. Click to refund.`)
          : h('span', { class: 'no' }, blocker),
      node.canEquip ? h('span', { class: 'dim' }, 'Can be slotted') : null));

  // Beside the node rather than over it, and always fully on screen: the detail
  // is tall enough that an above/below placement would run off the top.
  const box = anchor.getBoundingClientRect();
  treeTip.hidden = false;
  const tip = treeTip.getBoundingClientRect();
  const gap = 12;
  let left = box.right + gap;
  if (left + tip.width > window.innerWidth - 8) left = box.left - gap - tip.width;
  if (left < 8) {
    left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2),
      window.innerWidth - tip.width - 8);
  }
  treeTip.style.left = `${Math.max(8, left)}px`;
  treeTip.style.top = `${Math.min(Math.max(8, box.top + box.height / 2 - tip.height / 2),
    Math.max(8, window.innerHeight - tip.height - 8))}px`;
}

/* Hidden on a delay, so the pointer can travel from the node into the tooltip
   without it vanishing on the way. */
function hideTreeTip() {
  clearTimeout(treeTipTimer);
  treeTipTimer = setTimeout(() => {
    if (treeTip) treeTip.hidden = true;
    treeTipFor = null;
  }, 160);
}

/* ---- table rendering ----------------------------------------------------- */
const state = { section: SECTIONS[0], selected: null, filter: '', facets: {}, sort: null, asc: true };

function matches(row, query) {
  if (!query) return true;
  const haystack = [row.name, row.description, row.effectSummary, row.tree,
    row.category, row.kind, row.axis, row.group, row.assetName]
    .filter(Boolean).join(' ').toLowerCase();
  return query.toLowerCase().split(/\s+/).every((word) => haystack.includes(word));
}

function visibleRows() {
  const section = state.section;
  let rows = section.rows.filter((row) => matches(row, state.filter));
  for (const [label, chosen] of Object.entries(state.facets)) {
    if (!chosen.size) continue;
    const facet = section.facets.find((f) => f.label === label);
    rows = rows.filter((row) => facet.get(row).some((value) => chosen.has(value)));
  }
  if (state.sort) {
    const column = section.columns.find((c) => c.key === state.sort);
    const get = column.sort || ((row) => row.name);
    rows = [...rows].sort((a, b) => {
      const x = get(a); const y = get(b);
      const result = typeof x === 'number' && typeof y === 'number'
        ? x - y : String(x).localeCompare(String(y));
      return state.asc ? result : -result;
    });
  }
  return rows;
}

function renderSidebar() {
  const nav = $('nav-items');
  nav.replaceChildren(h('div', { class: 'nav-sep' }, 'Database'),
    ...SECTIONS.map((section) => h('a', {
      class: 'nav-item' + (section === state.section ? ' active' : ''),
      href: `#${section.id}`,
    }, h('span', { class: 'nav-label' }, navIcon(section.id), h('span', {}, section.label)),
      h('span', { class: 'count' }, section.rows.length))));
}

function applyFacet(sectionId, label, value) {
  if (SECTION_BY_ID[sectionId] !== state.section) {
    pendingFacet = { label, value };
    location.hash = `#${sectionId}`;
    return;
  }
  const chosen = state.facets[label] || (state.facets[label] = new Set());
  const alreadyOnlyThis = chosen.size === 1 && chosen.has(value);
  chosen.clear();
  if (!alreadyOnlyThis) chosen.add(value);
  renderFacets();
  renderTable();
  renderDetail();
}

/* One menu at a time: two open menus overlap each other. */
function closeFacetMenus() {
  for (const dd of document.querySelectorAll('.facet-dd.open')) dd.classList.remove('open');
}

/* One facet group as a multi-select button. Rows of pills cost a group's worth
   of vertical space each - which a phone does not have, and which a table-first
   page should not spend at any width; every group as a dropdown costs one row
   for all of them. */
function facetDropdown(facet, values, chosen) {
  const summarise = () => (chosen.size === 1 ? [...chosen][0]
    : chosen.size ? `${chosen.size} selected` : '');
  const summary = h('span', { class: 'facet-summary' }, summarise());
  const options = values.map((value) => {
    const option = h('div', {
      // The tone class its chip wears in the table, so a value reads as the
      // same thing in the filter as in the rows it filters to.
      class: 'facet-option' + (facet.tone ? ` ${facet.tone(value)}` : '')
        + (chosen.has(value) ? ' on' : ''),
      onclick: () => {
        chosen.has(value) ? chosen.delete(value) : chosen.add(value);
        option.classList.toggle('on', chosen.has(value));
        refresh();
      },
    }, h('span', { class: 'facet-box' }), h('span', {}, value));
    return option;
  });
  const clear = h('div', {
    class: 'facet-option clear' + (chosen.size ? '' : ' on'),
    onclick: () => {
      if (!chosen.size) return;
      chosen.clear();
      options.forEach((option) => option.classList.remove('on'));
      refresh();
    },
  }, h('span', { class: 'facet-box' }), h('span', {}, 'All'));
  const button = h('button', {
    type: 'button',
    class: 'facet-button' + (chosen.size ? ' on' : ''),
    onclick: (event) => {
      event.stopPropagation();
      const opening = !dd.classList.contains('open');
      closeFacetMenus();
      // Hang the menu off whichever edge keeps it on screen.
      dd.classList.toggle('right', dd.getBoundingClientRect().left > window.innerWidth / 2);
      dd.classList.toggle('open', opening);
    },
  }, h('span', { class: 'facet-name' }, facet.label), summary,
     h('span', { class: 'facet-caret' }, '\u25be'));
  // Ticking a value redraws the table and this button in place rather than
  // through renderFacets(), which would rebuild the menu and close it under
  // the finger halfway through a multi-select.
  const refresh = () => {
    summary.textContent = summarise();
    button.classList.toggle('on', chosen.size > 0);
    clear.classList.toggle('on', !chosen.size);
    renderTable();
    renderDetail();
  };
  const dd = h('div', { class: 'facet-dd' }, button,
    h('div', { class: 'facet-menu', onclick: (event) => event.stopPropagation() },
      clear, options));
  return dd;
}

/* The sidebar is a drawer once it no longer fits beside the table; the class on
   <body> drives both it and the scrim behind it. */
function setNav(open) {
  document.body.classList.toggle('nav-open', open);
  $('nav-toggle').setAttribute('aria-expanded', open ? 'true' : 'false');
}

function renderFacets() {
  const host = $('facets');
  host.replaceChildren(...state.section.facets.flatMap((facet) => {
    const values = [...new Set(state.section.rows.flatMap((row) => facet.get(row)))]
      .filter(Boolean).sort();
    // A group every row shares filters nothing, so it gets no control.
    if (values.length < 2) return [];
    const chosen = state.facets[facet.label] || (state.facets[facet.label] = new Set());
    return [facetDropdown(facet, values, chosen)];
  }));
}

function renderTable() {
  const section = state.section;
  $('thead').replaceChildren(h('tr', {}, section.columns.map((column) => h('th', {
    // The header carries the column's own class so that a column hidden on a
    // narrow screen takes its header with it: a th left behind puts every cell
    // after it under the wrong label.
    class: (column.cls || '') + (state.sort === column.key ? ' sorted' : ''),
    onclick: () => {
      state.asc = state.sort === column.key ? !state.asc : true;
      state.sort = column.key;
      renderTable();
    },
  }, column.label, state.sort === column.key
    ? h('span', { class: 'arrow' }, state.asc ? ' ▲' : ' ▼') : ''))));

  const rows = visibleRows();
  $('empty').hidden = rows.length > 0;
  $('tbody').replaceChildren(...rows.map((row) => h('tr', {
    class: state.selected === row ? 'selected' : '',
    onclick: (event) => {
      if (event.target.closest('a')) return;
      location.hash = `#${section.id}/${row.key}`;
    },
  }, section.columns.map((column) =>
    h('td', { class: column.cls || '' }, column.get(row))))));
}

function renderDetail() {
  const pane = $('detail-pane');
  if (!state.selected) {
    $('detail').replaceChildren(h('div', { class: 'detail-empty' },
      'Select a row to see its full data.'));
    pane.classList.remove('open');
    return;
  }
  $('detail').replaceChildren(state.section.detail(state.selected));
  $('detail').scrollTop = 0;
  pane.classList.add('open');
}

/* ---- global search ------------------------------------------------------- */
function renderSearch(query) {
  const box = $('search-results');
  if (query.trim().length < 2) { box.hidden = true; return; }
  const groups = SECTIONS.map((section) => ({
    section,
    hits: section.rows.filter((row) => matches(row, query)).slice(0, 6),
  })).filter((group) => group.hits.length);

  if (!groups.length) {
    box.replaceChildren(h('div', { class: 'search-hit muted' }, 'No matches.'));
    box.hidden = false;
    return;
  }
  box.replaceChildren(...groups.flatMap((group) => [
    h('div', { class: 'search-group' }, group.section.label),
    ...group.hits.map((row) => h('div', {
      class: 'search-hit',
      onmousedown: () => { location.hash = `#${group.section.id}/${row.key}`; },
    }, iconEl(row.icon), h('span', {}, row.name),
      h('small', {}, row.description || row.effectSummary || ''))),
  ]));
  box.hidden = false;
}

/* ---- routing ------------------------------------------------------------- */
let pendingFacet = null;

// Ability perks used to be their own section; keep old links working.
const SECTION_ALIASES = { abilityPerks: 'perks' };

function route() {
  // A custom section may take an argument of its own after the key (the ability
  // tree page takes a build code), so the tail of the hash is kept, not dropped.
  const [rawSection, key, ...rest] = decodeURIComponent(
    location.hash.replace(/^#/, '')).split('/');
  const sectionId = SECTION_ALIASES[rawSection] || rawSection;
  const section = SECTION_BY_ID[sectionId] || SECTIONS[0];
  if (section !== state.section) {
    state.section = section;
    state.filter = '';
    state.facets = {};
    state.sort = null;
    state.asc = true;
    $('filter').value = '';
  }
  // A chip clicked from another section asked for this filter; apply it after
  // the reset above so it survives the navigation.
  if (pendingFacet) {
    state.facets[pendingFacet.label] = new Set([pendingFacet.value]);
    pendingFacet = null;
  }
  closeFacetMenus();
  setNav(false);
  renderFacets();
  state.selected = key ? section.index.get(key) || null : null;
  // The page title wears the same glyph as its sidebar entry, so the two read
  // as one thing rather than two labels that happen to match.
  $('section-title').replaceChildren(
    ...[navIcon(section.id)].filter(Boolean), document.createTextNode(section.label));
  const blurb = $('section-blurb');
  blurb.textContent = section.blurb || '';
  blurb.hidden = !section.blurb;
  renderSidebar();
  // A custom section owns the whole pane: no filter row, no table, no detail.
  const custom = typeof section.custom === 'function';
  document.querySelector('.controls').hidden = custom;
  $('table').hidden = custom;
  $('empty').hidden = true;
  $('custom').hidden = !custom;
  document.querySelector('.detail-pane').hidden = custom;
  if (custom) {
    $('custom').replaceChildren(section.custom(key, rest.join('/')));
    return;
  }
  $('custom').replaceChildren();
  renderTable();
  renderDetail();
  if (state.selected) {
    const row = $('tbody').querySelector('tr.selected');
    if (row) row.scrollIntoView({ block: 'nearest' });
  }
}

function init() {
  const counts = (DB.meta && DB.meta.counts) || {};
  // The stamp exists twice - under the sidebar nav on wide screens, as a footer
  // on phones - so both copies are filled by class.
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  for (const el of document.querySelectorAll('.version')) {
    if (DB.meta && DB.meta.version) el.textContent = `v${DB.meta.version}`;
    else el.hidden = true;
  }
  for (const el of document.querySelectorAll('.generated')) {
    el.textContent = DB.meta ? `${total} entries - built ${DB.meta.generated}` : '';
  }
  $('filter').addEventListener('input', (event) => {
    state.filter = event.target.value;
    renderTable();
  });
  const search = $('global-search');
  search.addEventListener('input', () => renderSearch(search.value));
  search.addEventListener('blur', () => setTimeout(() => { $('search-results').hidden = true; }, 120));
  search.addEventListener('focus', () => renderSearch(search.value));
  $('detail-close').addEventListener('click', () => {
    location.hash = `#${state.section.id}`;
  });
  $('nav-toggle').addEventListener('click', (event) => {
    event.stopPropagation();
    setNav(!document.body.classList.contains('nav-open'));
  });
  $('nav-scrim').addEventListener('click', () => setNav(false));
  // A nav item for the section already showing changes no hash, so route()
  // never runs to close the drawer behind it.
  $('sidebar').addEventListener('click', (event) => {
    if (event.target.closest('a')) setNav(false);
  });
  document.addEventListener('click', closeFacetMenus);
  document.addEventListener('click', closeSlotPicker);
  const filter = $('filter');
  document.addEventListener('keydown', (event) => {
    // Ctrl/Cmd+K goes to the table filter, "/" to the global search - the same
    // split the shortcut hints inside the two fields advertise.
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault(); filter.focus(); filter.select();
      return;
    }
    if (event.key === '/' && document.activeElement !== search
        && document.activeElement !== filter) {
      event.preventDefault(); search.focus(); search.select();
    }
    if (event.key === 'Escape') {
      search.blur(); filter.blur(); $('search-results').hidden = true;
      closeFacetMenus(); closeSlotPicker(); hideTreeTip(); setNav(false);
    }
  });
  window.addEventListener('hashchange', route);
  renderFacets();
  route();
}

if (!DB.meta) {
  document.body.replaceChildren(h('p', { style: { padding: '40px', color: '#e06060' } },
    'data.js did not load. Re-run Tools/DatabaseSite/build_site.py.'));
} else {
  init();
}
