import { api, ApiError } from './api.js';
import { h, icon, toast, attempt, formDialog, emptyState, errorMessage } from './ui.js';
import { ROLES } from './labels.js';
import { dashboardView } from './views/dashboard.js';
import { planningView } from './views/planning.js';
import { practicalsView, practicalDetailView } from './views/practicals.js';
import { equipmentView, reagentsView } from './views/inventory.js';
import { loansView } from './views/loans.js';
import { incidentsView } from './views/incidents.js';
import { roomsView, groupsView, usersView } from './views/admin.js';

const STAFF = ['admin', 'technician'];

const NAV = [
  { section: 'Pédagogie', items: [
    { path: '/', label: 'Tableau de bord', icon: 'dashboard', view: dashboardView },
    { path: '/planning', label: 'Planning', icon: 'calendar', view: planningView },
    { path: '/practicals', label: 'Travaux pratiques', icon: 'book', view: practicalsView },
  ] },
  { section: 'Inventaire', items: [
    { path: '/equipment', label: 'Matériel', icon: 'box', view: equipmentView },
    { path: '/reagents', label: 'Produits chimiques', icon: 'flask', view: reagentsView },
    { path: '/loans', label: 'Emprunts', icon: 'loan', view: loansView },
  ] },
  { section: 'Sécurité', items: [
    { path: '/incidents', label: 'Incidents', icon: 'shield', view: incidentsView },
  ] },
  { section: 'Administration', items: [
    { path: '/rooms', label: 'Salles', icon: 'room', view: roomsView, roles: ['admin', 'technician', 'teacher'] },
    { path: '/groups', label: 'Groupes', icon: 'users', view: groupsView, roles: ['admin', 'teacher'] },
    { path: '/users', label: 'Utilisateurs', icon: 'user', view: usersView, roles: ['admin'] },
  ] },
];

// Routes avec paramètres (détail) en plus des entrées du menu
const EXTRA_ROUTES = [{ path: '/practicals/:id', view: practicalDetailView, nav: '/practicals', label: 'Travaux pratiques' }];

const allRoutes = [...NAV.flatMap((s) => s.items.map((i) => ({ ...i, nav: i.path }))), ...EXTRA_ROUTES];

function matchRoute(path, user) {
  const segs = path.split('/').filter(Boolean);
  for (const r of allRoutes) {
    const rs = r.path.split('/').filter(Boolean);
    if (rs.length !== segs.length) continue;
    const params = {};
    if (rs.every((s, i) => (s.startsWith(':') ? ((params[s.slice(1)] = segs[i]), true) : s === segs[i]))) {
      if (r.roles && !r.roles.includes(user.role)) return null;
      return { route: r, params };
    }
  }
  return null;
}

const root = document.getElementById('app');
const state = { user: null, renderToken: 0, shell: null };

// ---------- Connexion ----------

function renderLogin(notice) {
  state.shell = null;
  const error = h('div', { class: 'form-error', role: 'alert', hidden: !notice }, notice);
  const email = h('input', { id: 'email', type: 'email', required: true, autocomplete: 'username', autofocus: true });
  const password = h('input', { id: 'password', type: 'password', required: true, autocomplete: 'current-password' });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Se connecter');
  const form = h('form', { class: 'card login', onsubmit: async (e) => {
    e.preventDefault();
    error.hidden = true;
    submit.disabled = true;
    try {
      state.user = await api.post('/api/auth/login', { email: email.value, password: password.value });
      if (!location.hash || location.hash === '#/login') location.hash = '#/';
      renderShell();
    } catch (err) {
      error.textContent = errorMessage(err);
      error.hidden = false;
      password.value = '';
      password.focus();
    } finally {
      submit.disabled = false;
    }
  } },
  h('div', { class: 'brand' }, icon('flask'), h('div', {}, 'COOL', h('small', {}, 'Gestion de laboratoire éducatif'))),
  error,
  h('div', { class: 'field' }, h('label', { for: 'email' }, 'Adresse email'), email),
  h('div', { class: 'field' }, h('label', { for: 'password' }, 'Mot de passe'), password),
  submit);
  root.replaceChildren(h('div', { class: 'login-wrap' }, form));
  document.title = 'Connexion – COOL';
}

// ---------- Compte ----------

