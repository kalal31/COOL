import { api } from '../api.js';
import {
  h, icon, badge, fmtDate, fmtNum, parseISO, addDays, today, formDialog, infoDialog, confirmDialog, attempt, toast,
} from '../ui.js';

const mondayOf = (iso) => addDays(iso, -((parseISO(iso).getDay() + 6) % 7));

const weekLabel = (from) => {
  const a = parseISO(from);
  const b = parseISO(addDays(from, 6));
  const short = { day: 'numeric', month: 'short' };
  return `${a.toLocaleDateString('fr-FR', short)} – ${b.toLocaleDateString('fr-FR', { ...short, year: 'numeric' })}`;
};

export async function planningView(page, { user }) {
  const canBook = user.role === 'admin' || user.role === 'teacher';
  const canPrepare = user.role !== 'student';
  const rooms = await api.get('/api/rooms');
  const roomIndex = new Map(rooms.map((r, i) => [r.id, i % 5]));
  const state = { from: mondayOf(today()), room: '' };
  const grid = h('div', { class: 'week' });
  const label = h('strong', { 'aria-live': 'polite' });

  async function load() {
    const to = addDays(state.from, 6);
    const roomQuery = state.room ? `&room_id=${state.room}` : '';
    const bookings = await api.get(`/api/bookings?from=${state.from}&to=${to}${roomQuery}`);
    label.textContent = weekLabel(state.from);
    const t = today();
    const weekend = (iso) => parseISO(iso).getDay() % 6 === 0;
    const showWeekend = bookings.some((b) => weekend(b.date)) || [5, 6].some((i) => addDays(state.from, i) === t);
    grid.style.setProperty('--cols', showWeekend ? 7 : 5);
    grid.replaceChildren(...Array.from({ length: showWeekend ? 7 : 5 }, (_, i) => {
      const date = addDays(state.from, i);
      const d = parseISO(date);
      const items = bookings.filter((b) => b.date === date);
      return h('section', { class: `day${date === t ? ' today' : ''}`, 'aria-label': d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) },
        h('header', {},
          h('span', {}, d.toLocaleDateString('fr-FR', { weekday: 'short' }), ' ', d.getDate(), ' ', h('small', {}, d.toLocaleDateString('fr-FR', { month: 'short' }))),
          canBook && h('button', { class: 'icon-btn', type: 'button', title: 'Ajouter une séance ce jour', 'aria-label': `Ajouter une séance le ${fmtDate(date)}`, onclick: () => attempt(() => editBooking(null, date)) }, icon('plus'))),
        h('ul', {}, items.map((b) => h('li', {},
          h('button', { class: `slot room-${roomIndex.get(b.room_id) ?? 0}`, type: 'button', onclick: () => showBooking(b) },
            h('span', { class: 't' }, `${b.start_time}–${b.end_time}`),
            h('span', { class: 'n' }, b.title),
            h('span', { class: 'm' }, [b.room_name, b.group_name].filter(Boolean).join(' · ')))))));
    }));
  }

  const refresh = () => attempt(load);

  // ---- Formulaire de réservation ----
  async function editBooking(booking, date) {
    const [practicals, groups, people] = await Promise.all([
      api.get('/api/practicals'), api.get('/api/groups'),
      user.role === 'admin' ? api.get('/api/users/people') : [],
    ]);
    const fields = [
      { name: 'room_id', label: 'Salle', type: 'select', required: true, placeholder: '— Choisir une salle —', options: rooms.map((r) => ({ value: r.id, label: `${r.name} (${r.capacity} places)` })) },
      { name: 'practical_id', label: 'Travail pratique', type: 'select', placeholder: 'Aucun (séance libre)', options: practicals.map((p) => ({ value: p.id, label: p.title })) },
      { name: 'title', label: 'Titre', type: 'text', max: 160, hint: 'Laissez vide pour reprendre le titre du TP.', full: true },
      { name: 'group_id', label: 'Groupe', type: 'select', placeholder: 'Aucun groupe', options: groups.map((g) => ({ value: g.id, label: `${g.name} (${g.size})` })) },
      user.role === 'admin' && { name: 'teacher_id', label: 'Enseignant', type: 'select', required: true, default: user.id, options: people.filter((p) => p.role === 'teacher' || p.role === 'admin').map((p) => ({ value: p.id, label: p.name })) },
      { name: 'date', label: 'Date', type: 'date', required: true },
      { name: 'start_time', label: 'Début', type: 'time', required: true },
      { name: 'end_time', label: 'Fin', type: 'time', required: true },
      { name: 'stations', label: 'Postes de travail', type: 'number', min: 1, step: 1, hint: 'Sert à calculer les besoins de la fiche de préparation.' },
      { name: 'notes', label: 'Notes', type: 'textarea', rows: 2 },
    ].filter(Boolean);
    const saved = await formDialog({
      title: booking ? 'Modifier la séance' : 'Nouvelle séance',
      fields,
      values: booking ?? { date, start_time: '08:00', end_time: '10:00', stations: 1 },
      wide: true,
      onSubmit: (v) => (booking ? api.put(`/api/bookings/${booking.id}`, v) : api.post('/api/bookings', v)),
    });
    if (saved) {
      toast('Séance enregistrée.');
      if (saved.date) state.from = mondayOf(saved.date); // affiche la semaine de la séance enregistrée
      await refresh();
    }
  }

  // ---- Fiche de préparation ----
  async function showPreparation(b) {
    const prep = await api.get(`/api/bookings/${b.id}/preparation`);
    const mark = (ok, reason) => (ok ? badge('OK', 'ok') : badge(reason, 'danger'));
    const table = (head, rows) => h('div', { class: 'table-wrap' }, h('table', {},
      h('thead', {}, h('tr', {}, head.map((c, i) => h('th', { class: i > 0 && i < head.length - 1 ? 'num' : '' }, c)))),
      h('tbody', {}, rows)));
    const content = h('div', { class: 'prep' },
      h('p', { class: 'muted' }, `${b.title} · ${fmtDate(b.date)} · ${b.start_time}–${b.end_time} · ${b.room_name} · ${b.stations} poste${b.stations > 1 ? 's' : ''}`),
      !b.practical_id
        ? h('p', {}, 'Cette séance n’est liée à aucun TP : il n’y a pas de besoins à préparer.')
        : [
          h('div', { class: `prep-banner ${prep.ready ? 'ok' : 'ko'}` }, icon(prep.ready ? 'check' : 'alert'),
            prep.ready ? 'Tout est prêt pour cette séance.' : 'Préparation incomplète : certains éléments manquent.'),
          h('h3', {}, 'Matériel'),
          prep.equipment.length ? table(['Matériel', 'Par poste', 'Requis', 'Disponible', 'État'], prep.equipment.map((e) => h('tr', {},
            h('td', {}, e.name), h('td', { class: 'num' }, fmtNum(e.per_station)), h('td', { class: 'num' }, fmtNum(e.needed)),
            h('td', { class: 'num' }, fmtNum(e.available)),
            h('td', {}, mark(e.ok, e.status !== 'ok' ? (e.status === 'maintenance' ? 'En maintenance' : 'Hors service') : `Manque ${fmtNum(e.needed - e.available)}`))))) : h('p', { class: 'muted' }, 'Aucun matériel requis.'),
          h('h3', {}, 'Produits'),
          prep.reagents.length ? table(['Produit', 'Par poste', 'Requis', 'En stock', 'État'], prep.reagents.map((r) => h('tr', {},
            h('td', {}, r.name), h('td', { class: 'num' }, `${fmtNum(r.per_station)} ${r.unit}`), h('td', { class: 'num' }, `${fmtNum(r.needed)} ${r.unit}`),
            h('td', { class: 'num' }, `${fmtNum(r.stock)} ${r.unit}`),
            h('td', {}, mark(r.ok, r.expired ? 'Périmé à cette date' : `Manque ${fmtNum(Math.round((r.needed - r.stock) * 1e3) / 1e3)} ${r.unit}`))))) : h('p', { class: 'muted' }, 'Aucun produit requis.'),
        ]);
    await infoDialog('Fiche de préparation', content, {
      wide: true,
      actions: [() => h('button', { class: 'btn', type: 'button', onclick: () => window.print() }, icon('printer'), 'Imprimer')],
    });
  }

  // ---- Détail d'une séance ----
  async function showBooking(b) {
    const mine = user.role === 'admin' || (user.role === 'teacher' && b.teacher_id === user.id);
    const content = h('dl', { class: 'kv' },
      h('dt', {}, 'Date'), h('dd', {}, `${fmtDate(b.date)}, ${b.start_time}–${b.end_time}`),
      h('dt', {}, 'Salle'), h('dd', {}, b.room_name),
      h('dt', {}, 'Enseignant'), h('dd', {}, b.teacher_name),
      h('dt', {}, 'Groupe'), h('dd', {}, b.group_name ?? '—'),
      h('dt', {}, 'TP'), h('dd', {}, b.practical_id ? h('a', { href: `#/practicals/${b.practical_id}` }, b.practical_title) : '—'),
      h('dt', {}, 'Postes'), h('dd', {}, String(b.stations)),
      b.notes && [h('dt', {}, 'Notes'), h('dd', { class: 'prose' }, b.notes)]);
    const actions = [
      canPrepare && ((close) => h('button', { class: 'btn', type: 'button', onclick: async () => { close(); await attempt(() => showPreparation(b)); } }, icon('clipboard'), 'Fiche de préparation')),
      mine && ((close) => h('button', { class: 'btn', type: 'button', onclick: async () => { close(); await attempt(() => editBooking(b)); } }, icon('edit'), 'Modifier')),
      mine && ((close) => h('button', { class: 'btn danger', type: 'button', onclick: async () => {
        close();
        if (await confirmDialog(`Supprimer la séance « ${b.title} » du ${fmtDate(b.date)} ?`, { confirmLabel: 'Supprimer', danger: true })) {
          const { ok } = await attempt(() => api.del(`/api/bookings/${b.id}`), 'Séance supprimée.');
          if (ok) await refresh();
        }
      } }, icon('trash'), 'Supprimer')),
    ].filter(Boolean);
    await infoDialog(b.title, content, { actions });
  }

  const step = (days) => () => { state.from = addDays(state.from, days); refresh(); };
  page.append(
    h('div', { class: 'page-head' },
      h('div', {}, h('h1', {}, 'Planning des laboratoires'), h('p', { class: 'muted' }, 'Séances de travaux pratiques par semaine.')),
      h('div', { class: 'page-actions' },
        canBook && h('button', { class: 'btn primary', type: 'button', onclick: () => attempt(() => editBooking(null, today())) }, icon('plus'), 'Nouvelle séance'))),
    h('div', { class: 'toolbar' },
      h('div', { class: 'week-nav' },
        h('button', { class: 'btn', type: 'button', 'aria-label': 'Semaine précédente', onclick: step(-7) }, icon('left')),
        label,
        h('button', { class: 'btn', type: 'button', 'aria-label': 'Semaine suivante', onclick: step(7) }, icon('right')),
        h('button', { class: 'btn', type: 'button', onclick: () => { state.from = mondayOf(today()); refresh(); } }, 'Aujourd’hui')),
      h('select', { 'aria-label': 'Filtrer par salle', onchange: (e) => { state.room = e.target.value; refresh(); } },
        h('option', { value: '' }, 'Toutes les salles'), rooms.map((r) => h('option', { value: r.id }, r.name)))),
    grid);
  await load();
}
