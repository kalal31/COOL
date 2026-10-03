import { api } from '../api.js';
import {
  h, icon, badge, hazardChips, fmtDate, fmtNum, today, addDays, formDialog, infoDialog, attempt, emptyState,
} from '../ui.js';
import { crudPage } from '../crud-page.js';
import { EQUIPMENT_STATUS, HAZARDS, UNITS, options } from '../labels.js';

const statusKind = { ok: 'ok', maintenance: 'warn', out_of_service: 'danger' };

export function equipmentView(page, { isStaff }) {
  return crudPage(page, {
    title: 'Matériel',
    subtitle: 'Équipements, instruments et verrerie du laboratoire.',
    endpoint: '/api/equipment',
    noun: 'un matériel',
    canAdd: isStaff, canEdit: isStaff, canDelete: isStaff,
    searchText: (r) => [r.name, r.category, r.location, r.serial].filter(Boolean).join(' '),
    searchPlaceholder: 'Rechercher (nom, catégorie, emplacement…)',
    filters: [{ name: 'status', label: 'Tous les états', options: options(EQUIPMENT_STATUS), test: (r, v) => r.status === v }],
    toolbarExtras: isStaff ? [h('a', { class: 'btn', href: '/api/export/equipment.csv', download: '' }, icon('download'), 'Exporter en CSV')] : [],
    rowClass: (r) => (r.status === 'out_of_service' ? 'row-danger' : r.status === 'maintenance' ? 'row-warn' : ''),
    columns: [
      { label: 'Nom', render: (r) => h('span', {}, r.name, r.serial && h('span', { class: 'sub' }, `N° ${r.serial}`)) },
      { label: 'Catégorie', render: (r) => r.category ?? '—' },
      { label: 'Emplacement', render: (r) => r.location ?? '—' },
      { label: 'Quantité', class: 'num', render: (r) => fmtNum(r.quantity) },
      { label: 'Disponible', class: 'num', render: (r) => fmtNum(r.available) },
      { label: 'État', render: (r) => badge(EQUIPMENT_STATUS[r.status], statusKind[r.status]) },
    ],
    defaults: { quantity: 1, status: 'ok' },
    fields: [
      { name: 'name', label: 'Nom', type: 'text', required: true, max: 120, full: true },
      { name: 'category', label: 'Catégorie', type: 'text', max: 80, placeholder: 'ex. Verrerie' },
      { name: 'serial', label: 'N° de série', type: 'text', max: 80 },
      { name: 'location', label: 'Emplacement', type: 'text', max: 120, placeholder: 'ex. Armoire C-1' },
      { name: 'quantity', label: 'Quantité totale', type: 'number', min: 0, step: 1 },
      { name: 'status', label: 'État', type: 'select', required: true, options: options(EQUIPMENT_STATUS) },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, max: 1000 },
    ],
  });
}

const soonLimit = () => addDays(today(), 30);
const isExpired = (r) => r.expiry_date && r.expiry_date < today();
const isExpiringSoon = (r) => r.expiry_date && r.expiry_date >= today() && r.expiry_date <= soonLimit();
const isLow = (r) => r.min_quantity > 0 && r.quantity <= r.min_quantity;

async function showJournal(reagent) {
  const log = await api.get(`/api/reagents/${reagent.id}/movements`);
  const content = log.length
    ? h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, ['Date', 'Variation', 'Stock après', 'Motif', 'Par'].map((c, i) => h('th', { class: i === 1 || i === 2 ? 'num' : '' }, c)))),
      h('tbody', {}, log.map((m) => h('tr', {},
        h('td', {}, m.created_at.slice(0, 16).replace('T', ' ')),
        h('td', { class: 'num' }, `${m.delta > 0 ? '+' : ''}${fmtNum(m.delta)}`),
        h('td', { class: 'num' }, `${fmtNum(m.quantity_after)} ${reagent.unit}`),
        h('td', {}, m.reason ?? '—'), h('td', {}, m.user_name ?? '—'))))))
    : emptyState('Aucun mouvement enregistré.');
  await infoDialog(`Journal — ${reagent.name}`, content, { wide: true });
}

