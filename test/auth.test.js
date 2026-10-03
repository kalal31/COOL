import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, PASSWORD } from './helpers.js';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('une requête sans session est refusée', async () => {
  const api = app.anon();
  assert.equal((await api('GET', '/api/equipment')).status, 401);
  assert.equal((await api('GET', '/api/dashboard')).status, 401);
});

test('la connexion pose un cookie HttpOnly et ne révèle pas le hash', async () => {
  const api = app.anon();
  const res = await api('POST', '/api/auth/login', { email: 'prof@lab.local', password: PASSWORD });
  assert.equal(res.status, 200);
  assert.equal(res.body.role, 'teacher');
  assert.equal(res.body.password_hash, undefined);
  const cookie = res.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.equal((await api('GET', '/api/auth/me')).body.email, 'prof@lab.local');
});

test('mauvais mot de passe et compte inconnu donnent la même erreur', async () => {
  const api = app.anon();
  const a = await api('POST', '/api/auth/login', { email: 'prof@lab.local', password: 'faux-faux-faux' });
  const b = await api('POST', '/api/auth/login', { email: 'inconnu@lab.local', password: 'faux-faux-faux' });
  assert.equal(a.status, 401);
  assert.deepEqual(a.body, b.body);
});

test('la déconnexion invalide la session côté serveur', async () => {
  const api = await app.login('eleve@lab.local');
  assert.equal((await api('GET', '/api/auth/me')).status, 200);
  const cookie = (await app.anon()('GET', '/api/auth/me')).status; // sanity : anonyme refusé
  assert.equal(cookie, 401);
  assert.equal((await api('POST', '/api/auth/logout')).status, 204);
  assert.equal((await api('GET', '/api/auth/me')).status, 401);
});

test('les écritures sans l’en-tête X-Requested-With sont refusées (CSRF)', async () => {
  const api = await app.login('tech@lab.local');
  const res = await fetch(`${app.base}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: 'lab_session=x' },
    body: JSON.stringify({ name: 'Pirate' }),
  });
  assert.equal(res.status, 403);
  assert.equal((await api('GET', '/api/rooms')).status, 200);
});

test('un compte désactivé ne peut plus se connecter ni utiliser sa session', async () => {
  const admin = await app.login('admin@lab.local');
  const hugo = await app.login('hugo@lab.local');
  const hugoId = app.id("SELECT id FROM users WHERE email = 'hugo@lab.local'");
  assert.equal((await admin('PUT', `/api/users/${hugoId}`, { active: 0 })).status, 200);
  assert.equal((await hugo('GET', '/api/auth/me')).status, 401);
  const retry = await app.anon()('POST', '/api/auth/login', { email: 'hugo@lab.local', password: PASSWORD });
  assert.equal(retry.status, 401);
});

test('changement de mot de passe : ancien refusé, nouveau accepté', async () => {
  const api = await app.login('sophie@lab.local');
  const bad = await api('POST', '/api/auth/password', { current_password: 'incorrect', new_password: 'nouveau-mdp-1' });
  assert.equal(bad.status, 400);
  const short = await api('POST', '/api/auth/password', { current_password: PASSWORD, new_password: 'court' });
  assert.equal(short.status, 400);
  const ok = await api('POST', '/api/auth/password', { current_password: PASSWORD, new_password: 'nouveau-mdp-1' });
  assert.equal(ok.status, 204);
  assert.equal((await api('GET', '/api/auth/me')).status, 200, 'la session courante reste valide');
  assert.equal((await app.anon()('POST', '/api/auth/login', { email: 'sophie@lab.local', password: PASSWORD })).status, 401);
  assert.equal((await app.anon()('POST', '/api/auth/login', { email: 'sophie@lab.local', password: 'nouveau-mdp-1' })).status, 200);
});

test('trop d’échecs de connexion déclenchent un blocage temporaire', async () => {
  const api = app.anon();
  let last;
  for (let i = 0; i < 9; i++) last = await api('POST', '/api/auth/login', { email: 'tech@lab.local', password: 'mauvais-mdp' });
  assert.equal(last.status, 429);
  // Le blocage est propre à ce couple IP/compte : un autre compte reste accessible.
  assert.equal((await app.anon()('POST', '/api/auth/login', { email: 'admin@lab.local', password: PASSWORD })).status, 200);
});

test('JSON invalide et route inconnue renvoient des erreurs JSON propres', async () => {
  const api = await app.login('admin@lab.local');
  const bad = await api('POST', '/api/rooms', '{pas du json');
  assert.equal(bad.status, 400);
  assert.ok(bad.body.error);
  assert.equal((await api('GET', '/api/nimportequoi')).status, 404);
  assert.equal((await api('GET', '/api/equipment/abc')).status, 404);
});

test('la gestion des utilisateurs est réservée à l’administrateur et protège contre l’auto-blocage', async () => {
  const admin = await app.login('admin@lab.local');
  const prof = await app.login('prof@lab.local');
  assert.equal((await prof('GET', '/api/users')).status, 403);
  assert.equal((await prof('GET', '/api/users/people')).status, 200);
  const adminId = app.id("SELECT id FROM users WHERE email = 'admin@lab.local'");
  assert.equal((await admin('PUT', `/api/users/${adminId}`, { role: 'student' })).status, 409);
  assert.equal((await admin('PUT', `/api/users/${adminId}`, { name: 'Claire D.', role: 'admin' })).status, 200);
  assert.equal((await admin('GET', '/api/auth/me')).status, 200, 'modifier son propre profil ne coupe pas sa session');
  assert.equal((await admin('DELETE', `/api/users/${adminId}`)).status, 409);

  const created = await admin('POST', '/api/users', { name: 'Nouveau', email: 'nouveau@lab.local', role: 'teacher', password: 'motdepasse1' });
  assert.equal(created.status, 201);
  assert.equal(created.body.password_hash, undefined);
  const dup = await admin('POST', '/api/users', { name: 'Doublon', email: 'NOUVEAU@lab.local', role: 'teacher', password: 'motdepasse1' });
  assert.equal(dup.status, 409);
  const student = await app.login('eleve@lab.local');
  assert.equal((await student('GET', '/api/users/people')).status, 403);
});

test('un cookie de session mal formé est traité comme une absence de session (401, pas 500)', async () => {
  const api = app.anon();
  for (const cookie of ['lab_session=%E0%A4%A', 'lab_session=%', '=;;;', 'lab_session=' + 'a'.repeat(5000)]) {
    const res = await api('GET', '/api/auth/me', undefined, { Cookie: cookie });
    assert.equal(res.status, 401, cookie.slice(0, 30));
  }
});

test('une session expirée est refusée, supprimée, et les sessions expirées sont purgées à la connexion', async () => {
  const userId = app.id("SELECT id FROM users WHERE email = 'eleve@lab.local'");
  const count = () => app.db.prepare('SELECT COUNT(*) AS n FROM auth_sessions WHERE user_id = ?').get(userId).n;
  const first = await app.login('eleve@lab.local');
  await app.login('eleve@lab.local'); // une seconde session, jamais réutilisée
  assert.equal((await first('GET', '/api/auth/me')).status, 200);
  const total = count();
  assert.ok(total >= 2);

  app.db.prepare('UPDATE auth_sessions SET expires_at = ? WHERE user_id = ?').run(Date.now() - 1000, userId);
  assert.equal((await first('GET', '/api/auth/me')).status, 401);
  assert.equal(count(), total - 1, 'la session utilisée est supprimée dès son refus');

  await app.login('eleve@lab.local');
  assert.equal(count(), 1, 'une nouvelle connexion purge les sessions expirées restantes');
});
