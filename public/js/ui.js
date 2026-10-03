import { ApiError } from './api.js';
import { HAZARDS } from './labels.js';

// ---------- Construction du DOM (le texte passe toujours par des nœuds texte : pas d'injection HTML) ----------

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  const late = {};
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value' || k === 'checked' || k === 'selected') late[k] = v; // après les enfants (utile pour <select>)
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  Object.assign(el, late);
  return el;
}

const ICONS = {
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  flask: '<path d="M10 2v7.5L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5L14 9.5V2"/><path d="M8.5 2h7M7 16h10"/>',
  book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/>',
  loan: '<path d="m17 1 4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="m7 23-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  room: '<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z"/>',
  trash: '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  menu: '<path d="M3 12h18M3 6h18M3 18h18"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  left: '<path d="m15 18-6-6 6-6"/>',
  right: '<path d="m9 18 6-6-6-6"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
  clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2M9 14l2 2 4-4"/>',
  printer: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>',
};

/** Icônes : balisage SVG statique défini ci-dessus, jamais construit à partir de données. */
export function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

// ---------- Formats ----------

export const parseISO = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const toISO = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const addDays = (iso, n) => { const d = parseISO(iso); d.setDate(d.getDate() + n); return toISO(d); };
export const today = () => toISO(new Date());
export const fmtDate = (iso) => (iso ? parseISO(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDay = (iso) => parseISO(iso).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
export const fmtNum = (n) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 3 }).format(n);
export const pluralize = (n, one, many) => `${fmtNum(n)} ${n > 1 ? many : one}`;

// ---------- Petits composants ----------

export function badge(text, kind = 'neutral') {
  return h('span', { class: `badge ${kind}` }, text);
}

export function hazardChips(codes, { labels = false } = {}) {
  if (!codes?.length) return h('span', { class: 'muted' }, '—');
  return h('span', { class: 'ghs-list' }, codes.map((c) =>
    h('span', { class: 'ghs-item', title: HAZARDS[c] ?? c },
      h('span', { class: 'ghs', role: 'img', 'aria-label': HAZARDS[c] ?? c }, h('span', {}, c.replace('GHS', ''))),
      labels && h('span', { class: 'ghs-label' }, HAZARDS[c] ?? c))));
}

export function emptyState(text) {
  return h('div', { class: 'empty' }, text);
}

export function toast(message, kind = 'ok') {
  const el = h('div', { class: `toast ${kind}` }, message);
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), kind === 'error' ? 6000 : 3500);
}

export const errorMessage = (err) => (err instanceof ApiError ? err.message : 'Une erreur inattendue est survenue.');

/** Exécute une action et affiche l'erreur éventuelle en notification. */
export async function attempt(fn, successMessage) {
  try {
    const result = await fn();
    if (successMessage) toast(successMessage);
    return { ok: true, result };
  } catch (err) {
    toast(errorMessage(err), 'error');
    return { ok: false };
  }
}

// ---------- Boîtes de dialogue ----------

/** Ouvre un <dialog> modal ; `build(close)` renvoie son contenu. Résout avec la valeur passée à close(), sinon null. */
export function openDialog(build, { wide = false, label } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const dlg = h('dialog', { class: `modal${wide ? ' wide' : ''}`, 'aria-label': label });
    const close = (value = null) => { result = value; dlg.close(); };
    dlg.append(build(close));
    dlg.addEventListener('close', () => { dlg.remove(); resolve(result); });
    document.body.append(dlg);
    dlg.showModal();
  });
}

export function confirmDialog(message, { confirmLabel = 'Confirmer', danger = false, title = 'Confirmation' } = {}) {
  return openDialog((close) => h('div', { class: 'modal-body' },
    h('h2', {}, title),
    h('p', {}, message),
    h('div', { class: 'modal-actions' },
      h('button', { class: 'btn', type: 'button', onclick: () => close(false) }, 'Annuler'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, type: 'button', autofocus: true, onclick: () => close(true) }, confirmLabel))),
  { label: title }).then(Boolean);
}

