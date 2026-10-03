import { openDb, todayISO } from '../server/db.js';
import { createApp } from '../server/app.js';
import { seedDemo } from '../server/seed.js';

export const PASSWORD = 'demo1234';

export const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return todayISO(d);
};

/** Démarre l'application sur un port libre avec une base mémoire remplie des données de démo. */
export async function startApp() {
  const db = openDb(':memory:');
  await seedDemo(db, PASSWORD);
  const app = createApp({ db });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  const makeClient = (getCookie, setCookie) => async (method, path, body, extraHeaders = {}) => {
    const headers = { 'X-Requested-With': 'XMLHttpRequest', ...extraHeaders };
    const cookie = getCookie();
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const setCookieHeader = res.headers.get('set-cookie');
    if (setCookieHeader) setCookie(setCookieHeader.split(';')[0]);
    // Buffer#toString conserve le BOM UTF-8 que fetch().text() supprimerait.
    const text = Buffer.from(await res.arrayBuffer()).toString('utf8');
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: res.status, body: json, text, headers: res.headers };
  };

  const anon = () => {
    let cookie = null;
    return makeClient(() => cookie, (c) => { cookie = c; });
  };

  async function login(email, password = PASSWORD) {
    const api = anon();
    const res = await api('POST', '/api/auth/login', { email, password });
    if (res.status !== 200) throw new Error(`Connexion impossible pour ${email} : ${res.status}`);
    return api;
  }

  const id = (sql, ...p) => db.prepare(sql).get(...p)?.id;
  return {
    db, base, anon, login, id,
    close: () => new Promise((resolve) => server.close(() => { db.close(); resolve(); })),
  };
}