export function reagentsView(page, { isStaff }) {
  const movement = (reagent, reload) => formDialog({
    title: `Mouvement de stock — ${reagent.name}`,
    intro: `Stock actuel : ${fmtNum(reagent.quantity)} ${reagent.unit}. Saisissez un nombre positif pour une entrée, négatif pour une consommation.`,
    fields: [
      { name: 'delta', label: `Variation (${reagent.unit})`, type: 'number', step: 'any', required: true, full: true },
      { name: 'reason', label: 'Motif', type: 'text', max: 200, placeholder: 'ex. TP dosage — Première Spé', full: true },
    ],
    submitLabel: 'Enregistrer le mouvement',
    onSubmit: (v) => api.post(`/api/reagents/${reagent.id}/movements`, { delta: Number(v.delta), reason: v.reason }),
  }).then((saved) => saved && attempt(reload, 'Stock mis à jour.'));

  return crudPage(page, {
    title: 'Produits chimiques',
    subtitle: 'Stocks, dates de péremption et dangers (pictogrammes SGH).',
    endpoint: '/api/reagents',
    noun: 'un produit',
    canAdd: isStaff, canEdit: isStaff, canDelete: isStaff,
    searchText: (r) => [r.name, r.formula, r.cas, r.location].filter(Boolean).join(' '),
    searchPlaceholder: 'Rechercher (nom, formule, CAS…)',
    filters: [{
      name: 'alert', label: 'Tous les produits',
      options: [{ value: 'low', label: 'Stock bas' }, { value: 'expired', label: 'Périmés' }, { value: 'soon', label: 'Péremption sous 30 j' }, { value: 'hazard', label: 'Dangereux' }],
      test: (r, v) => ({ low: isLow(r), expired: isExpired(r), soon: isExpiringSoon(r), hazard: r.hazards.length > 0 })[v],
    }],
    toolbarExtras: isStaff ? [h('a', { class: 'btn', href: '/api/export/reagents.csv', download: '' }, icon('download'), 'Exporter en CSV')] : [],
    rowClass: (r) => (isExpired(r) ? 'row-danger' : isLow(r) || isExpiringSoon(r) ? 'row-warn' : ''),
    columns: [
      { label: 'Produit', render: (r) => h('span', {}, r.name, h('span', { class: 'sub' }, [r.formula, r.cas && `CAS ${r.cas}`].filter(Boolean).join(' · '))) },
      { label: 'Stock', class: 'num', render: (r) => h('span', {}, `${fmtNum(r.quantity)} ${r.unit} `, isLow(r) && badge('Bas', 'danger')) },
      { label: 'Péremption', render: (r) => (r.expiry_date
        ? h('span', {}, fmtDate(r.expiry_date), ' ', isExpired(r) ? badge('Périmé', 'danger') : isExpiringSoon(r) ? badge('Bientôt', 'warn') : null)
        : '—') },
      { label: 'Dangers', render: (r) => hazardChips(r.hazards) },
      { label: 'Emplacement', render: (r) => r.location ?? '—' },
    ],
    rowActions: (r, { reload }) => [
      isStaff && h('button', { class: 'btn small', type: 'button', onclick: () => movement(r, reload) }, 'Mouvement'),
      h('button', { class: 'icon-btn', type: 'button', title: 'Journal des mouvements', 'aria-label': `Journal de ${r.name}`, onclick: () => attempt(() => showJournal(r)) }, icon('list')),
    ],
    defaults: { unit: 'mL', quantity: 0, min_quantity: 0, hazards: [] },
    fields: [
      { name: 'name', label: 'Nom', type: 'text', required: true, max: 120, full: true },
      { name: 'formula', label: 'Formule', type: 'text', max: 60, placeholder: 'ex. HCl' },
      { name: 'cas', label: 'N° CAS', type: 'text', max: 12, placeholder: 'ex. 7647-01-0' },
      { name: 'quantity', label: 'Quantité en stock', type: 'number', min: 0, step: 'any', required: true },
      { name: 'unit', label: 'Unité', type: 'select', required: true, options: UNITS.map((u) => ({ value: u, label: u })) },
      { name: 'min_quantity', label: 'Seuil d’alerte', type: 'number', min: 0, step: 'any', hint: 'Une alerte apparaît quand le stock passe sous ce seuil.' },
      { name: 'expiry_date', label: 'Date de péremption', type: 'date' },
      { name: 'location', label: 'Emplacement', type: 'text', max: 120, placeholder: 'ex. Armoire acides' },
      { name: 'hazards', label: 'Dangers (pictogrammes SGH)', type: 'checkboxes', options: options(HAZARDS) },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, max: 1000 },
    ],
  });
}
