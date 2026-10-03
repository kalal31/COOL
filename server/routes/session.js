import { Router } from 'express';
import {
  ROLES, hashPassword, verifyPassword, createSession, destroySession, destroyUserSessions,
  cookieHeader, requireAuth, createLoginLimiter,
} from '../auth.js';
import { HttpError, badRequest } from '../http.js';
import { validate } from '../validate.js';

export const passwordField = {
  type: 'string', required: true, max: 200, label: 'Le mot de passe',
  pattern: /^.{8,}$/, patternMessage: 'Le mot de passe doit contenir au moins 8 caractères.',
};

export { ROLES };

export function sessionRouter(db, { secureCookies }) {
  const router = Router();
  const limiter = createLoginLimiter();

  router.post('/login', async (req, res) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) throw badRequest('Email et mot de passe requis.');

    const key = `${req.ip}|${email.toLowerCase()}`;
    if (!limiter.check(key)) throw new HttpError(429, 'Trop de tentatives. Réessayez dans quelques minutes.');

    const user = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(email);
    // Vérification même si l'utilisateur est inconnu, pour ne pas révéler son existence par le temps de réponse.
    const ok = await verifyPassword(password, user?.password_hash ?? 'scrypt$00$00');
    if (!user || !ok) {
      limiter.fail(key);
      throw new HttpError(401, 'Identifiants incorrects.');
    }
    limiter.reset(key);
    const token = createSession(db, user.id);
    res.setHeader('Set-Cookie', cookieHeader(token, { secure: secureCookies }));
    res.json({ id: user.id, email: user.email, name: user.name, role: user.role });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    res.setHeader('Set-Cookie', cookieHeader('', { secure: secureCookies, maxAgeMs: 0 }));
    res.status(204).end();
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json(req.user);
  });

  const pwFields = {
    current_password: { type: 'string', required: true, max: 200, label: 'Le mot de passe actuel' },
    new_password: { ...passwordField, label: 'Le nouveau mot de passe' },
  };

  router.post('/password', requireAuth, async (req, res) => {
    const { current_password, new_password } = validate(pwFields, req.body);
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!(await verifyPassword(current_password, row.password_hash))) {
      throw badRequest('Le mot de passe actuel est incorrect.', { current_password: 'Mot de passe actuel incorrect.' });
    }
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(new_password), req.user.id);
    // Les autres sessions sont fermées ; celle-ci est recréée.
    destroyUserSessions(db, req.user.id);
    const token = createSession(db, req.user.id);
    res.setHeader('Set-Cookie', cookieHeader(token, { secure: secureCookies }));
    res.status(204).end();
  });

  return router;
}
