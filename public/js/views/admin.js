import { h, badge, fmtDate, fmtNum } from '../ui.js';
import { crudPage } from '../crud-page.js';
import { ROLES, options } from '../labels.js';

export function roomsView(page, { user }) {
  const edit = user.role === 'admin' || user.role === 'technician';
  return crudPage(page, {
    title: 'Salles et laboratoires',
    subtitle: 'La capacité est contrôlée lors de la réservation d’une séance.',
    endpoint: '/api/rooms',
    noun: 'une salle',
    canAdd: edit, canEdit: edit, canDelete: edit,
    searchText: (r) => `${r.name} ${r.building ?? ''}`,
    columns: [
      { label: 'Nom', render: (r) => h('span', {}, r.name, r.description && h('span', { class: 'sub' }, r.description)) },
      { label: 'Bâtiment', render: (r) => r.building ?? '—' },
      { label: 'Capacité', class: 'num', render: (r) => `${fmtNum(r.capacity)} places` },
    ],
    defaults: { capacity: 24 },
    fields: [
      { name: 'name', label: 'Nom', type: 'text', required: true, max: 80 },
      { name: 'building', label: 'Bâtiment', type: 'text', max: 80 },
      { name: 'capacity', label: 'Capacité (places)', type: 'number', min: 1, step: 1, required: true },
      { name: 'description', label: 'Description', type: 'textarea', rows: 2, max: 500 },
    ],
  });
}

export function groupsView(page, { user }) {
  const edit = user.role === 'admin' || user.role === 'teacher';
  return crudPage(page, {
    title: 'Groupes et classes',
    subtitle: 'L’effectif sert à vérifier qu’une salle peut accueillir le groupe.',
    endpoint: '/api/groups',
    noun: 'un groupe',
    canAdd: edit, canEdit: edit, canDelete: edit,
    searchText: (r) => `${r.name} ${r.level ?? ''}`,
    columns: [
      { label: 'Nom', render: (r) => r.name },
      { label: 'Niveau', render: (r) => r.level ?? '—' },
      { label: 'Effectif', class: 'num', render: (r) => fmtNum(r.size) },
    ],
    defaults: { size: 24 },
    fields: [
      { name: 'name', label: 'Nom', type: 'text', required: true, max: 80 },
      { name: 'level', label: 'Niveau', type: 'text', max: 80, placeholder: 'ex. Seconde' },
      { name: 'size', label: 'Effectif', type: 'number', min: 1, step: 1, required: true },
    ],
  });
}

export function usersView(page, { user }) {
  return crudPage(page, {
    title: 'Utilisateurs',
    subtitle: 'Comptes et rôles. Un compte désactivé ne peut plus se connecter.',
    endpoint: '/api/users',
    noun: 'un utilisateur',
    canAdd: true, canEdit: true, canDelete: (r) => r.id !== user.id,
    searchText: (r) => `${r.name} ${r.email} ${ROLES[r.role]}`,
    filters: [{ name: 'role', label: 'Tous les rôles', options: options(ROLES), test: (r, v) => r.role === v }],
    columns: [
      { label: 'Nom', render: (r) => h('span', {}, r.name, r.id === user.id && h('span', { class: 'sub' }, 'Vous')) },
      { label: 'Email', render: (r) => r.email },
      { label: 'Rôle', render: (r) => badge(ROLES[r.role], r.role === 'admin' ? 'danger' : 'info') },
      { label: 'Statut', render: (r) => (r.active ? badge('Actif', 'ok') : badge('Désactivé')) },
      { label: 'Créé le', render: (r) => fmtDate(r.created_at.slice(0, 10)) },
    ],
    defaults: { role: 'student', active: 1 },
    toApi: (v, row) => {
      const payload = { ...v };
      if (row && !payload.password) delete payload.password; // vide = mot de passe inchangé
      return payload;
    },
    fields: (row) => [
      { name: 'name', label: 'Nom complet', type: 'text', required: true, max: 120 },
      { name: 'email', label: 'Email', type: 'email', required: true, max: 160, autocomplete: 'off' },
      { name: 'role', label: 'Rôle', type: 'select', required: true, options: options(ROLES) },
      { name: 'active', label: 'Statut', type: 'select', required: true, options: [{ value: 1, label: 'Actif' }, { value: 0, label: 'Désactivé' }] },
      { name: 'password', label: row ? 'Nouveau mot de passe' : 'Mot de passe', type: 'password', required: !row, autocomplete: 'new-password', full: true,
        hint: row ? 'Laissez vide pour ne pas le changer. 8 caractères minimum.' : '8 caractères minimum.' },
    ],
  });
}
