// Pyde Design: the Pyde Design team's Figma tools in one plugin.
//
//  - Handoff Pre Checklist  a handoff checklist stored on a root frame / section
//  - Design ReadMe          status, owners and links on a section, drawn as a card inside it
//  - Frame Note             designer notes drawn as a card right below a frame
//  - Image Optimizer        shrinks oversized images to the size they are displayed at
//  - Title Maker            adds a title bar above selected frames and lines them up
//
// Every tool is also in the plugin's menu (manifest `menu`); picking one there opens this plugin
// straight on that tool (figma.command). The tools keep the storage keys of the separate plugins
// they came from, so data already saved in files keeps working.
//
// The UI talks to each tool through messages carrying `f` (the tool's id). Selection changes only go
// to the tool currently on screen (`active`).

figma.showUI(__html__, { width: 360, height: 600, themeColors: true });

const TOOLS = ['checklist', 'readme', 'note', 'images', 'titles'];
const LANG_KEY = 'pyde-lang';
const ADMIN_KEY = 'pyde-admin-token';
let lang = 'en';
let active = null; // the tool on screen, null on the home screen
const startRoute = TOOLS.indexOf(figma.command) !== -1 ? figma.command : null;

function t(en, tr) { return lang === 'tr' ? tr : en; }
function post(f, m) { figma.ui.postMessage(Object.assign({ f }, m)); }

// ---------- Shared helpers ----------

