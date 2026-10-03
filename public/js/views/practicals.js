import { api } from '../api.js';
import {
  h, icon, badge, hazardChips, emptyState, fmtNum, formDialog, confirmDialog, attempt, toast,
} from '../ui.js';
import { SUBJECTS, options } from '../labels.js';

const canCreate = (user) => user.role === 'admin' || user.role === 'teacher';
const canEdit = (user, tp) => user.role === 'admin' || (user.role === 'teacher' && tp.created_by === user.id);

async function practicalFields(extra) {
  const [equipment, reagents] = await Promise.all([api.get('/api/equipment'), api.get('/api/reagents')]);
  return [
    { name: 'title', label: 'Titre', type: 'text', required: true, max: 160, full: true },
    { name: 'subject', label: 'Discipline', type: 'select', required: true, options: options(SUBJECTS), default: 'chimie' },
    { name: 'level', label: 'Niveau', type: 'text', max: 80, placeholder: 'ex. Première' },
    { name: 'duration_min', label: 'Durée (minutes)', type: 'number', min: 15, step: 5 },
    { name: 'objectives', label: 'Objectifs', type: 'textarea', rows: 2, max: 2000 },
    { name: 'description', label: 'Protocole', type: 'textarea', rows: 7, max: 5000 },
    { name: 'safety_notes', label: 'Consignes de sécurité', type: 'textarea', rows: 3, max: 2000 },
    { name: 'equipment', label: 'Matériel (par poste)', type: 'lines', itemKey: 'equipment_id', itemLabel: 'Matériel',
      options: equipment.map((e) => ({ value: e.id, label: e.name })) },
    { name: 'reagents', label: 'Produits (par poste)', type: 'lines', itemKey: 'reagent_id', itemLabel: 'Produit', decimal: true,
      options: reagents.map((r) => ({ value: r.id, label: `${r.name} (${r.unit})` })) },
    ...(extra ?? []),
  ];
}

async function openEditor(tp) {
  const fields = await practicalFields();
  return formDialog({
    title: tp ? 'Modifier le TP' : 'Nouveau travail pratique',
    fields, wide: true,
    values: tp ?? { subject: 'chimie', duration_min: 120 },
    onSubmit: (v) => (tp ? api.put(`/api/practicals/${tp.id}`, v) : api.post('/api/practicals', v)),
  });
}

export async function practicalsView(page, { user }) {
  const list = await api.get('/api/practicals');
  const state = { q: '', subject: '' };
  const cards = h('div', { class: 'cards' });

  function draw() {
    const shown = list.filter((p) => (!state.subject || p.subject === state.subject)
      && (!state.q || `${p.title} ${p.level ?? ''} ${p.author ?? ''}`.toLowerCase().includes(state.q)));
    if (!shown.length) { cards.replaceChildren(emptyState('Aucun TP ne correspond.')); return; }
    cards.replaceChildren(...shown.map((p) => h('a', { class: 'card tp-card', href: `#/practicals/${p.id}` },
      h('h3', {}, p.title),
      h('div', { class: 'meta' }, badge(SUBJECTS[p.subject], 'info'), p.level && badge(p.level), badge(`${p.duration_min} min`)),
      p.hazards.length > 0 && hazardChips(p.hazards),
      h('div', { class: 'foot' }, h('span', {}, `${p.equipment_count} matériel · ${p.reagent_count} produit${p.reagent_count > 1 ? 's' : ''}`), h('span', {}, p.author ?? '')))));
  }

  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Travaux pratiques'), h('p', { class: 'muted' }, 'Protocoles, matériel, produits et consignes de sécurité.')),
      h('div', { class: 'page-actions' }, canCreate(user) && h('button', { class: 'btn primary', type: 'button', onclick: async () => {
        const { ok, result } = await attempt(() => openEditor(null));
        if (ok && result) { toast('TP créé.'); location.hash = `#/practicals/${result.id}`; }
      } }, icon('plus'), 'Nouveau TP'))),
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', placeholder: 'Rechercher un TP…', 'aria-label': 'Rechercher', oninput: (e) => { state.q = e.target.value.trim().toLowerCase(); draw(); } }),
      h('select', { 'aria-label': 'Discipline', onchange: (e) => { state.subject = e.target.value; draw(); } },
        h('option', { value: '' }, 'Toutes les disciplines'), Object.entries(SUBJECTS).map(([v, l]) => h('option', { value: v }, l)))),
    cards);
  draw();
}

export async function practicalDetailView(page, { user, params }) {
  const container = h('div');
  page.append(container);

  async function render() {
    const tp = await api.get(`/api/practicals/${params.id}`);
    const editable = canEdit(user, tp);
    const section = (title, content) => content && h('section', { class: 'card' }, h('h2', {}, title), content);

    container.replaceChildren(
      h('a', { class: 'back-link', href: '#/practicals' }, icon('left'), 'Tous les TP'),
      h('div', { class: 'page-head' },
        h('div', {}, h('h1', {}, tp.title),
          h('div', { class: 'meta toolbar' }, badge(SUBJECTS[tp.subject], 'info'), tp.level && badge(tp.level), badge(`${tp.duration_min} min`),
            tp.author && h('span', { class: 'muted' }, `par ${tp.author}`))),
        editable && h('div', { class: 'page-actions' },
          h('button', { class: 'btn', type: 'button', onclick: async () => {
            const { ok, result } = await attempt(() => openEditor(tp));
            if (ok && result) { toast('TP mis à jour.'); await attempt(render); }
          } }, icon('edit'), 'Modifier'),
          h('button', { class: 'btn danger', type: 'button', onclick: async () => {
            if (!(await confirmDialog(`Supprimer le TP « ${tp.title} » ? Les séances déjà planifiées seront conservées sans lien vers ce TP.`, { confirmLabel: 'Supprimer', danger: true }))) return;
            const { ok } = await attempt(() => api.del(`/api/practicals/${tp.id}`), 'TP supprimé.');
            if (ok) location.hash = '#/practicals';
          } }, icon('trash'), 'Supprimer'))),
      h('div', { class: 'grid' },
        (tp.safety_notes || tp.hazards.length > 0) && h('section', { class: 'safety' },
          h('h3', {}, icon('alert'), 'Sécurité'),
          tp.safety_notes && h('p', { class: 'prose' }, tp.safety_notes),
          tp.hazards.length > 0 && hazardChips(tp.hazards, { labels: true })),
        section('Objectifs', tp.objectives && h('p', { class: 'prose' }, tp.objectives)),
        section('Protocole', tp.description && h('p', { class: 'prose' }, tp.description)),
        h('div', { class: 'grid cols-2' },
          section('Matériel (par poste)', tp.equipment.length
            ? h('ul', { class: 'bullets' }, tp.equipment.map((e) => h('li', {}, `${e.name} × ${fmtNum(e.quantity)}`)))
            : h('p', { class: 'muted' }, 'Aucun matériel renseigné.')),
          section('Produits (par poste)', tp.reagents.length
            ? h('ul', { class: 'bullets' }, tp.reagents.map((r) => h('li', {}, `${r.name} : ${fmtNum(r.quantity)} ${r.unit} `, hazardChips(r.hazards))))
            : h('p', { class: 'muted' }, 'Aucun produit renseigné.')))));
  }
  await render();
}