export function infoDialog(title, content, { wide = false, actions = [] } = {}) {
  return openDialog((close) => h('div', { class: 'modal-body' },
    h('div', { class: 'modal-head' }, h('h2', {}, title),
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('x'))),
    content,
    h('div', { class: 'modal-actions' }, ...actions.map((a) => a(close)),
      h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Fermer'))),
  { wide, label: title });
}

// ---------- Formulaires ----------

/** Éditeur de lignes « élément + quantité » (matériel et produits d'un TP). */
function linesEditor(field, initial) {
  const list = h('div', { class: 'lines' });
  const addRow = (item = {}) => {
    const select = h('select', { 'aria-label': field.itemLabel },
      h('option', { value: '' }, `— ${field.itemLabel} —`),
      field.options.map((o) => h('option', { value: o.value }, o.label)));
    select.value = item[field.itemKey] ?? '';
    const qty = h('input', { type: 'number', min: field.decimal ? 0 : 1, step: field.decimal ? 'any' : 1, value: item.quantity ?? 1, 'aria-label': 'Quantité par poste' });
    const row = h('div', { class: 'line' }, select, qty,
      h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Retirer la ligne', onclick: () => row.remove() }, icon('x')));
    row.getItem = () => (select.value ? { [field.itemKey]: Number(select.value), quantity: Number(qty.value) } : null);
    list.append(row);
  };
  (initial ?? []).forEach(addRow);
  const node = h('div', { class: 'lines-editor' }, list,
    h('button', { class: 'btn small', type: 'button', onclick: () => addRow() }, icon('plus'), 'Ajouter'));
  return { node, getValue: () => [...list.children].map((r) => r.getItem()).filter(Boolean) };
}

function buildControl(field, value, id) {
  const common = { id, name: field.name, required: field.required, placeholder: field.placeholder, autocomplete: field.autocomplete ?? 'off' };
  switch (field.type) {
    case 'textarea':
      return { node: h('textarea', { ...common, rows: field.rows ?? 4, maxlength: field.max, value: value ?? '' }), getValue(n) { return n.value; } };
    case 'select': {
      const sel = h('select', common,
        (!field.required || field.placeholder) && h('option', { value: '' }, field.placeholder ?? '—'),
        field.options.map((o) => h('option', { value: o.value }, o.label)));
      sel.value = value ?? field.default ?? '';
      return { node: sel, getValue: (n) => n.value };
    }
    case 'checkboxes': {
      const chosen = new Set(value ?? []);
      const boxes = field.options.map((o) => ({ o, input: h('input', { type: 'checkbox', value: o.value, checked: chosen.has(o.value) }) }));
      const node = h('div', { class: 'checkbox-grid', role: 'group', 'aria-labelledby': `${id}-label` },
        boxes.map(({ o, input }) => h('label', { class: 'check' }, input, o.label)));
      return { node, getValue: () => boxes.filter((b) => b.input.checked).map((b) => b.o.value) };
    }
    case 'lines': {
      const ed = linesEditor(field, value);
      return { node: ed.node, getValue: ed.getValue, bare: true };
    }
    default: {
      const input = h('input', {
        ...common, type: field.type ?? 'text', value: value ?? field.default ?? '',
        min: field.min, max: field.max, step: field.step, maxlength: field.type === 'number' ? null : field.max,
      });
      return { node: input, getValue: (n) => n.value };
    }
  }
}

/**
 * Formulaire modal piloté par une description de champs.
 * `onSubmit(values)` envoie les données ; une ApiError y est affichée champ par champ.
 * Résout avec le résultat de onSubmit, ou null si l'utilisateur annule.
 */
export function formDialog({ title, fields, values = {}, submitLabel = 'Enregistrer', onSubmit, wide = false, intro }) {
  return openDialog((close) => {
    const controls = [];
    const errorBox = h('div', { class: 'form-error', role: 'alert', hidden: true });
    const grid = h('div', { class: 'form-grid' });

    fields.forEach((f, i) => {
      const id = `f-${f.name}-${i}`;
      const ctl = buildControl(f, values[f.name], id);
      const err = h('div', { class: 'field-error', id: `${id}-err`, hidden: true });
      ctl.node.setAttribute?.('aria-describedby', `${id}-err`);
      controls.push({ f, ctl, err });
      grid.append(h('div', { class: `field${f.full || f.type === 'textarea' || f.type === 'lines' || f.type === 'checkboxes' ? ' full' : ''}` },
        h('label', { for: ctl.bare ? null : id, id: `${id}-label` }, f.label, f.required && h('span', { class: 'req', 'aria-hidden': 'true' }, ' *')),
        ctl.node, f.hint && h('div', { class: 'hint' }, f.hint), err));
    });

    const submit = h('button', { class: 'btn primary', type: 'submit' }, submitLabel);
    const form = h('form', { class: 'modal-body', novalidate: true },
      h('div', { class: 'modal-head' }, h('h2', {}, title),
        h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Fermer', onclick: () => close() }, icon('x'))),
      intro && h('p', { class: 'muted' }, intro),
      errorBox, grid,
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: () => close() }, 'Annuler'), submit));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {};
      for (const { f, ctl } of controls) data[f.name] = ctl.getValue(ctl.node);
      for (const { err } of controls) { err.hidden = true; err.textContent = ''; }
      errorBox.hidden = true;
      submit.disabled = true;
      try {
        close(await onSubmit(data) ?? true);
      } catch (err) {
        submit.disabled = false;
        if (!(err instanceof ApiError)) { errorBox.textContent = 'Une erreur inattendue est survenue.'; errorBox.hidden = false; return; }
        let shown = false;
        for (const { f, err: box } of controls) {
          const msg = err.fields?.[f.name];
          if (msg) { box.textContent = msg; box.hidden = false; shown = true; }
        }
        errorBox.textContent = shown ? 'Corrigez les champs signalés.' : err.message;
        errorBox.hidden = false;
        form.querySelector('.field-error:not([hidden])')?.closest('.field')?.querySelector('input,select,textarea')?.focus();
      }
    });
    queueMicrotask(() => form.querySelector('input:not([type=checkbox]),select,textarea')?.focus());
    return form;
  }, { wide, label: title });
}