function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
}
function solid(h, opacity) {
  return { type: 'SOLID', color: hex(h), opacity: opacity === undefined ? 1 : opacity };
}
function userName() {
  return figma.currentUser && figma.currentUser.name ? figma.currentUser.name : 'Unknown';
}
function pageOf(node) {
  let n = node;
  while (n && n.type !== 'PAGE') n = n.parent;
  return n;
}
function pad(n) { return (n < 10 ? '0' : '') + n; }
function fmtDate(ts) {
  const d = new Date(ts);
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return d.getDate() + ' ' + M[d.getMonth()] + ' ' + d.getFullYear() + ', ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}
// The cards and titles on the canvas use DM Sans (it comes with Figma, like all Google Fonts).
// Inter is only a fallback in case DM Sans can't be loaded.
const CARD_FONT_STYLES = {
  regular: ['Regular', 'Regular'],
  medium: ['Medium', 'Medium'],
  semibold: ['SemiBold', 'Semi Bold'],
  bold: ['Bold', 'Bold']
};
let cardFonts = null;
async function loadCardFonts() {
  if (cardFonts) return cardFonts;
  for (const [i, family] of [[0, 'DM Sans'], [1, 'Inter']]) {
    const set = {};
    for (const k of Object.keys(CARD_FONT_STYLES)) set[k] = { family, style: CARD_FONT_STYLES[k][i] };
    try {
      await Promise.all(Object.keys(set).map((k) => figma.loadFontAsync(set[k])));
      return (cardFonts = set);
    } catch (e) {}
  }
  throw new Error(t('The card fonts couldn’t be loaded.', 'Kart fontları yüklenemedi.'));
}

// Relaunch data can't be set on some nodes (e.g. inside a library instance); that only loses the button.
function relaunch(node, data) {
  try { node.setRelaunchData(data); } catch (e) {}
}

// ---------- Drafts ----------
// Unsaved Frame Note and Design ReadMe edits are kept on this computer while typing, so they survive the
// plugin being closed (Figma closes a running plugin when someone clicks into a widget, for example).
// A draft is keyed by file + tool + node id; the file gets a random token in this plugin's private data,
// since node ids repeat across files. Drafts older than a week are dropped.

const DRAFTS_KEY = 'pyde-drafts';
const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;
let drafts = {};
let fileToken = null;

async function loadDrafts() {
  const saved = await figma.clientStorage.getAsync(DRAFTS_KEY);
  drafts = saved && typeof saved === 'object' ? saved : {};
  const now = Date.now();
  for (const k of Object.keys(drafts)) if (!drafts[k] || now - drafts[k].at > DRAFT_TTL) delete drafts[k];
}
function draftKey(tool, id) {
  if (!fileToken) {
    fileToken = figma.root.getPluginData('fileToken');
    if (!fileToken) {
      fileToken = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      try { figma.root.setPluginData('fileToken', fileToken); } catch (e) {}
    }
  }
  return fileToken + '|' + tool + '|' + id;
}
function getDraft(tool, id) {
  const d = drafts[draftKey(tool, id)];
  return d ? d.data : null;
}
// `data` null clears the draft.
async function setDraft(tool, id, data) {
  const k = draftKey(tool, id);
  if (data) drafts[k] = { data, at: Date.now() };
  else if (drafts[k]) delete drafts[k];
  else return;
  await figma.clientStorage.setAsync(DRAFTS_KEY, drafts);
}

// The cards drawn by Design ReadMe and Frame Note, and the titles made by Title Maker, are frames that
// sit directly in a section, like the designs themselves. The other tools ignore them.
function isToolCard(node) {
  return node.type === 'FRAME' &&
    (node.getSharedPluginData('pydespec', 'card') !== '' || node.getSharedPluginData('pydenote', 'card') !== '' ||
     node.getSharedPluginData('pydetitle', 'title') !== '');
}

// =====================================================================================
// Handoff Pre Checklist
// Checklist state lives on the selected frame / section (shared plugin data).
// Since the data is stored in the file itself, every designer opening it sees the same status.
// =====================================================================================

const Checklist = (() => {
  const NS = 'pydehandoff'; // namespace may only contain letters and digits
  const KEY = 'checklist';

  // The checklist only attaches to the node that is selected directly:
  // a section, or a root frame (a frame directly on the page or directly inside a section).
  // Nested frames and inner layers are not valid targets.
  function resolveTarget(node) {
    if (node.type === 'SECTION') return node;
    if (node.type === 'FRAME' && !isToolCard(node) && node.parent &&
        (node.parent.type === 'PAGE' || node.parent.type === 'SECTION')) return node;
    return null;
  }

  function readData(node) {
    try {
      const raw = node.getSharedPluginData(NS, KEY);
      if (raw) {
        const d = JSON.parse(raw);
        return { done: Array.isArray(d.done) ? d.done : [], by: d.by || null, at: d.at || null };
      }
    } catch (e) {}
    return { done: [], by: null, at: null };
  }

  function writeData(node, done) {
    node.setSharedPluginData(NS, KEY, JSON.stringify({ done, by: userName(), at: Date.now() }));
  }

  function currentTargets() {
    const seen = new Set();
    const targets = [];
    for (const n of figma.currentPage.selection) {
      const tg = resolveTarget(n);
      if (tg && !seen.has(tg.id)) { seen.add(tg.id); targets.push(tg); }
    }
    return targets;
  }

  function pushState() {
    const targets = currentTargets();
    if (targets.length === 0) return post('checklist', { type: 'state', status: 'none' });
    if (targets.length > 1) return post('checklist', { type: 'state', status: 'multiple', count: targets.length });
    const tg = targets[0];
    const data = readData(tg);
    post('checklist', {
      type: 'state',
      status: 'ok',
      target: {
        id: tg.id,
        name: tg.name,
        kind: tg.type === 'SECTION' ? 'Section' : 'Frame',
        section: tg.parent && tg.parent.type === 'SECTION' ? tg.parent.name : null,
        page: figma.currentPage.name
      },
      done: data.done,
      by: data.by,
      at: data.at
    });
  }

  async function onMessage(msg) {
    if (msg.type === 'refresh') return pushState();
    if (msg.type === 'toggle' || msg.type === 'reset') {
      const node = await figma.getNodeByIdAsync(msg.id);
      if (!node) return pushState();
      try {
        // Re-read the latest data and change only this item, so two designers working
        // at the same time don't overwrite each other. `legacy` is the item's old
        // (pre-id) key, removed too so old entries can still be unchecked.
        const done = msg.type === 'reset'
          ? []
          : readData(node).done.filter((x) => x !== msg.item && x !== msg.legacy);
        if (msg.type === 'toggle' && msg.value) done.push(msg.item);
        writeData(node, done);
      } catch (e) {
        figma.notify(t('Could not save: ', 'Kaydedilemedi: ') + (e && e.message ? e.message : e), { error: true });
      }
      pushState();
    }
  }

  return { activate: pushState, refresh: pushState, onMessage };
})();

// =====================================================================================
// Design ReadMe ("Tasarım Künyesi"): a structured note attached to a section that developers
// and their AI agents (Claude via Figma MCP) read before implementing the design.
//
// The ReadMe lives in two places:
//  - as JSON in shared plugin data on the section (source of truth, read by this plugin)
//  - as a normal frame of plain text layers inside the section (the "card"), so Figma MCP and
//    Dev Mode read it whenever they read the section
// The card is always written in English, whatever the plugin's interface language is.
//
// Storage keys still say "spec" (the tool's earlier name) so existing files keep working.
// =====================================================================================

const ReadMe = (() => {
  const NS = 'pydespec'; // namespace may only contain letters and digits
  const KEY = 'spec';
  const CARD_KEY = 'card';
  const IDX_PREFIX = 'idx:'; // per-section index entries on the document root, used by the overview
  const CARD_NAME = '📋 Design ReadMe';

  // `color` is the status pill on the card.
  // `emoji` goes into the section's layer name (see syncName).
  const STATUSES = {
    wip: { label: 'Work in progress', emoji: '🚧', color: '#D97706' },
    review: { label: 'In review', emoji: '👀', color: '#7C5CFF' },
    ready: { label: 'Ready for development', emoji: '✅', color: '#14A367' }
  };

  // ---------- Sections & cards ----------

  function isCard(node) {
    return node.type === 'FRAME' && node.getSharedPluginData(NS, CARD_KEY) !== '';
  }
  function cardInfo(card) {
    try { return JSON.parse(card.getSharedPluginData(NS, CARD_KEY)) || {}; } catch (e) { return {}; }
  }
  // Earlier versions could also attach a card to a frame (kind 'frame', placed next to it).
  // Those are left alone: they never count as the card of the section they happen to sit in.
  function isSectionCard(node) {
    return isCard(node) && cardInfo(node).kind !== 'frame';
  }

  // Resolves a selected node to its section. Selecting the card (or anything inside it) resolves
  // to the section it sits in, so the relaunch button works from the card too.
  function resolveTarget(node) {
    for (let n = node; n && n.type !== 'PAGE' && n.type !== 'DOCUMENT'; n = n.parent) {
      if (isCard(n)) return isSectionCard(n) && n.parent && n.parent.type === 'SECTION' ? n.parent : null;
    }
    return node.type === 'SECTION' ? node : null;
  }

  function findCard(section) {
    const card = section.children.find(isSectionCard);
    // A copied section carries a copy of the card that still points at the original section.
    if (card && cardInfo(card).targetId !== section.id) {
      card.setSharedPluginData(NS, CARD_KEY, JSON.stringify({ kind: 'section', targetId: section.id }));
    }
    return card || null;
  }

  function readSpec(node) {
    try {
      const raw = node.getSharedPluginData(NS, KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const o = d.owners || {};
      return {
        v: 1,
        status: STATUSES[d.status] ? d.status : 'wip',
        owners: {
          design: Array.isArray(o.design) ? o.design : [],
          dev: Array.isArray(o.dev) ? o.dev : [],
          product: Array.isArray(o.product) ? o.product : []
        },
        jira: Array.isArray(d.jira) ? d.jira : [],
        slack: Array.isArray(d.slack) ? d.slack : [],
        notes: typeof d.notes === 'string' ? d.notes : '',
        by: d.by || null,
        at: d.at || null,
        ready: d.ready ? { at: d.ready.at, by: d.ready.by } : null // when, and by whom, it was marked Ready
      };
    } catch (e) {
      return null;
    }
  }
  function writeSpec(node, data) {
    node.setSharedPluginData(NS, KEY, JSON.stringify(data));
  }

  // ---------- Card rendering ----------

  // Ink colors are translucent black over the sticky note's paper color.
  const STICKY = '#FFEFA6';
  const LINK = '#2B49D6';
  const INK = { text: 1, secondary: 0.62, tertiary: 0.4 };
  let FONTS = null; // DM Sans (see loadCardFonts)
  async function ensureFonts() {
    FONTS = await loadCardFonts();
  }

  // `color` is a hex, or one of the INK levels ('text' | 'secondary' | 'tertiary').
  function text(chars, font, size, color, name) {
    const tx = figma.createText();
    tx.fontName = FONTS[font];
    tx.fontSize = size;
    tx.characters = chars;
    tx.fills = [INK[color] !== undefined ? solid('#1E1E1E', INK[color]) : solid(color)];
    tx.lineHeight = { unit: 'PERCENT', value: 145 };
    if (name) tx.name = name;
    return tx;
  }
  function stack(name, dir, gap) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = dir;
    f.itemSpacing = gap;
    f.fills = [];
    f.clipsContent = false;
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    return f;
  }
  // Appends a child; `fill` stretches it to the parent's width (text then wraps).
  function put(parent, child, fill) {
    parent.appendChild(child);
    if (fill) {
      child.layoutSizingHorizontal = 'FILL';
      if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT';
    }
    return child;
  }

  function heading(parent, label) {
    const tx = put(parent, text(label.toUpperCase(), 'bold', 11, 'secondary', label), true);
    tx.letterSpacing = { unit: 'PERCENT', value: 6 };
  }

  function label(parent, chars) {
    const l = put(parent, text(chars, 'medium', 13, 'secondary', 'Label'));
    l.resize(104, l.height);
    l.textAutoResize = 'HEIGHT';
  }

  function row(parent, name, value, empty) {
    const r = put(parent, stack(name, 'HORIZONTAL', 12), true);
    label(r, name);
    put(r, text(value || empty, 'regular', 13, value ? 'text' : 'tertiary', 'Value'), true);
  }

  function links(parent, name, urls) {
    const r = put(parent, stack(name, 'HORIZONTAL', 12), true);
    label(r, name);
    const col = put(r, stack('Links', 'VERTICAL', 4), true);
    if (!urls.length) {
      put(col, text('None', 'regular', 13, 'tertiary', 'Value'), true);
      return;
    }
    for (const url of urls) {
      const tx = put(col, text(url, 'regular', 13, LINK, 'Link'), true);
      try {
        tx.setRangeHyperlink(0, url.length, { type: 'URL', value: url });
        tx.textDecoration = 'UNDERLINE';
      } catch (e) {}
    }
  }

  function renderCard(card, section, data) {
    const st = STATUSES[data.status];
    for (const c of card.children.slice()) c.remove();

    card.name = CARD_NAME + ' — ' + baseName(section);
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(440, card.height);
    card.itemSpacing = 20;
    card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 28;
    // Sticky note look: flat paper color, nearly square corners, soft lifted shadow.
    card.cornerRadius = 4;
    card.fills = [solid(STICKY)];
    card.strokes = [];
    card.effects = [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 1 },
        radius: 3, spread: 0, visible: true, blendMode: 'NORMAL' },
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 10 },
        radius: 24, spread: -4, visible: true, blendMode: 'NORMAL' }
    ];

    // Header: eyebrow + status pill, then the section name and a one-line instruction for readers.
    const top = put(card, stack('Header', 'HORIZONTAL', 12), true);
    top.primaryAxisAlignItems = 'SPACE_BETWEEN';
    top.counterAxisAlignItems = 'CENTER';
    put(top, text('📋 DESIGN README', 'bold', 12, 'secondary', 'Eyebrow'));
    const pill = put(top, stack('Status', 'HORIZONTAL', 0));
    pill.paddingTop = pill.paddingBottom = 5;
    pill.paddingLeft = pill.paddingRight = 12;
    pill.cornerRadius = 999;
    pill.fills = [solid(st.color)];
    put(pill, text(st.label, 'bold', 12, '#FFFFFF', 'Status label'));

    const titles = put(card, stack('Title', 'VERTICAL', 6), true);
    put(titles, text(baseName(section), 'bold', 22, 'text', 'Name'), true);
    put(titles, text(
      'Documents the section this card sits in. Developers and AI agents (e.g. Claude): read this card before implementing the design.',
      'regular', 12, 'secondary', 'About'), true);

    const status = put(card, stack('Status details', 'VERTICAL', 8), true);
    heading(status, 'Status');
    row(status, 'Status', st.label, '');
    if (data.status === 'ready' && data.ready) {
      row(status, 'Ready since', fmtDate(data.ready.at) + ' · ' + data.ready.by, '');
    }

    const owners = put(card, stack('Owners', 'VERTICAL', 8), true);
    heading(owners, 'Owners');
    row(owners, 'Design', data.owners.design.join(', '), 'Not assigned');
    row(owners, 'Development', data.owners.dev.join(', '), 'Not assigned');
    row(owners, 'Product', data.owners.product.join(', '), 'Not assigned');

    const ls = put(card, stack('Links', 'VERTICAL', 8), true);
    heading(ls, 'Links');
    links(ls, 'Jira', data.jira);
    links(ls, 'Slack', data.slack);

    const notes = put(card, stack('Notes', 'VERTICAL', 8), true);
    heading(notes, 'Notes');
    put(notes, text(data.notes.trim() || 'No notes.', 'regular', 14, data.notes.trim() ? 'text' : 'tertiary', 'Notes'), true);

    const line = figma.createRectangle();
    line.name = 'Divider';
    line.resize(10, 1);
    line.fills = [solid('#1E1E1E', 0.12)];
    put(card, line, true);
    put(card, text('Last updated by ' + data.by + ' · ' + fmtDate(data.at), 'regular', 11, 'tertiary', 'Last updated'), true);
  }

  // The card sits this far from the section's left and top edges: 100, like Figma's own "Resize to fit"
  // for sections. Cards placed before v1.4.1 sit at 96 and still count as placed by the plugin.
  const CARD_INSET = 100;
  const LEGACY_INSET = 96;
  const CARD_GAP = 96;   // minimum space between the card and the content below it

  // Grows a section so the card fits inside it, with breathing room.
  function fitSection(section, card) {
    const w = Math.max(section.width, card.x + card.width + CARD_INSET);
    const h = Math.max(section.height, card.y + card.height + CARD_INSET);
    if (w !== section.width || h !== section.height) section.resizeWithoutConstraints(w, h);
  }

  // Moves the section's other content down (or up) by `dy` and resizes the section with it.
  function shiftContent(section, card, dy, onlyBelow) {
    if (!dy) return;
    for (const c of section.children) {
      if (c.id === card.id || (onlyBelow !== undefined && c.y < onlyBelow)) continue;
      c.y += dy;
    }
    section.resizeWithoutConstraints(section.width, Math.max(1, section.height + dy));
  }

  // Top-left corner; everything else moves down so it starts CARD_GAP below the card.
  function placeNewCard(card, section) {
    card.x = CARD_INSET;
    card.y = CARD_INSET;
    const others = section.children.filter((c) => c.id !== card.id);
    if (others.length) {
      const top = Math.min.apply(null, others.map((c) => c.y));
      const dy = card.y + card.height + CARD_GAP - top;
      if (dy > 0) shiftContent(section, card, dy);
    }
  }

  function upsertCard(section, data) {
    let card = findCard(section);
    const isNew = !card;
    if (isNew) {
      card = figma.createFrame();
      section.appendChild(card);
    }
    card.setSharedPluginData(NS, CARD_KEY, JSON.stringify({ kind: 'section', targetId: section.id }));
    const oldBottom = isNew ? 0 : card.y + card.height;
    renderCard(card, section, data);
    if (isNew) {
      placeNewCard(card, section);
    } else if ((card.x === CARD_INSET && card.y === CARD_INSET) || (card.x === LEGACY_INSET && card.y === LEGACY_INSET)) {
      // The card got taller or shorter: move the content below it by the same amount,
      // so the space between them stays as it was. Skipped if someone moved the card
      // (or it was placed by an older version), since then it isn't above the content.
      shiftContent(section, card, card.y + card.height - oldBottom, oldBottom);
    }
    fitSection(section, card);
    return card;
  }

  // The "Edit Design ReadMe" button in the right panel opens this plugin on the ReadMe tool.
  // ReadMes saved by the old standalone plugin get the button the first time this tool sees them.
  const relaunched = new Set();
  function setRelaunch(section, card, data) {
    const d = { readme: 'Design ReadMe · ' + STATUSES[data.status].label };
    relaunch(section, d);
    if (card) relaunch(card, d);
    relaunched.add(section.id);
  }

  // The section's layer name shows its status after an em dash, e.g. "Checkout Flow — ✅ Ready for development",
  // so the status is visible on the canvas, in the layers panel and to anyone reading the file via Figma MCP.
  const NAME_SEP = ' — ';
  const LEGACY_READY_PREFIX = '✅ Ready · '; // used by v1.3.0

  function statusSuffix(status) {
    return NAME_SEP + STATUSES[status].emoji + ' ' + STATUSES[status].label;
  }
  function baseName(node) {
    let name = node.name;
    if (name.indexOf(LEGACY_READY_PREFIX) === 0) name = name.slice(LEGACY_READY_PREFIX.length);
    for (const k of Object.keys(STATUSES)) {
      const suffix = statusSuffix(k);
      if (name.length > suffix.length && name.slice(-suffix.length) === suffix) return name.slice(0, -suffix.length);
    }
    return name;
  }
  // `status` null removes the suffix (ReadMe removed).
  function syncName(section, status) {
    const name = baseName(section) + (status ? statusSuffix(status) : '');
    if (section.name !== name) section.name = name;
  }

  // ---------- Overview index ----------
  // One key per section on the document root, so two people saving at once never overwrite each other.

  function writeIndex(section, data) {
    const p = pageOf(section);
    figma.root.setSharedPluginData(NS, IDX_PREFIX + section.id, JSON.stringify({
      id: section.id, name: baseName(section),
      pageId: p ? p.id : null, pageName: p ? p.name : '',
      status: data.status, by: data.by, at: data.at
    }));
  }
  function removeIndex(id) {
    figma.root.setSharedPluginData(NS, IDX_PREFIX + id, '');
  }
  function readIndex() {
    const out = [];
    for (const k of figma.root.getSharedPluginDataKeys(NS)) {
      if (k.indexOf(IDX_PREFIX) !== 0) continue;
      try {
        const raw = figma.root.getSharedPluginData(NS, k);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) {}
    }
    return out;
  }

  // Indexed lookup (no full tree walk), so this stays fast on large pages.
  async function rescanPage(page) {
    await page.loadAsync();
    const nodes = page.findAllWithCriteria({
      types: ['SECTION'],
      sharedPluginData: { namespace: NS, keys: [KEY] }
    });
    const found = new Set();
    for (const n of nodes) {
      const data = readSpec(n);
      if (!data) continue;
      found.add(n.id);
      writeIndex(n, data);
      if (!relaunched.has(n.id)) setRelaunch(n, findCard(n), data);
    }
    // Also drops entries for frames, which earlier versions allowed as targets.
    for (const e of readIndex()) {
      if (e.pageId === page.id && !found.has(e.id)) removeIndex(e.id);
    }
  }

  async function sendOverview() {
    await rescanPage(figma.currentPage);
    post('readme', { type: 'overview', entries: readIndex(), currentPageId: figma.currentPage.id });
  }

  // ---------- State ----------

  function pushState() {
    const seen = new Set();
    const sections = [];
    for (const n of figma.currentPage.selection) {
      const s = resolveTarget(n);
      if (s && !seen.has(s.id)) { seen.add(s.id); sections.push(s); }
    }

    if (sections.length !== 1) {
      // Tell the UI when a frame is selected, so it can explain that only sections get a ReadMe.
      const frame = !sections.length && figma.currentPage.selection.some((n) => n.type === 'FRAME');
      post('readme', {
        type: 'state', status: sections.length ? 'multiple' : frame ? 'frame' : 'none', count: sections.length
      });
      return;
    }

    const s = sections[0];
    const p = pageOf(s);
    const spec = readSpec(s);
    if (spec && !relaunched.has(s.id)) setRelaunch(s, findCard(s), spec);
    post('readme', {
      type: 'state',
      status: 'ok',
      target: {
        id: s.id,
        name: baseName(s),
        section: s.parent && s.parent.type === 'SECTION' ? baseName(s.parent) : null,
        page: p ? p.name : ''
      },
      spec,
      draft: getDraft('readme', s.id),
      me: userName()
    });
  }

  // ---------- People suggestions ----------
  // Figma only exposes the people who have this file open right now (activeUsers), so suggestions
  // are built from several sources. The UI adds the team list from team.json on GitHub.
  //  - every owner ever saved in a ReadMe in this file (shared, so the whole team sees them)
  //  - names this user typed before, in any file (local)
  //  - people currently in the file, and the current user
  // Names aren't tied to a role: any name can go in any owner field.

  const PEOPLE_KEY = 'pyde-spec-people';
  const PERSON_PREFIX = 'person:'; // one key per name on the document root

  function ownersOf(data) {
    return data.owners.design.concat(data.owners.dev, data.owners.product);
  }

  function registerPeople(data) {
    for (const name of ownersOf(data)) {
      if (!figma.root.getSharedPluginData(NS, PERSON_PREFIX + name)) {
        figma.root.setSharedPluginData(NS, PERSON_PREFIX + name, '1');
      }
    }
  }

  // Earlier versions stored { name, roles } objects locally; only the name matters now.
  async function savedNames() {
    const saved = await figma.clientStorage.getAsync(PEOPLE_KEY);
    return Array.isArray(saved) ? saved.map((p) => (typeof p === 'string' ? p : p && p.name)).filter(Boolean) : [];
  }

  async function people() {
    const names = new Set();
    for (const k of figma.root.getSharedPluginDataKeys(NS)) {
      if (k.indexOf(PERSON_PREFIX) === 0) names.add(k.slice(PERSON_PREFIX.length));
    }
    (await savedNames()).forEach((n) => names.add(n));
    // Stored names can be removed from the suggestions; people who are here right now can't
    // (they would come straight back).
    const present = new Set();
    try { figma.activeUsers.forEach((u) => u.name && present.add(u.name)); } catch (e) {}
    if (figma.currentUser) present.add(figma.currentUser.name);
    present.forEach((n) => names.add(n));
    return Array.from(names).sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, removable: !present.has(name) }));
  }

  // Removes a name from the suggestions (file list and this user's local list).
  // ReadMes that already list the person are left untouched.
  async function forgetPerson(name) {
    figma.root.setSharedPluginData(NS, PERSON_PREFIX + name, '');
    await figma.clientStorage.setAsync(PEOPLE_KEY, (await savedNames()).filter((n) => n !== name));
  }

  async function rememberPeople(data) {
    const used = ownersOf(data);
    const merged = used.concat((await savedNames()).filter((n) => used.indexOf(n) === -1));
    await figma.clientStorage.setAsync(PEOPLE_KEY, merged.slice(0, 150));
  }

  async function sendPeople() {
    post('readme', { type: 'people', people: await people() });
  }

  // ---------- Messages ----------

  function cleanList(a) {
    return Array.isArray(a) ? a.map((s) => String(s).trim()).filter(Boolean) : [];
  }
  function cleanUrls(a) {
    return cleanList(a).map((u) => (/^https?:\/\//i.test(u) ? u : 'https://' + u));
  }

  async function getSection(id) {
    const node = id ? await figma.getNodeByIdAsync(id) : null;
    if (!node || node.removed || node.type !== 'SECTION') {
      figma.notify(t('The section no longer exists.', 'Section artık yok.'), { error: true });
      return null;
    }
    return node;
  }

  async function save(msg) {
    const node = await getSection(msg.id);
    if (!node) return;
    const old = readSpec(node);
    const s = msg.spec || {};
    const now = Date.now();
    const data = {
      v: 1,
      status: STATUSES[s.status] ? s.status : 'wip',
      owners: {
        design: cleanList(s.owners && s.owners.design),
        dev: cleanList(s.owners && s.owners.dev),
        product: cleanList(s.owners && s.owners.product)
      },
      jira: cleanUrls(s.jira),
      slack: cleanUrls(s.slack),
      notes: typeof s.notes === 'string' ? s.notes : '',
      by: userName(),
      at: now,
      ready: null
    };
    // "Ready since" keeps its original date while the status stays Ready.
    if (data.status === 'ready') {
      data.ready = old && old.status === 'ready' && old.ready ? old.ready : { at: now, by: data.by };
    }
    await ensureFonts();
    const card = upsertCard(node, data);
    writeSpec(node, data);
    setRelaunch(node, card, data);
    syncName(node, data.status);
    writeIndex(node, data);
    registerPeople(data);
    await setDraft('readme', node.id, null);
    await rememberPeople(data);
    await sendPeople();
    figma.notify(t('Design ReadMe saved', 'Tasarım künyesi kaydedildi'));
  }

  async function remove(msg) {
    const node = await getSection(msg.id);
    if (!node) return;
    const card = findCard(node);
    if (card) card.remove();
    node.setSharedPluginData(NS, KEY, '');
    relaunch(node, {});
    syncName(node, null);
    removeIndex(node.id);
    await setDraft('readme', node.id, null);
    figma.notify(t('Design ReadMe removed', 'Tasarım künyesi kaldırıldı'));
  }

  // Sizes the section to its content with SECTION_FIT on every side (100, like Figma's own "Resize to fit"
  // for sections). The content keeps its place on
  // the canvas: the section moves and resizes around it. Works on any section, with or without a ReadMe.
  const SECTION_FIT = 100;
  async function fit(id) {
    const section = await getSection(id);
    if (!section) return;
    const kids = section.children.filter((c) => c.visible);
    if (!kids.length) return figma.notify(t('The section is empty.', 'Section boş.'));
    const minX = Math.min.apply(null, kids.map((c) => c.x));
    const minY = Math.min.apply(null, kids.map((c) => c.y));
    const maxX = Math.max.apply(null, kids.map((c) => c.x + c.width));
    const maxY = Math.max.apply(null, kids.map((c) => c.y + c.height));
    const dx = SECTION_FIT - minX, dy = SECTION_FIT - minY;
    for (const c of section.children) { c.x += dx; c.y += dy; }
    section.x -= dx;
    section.y -= dy;
    section.resizeWithoutConstraints(maxX - minX + 2 * SECTION_FIT, maxY - minY + 2 * SECTION_FIT);
    figma.notify(t('Section resized to its content', 'Section içeriğine göre boyutlandırıldı'));
  }

  async function goTo(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed) {
      removeIndex(id);
      figma.notify(t('That section no longer exists, removed from the list.', 'Bu section artık yok, listeden kaldırıldı.'));
      return sendOverview();
    }
    const page = pageOf(node);
    if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }

  async function onMessage(msg) {
    if (msg.type === 'refresh') return pushState();
    if (msg.type === 'save') {
      await save(msg);
      post('readme', { type: 'saved' });
      return pushState();
    }
    if (msg.type === 'remove') { await remove(msg); return pushState(); }
    if (msg.type === 'overview') return sendOverview();
    if (msg.type === 'scanAll') {
      await figma.loadAllPagesAsync();
      for (const page of figma.root.children) await rescanPage(page);
      figma.notify(t('All pages scanned', 'Tüm sayfalar tarandı'));
      return sendOverview();
    }
    if (msg.type === 'goto') return goTo(msg.id);
    if (msg.type === 'forgetPerson') { await forgetPerson(String(msg.name)); return sendPeople(); }
    if (msg.type === 'fit') { await fit(msg.id); return pushState(); }
    if (msg.type === 'draft') return setDraft('readme', String(msg.id), msg.data || null);
  }

  async function activate() {
    await sendPeople();
    pushState();
  }

  return { activate, refresh: pushState, onMessage };
})();

