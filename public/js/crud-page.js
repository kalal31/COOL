import { api } from './api.js';
import { h, icon, attempt, confirmDialog, formDialog, emptyState } from './ui.js';

const can = (rule, row) => (typeof rule === 'function' ? Boolean(rule(row)) : Boolean(rule));

/**
 * Page de liste avec recherche, filtres, ajout, modification et suppression.
 * Configuration : title, subtitle, endpoint, noun (« un matériel »), columns, fields, searchText,
 * filters, canAdd / canEdit / canDelete (booléen ou fonction de ligne), rowActions, toolbarExtras…
 */
export async function crudPage(page, cfg) {
  const {
    title, subtitle, endpoint, noun, columns, searchText, filters = [], defaults = {}, nameKey = 'name',
    labelOf = (r) => r[nameKey],
    toForm = (r) => r, toApi = (v) => v, rowClass, rowActions, toolbarExtras = [], searchPlaceholder = 'Rechercher…',
  } = cfg;
  let rows = await api.get(endpoint);
  const state = { q: '', filters: {} };
  const body = h('div');

  const visible = () => rows.filter((r) => {
    if (state.q && !searchText(r).toLowerCase().includes(state.q)) return false;
    return filters.every((f) => !state.filters[f.name] || f.test(r, state.filters[f.name]));
  });

  async function reload() {
    rows = await api.get(endpoint);
    draw();
  }

  async function openForm(row) {
    const fields = typeof cfg.fields === 'function' ? await cfg.fields(row) : cfg.fields;
    const label = row ? `Modifier ${noun.replace(/^(un|une) /, '')}` : `Ajouter ${noun}`;
    const saved = await formDialog({
      title: label,
      fields,
      values: row ? toForm(row) : defaults,
      onSubmit: (values) => (row ? api.put(`${endpoint}/${row.id}`, toApi(values, row)) : api.post(endpoint, toApi(values, null))),
    });
    if (saved) {
      await attempt(reload, 'Enregistré.');
    }
  }

  async function remove(row) {
    const ok = await confirmDialog(`Supprimer « ${labelOf(row)} » ? Cette action est définitive.`, { confirmLabel: 'Supprimer', danger: true });
    if (!ok) return;
    const { ok: done } = await attempt(() => api.del(`${endpoint}/${row.id}`), 'Supprimé.');
    if (done) await attempt(reload);
  }

  function draw() {
    const list = visible();
    if (!list.length) {
      body.replaceChildren(h('div', { class: 'table-wrap' }, emptyState(rows.length ? 'Aucun résultat pour ces critères.' : 'Rien à afficher pour le moment.')));
      return;
    }
    const table = h('table', {},
      h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.class }, c.label)), h('th', { class: 'actions' }, h('span', { class: 'sr-only' }, 'Actions')))),
      h('tbody', {}, list.map((r) => h('tr', { class: rowClass?.(r) },
        columns.map((c) => h('td', { class: c.class }, c.render(r))),
        h('td', { class: 'actions' },
          rowActions?.(r, { reload }),
          can(cfg.canEdit, r) && h('button', { class: 'icon-btn', type: 'button', title: 'Modifier', 'aria-label': `Modifier ${labelOf(r)}`, onclick: () => openForm(r) }, icon('edit')),
          can(cfg.canDelete, r) && h('button', { class: 'icon-btn danger', type: 'button', title: 'Supprimer', 'aria-label': `Supprimer ${labelOf(r)}`, onclick: () => remove(r) }, icon('trash')))))));
    body.replaceChildren(h('div', { class: 'table-wrap' }, table));
  }

  const toolbar = h('div', { class: 'toolbar' },
    h('input', {
      type: 'search', placeholder: searchPlaceholder, 'aria-label': 'Rechercher',
      oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); },
    }),
    filters.map((f) => h('select', {
      'aria-label': f.label,
      onchange: (e) => { state.filters[f.name] = e.target.value; draw(); },
    }, h('option', { value: '' }, f.label), f.options.map((o) => h('option', { value: o.value }, o.label)))));

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, title), subtitle && h('p', { class: 'muted' }, subtitle)),
      h('div', { class: 'page-actions' }, toolbarExtras,
        can(cfg.canAdd) && h('button', { class: 'btn primary', type: 'button', onclick: () => openForm(null) }, icon('plus'), 'Ajouter'))),
    (searchText || filters.length) && toolbar,
    body);
  draw();
  return { reload };
}