async function changePassword() {
  const saved = await formDialog({
    title: 'Changer mon mot de passe',
    fields: [
      { name: 'current_password', label: 'Mot de passe actuel', type: 'password', required: true, autocomplete: 'current-password', full: true },
      { name: 'new_password', label: 'Nouveau mot de passe', type: 'password', required: true, autocomplete: 'new-password', hint: '8 caractères minimum.', full: true },
    ],
    onSubmit: (v) => api.post('/api/auth/password', v),
  });
  if (saved) toast('Mot de passe modifié.');
}

async function logout() {
  await attempt(() => api.post('/api/auth/logout'));
  state.user = null;
  location.hash = '#/';
  renderLogin();
}

// ---------- Coquille de l'application ----------

function renderShell() {
  const { user } = state;
  const links = [];
  const nav = h('nav', { class: 'nav', 'aria-label': 'Navigation principale' },
    NAV.map((section) => {
      const items = section.items.filter((i) => !i.roles || i.roles.includes(user.role));
      if (!items.length) return null;
      return h('div', { class: 'nav-section' }, h('div', { class: 'nav-title' }, section.section),
        items.map((i) => {
          const a = h('a', { href: `#${i.path}` }, icon(i.icon), i.label);
          links.push([i.path, a]);
          return a;
        }));
    }));

  const sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
    h('div', { class: 'brand' }, icon('flask'), h('div', {}, 'COOL', h('small', {}, 'Laboratoire éducatif'))), nav);
  const scrim = h('div', { class: 'scrim', hidden: true, onclick: () => toggleMenu(false) });
  const toggleMenu = (open) => {
    sidebar.classList.toggle('open', open);
    scrim.hidden = !open;
    menuBtn.setAttribute('aria-expanded', String(open));
  };
  const menuBtn = h('button', { class: 'icon-btn menu-btn', type: 'button', 'aria-label': 'Ouvrir le menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false', onclick: () => toggleMenu(!sidebar.classList.contains('open')) }, icon('menu'));

  const main = h('main', { class: 'main', id: 'main' });
  const page = h('div', { class: 'page' });
  main.append(
    h('header', { class: 'topbar' }, menuBtn, h('span', { class: 'topbar-brand' }, 'COOL'),
      h('div', { class: 'userbox' },
        h('div', { class: 'who' }, user.name, h('small', {}, ROLES[user.role])),
        h('button', { class: 'icon-btn', type: 'button', title: 'Changer mon mot de passe', 'aria-label': 'Changer mon mot de passe', onclick: changePassword }, icon('key')),
        h('button', { class: 'icon-btn', type: 'button', title: 'Se déconnecter', 'aria-label': 'Se déconnecter', onclick: logout }, icon('logout')))),
    page);

  root.replaceChildren(h('div', { class: 'shell' }, sidebar, main), scrim);
  state.shell = { page, links, toggleMenu };
  renderRoute();
}

async function renderRoute() {
  if (!state.user || !state.shell) return;
  const { page, links, toggleMenu } = state.shell;
  const path = location.hash.replace(/^#/, '') || '/';
  const matched = matchRoute(path, state.user);
  const token = ++state.renderToken;
  toggleMenu(false);

  if (!matched) {
    page.replaceChildren(emptyState('Page introuvable ou non accessible avec votre rôle.'));
    links.forEach(([, a]) => a.removeAttribute('aria-current'));
    return;
  }
  for (const [p, a] of links) {
    if (p === matched.route.nav) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  document.title = `${matched.route.label} – COOL`;

  // La vue se construit hors du DOM puis remplace la page : une navigation plus rapide ne peut pas être écrasée.
  // Une vue qui se redessine plus tard doit le faire dans un élément enfant, pas dans `next` lui-même.
  const next = h('div');
  try {
    await matched.route.view(next, { user: state.user, params: matched.params, isStaff: STAFF.includes(state.user.role) });
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return;
    next.replaceChildren(h('div', { class: 'card' }, h('p', {}, errorMessage(err)),
      h('button', { class: 'btn', type: 'button', onclick: renderRoute }, 'Réessayer')));
  }
  if (token !== state.renderToken) return;
  page.replaceChildren(...next.childNodes);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', renderRoute);
window.addEventListener('auth:expired', () => {
  if (!state.user) return;
  state.user = null;
  renderLogin('Votre session a expiré. Reconnectez-vous.');
});

try {
  state.user = await api.get('/api/auth/me');
  renderShell();
} catch {
  renderLogin();
}