// =====================================================================================
// Frame Note: designer notes attached to a frame, for developers and their AI agents
// (Claude via Figma MCP).
//
// A note lives in two places:
//  - as JSON in shared plugin data on the frame (source of truth, read by this plugin)
//  - as a frame of plain text layers (the "card") placed right below the frame, in the same section
//    and exactly as wide as the frame, so Figma MCP and Dev Mode read it with the section. The card's
//    layer name and text name the frame and its node id, so a reader knows which frame it belongs to.
// The card is always written in English, whatever the plugin's interface language is.
//
// Notes are added to top-level frames: frames directly in a section or directly on the page. Frames that
// aren't in a section get a note too; the UI only warns about it. While the plugin is open (on any
// tool), cards follow their frame when it moves, resizes or is renamed; anything that drifted while it
// was closed is fixed the next time it opens.
// =====================================================================================

const Note = (() => {
  const NS = 'pydenote'; // namespace may only contain letters and digits
  const KEY = 'note';
  const CARD_KEY = 'card';
  const IDX_PREFIX = 'idx:'; // per-frame index entries on the document root, used by the overview
  const CARD_PREFIX = '📝 Note → ';
  // A broken card: one that no frame owns. It stays on the canvas, renamed and covered with a red
  // warning, until someone deletes it (the plugin never deletes a card on its own).
  const BROKEN = {
    deleted: { prefix: '📝 Note (broken: frame deleted) → ', text: 'Its frame was deleted, so this note isn’t attached to anything.' },
    copy: { prefix: '📝 Note (broken: copy) → ', text: 'This is a copy of another frame’s note and isn’t attached to any frame.' },
    nested: { prefix: '📝 Note (broken: frame moved) → ', text: 'Its frame is no longer directly in a section or on the page.' }
  };
  const OVERLAY_NAME = '⚠️ Broken note';
  const FRAME_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];

  function indexIn(parent, node) {
    return parent.children.findIndex((c) => c.id === node.id);
  }
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------- Notes ----------

  // { v, entries: [{ id, text, by, at }] }. `by` / `at` are who last wrote that paragraph, and when.
  function readNote(node) {
    try {
      const raw = node.getSharedPluginData(NS, KEY);
      if (!raw) return null;
      const d = JSON.parse(raw);
      const entries = (Array.isArray(d.entries) ? d.entries : [])
        .filter((e) => e && typeof e.text === 'string' && e.text.trim())
        .map((e) => ({ id: String(e.id || newId()), text: e.text, by: e.by || 'Unknown', at: e.at || 0 }));
      return entries.length ? { v: 1, entries } : null;
    } catch (e) {
      return null;
    }
  }
  // A note only exists while it has a card: a frame whose card was deleted (or that was copied without
  // its card) has no note. Its data is left on the frame untouched (the plugin writes nothing when a card
  // is deleted), so undoing the deletion brings the card and the note back together.
  function activeNote(frame) {
    const data = readNote(frame);
    return data && findCard(frame) ? data : null;
  }
  function writeNote(node, data) {
    node.setSharedPluginData(NS, KEY, data ? JSON.stringify(data) : '');
  }
  function lastChange(data) {
    return data.entries.reduce((a, e) => (e.at > a.at ? e : a), data.entries[0]);
  }

  // Design ReadMe cards and titles are frames in a section too, but they never get a note.
  function isFrame(node) {
    return FRAME_TYPES.indexOf(node.type) !== -1 && node.getSharedPluginData('pydespec', 'card') === '' &&
      node.getSharedPluginData('pydetitle', 'title') === '';
  }
  // Cards are placed next to their frame, which is only possible when the frame isn't inside
  // auto layout, a component set or an instance.
  function canHost(frame) {
    return !!frame.parent && (frame.parent.type === 'SECTION' || frame.parent.type === 'PAGE');
  }

  // ---------- Cards ----------

  function isCard(node) {
    return node.type === 'FRAME' && node.getSharedPluginData(NS, CARD_KEY) !== '';
  }
  function cardInfo(card) {
    try { return JSON.parse(card.getSharedPluginData(NS, CARD_KEY)) || {}; } catch (e) { return {}; }
  }
  function cardsOn(page) {
    return page.findAllWithCriteria({ types: ['FRAME'], sharedPluginData: { namespace: NS, keys: [CARD_KEY] } });
  }
  function notedFramesOn(page) {
    return page.findAllWithCriteria({ types: FRAME_TYPES, sharedPluginData: { namespace: NS, keys: [KEY] } })
      .filter((f) => canHost(f) && readNote(f));
  }

  // The frame a card belongs to, or null if that frame is gone (or no longer has a note).
  async function targetOf(card) {
    const id = cardInfo(card).targetId;
    const f = id ? await figma.getNodeByIdAsync(id) : null;
    if (!f || f.removed || !isFrame(f) || !readNote(f)) return null;
    const a = pageOf(f), b = pageOf(card);
    return a && b && a.id === b.id ? f : null;
  }

  function findCard(frame) {
    const page = pageOf(frame);
    if (!page) return null;
    return cardsOn(page).find((c) => { const i = cardInfo(c); return i.targetId === frame.id && !i.broken; }) || null;
  }

  // A fingerprint of everything the card shows, so a card is only redrawn when something changed
  // (an edit, a rename, an undo, or a copied card that now belongs to a new frame).
  const CARD_LAYOUT = 4; // bump when the card's design changes, so existing cards are redrawn
  function revision(frame, data) {
    const s = CARD_LAYOUT + '|' + frame.id + '|' + frame.name + '|' + JSON.stringify(data.entries);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return String(h);
  }
  function cardName(frame) {
    return CARD_PREFIX + frame.name + ' (' + frame.id + ')';
  }

  // ---------- Card rendering ----------

  // Ink colors are translucent black over the sticky note's paper color (same as Design ReadMe).
  const STICKY = '#FFEFA6';
  const INK = { text: 1, strong: 0.8, secondary: 0.62, warn: 0.6, tertiary: 0.4 };
  let FONTS = null; // DM Sans (see loadCardFonts)
  async function ensureFonts() {
    FONTS = await loadCardFonts();
  }

  // `color` is one of the INK levels, or { hex, opacity }.
  function text(chars, font, size, color, name) {
    const tx = figma.createText();
    tx.fontName = FONTS[font];
    tx.fontSize = size;
    tx.characters = chars;
    tx.fills = [typeof color === 'string' ? solid('#1E1E1E', INK[color]) : solid(color.hex, color.opacity)];
    tx.lineHeight = { unit: 'PERCENT', value: 145 };
    if (name) tx.name = name;
    return tx;
  }
  function stack(name, dir, gap) {
    const f = figma.createFrame();
    f.name = name;
    f.layoutMode = dir;
    f.itemSpacing = gap;
    f.fills = [];
    f.clipsContent = false;
    f.primaryAxisSizingMode = 'AUTO';
    f.counterAxisSizingMode = 'AUTO';
    return f;
  }
  // Appends a child stretched to the parent's width (text then wraps).
  function put(parent, child) {
    parent.appendChild(child);
    child.layoutSizingHorizontal = 'FILL';
    if (child.type === 'TEXT') child.textAutoResize = 'HEIGHT';
    return child;
  }
  function divider(parent, opacity) {
    const line = figma.createRectangle();
    line.name = 'Divider';
    line.resize(10, 1);
    line.fills = [solid('#1E1E1E', opacity)];
    put(parent, line);
  }

  // Layout by Tolga (DM Sans): the notes on the sticky paper; below them a slightly darker strip with
  // the frame's name and node id and a line for developers / AI agents.
  function renderCard(card, frame, data) {
    for (const c of card.children.slice()) c.remove();

    card.name = cardName(frame);
    card.layoutMode = 'VERTICAL';
    card.primaryAxisSizingMode = 'AUTO';
    card.counterAxisSizingMode = 'FIXED';
    card.resize(frame.width, card.height);
    card.itemSpacing = 0;
    card.paddingTop = card.paddingBottom = card.paddingLeft = card.paddingRight = 0;
    card.cornerRadius = 4;
    card.fills = [solid(STICKY)];
    card.strokes = [];
    card.clipsContent = true; // the footer strip follows the rounded corners
    card.effects = [
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.1 }, offset: { x: 0, y: 1 },
        radius: 3, spread: 0, visible: true, blendMode: 'NORMAL' },
      { type: 'DROP_SHADOW', color: { r: 0, g: 0, b: 0, a: 0.12 }, offset: { x: 0, y: 10 },
        radius: 24, spread: -4, visible: true, blendMode: 'NORMAL' }
    ];

    const body = put(card, stack('Notes', 'VERTICAL', 8));
    body.paddingTop = body.paddingBottom = body.paddingLeft = body.paddingRight = 16;
    const eyebrow = put(body, text('📝 FRAME NOTE', 'bold', 11, 'secondary', 'Eyebrow'));
    eyebrow.letterSpacing = { unit: 'PERCENT', value: 6 };

    // One paragraph per note, each with its author and date, separated by a faint line.
    const list = put(body, stack('Paragraphs', 'VERTICAL', 12));
    data.entries.forEach((e, i) => {
      if (i) divider(list, 0.08);
      const item = put(list, stack('Note ' + (i + 1), 'VERTICAL', 6));
      put(item, text(e.text.trim(), 'medium', 16, 'text', 'Text'));
      put(item, text(e.by + ' · ' + fmtDate(e.at), 'regular', 11, 'tertiary', 'Author'));
    });

    // Footer: a darker strip (black ink at 5% over the paper).
    const foot = put(card, stack('Footer', 'VERTICAL', 2));
    foot.paddingTop = foot.paddingBottom = 8;
    foot.paddingLeft = foot.paddingRight = 16;
    foot.fills = [solid('#1E1E1E', 0.05)];
    const row = put(foot, stack('Frame info', 'HORIZONTAL', 8));
    const name = text(frame.name, 'bold', 11, 'strong', 'Frame name');
    row.appendChild(name);
    name.layoutSizingHorizontal = 'FILL';
    name.textAutoResize = 'HEIGHT';
    try { name.textTruncation = 'ENDING'; name.maxLines = 1; } catch (e) {} // a long name ends in "…"
    const id = text('Frame node ID: ' + frame.id, 'medium', 11, 'secondary', 'Frame ID');
    row.appendChild(id);
    id.textAutoResize = 'WIDTH_AND_HEIGHT';
    put(foot, text('For developers & AI agents: requirements for the frame above (node ' + frame.id + ').',
      'regular', 10, 'tertiary', 'About'));
  }

  // Covers a broken card with a red warning (absolutely positioned, so it doesn't change the card's
  // size) and renames it. Redrawing the card for its frame again (undo) removes both.
  function markBroken(card, reason) {
    const info = cardInfo(card);
    const name = BROKEN[reason].prefix + (info.frameName || '?');
    if (card.name !== name) card.name = name;
    const old = card.children.filter((c) => c.name === OVERLAY_NAME);
    if (info.broken === reason && old.length) return;
    old.forEach((c) => c.remove());

    const o = figma.createFrame();
    o.name = OVERLAY_NAME;
    card.appendChild(o);
    if (card.layoutMode !== 'NONE') o.layoutPositioning = 'ABSOLUTE';
    o.x = 0;
    o.y = 0;
    o.resize(Math.max(1, card.width), Math.max(1, card.height));
    o.constraints = { horizontal: 'STRETCH', vertical: 'STRETCH' };
    o.layoutMode = 'VERTICAL';
    o.primaryAxisSizingMode = 'FIXED';
    o.counterAxisSizingMode = 'FIXED';
    o.primaryAxisAlignItems = 'CENTER';
    o.counterAxisAlignItems = 'CENTER';
    o.itemSpacing = 6;
    o.paddingTop = o.paddingBottom = o.paddingLeft = o.paddingRight = 16;
    o.fills = [solid('#000000', 0.72)];
    o.clipsContent = true;
    const white = (op) => ({ hex: '#FFFFFF', opacity: op });
    const lines = [
      ['⚠️ BROKEN NOTE', 'bold', 13, white(1)],
      [BROKEN[reason].text, 'medium', 12, white(1)],
      ['Designers: open Pyde Design → Frame Note to fix or delete it.', 'regular', 11, white(0.85)]
    ];
    lines.forEach(([chars, font, size, color], i) => {
      const tx = put(o, text(chars, font, size, color, i ? 'Text' : 'Title'));
      tx.textAlignHorizontal = 'CENTER';
      if (!i) tx.letterSpacing = { unit: 'PERCENT', value: 6 };
    });
    card.setSharedPluginData(NS, CARD_KEY, JSON.stringify(Object.assign({}, info, { broken: reason })));
  }

  const GAP = 24;         // space between a frame and its card
  const SECTION_PAD = 40; // room kept between a card and the section's edge

  // Grows a section so the card fits inside it.
  function fitSection(section, card) {
    const w = Math.max(section.width, card.x + card.width + SECTION_PAD);
    const h = Math.max(section.height, card.y + card.height + SECTION_PAD);
    if (w !== section.width || h !== section.height) section.resizeWithoutConstraints(w, h);
  }

  function isBelow(card, frame) {
    return Math.abs(card.x - frame.x) < 0.5 && Math.abs(card.y - (frame.y + frame.height + GAP)) < 0.5;
  }

  // Puts the card right below its frame, as wide as the frame, and right above it in the layer list,
  // so the two are read together. Only writes what actually changed.
  function place(card, frame) {
    const parent = frame.parent;
    if (!card.parent || card.parent.id !== parent.id || indexIn(parent, card) !== indexIn(parent, frame) + 1) {
      parent.insertChild(indexIn(parent, frame) + 1, card);
      // When the card was already in this parent, its old slot can push it one too far.
      if (indexIn(parent, card) !== indexIn(parent, frame) + 1) parent.insertChild(indexIn(parent, frame) + 1, card);
    }
    if (Math.abs(card.width - frame.width) > 0.01) card.resize(frame.width, card.height);
    if (Math.abs(card.x - frame.x) > 0.01) card.x = frame.x;
    const y = frame.y + frame.height + GAP;
    if (Math.abs(card.y - y) > 0.01) card.y = y;
    if (parent.type === 'SECTION') fitSection(parent, card);
  }

  // True when the card doesn't show the frame's current note (edited, renamed, copied, or marked as
  // orphaned while the frame was deleted and then brought back with undo).
  function isStale(card, frame, data) {
    const info = cardInfo(card);
    return info.rev !== revision(frame, data) || info.targetId !== frame.id || card.name !== cardName(frame);
  }

  // The card keeps a copy of the note, so a card whose frame gets deleted can still be attached to
  // another frame with all its paragraphs (see fix).
  function writeCardInfo(card, frame, data) {
    card.setSharedPluginData(NS, CARD_KEY, JSON.stringify({
      kind: 'frameNote', targetId: frame.id, frameName: frame.name, rev: revision(frame, data), entries: data.entries
    }));
  }

  // ---------- Text edited on the canvas ----------
  // A designer may change a paragraph right on the card. The card's text then wins: the note data is
  // updated to match (author and date stay), without redrawing the card, so someone typing in it isn't
  // thrown out of the text.

  // The paragraph text layers of a card, in order ("Note 1" › "Text", "Note 2" › "Text", …), with their
  // author lines. Works for the current card layout and the earlier ones.
  function cardParagraphs(card) {
    const out = [];
    const visit = (n) => {
      if (/^Note \d+$/.test(n.name) && 'children' in n) {
        const tx = n.children.find((c) => c.type === 'TEXT' && c.name === 'Text');
        const au = n.children.find((c) => c.type === 'TEXT' && c.name === 'Author');
        if (tx) out.push({ text: tx.characters, author: au ? au.characters : '' });
        return;
      }
      if ('children' in n && n.name !== OVERLAY_NAME) n.children.forEach(visit);
    };
    visit(card);
    return out;
  }

  // The note with the card's text, or null when nothing was edited (or the card's structure no longer
  // matches the note, e.g. a paragraph layer was deleted by hand).
  function handEdits(card, data) {
    const paras = cardParagraphs(card);
    if (paras.length !== data.entries.length) return null;
    let changed = false;
    const entries = data.entries.map((e, i) => {
      const tx = paras[i].text.trim();
      if (!tx || tx === e.text.trim()) return e;
      changed = true;
      return Object.assign({}, e, { text: tx });
    });
    return changed ? { v: 1, entries } : null;
  }

  // "Tolga Kütükcü · 9 Oct 2026, 02:27" → { by, at }, for cards that predate the copy in the card data.
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function parseAuthor(s) {
    const i = s.lastIndexOf(' · ');
    const by = i > 0 ? s.slice(0, i) : 'Unknown';
    const m = (i > 0 ? s.slice(i + 3) : '').match(/^(\d{1,2}) (\w{3}) (\d{4}), (\d{2}):(\d{2})$/);
    const at = m && MONTHS.indexOf(m[2]) !== -1
      ? new Date(+m[3], MONTHS.indexOf(m[2]), +m[1], +m[4], +m[5]).getTime() : Date.now();
    return { by, at };
  }

  // The paragraphs of a card: the copy kept in the card data, else the note of the frame it names
  // (still there for a copied card), else what the card shows.
  async function cardEntries(card) {
    const info = cardInfo(card);
    if (Array.isArray(info.entries) && info.entries.length) return info.entries;
    const f = info.targetId ? await figma.getNodeByIdAsync(info.targetId) : null;
    const note = f && !f.removed && isFrame(f) ? readNote(f) : null;
    if (note) return note.entries;
    return cardParagraphs(card).filter((p) => p.text.trim())
      .map((p) => Object.assign({ id: newId(), text: p.text.trim() }, parseAuthor(p.author)));
  }

  // Brings an existing card up to date with its frame: content, position, size, relaunch button.
  function refreshCard(card, frame, data) {
    if (isStale(card, frame, data)) {
      renderCard(card, frame, data);
      writeCardInfo(card, frame, data);
      setRelaunch(frame, card, data);
    } else if (!relaunched.has(frame.id)) {
      setRelaunch(frame, card, data);
    }
    place(card, frame);
  }

  function createCard(frame, data) {
    const card = figma.createFrame();
    frame.parent.appendChild(card);
    refreshCard(card, frame, data);
    return card;
  }

  // The "Edit Frame Note" button in the right panel opens this plugin on the Frame Note tool.
  // Notes saved by the old standalone plugin get the button the first time this tool sees them.
  const relaunched = new Set();
  function setRelaunch(frame, card, data) {
    const n = data.entries.length;
    const d = { note: 'Frame note · ' + n + (n === 1 ? ' note' : ' notes') };
    relaunch(frame, d);
    if (card) relaunch(card, d);
    relaunched.add(frame.id);
  }

  // Sibling layers the card covers, so the designer can make room.
  function overlaps(card) {
    if (!card || !card.parent) return [];
    const a = { x: card.x, y: card.y, w: card.width, h: card.height };
    return card.parent.children.filter((c) => c.id !== card.id && c.visible &&
      c.x < a.x + a.w && c.x + c.width > a.x && c.y < a.y + a.h && c.y + c.height > a.y).map((c) => c.name);
  }

  // ---------- Page sync ----------
  // Matches every card on a page to its frame, then fixes positions, content and the overview index.

  // `tidy` also drops overview entries of frames that no longer have a note on this page. That is a
  // write, so it only happens when someone opens the overview or scans, not while editing.
  async function syncPage(page, tidy) {
    await page.loadAsync();
    const frames = notedFramesOn(page);
    const cards = cardsOn(page);
    const owner = new Map(); // frame id → card
    const pending = [];

    // 1. A card sitting right below a frame with note data belongs to that frame. This also handles
    //    copies: duplicating a frame together with its card gives a new card that still names the
    //    original frame, but sits below the copy.
    for (const card of cards) {
      const f = frames.find((fr) => !owner.has(fr.id) && fr.parent.id === card.parent.id && isBelow(card, fr));
      if (f) owner.set(f.id, card); else pending.push(card);
    }
    // 1b. A card placed right below a frame that has no note gives it one: copying a card under the
    //     next frame makes it that frame's note.
    const adopted = new Set();
    for (const card of pending.slice()) {
      if (!card.parent) continue;
      const f = card.parent.children.find((c) => c.id !== card.id && !owner.has(c.id) && !isCard(c) &&
        isFrame(c) && canHost(c) && isBelow(card, c));
      if (!f) continue;
      const entries = await cardEntries(card);
      if (!entries.length) continue;
      writeNote(f, { v: 1, entries });
      if (frames.indexOf(f) === -1) frames.push(f);
      owner.set(f.id, card);
      adopted.add(card.id);
      pending.splice(pending.indexOf(card), 1);
    }
    // 2. Otherwise by the frame id stored on the card (the frame moved while the plugin was closed).
    //    A second card for a frame that already has one is a copy.
    const lost = [];
    for (const card of pending) {
      const id = cardInfo(card).targetId;
      if (frames.some((fr) => fr.id === id)) {
        if (owner.has(id)) lost.push({ card, reason: 'copy' });
        else owner.set(id, card);
      } else {
        lost.push({ card, reason: null });
      }
    }
    // Why the others have no frame: it's gone, it sits inside another layer now, or the card was
    // copied from another page.
    for (const l of lost) {
      if (l.reason) continue;
      const id = cardInfo(l.card).targetId;
      const f = id ? await figma.getNodeByIdAsync(id) : null;
      if (!f || f.removed || !isFrame(f) || !readNote(f)) l.reason = 'deleted';
      else if (pageOf(f) && pageOf(f).id !== page.id) l.reason = 'copy';
      else l.reason = canHost(f) ? 'copy' : 'nested';
    }

    let fontsReady = false;
    const fonts = async () => { if (!fontsReady) { await ensureFonts(); fontsReady = true; } };

    // 3. Every frame with a card gets it brought up to date. A frame without a card has no note:
    //    its card was deleted, or it was copied without it. Nothing is drawn or written for it.
    for (const frame of frames) {
      let data = readNote(frame);
      const card = owner.get(frame.id);
      if (!card) continue;
      // A card that names another frame was copied under this one: what the card shows becomes the
      // note (a frame copied on its own may still carry old note data that nobody can see).
      const named = cardInfo(card).targetId;
      if (named && named !== frame.id && !adopted.has(card.id)) {
        const entries = await cardEntries(card);
        if (entries.length && JSON.stringify(entries) !== JSON.stringify(data.entries)) {
          data = { v: 1, entries };
          writeNote(frame, data);
        }
      }
      const edited = handEdits(card, data);
      if (edited) {
        // The card already shows the new text: only the data (and the card's record of it) change.
        data = edited;
        writeNote(frame, data);
        writeCardInfo(card, frame, data);
      }
      if (isStale(card, frame, data)) await fonts();
      refreshCard(card, frame, data);
      writeIndex(frame, data);
    }

    // 4. Broken cards stay on the canvas, renamed and covered with a warning, until someone deletes them.
    for (const l of lost) {
      if (cardInfo(l.card).broken !== l.reason || !l.card.children.some((c) => c.name === OVERLAY_NAME)) await fonts();
      markBroken(l.card, l.reason);
    }

    if (tidy) {
      for (const e of readIndex()) {
        if (e.pageId === page.id && !owner.has(e.id)) removeIndex(e.id);
      }
    }
    return lost.map((l) => ({ id: l.card.id, name: cardInfo(l.card).frameName || '?', reason: l.reason }));
  }

  // Re-syncs the current page shortly after relevant edits, while the plugin is open.
  let syncTimer = null;
  let syncing = false;
  let orphans = [];
  function scheduleSync() {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(runSync, 200);
  }
  async function runSync() {
    if (syncing) return scheduleSync();
    syncing = true;
    try {
      orphans = await syncPage(figma.currentPage);
    } catch (e) {
      console.error('[Pyde Note] sync failed', e);
    } finally {
      syncing = false;
    }
    if (active === 'note') pushState();
  }

  function onNodeChange(e) {
    for (const c of e.nodeChanges) {
      if (c.type === 'DELETE') return scheduleSync();
      const n = c.node;
      if (!n || n.removed || !('getSharedPluginData' in n)) continue;
      if (n.getSharedPluginData(NS, KEY) || n.getSharedPluginData(NS, CARD_KEY)) return scheduleSync();
      // Text typed into a card (a layer inside it).
      for (let p = n.parent; p && p.type !== 'PAGE' && p.type !== 'DOCUMENT'; p = p.parent) {
        if (p.type === 'FRAME' && p.getSharedPluginData(NS, CARD_KEY)) return scheduleSync();
      }
    }
  }
  let watched = null;
  function watchPage() {
    if (watched) watched.off('nodechange', onNodeChange);
    watched = figma.currentPage;
    watched.on('nodechange', onNodeChange);
  }

  // ---------- Overview index ----------
  // One key per frame on the document root, so two people saving at once never overwrite each other.

  function writeIndex(frame, data) {
    const p = pageOf(frame);
    const last = lastChange(data);
    const v = JSON.stringify({
      id: frame.id, name: frame.name,
      section: frame.parent && frame.parent.type === 'SECTION' ? frame.parent.name : null,
      pageId: p ? p.id : null, pageName: p ? p.name : '',
      count: data.entries.length, by: last.by, at: last.at,
      preview: data.entries[0].text.trim().slice(0, 160)
    });
    if (figma.root.getSharedPluginData(NS, IDX_PREFIX + frame.id) !== v) {
      figma.root.setSharedPluginData(NS, IDX_PREFIX + frame.id, v);
    }
  }
  function removeIndex(id) {
    figma.root.setSharedPluginData(NS, IDX_PREFIX + id, '');
  }
  function readIndex() {
    const out = [];
    for (const k of figma.root.getSharedPluginDataKeys(NS)) {
      if (k.indexOf(IDX_PREFIX) !== 0) continue;
      try {
        const raw = figma.root.getSharedPluginData(NS, k);
        if (raw) out.push(JSON.parse(raw));
      } catch (e) {}
    }
    return out;
  }

  async function sendOverview() {
    orphans = await syncPage(figma.currentPage, true);
    post('note', { type: 'overview', entries: readIndex(), orphans, currentPageId: figma.currentPage.id });
  }

  // ---------- State ----------

  // What a selected node points at:
  //  { kind: 'frame', frame }   a frame directly in a section or on the page, anything inside it, or its card
  //  { kind: 'orphan', card }   a broken card (its frame was deleted, it's a copy, …)
  //  { kind: 'section' }        a section itself
  //  null                       anything else (including a Design ReadMe card)
  async function resolve(node) {
    for (let n = node; n && n.type !== 'PAGE'; n = n.parent) {
      if (isCard(n)) {
        if (cardInfo(n).broken) return { kind: 'orphan', card: n };
        const f = await targetOf(n);
        if (!f) return { kind: 'orphan', card: n };
        const own = findCard(f);
        if (own && own.id !== n.id) return { kind: 'orphan', card: n }; // a copy, not marked yet
        return canHost(f) ? { kind: 'frame', frame: f } : null;
      }
    }
    let top = node;
    while (top.parent && top.parent.type !== 'SECTION' && top.parent.type !== 'PAGE') top = top.parent;
    if (top.type === 'SECTION') return { kind: 'section' };
    return isFrame(top) ? { kind: 'frame', frame: top } : null;
  }

  let stateSeq = 0;
  async function pushState() {
    const seq = ++stateSeq;
    const frames = [];
    const seen = new Set();
    let orphan = null, section = false;
    for (const n of figma.currentPage.selection) {
      const r = await resolve(n);
      if (!r) continue;
      if (r.kind === 'frame') {
        if (!seen.has(r.frame.id)) { seen.add(r.frame.id); frames.push(r.frame); }
      } else if (r.kind === 'orphan') orphan = r.card;
      else if (r.kind === 'section') section = true;
    }
    if (seq !== stateSeq) return; // a newer selection is already being handled

    // `section` is null for a frame that isn't in a section; the UI warns about it.
    const sectionOf = (f) => (f.parent.type === 'SECTION' ? f.parent.name : null);
    if (frames.length === 1) {
      const f = frames[0];
      const p = pageOf(f);
      return post('note', {
        type: 'state', status: 'ok',
        target: { id: f.id, name: f.name, section: sectionOf(f), page: p ? p.name : '' },
        note: activeNote(f),
        draft: getDraft('note', f.id),
        overlaps: overlaps(findCard(f)),
        me: userName()
      });
    }
    if (frames.length) {
      return post('note', {
        type: 'state', status: 'multiple',
        draft: getDraft('note', multiKey(frames.map((f) => f.id))),
        frames: frames.map((f) => {
          const d = activeNote(f);
          return { id: f.id, name: f.name, section: sectionOf(f), count: d ? d.entries.length : 0 };
        })
      });
    }
    post('note', {
      type: 'state',
      status: orphan ? 'orphan' : section ? 'section' : 'none',
      orphan: orphan ? {
        id: orphan.id, name: cardInfo(orphan).frameName || '?', reason: cardInfo(orphan).broken || 'copy',
        suggestion: suggestFrame(orphan)
      } : null
    });
  }

  // The draft of the "add to all" text belongs to that exact set of frames.
  function multiKey(ids) {
    return ids.slice().sort().join(',');
  }

  // ---------- Fixing a broken card ----------

  // The frame a broken card most likely belongs to: a top-level frame next to it whose bottom edge is at
  // most 100 px above the card and which overlaps it horizontally. The closest one wins.
  const SUGGEST_RANGE = 100;
  function suggestFrame(card) {
    if (!card.parent) return null;
    let best = null, bestGap = Infinity;
    for (const c of card.parent.children) {
      if (c.id === card.id || isCard(c) || !isFrame(c) || !canHost(c)) continue;
      const gap = card.y - (c.y + c.height);
      const overlap = Math.min(card.x + card.width, c.x + c.width) - Math.max(card.x, c.x);
      if (gap < -1 || gap > SUGGEST_RANGE || overlap <= 0) continue;
      if (gap < bestGap) { best = c; bestGap = gap; }
    }
    return best ? { id: best.id, name: best.name, hasNote: !!activeNote(best) } : null;
  }

  // Attaches a broken card's note to a frame. If the frame already has a note, the card's paragraphs
  // are added at the end (paragraphs with the same text are skipped) and the broken card goes away,
  // since its content now lives in the frame's own card. Otherwise the broken card becomes the frame's card.
  async function fix(msg) {
    const card = msg.id ? await figma.getNodeByIdAsync(msg.id) : null;
    if (!card || card.removed || !isCard(card)) {
      return figma.notify(t('The note card no longer exists.', 'Not kartı artık yok.'), { error: true });
    }
    const frame = await getFrame(msg.frameId);
    if (!frame) return;
    const entries = await cardEntries(card);
    if (!entries.length) {
      return figma.notify(t('This card has no note text to attach.', 'Bu kartta bağlanacak not metni yok.'), { error: true });
    }
    const old = activeNote(frame);
    const have = new Set((old ? old.entries : []).map((e) => e.text.trim()));
    const added = entries.filter((e) => e.text && e.text.trim() && !have.has(e.text.trim()))
      .map((e) => ({ id: newId(), text: e.text.trim(), by: e.by || 'Unknown', at: e.at || Date.now() }));
    const data = { v: 1, entries: (old ? old.entries : []).concat(added) };
    if (!data.entries.length) return;

    await ensureFonts();
    writeNote(frame, data);
    const own = findCard(frame);
    if (own && own.id !== card.id) {
      refreshCard(own, frame, data);
      card.remove();
    } else {
      // A fresh record makes the card stale, so it is redrawn for this frame (the warning goes away).
      card.setSharedPluginData(NS, CARD_KEY, JSON.stringify({ kind: 'frameNote', targetId: frame.id, frameName: frame.name }));
      refreshCard(card, frame, data);
    }
    writeIndex(frame, data);
    figma.currentPage.selection = [frame];
    figma.notify(old
      ? t(added.length + ' paragraph(s) added to the note of “' + frame.name + '”', '“' + frame.name + '” notuna ' + added.length + ' paragraf eklendi')
      : t('Note attached to “' + frame.name + '”', 'Not “' + frame.name + '” frame’ine bağlandı'));
  }

  // ---------- Messages ----------

  // `anywhere` skips the placement check (removing a note from a frame that was moved into another layer).
  async function getFrame(id, anywhere) {
    const node = id ? await figma.getNodeByIdAsync(id) : null;
    if (!node || node.removed || !isFrame(node)) {
      figma.notify(t('The frame no longer exists.', 'Frame artık yok.'), { error: true });
      return null;
    }
    if (!anywhere && !canHost(node)) {
      figma.notify(t('Notes can only be added to frames placed directly in a section or on the page.',
        'Not sadece doğrudan bir section içinde ya da sayfada duran frame’lere eklenebilir.'), { error: true });
      return null;
    }
    return node;
  }

  // Writes the note and its card. An empty note removes both.
  async function apply(frame, data) {
    if (!data.entries.length) return removeNote(frame);
    await ensureFonts();
    writeNote(frame, data);
    const card = findCard(frame);
    const c = card || createCard(frame, data);
    if (card) refreshCard(card, frame, data);
    writeIndex(frame, data);
    return c;
  }

  function removeNote(frame) {
    const card = findCard(frame);
    if (card) card.remove();
    writeNote(frame, null);
    relaunch(frame, {});
    removeIndex(frame.id);
    return null;
  }

  function warnOverlaps(card) {
    const o = overlaps(card);
    if (o.length) {
      figma.notify(t('The note overlaps “' + o[0] + '”' + (o.length > 1 ? ' and ' + (o.length - 1) + ' more' : '') + '. Make some room below the frame.',
        'Not “' + o[0] + '”' + (o.length > 1 ? ' ve ' + (o.length - 1) + ' katman daha' : '') + ' ile çakışıyor. Frame’in altında yer aç.'));
    }
  }

  // A paragraph keeps its author and date unless its text changed.
  async function save(msg) {
    const frame = await getFrame(msg.id);
    if (!frame) return;
    const old = activeNote(frame);
    const prev = new Map((old ? old.entries : []).map((e) => [e.id, e]));
    const now = Date.now();
    const me = userName();
    const entries = (Array.isArray(msg.entries) ? msg.entries : [])
      .map((e) => ({ id: e.id ? String(e.id) : newId(), text: String(e.text || '').trim() }))
      .filter((e) => e.text)
      .map((e) => {
        const p = prev.get(e.id);
        return p && p.text.trim() === e.text ? p : { id: e.id, text: e.text, by: me, at: now };
      });
    const card = await apply(frame, { v: 1, entries });
    await setDraft('note', frame.id, null);
    if (!card) return figma.notify(t('Note removed', 'Not kaldırıldı'));
    figma.notify(t('Note saved', 'Not kaydedildi'));
    warnOverlaps(card);
  }

  // Adds the same paragraph to several frames at once.
  async function addToAll(msg) {
    const body = String(msg.text || '').trim();
    if (!body) return;
    const now = Date.now();
    const me = userName();
    let n = 0;
    for (const id of Array.isArray(msg.ids) ? msg.ids : []) {
      const frame = await getFrame(id);
      if (!frame) continue;
      const data = activeNote(frame) || { v: 1, entries: [] };
      data.entries.push({ id: newId(), text: body, by: me, at: now });
      const card = await apply(frame, data);
      if (overlaps(card).length) warnOverlaps(card);
      n++;
    }
    await setDraft('note', multiKey(Array.isArray(msg.ids) ? msg.ids : []), null);
    figma.notify(t('Note added to ' + n + (n === 1 ? ' frame' : ' frames'), 'Not ' + n + ' frame’e eklendi'));
  }

  async function remove(msg) {
    const frame = await getFrame(msg.id, true);
    if (!frame) return;
    removeNote(frame);
    await setDraft('note', frame.id, null);
    figma.notify(t('Note removed', 'Not kaldırıldı'));
  }

  async function deleteOrphan(id) {
    const card = await figma.getNodeByIdAsync(id);
    if (!card || card.removed || !isCard(card)) return;
    const f = cardInfo(card).broken ? null : await targetOf(card);
    if (!f || (findCard(f) && findCard(f).id !== card.id)) card.remove();
  }

  async function goTo(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed) {
      removeIndex(id);
      figma.notify(t('That frame no longer exists, removed from the list.', 'Bu frame artık yok, listeden kaldırıldı.'));
      return sendOverview();
    }
    const page = pageOf(node);
    if (page && page.id !== figma.currentPage.id) await figma.setCurrentPageAsync(page);
    figma.currentPage.selection = [node];
    const card = isCard(node) ? null : findCard(node);
    figma.viewport.scrollAndZoomIntoView(card ? [node, card] : [node]);
  }

  async function onMessage(msg) {
    if (msg.type === 'refresh') return pushState();
    if (msg.type === 'save' || msg.type === 'addToAll') {
      await (msg.type === 'save' ? save(msg) : addToAll(msg));
      post('note', { type: 'saved' });
      return pushState();
    }
    if (msg.type === 'remove') { await remove(msg); return pushState(); }
    if (msg.type === 'fix') {
      await fix(msg);
      post('note', { type: 'fixed' });
      await runSync();
      return pushState();
    }
    if (msg.type === 'deleteOrphan') {
      await deleteOrphan(msg.id);
      figma.notify(t('Note deleted', 'Not silindi'));
      await sendOverview();
      return pushState();
    }
    if (msg.type === 'overview') return sendOverview();
    if (msg.type === 'scanAll') {
      await figma.loadAllPagesAsync();
      for (const page of figma.root.children) await syncPage(page, true);
      figma.notify(t('All pages scanned', 'Tüm sayfalar tarandı'));
      return sendOverview();
    }
    if (msg.type === 'goto') return goTo(msg.id);
    if (msg.type === 'draft') {
      return setDraft('note', Array.isArray(msg.ids) ? multiKey(msg.ids) : String(msg.id), msg.data || null);
    }
  }

  // Cards follow their frames whichever tool is on screen, so this starts with the plugin.
  function start() {
    watchPage();
    return runSync();
  }
  function onPageChange() {
    watchPage();
    runSync();
  }

  // The card of a frame, if it has a note (Title Maker lays a frame out together with its card).
  function cardOf(frame) {
    return readNote(frame) ? findCard(frame) : null;
  }

  return { start, onPageChange, activate: pushState, refresh: pushState, onMessage, cardOf };
})();

