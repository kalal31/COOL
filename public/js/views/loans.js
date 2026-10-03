import { api } from '../api.js';
import { h, badge, fmtDate, fmtNum, today, addDays, confirmDialog, attempt } from '../ui.js';
import { crudPage } from '../crud-page.js';
import { ROLES } from '../labels.js';

export function loansView(page, { user, isStaff }) {
  const dueField = { name: 'due_date', label: 'Retour prévu le', type: 'date', required: true };
  const notesField = { name: 'notes', label: 'Notes', type: 'text', max: 500, full: true };

  return crudPage(page, {
    title: isStaff ? 'Emprunts de matériel' : 'Mes emprunts',
    subtitle: isStaff ? 'Sorties de matériel, retours et retards.' : 'Le matériel que vous avez emprunté.',
    endpoint: '/api/loans',
    noun: 'un emprunt',
    labelOf: (r) => `${r.equipment_name} — ${r.borrower_name}`,
    canAdd: isStaff, canEdit: isStaff, canDelete: user.role === 'admin',
    searchText: (r) => `${r.equipment_name} ${r.borrower_name}`,
    searchPlaceholder: 'Rechercher (matériel, emprunteur…)',
    filters: [{
      name: 'state', label: 'Tous les emprunts',
      options: [{ value: 'open', label: 'En cours' }, { value: 'overdue', label: 'En retard' }, { value: 'returned', label: 'Retournés' }],
      test: (r, v) => ({ open: !r.returned_at, overdue: r.overdue, returned: Boolean(r.returned_at) })[v],
    }],
    rowClass: (r) => (r.overdue ? 'row-danger' : ''),
    columns: [
      { label: 'Matériel', render: (r) => h('span', {}, r.equipment_name, r.notes && h('span', { class: 'sub' }, r.notes)) },
      { label: 'Qté', class: 'num', render: (r) => fmtNum(r.quantity) },
      { label: 'Emprunteur', render: (r) => r.borrower_name },
      { label: 'Sortie', render: (r) => fmtDate(r.loaned_at) },
      { label: 'Retour prévu', render: (r) => fmtDate(r.due_date) },
      { label: 'Statut', render: (r) => (r.returned_at ? badge(`Rendu le ${fmtDate(r.returned_at)}`, 'ok') : r.overdue ? badge('En retard', 'danger') : badge('En cours', 'info')) },
    ],
    rowActions: (r, { reload }) => isStaff && !r.returned_at && h('button', { class: 'btn small', type: 'button', onclick: async () => {
      if (!(await confirmDialog(`Enregistrer le retour de « ${r.equipment_name} » × ${r.quantity} ?`, { confirmLabel: 'Enregistrer le retour' }))) return;
      const { ok } = await attempt(() => api.post(`/api/loans/${r.id}/return`), 'Retour enregistré.');
      if (ok) await attempt(reload);
    } }, 'Retour'),
    defaults: { quantity: 1, loaned_at: today(), due_date: addDays(today(), 7) },
    toForm: (r) => ({ due_date: r.due_date, notes: r.notes }),
    toApi: (v, row) => (row ? { due_date: v.due_date, notes: v.notes } : v),
    fields: async (row) => {
      if (row) return [dueField, notesField];
      const [equipment, people] = await Promise.all([api.get('/api/equipment'), api.get('/api/users/people')]);
      return [
        { name: 'equipment_id', label: 'Matériel', type: 'select', required: true, placeholder: '— Choisir —', full: true,
          options: equipment.filter((e) => e.status === 'ok' && e.available > 0).map((e) => ({ value: e.id, label: `${e.name} (${e.available} disponible${e.available > 1 ? 's' : ''})` })) },
        { name: 'borrower_id', label: 'Emprunteur', type: 'select', required: true, placeholder: '— Choisir —',
          options: people.map((p) => ({ value: p.id, label: `${p.name} (${ROLES[p.role]})` })) },
        { name: 'quantity', label: 'Quantité', type: 'number', min: 1, step: 1 },
        { name: 'loaned_at', label: 'Sortie le', type: 'date' },
        dueField, notesField,
      ];
    },
  });
}
