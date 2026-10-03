import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError, forbidden } from './http.js';

const scryptAsync = promisify(scrypt);
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
export const COOKIE_NAME = 'lab_session';
export const ROLES = ['admin', 'teacher', 'technician', 'student'];

export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, 64);
  return `scrypt$${salt.toString('hex')}$${key.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltHex, keyHex] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

export function createSession(db, userId) {
  const token = randomBytes(32).toString('hex');
  db.prepare('INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
    .run(sha256(token), userId, Date.now() + SESSION_TTL_MS);
  return token;
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(sha256(token));
}

export function destroyUserSessions(db, userId) {
  db.prepare('DELETE FROM auth_sessions WHERE user_id = ?').run(userId);
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function cookieHeader(token, { secure = false, maxAgeMs = SESSION_TTL_MS } = {}) {
  const attrs = [`${COOKIE_NAME}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** Charge req.user (ou null) à partir du cookie de session. */
export function authenticate(db) {
  const find = db.prepare(`
    SELECT u.id, u.email, u.name, u.role, s.expires_at
    FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND u.active = 1`);
  return (req, _res, next) => {
    req.user = null;
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
      const row = find.get(sha256(token));
      if (row && row.expires_at > Date.now()) {
        req.user = { id: row.id, email: row.email, name: row.name, role: row.role };
        req.sessionToken = token;
      } else if (row) {
        destroySession(db, token);
      }
    }
    next();
  };
}

export function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Authentification requise.'));
  next();
}

export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentification requise.'));
  if (!roles.includes(req.user.role)) return next(forbidden());
  next();
};

/** Limiteur simple en mémoire contre les tentatives de connexion répétées. */
export function createLoginLimiter({ max = 8, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();
  const prune = (now) => {
    for (const [k, v] of attempts) if (v.reset <= now) attempts.delete(k);
  };
  return {
    check(key) {
      const now = Date.now();
      prune(now);
      const e = attempts.get(key);
      return !e || e.count < max;
    },
    fail(key) {
      const now = Date.now();
      const e = attempts.get(key);
      if (!e || e.reset <= now) attempts.set(key, { count: 1, reset: now + windowMs });
      else e.count += 1;
    },
    reset(key) {
      attempts.delete(key);
    },
  };
}