// =====================================================================================
// Image Optimizer: downsizes image fills to the size they are actually displayed at.
// Pixel work happens in the UI (canvas).
//
// Only the pixel size changes: PNGs stay PNG, JPEGs stay JPEG. If the resized image isn't smaller
// than the original, it is left alone.
// =====================================================================================

const Images = (() => {
  const PREFS_KEY = 'pyde-optimizer-prefs';
  // Selecting one of these switches the scope to "Selection" automatically.
  const CONTAINER_TYPES = ['FRAME', 'SECTION', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE', 'GROUP'];
  // An image is listed only when it is at least this much bigger than needed (factor < 0.9 = 10%+).
  const MIN_REDUCTION = 0.9;

  // hash -> { hash, imgW, imgH, bytes, format, factor, targetW, targetH, nodes: [{id, name, page}] }
  let lastScan = new Map();
  let runId = 0; // bumped on every scan / apply, so an outdated preview loop stops
  const pendingResizes = new Map();  // hash -> resolve fn
  const pendingPreviews = new Map(); // hash -> resolve fn
  let focusedId = null; // the layer we last selected ourselves (Go to layer)

  function needFactorForPaint(node, paint, imgW, imgH, scale) {
    let w = node.width;
    let h = node.height;
    if (!w || !h) return null;
    const rot = ((paint.rotation || 0) % 180 + 180) % 180;
    if (rot === 90) { const tmp = w; w = h; h = tmp; }

    let s;
    switch (paint.scaleMode) {
      case 'FILL':
        s = Math.max(w / imgW, h / imgH);
        break;
      case 'FIT':
        s = Math.min(w / imgW, h / imgH);
        break;
      case 'CROP': {
        const tr = paint.imageTransform;
        if (!tr) { s = Math.max(w / imgW, h / imgH); break; }
        // imageTransform maps node space (0..1) to image space (0..1).
        const sx = Math.hypot(tr[0][0], tr[1][0]) || 1;
        const sy = Math.hypot(tr[0][1], tr[1][1]) || 1;
        s = Math.max(w / (sx * imgW), h / (sy * imgH));
        break;
      }
      case 'TILE':
        s = paint.scalingFactor || 1;
        break;
      default:
        s = Math.max(w / imgW, h / imgH);
    }
    return s * scale;
  }

  async function collectNodes(scope) {
    const nodes = [];
    const pushTree = (root, pageName) => {
      const visit = (n) => {
        if ('fills' in n) nodes.push({ node: n, page: pageName });
        if ('children' in n) for (const c of n.children) visit(c);
      };
      visit(root);
    };

    if (scope === 'selection') {
      for (const n of figma.currentPage.selection) pushTree(n, figma.currentPage.name);
    } else if (scope === 'page') {
      for (const n of figma.currentPage.children) pushTree(n, figma.currentPage.name);
    } else {
      await figma.loadAllPagesAsync();
      for (const page of figma.root.children) {
        for (const n of page.children) pushTree(n, page.name);
      }
    }
    return nodes;
  }

  function formatOf(bytes) {
    if (bytes.length > 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'GIF';
    if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E) return 'PNG';
    if (bytes.length > 2 && bytes[0] === 0xFF && bytes[1] === 0xD8) return 'JPEG';
    return '';
  }

  async function scan(scope, scale, minBytes) {
    const id = ++runId;
    const entries = await collectNodes(scope);
    const byHash = new Map();
    const sizeCache = new Map();
    let processed = 0;

    for (const { node, page } of entries) {
      const fills = node.fills;
      if (fills === figma.mixed || !Array.isArray(fills)) continue;
      for (const paint of fills) {
        if (paint.type !== 'IMAGE' || !paint.imageHash) continue;
        const hash = paint.imageHash;
        let size = sizeCache.get(hash);
        if (!size) {
          const img = figma.getImageByHash(hash);
          if (!img) continue;
          try { size = await img.getSizeAsync(); } catch (e) { continue; }
          sizeCache.set(hash, size);
        }
        const f = needFactorForPaint(node, paint, size.width, size.height, scale);
        if (f == null) continue;
        let rec = byHash.get(hash);
        if (!rec) {
          rec = { hash, imgW: size.width, imgH: size.height, factor: 0, nodes: [] };
          byHash.set(hash, rec);
        }
        rec.factor = Math.max(rec.factor, f);
        if (!rec.nodes.some((n) => n.id === node.id)) rec.nodes.push({ id: node.id, name: node.name, page });
      }
      processed++;
      if (processed % 500 === 0) {
        post('images', { type: 'progress', phase: 'scan', n: processed, total: entries.length });
      }
    }

    // Keep only images that are bigger than needed and heavy enough to be worth it.
    const items = [];
    for (const rec of byHash.values()) {
      if (rec.factor >= MIN_REDUCTION) continue;
      const img = figma.getImageByHash(rec.hash);
      const bytes = await img.getBytesAsync();
      if (bytes.length < minBytes) continue;
      rec.format = formatOf(bytes);
      if (rec.format === 'GIF') continue; // animated GIFs would lose their animation
      rec.bytes = bytes.length;
      rec.targetW = Math.max(1, Math.round(rec.imgW * rec.factor));
      rec.targetH = Math.max(1, Math.round(rec.imgH * rec.factor));
      items.push(rec);
    }
    items.sort((a, b) => b.bytes - a.bytes);

    lastScan = new Map(items.map((i) => [i.hash, i]));
    post('images', {
      type: 'scan-result',
      items: items.map((i) => ({
        hash: i.hash, imgW: i.imgW, imgH: i.imgH, targetW: i.targetW, targetH: i.targetH,
        bytes: i.bytes, format: i.format, nodes: i.nodes
      }))
    });

    // Then, one by one, let the UI draw a thumbnail and measure the real size after resizing.
    for (const rec of items) {
      if (id !== runId) return;
      const img = figma.getImageByHash(rec.hash);
      if (!img) continue;
      const bytes = await img.getBytesAsync();
      if (id !== runId) return;
      await new Promise((resolve) => {
        pendingPreviews.set(rec.hash, resolve);
        post('images', { type: 'preview', hash: rec.hash, bytes, targetW: rec.targetW, targetH: rec.targetH, format: rec.format });
      });
    }
  }

  function requestResize(hash, bytes, targetW, targetH, format) {
    return new Promise((resolve) => {
      pendingResizes.set(hash, resolve);
      post('images', { type: 'resize', hash, bytes, targetW, targetH, format });
    });
  }

  async function apply(hashes) {
    runId++;
    let done = 0, savedBytes = 0, skipped = 0, failedNodes = 0;

    for (const hash of hashes) {
      const rec = lastScan.get(hash);
      if (!rec) continue;
      const img = figma.getImageByHash(hash);
      if (!img) { skipped++; continue; }
      const bytes = await img.getBytesAsync();
      const result = await requestResize(hash, bytes, rec.targetW, rec.targetH, rec.format);

      if (!result || !result.bytes || result.bytes.length >= bytes.length) { skipped++; continue; }

      const newImage = figma.createImage(result.bytes);
      for (const ref of rec.nodes) {
        const node = await figma.getNodeByIdAsync(ref.id);
        if (!node || !('fills' in node) || node.fills === figma.mixed) continue;
        try {
          node.fills = node.fills.map((p) =>
            p.type === 'IMAGE' && p.imageHash === hash ? Object.assign({}, p, { imageHash: newImage.hash }) : p
          );
        } catch (e) {
          failedNodes++; // e.g. nodes inside a remote library component
        }
      }
      savedBytes += bytes.length - result.bytes.length;
      done++;
      post('images', { type: 'progress', phase: 'apply', n: done, total: hashes.length });
    }

    figma.commitUndo();
    post('images', { type: 'apply-result', done, skipped, failedNodes, savedBytes });
  }

  // Tells the UI what is selected, so it can switch the scope to "Selection" on its own.
  function pushSelection() {
    const sel = figma.currentPage.selection;
    const focused = sel.length === 1 && sel[0].id === focusedId;
    if (!focused) focusedId = null;
    post('images', {
      type: 'selection',
      count: sel.length,
      container: sel.some((n) => CONTAINER_TYPES.indexOf(n.type) !== -1),
      name: sel.length === 1 ? sel[0].name : null,
      focused
    });
  }

  async function focus(id) {
    const node = await figma.getNodeByIdAsync(id);
    if (!node || node.removed) return figma.notify(t('That layer no longer exists.', 'Bu katman artık yok.'));
    const page = pageOf(node);
    if (page && page !== figma.currentPage) await figma.setCurrentPageAsync(page);
    focusedId = node.id;
    figma.currentPage.selection = [node];
    figma.viewport.scrollAndZoomIntoView([node]);
  }

  async function activate() {
    const prefs = (await figma.clientStorage.getAsync(PREFS_KEY)) || {};
    post('images', { type: 'prefs', prefs });
    pushSelection();
  }

  async function onMessage(msg) {
    if (msg.type === 'setPrefs') return figma.clientStorage.setAsync(PREFS_KEY, msg.prefs);
    if (msg.type === 'scan') return scan(msg.scope, msg.scale, msg.minBytes);
    if (msg.type === 'apply') return apply(msg.hashes);
    if (msg.type === 'resized' || msg.type === 'previewed') {
      const map = msg.type === 'resized' ? pendingResizes : pendingPreviews;
      const resolve = map.get(msg.hash);
      if (resolve) { map.delete(msg.hash); resolve(msg); }
      return;
    }
    if (msg.type === 'focus') return focus(msg.id);
  }

  return { activate, refresh: pushSelection, onMessage };
})();

// =====================================================================================
// Title Maker ("Başlık Ekleyici"): adds a title bar above the selected frames, and optionally pushes
// the content below down and lines the frames up in rows.
//
// The title is a plain frame named "🏷 Title" with one text layer. Its text is edited on the canvas
// like any other text; the plugin never redraws it. Copying a title is fine too: nothing ties a title
// to its frames except where it sits.
// =====================================================================================

const Titles = (() => {
  const NS = 'pydetitle'; // namespace may only contain letters and digits
  const KEY = 'title';
  const NAME = '🏷 Title';
  const HEIGHT = 72;
  const GAP = 48; // between the title and the frames, and between frames
  const FRAME_TYPES = ['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'];
  const PREFS_KEY = 'pyde-title-prefs';
  const SECTION_PAD = 100; // room kept around content that would stick out of its section (as Figma's "Resize to fit")

  async function loadFont() {
    return (await loadCardFonts()).semibold;
  }

  // The frames a selection points at: for each selected layer, the top-level layer it sits in
  // (directly in a section or on the page). Titles and the ReadMe / note cards are skipped.
  function topLevel(node) {
    let top = node;
    while (top.parent && top.parent.type !== 'SECTION' && top.parent.type !== 'PAGE') top = top.parent;
    return top;
  }
  function isTitle(node) {
    return node.type === 'FRAME' && (node.getSharedPluginData(NS, KEY) !== '' || node.name === NAME);
  }
  function selectedFrames() {
    const seen = new Set();
    const frames = [];
    for (const n of figma.currentPage.selection) {
      const top = topLevel(n);
      if (FRAME_TYPES.indexOf(top.type) === -1 || isToolCard(top) || isTitle(top) || seen.has(top.id)) continue;
      seen.add(top.id);
      frames.push(top);
    }
    return frames;
  }

  function pushState() {
    const frames = selectedFrames();
    if (!frames.length) return post('titles', { type: 'state', status: 'none' });
    const parent = frames[0].parent;
    if (frames.some((f) => f.parent.id !== parent.id)) return post('titles', { type: 'state', status: 'mixed' });
    post('titles', {
      type: 'state', status: 'ok', count: frames.length,
      name: frames.length === 1 ? frames[0].name : null,
      section: parent.type === 'SECTION' ? parent.name : null,
      page: figma.currentPage.name
    });
  }

  // ---------- Building the title ----------

  function rgb(h) {
    const c = hex(h);
    return { r: c.r, g: c.g, b: c.b, a: 1 };
  }

  function createTitle(text, font) {
    const f = figma.createFrame();
    f.name = NAME;
    f.setSharedPluginData(NS, KEY, '1');
    f.layoutMode = 'HORIZONTAL';
    f.primaryAxisSizingMode = 'FIXED';
    f.counterAxisSizingMode = 'AUTO';
    f.counterAxisAlignItems = 'CENTER';
    f.paddingLeft = f.paddingRight = 32;
    f.paddingTop = f.paddingBottom = 18; // 18 + 36 + 18 = 72
    f.cornerRadius = 8;
    f.clipsContent = true;
    // Top to bottom: #7B7D83 → #5C5E66.
    f.fills = [{
      type: 'GRADIENT_LINEAR',
      gradientTransform: [[0, 1, 0], [-1, 0, 1]],
      gradientStops: [{ position: 0, color: rgb('#7B7D83') }, { position: 1, color: rgb('#5C5E66') }]
    }];
    f.strokes = [solid('#FFFFFF', 0.6)];
    f.strokeWeight = 1;
    f.strokeAlign = 'INSIDE';

    const tx = figma.createText();
    tx.fontName = font;
    tx.fontSize = 34;
    tx.lineHeight = { unit: 'PIXELS', value: 36 };
    tx.letterSpacing = { unit: 'PIXELS', value: -0.5 };
    tx.characters = text;
    tx.fills = [solid('#FFFFFF')];
    f.appendChild(tx);
    tx.layoutGrow = 1;
    tx.textAutoResize = 'HEIGHT';
    return f;
  }

  // ---------- Layout ----------

  // A frame with a Frame Note is laid out together with its card, so the card never lands on the next row.
  function block(frame) {
    const card = Note.cardOf(frame);
    const bottom = card && card.parent && card.parent.id === frame.parent.id ? card.y + card.height : frame.y + frame.height;
    return { frame, h: Math.max(frame.height, bottom - frame.y) };
  }

  // Rows follow how the frames are placed now: a frame whose top is above the middle of a row's
  // shortest frame belongs to that row. Each row is laid out left to right, 48 apart, aligned at the top.
  function tile(frames, left, top) {
    const blocks = frames.map(block).sort((a, b) => a.frame.y - b.frame.y || a.frame.x - b.frame.x);
    const rows = [];
    for (const b of blocks) {
      const row = rows[rows.length - 1];
      if (row && b.frame.y < row.top + row.minH / 2) {
        row.items.push(b);
        row.minH = Math.min(row.minH, b.frame.height);
      } else {
        rows.push({ top: b.frame.y, minH: b.frame.height, items: [b] });
      }
    }
    let y = top;
    let width = 0;
    for (const row of rows) {
      row.items.sort((a, b) => a.frame.x - b.frame.x);
      let x = left;
      let h = 0;
      for (const b of row.items) {
        b.frame.x = x;
        b.frame.y = y;
        x += b.frame.width + GAP;
        h = Math.max(h, b.h);
      }
      width = Math.max(width, x - GAP - left);
      y += h + GAP;
    }
    return { width, bottom: y - GAP };
  }

  function groupBottom(frames) {
    return Math.max.apply(null, frames.map((f) => { const b = block(f); return f.y + b.h; }));
  }

  // Sibling layers the title covers.
  function overlaps(title) {
    return title.parent.children.filter((c) => c.id !== title.id && c.visible &&
      c.x < title.x + title.width && c.x + c.width > title.x &&
      c.y < title.y + title.height && c.y + c.height > title.y).map((c) => c.name);
  }

  async function add(msg) {
    const text = String(msg.text || '').trim();
    const frames = selectedFrames();
    if (!text || !frames.length) return;
    const parent = frames[0].parent;
    if (frames.some((f) => f.parent.id !== parent.id)) {
      return figma.notify(t('The frames must be in the same section.', 'Frame’ler aynı section’da olmalı.'), { error: true });
    }
    const font = await loadFont();

    const left = Math.min.apply(null, frames.map((f) => f.x));
    const top = Math.min.apply(null, frames.map((f) => f.y));
    const right = Math.max.apply(null, frames.map((f) => f.x + f.width));
    const shift = HEIGHT + GAP;

    // Everything else in the section (or on the page) that starts at or below the top frame moves down.
    // The selected frames' note cards are left to Frame Note, which keeps them under their frames.
    const own = new Set(frames.map((f) => f.id));
    frames.forEach((f) => { const c = Note.cardOf(f); if (c) own.add(c.id); });
    const below = msg.push ? parent.children.filter((c) => !own.has(c.id) && c.y >= top - 0.5) : [];

    const oldBottom = groupBottom(frames);
    const titleY = msg.push ? top : top - shift;
    if (msg.push) {
      below.forEach((c) => { c.y += shift; });
      frames.forEach((f) => { f.y += shift; });
    }

    let width = right - left;
    let pushed = msg.push ? shift : 0;
    if (msg.align) {
      const r = tile(frames, left, titleY + shift);
      width = r.width;
      // If lining up made the group taller, what was pushed moves down by the difference too.
      const grew = r.bottom - (oldBottom + pushed);
      if (msg.push && grew > 0) {
        below.forEach((c) => { c.y += grew; });
        pushed += grew;
      }
    }

    const title = createTitle(text, font);
    const index = Math.max.apply(null, frames.map((f) => parent.children.findIndex((c) => c.id === f.id)));
    parent.insertChild(index + 1, title);
    title.x = left;
    title.y = titleY;
    title.resize(Math.max(1, width), title.height);
    // resize() fixes both sizes; the height goes back to hugging the text.
    title.primaryAxisSizingMode = 'FIXED';
    title.counterAxisSizingMode = 'AUTO';

    if (parent.type === 'SECTION') fitSection(parent, title, pushed);
    figma.currentPage.selection = [title];
    figma.commitUndo();

    const o = msg.push ? [] : overlaps(title);
    if (o.length) {
      figma.notify(t('The title overlaps “' + o[0] + '”' + (o.length > 1 ? ' and ' + (o.length - 1) + ' more' : '') + '.',
        'Başlık “' + o[0] + '”' + (o.length > 1 ? ' ve ' + (o.length - 1) + ' katman daha' : '') + ' ile çakışıyor.'));
    } else {
      figma.notify(t('Title added', 'Başlık eklendi'));
    }
    if (font.family !== 'DM Sans') {
      figma.notify(t('DM Sans couldn’t be loaded, the title uses ' + font.family + '.',
        'DM Sans yüklenemedi, başlıkta ' + font.family + ' kullanıldı.'));
    }
  }

  // Grows the section by what was pushed down (so the space below the content stays the same), and
  // further around its content when something still sticks out: to the right / bottom, and upwards when
  // the title sits above its top edge (the content keeps its place on the canvas).
  function fitSection(section, title, pushed) {
    if (pushed > 0) section.resizeWithoutConstraints(section.width, section.height + pushed);
    if (title.y < 0) {
      const d = SECTION_PAD - title.y;
      for (const c of section.children) c.y += d;
      section.y -= d;
      section.resizeWithoutConstraints(section.width, section.height + d);
    }
    let maxR = 0, maxB = 0;
    for (const c of section.children) {
      maxR = Math.max(maxR, c.x + c.width);
      maxB = Math.max(maxB, c.y + c.height);
    }
    const w = Math.max(section.width, maxR + SECTION_PAD);
    const h = Math.max(section.height, maxB + SECTION_PAD);
    if (w !== section.width || h !== section.height) section.resizeWithoutConstraints(w, h);
  }

  async function activate() {
    const prefs = (await figma.clientStorage.getAsync(PREFS_KEY)) || {};
    post('titles', { type: 'prefs', push: prefs.push !== false, align: prefs.align !== false });
    pushState();
  }

  async function onMessage(msg) {
    if (msg.type === 'refresh') return pushState();
    if (msg.type === 'setPrefs') return figma.clientStorage.setAsync(PREFS_KEY, { push: !!msg.push, align: !!msg.align });
    if (msg.type === 'add') {
      await add(msg);
      post('titles', { type: 'done' });
      return pushState();
    }
  }

  return { activate, refresh: pushState, onMessage, isTitle };
})();

// =====================================================================================
// Router
// =====================================================================================

const MODULES = { checklist: Checklist, readme: ReadMe, note: Note, images: Images, titles: Titles };

figma.on('selectionchange', () => {
  if (MODULES[active]) MODULES[active].refresh();
});
figma.on('currentpagechange', () => {
  Note.onPageChange(); // also refreshes the Frame Note screen when it is on
  if (MODULES[active] && active !== 'note') MODULES[active].refresh();
});

figma.ui.onmessage = async (msg) => {
  try {
    if (msg.type === 'ready') {
      const saved = await figma.clientStorage.getAsync(LANG_KEY);
      if (saved === 'en' || saved === 'tr') lang = saved;
      await loadDrafts();
      figma.ui.postMessage({ type: 'prefs', lang, route: startRoute });
      return Note.start();
    }
    if (msg.type === 'setLang') {
      if (msg.lang === 'en' || msg.lang === 'tr') {
        lang = msg.lang;
        await figma.clientStorage.setAsync(LANG_KEY, lang);
      }
      return;
    }
    // The admin's GitHub token (used by the UI to edit checklist.json / team.json in the repo).
    // It is kept only on this computer, in this plugin's local storage, never in the file.
    if (msg.type === 'getAdmin') {
      figma.ui.postMessage({ type: 'admin', token: (await figma.clientStorage.getAsync(ADMIN_KEY)) || null });
      return;
    }
    if (msg.type === 'setAdmin') {
      if (msg.token) await figma.clientStorage.setAsync(ADMIN_KEY, String(msg.token));
      else await figma.clientStorage.deleteAsync(ADMIN_KEY);
      return;
    }
    // The UI switched screens: `f` is the tool now on screen, or null for the home screen.
    if (msg.type === 'nav') {
      active = MODULES[msg.f] ? msg.f : null;
      if (active) await MODULES[active].activate();
      return;
    }
    if (MODULES[msg.f]) return await MODULES[msg.f].onMessage(msg);
  } catch (e) {
    const text = e && e.message ? e.message : String(e);
    // The Image Optimizer shows errors in its own banner.
    if (msg.f !== 'images') figma.notify(t('Something went wrong: ', 'Bir hata oluştu: ') + text, { error: true });
    if (msg.f) post(msg.f, { type: 'error', text });
  }
};
