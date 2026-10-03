import { api } from '../api.js';
import { h, icon, badge, fmtDate, fmtDay, fmtNum, pluralize } from '../ui.js';
import { EQUIPMENT_STATUS } from '../labels.js';

function kpi(href, iconName, value, label, { alert = false } = {}) {
  return h('a', { class: `card kpi${alert && value > 0 ? ' alert' : ''}`, href },
    h('span', { class: 'value' }, fmtNum(value)), h('span', { class: 'label' }, icon(iconName), label));
}

function alertGroup(kind, title, items, render) {
  if (!items.length) return null;
  return h('div', { class: `alert-group ${kind}` },
    h('h3', {}, icon('alert'), `${title} (${items.length})`),
    h('ul', { class: 'alert-list' }, items.map((i) => h('li', {}, render(i)))));
}

function sessionList(list, { withDate = false } = {}) {
  if (!list.length) return h('p', { class: 'muted' }, 'Aucune séance.');
  return h('ul', { class: 'alert-list' }, list.map((b) => h('li', {},
    h('span', {}, h('strong', {}, `${withDate ? `${fmtDay(b.date)} · ` : ''}${b.start_time}–${b.end_time}`), ' ', b.title,
      h('span', { class: 'sub muted' }, [b.room_name, b.group_name, b.teacher_name].filter(Boolean).join(' · '))),
    h('a', { href: '#/planning' }, 'Planning'))));
}

export async function dashboardView(page, { user, isStaff }) {
  const d = await api.get('/api/dashboard');
  const a = d.alerts;
  const groups = [
    alertGroup('danger', 'Produits périmés', a.expired, (r) => [h('a', { href: '#/reagents' }, r.name), h('span', { class: 'muted' }, `périmé le ${fmtDate(r.expiry_date)}`)]),
    alertGroup('danger', 'Stocks bas', a.lowStock, (r) => [h('a', { href: '#/reagents' }, r.name), h('span', { class: 'muted' }, `${fmtNum(r.quantity)} ${r.unit} (seuil ${fmtNum(r.min_quantity)})`)]),
    alertGroup('danger', 'Emprunts en retard', a.overdueLoans, (l) => [h('a', { href: '#/loans' }, `${l.equipment_name} × ${l.quantity}`), h('span', { class: 'muted' }, `${l.borrower_name}, dû le ${fmtDate(l.due_date)}`)]),
    alertGroup('warn', 'Péremption sous 30 jours', a.expiringSoon, (r) => [h('a', { href: '#/reagents' }, r.name), h('span', { class: 'muted' }, `le ${fmtDate(r.expiry_date)}`)]),
    alertGroup('warn', 'Matériel indisponible', a.unavailableEquipment, (e) => [h('a', { href: '#/equipment' }, e.name), badge(EQUIPMENT_STATUS[e.status], e.status === 'maintenance' ? 'warn' : 'danger')]),
  ].filter(Boolean);

  const first = user.name.split(' ')[0];
  page.append(
    h('div', { class: 'page-head' }, h('div', {}, h('h1', {}, `Bonjour ${first}`), h('p', { class: 'muted' }, fmtDay(d.today)))),
    h('div', { class: 'grid cols-4' },
      kpi('#/equipment', 'box', d.counts.equipment, 'Matériels'),
      kpi('#/reagents', 'flask', d.counts.reagents, 'Produits chimiques'),
      kpi('#/practicals', 'book', d.counts.practicals, 'Travaux pratiques'),
      kpi('#/loans', 'loan', d.counts.openLoans, isStaff ? 'Emprunts en cours' : 'Mes emprunts en cours'),
      isStaff && kpi('#/incidents', 'shield', d.counts.openIncidents, 'Incidents ouverts', { alert: true })),
    h('div', { class: 'grid cols-2' },
      h('section', { class: 'card' }, h('h2', {}, 'Alertes'),
        groups.length ? groups : h('p', { class: 'all-clear' }, icon('check'), 'Aucune alerte : tout est en ordre.')),
      h('div', { class: 'grid' },
        h('section', { class: 'card' }, h('h2', {}, `Aujourd’hui (${pluralize(d.todayBookings.length, 'séance', 'séances')})`), sessionList(d.todayBookings)),
        h('section', { class: 'card' }, h('h2', {}, 'Cette semaine'), sessionList(d.upcomingBookings, { withDate: true })))));
}
