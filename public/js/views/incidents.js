import { api } from '../api.js';
import { h, badge, fmtDate, today } from '../ui.js';
import { crudPage } from '../crud-page.js';
import { SEVERITY, INCIDENT_STATUS, options } from '../labels.js';

const severityKind = { low: 'info', medium: 'warn', high: 'danger' };
const statusKind = { open: 'danger', in_progress: 'warn', closed: 'ok' };

export function incidentsView(page, { user, isStaff }) {
  const description = { name: 'description', label: 'Description', type: 'textarea', required: true, rows: 4, max: 2000 };
  const severity = { name: 'severity', label: 'Gravité', type: 'select', required: true, options: options(SEVERITY), default: 'low' };

  return crudPage(page, {
    title: 'Incidents et sécurité',
    subtitle: isStaff ? 'Signalements à traiter et historique.' : 'Signalez un problème de sécurité ou de matériel. Vous voyez vos propres signalements.',
    endpoint: '/api/incidents',
    noun: 'un incident',
    labelOf: (r) => `incident du ${fmtDate(r.occurred_at)}`,
    canAdd: true, canEdit: isStaff, canDelete: user.role === 'admin',
    searchText: (r) => `${r.description} ${r.room_name ?? ''} ${r.reporter_name}`,
    filters: [{ name: 'status', label: 'Tous les statuts', options: options(INCIDENT_STATUS), test: (r, v) => r.status === v }],
    rowClass: (r) => (r.status !== 'closed' && r.severity === 'high' ? 'row-danger' : r.status !== 'closed' && r.severity === 'medium' ? 'row-warn' : ''),
    columns: [
      { label: 'Date', render: (r) => fmtDate(r.occurred_at) },
      { label: 'Salle', render: (r) => r.room_name ?? '—' },
      { label: 'Gravité', render: (r) => badge(SEVERITY[r.severity], severityKind[r.severity]) },
      { label: 'Description', render: (r) => h('span', {}, r.description, r.resolution && h('span', { class: 'sub' }, `Résolution : ${r.resolution}`)) },
      { label: 'Signalé par', render: (r) => r.reporter_name },
      { label: 'Statut', render: (r) => badge(INCIDENT_STATUS[r.status], statusKind[r.status]) },
    ],
    defaults: { occurred_at: today(), severity: 'low' },
    fields: async (row) => {
      if (row) {
        return [severity, { name: 'status', label: 'Statut', type: 'select', required: true, options: options(INCIDENT_STATUS) }, description,
          { name: 'resolution', label: 'Résolution / mesures prises', type: 'textarea', rows: 3, max: 2000 }];
      }
      const rooms = await api.get('/api/rooms');
      return [
        { name: 'room_id', label: 'Salle', type: 'select', placeholder: 'Non précisée', options: rooms.map((r) => ({ value: r.id, label: r.name })) },
        { name: 'occurred_at', label: 'Date', type: 'date' },
        severity, description,
      ];
    },
  });
}
