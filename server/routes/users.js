import { Router } from 'express';
import { ROLES, hashPassword, destroyUserSessions, requireAuth, requireRole } from '../auth.js';
import { conflict, notFound, parseId } from '../http.js';
import { validate } from '../validate.js';
import { passwordField } from './session.js';

const userFields = {
  name: { type: 'string', required: true, max: 120, label: 'Le nom' },
  email: {
    type: 'string', required: true, max: 160, label: 'L’email',
    pattern: /^[^\s@]+@[^\s@]+$/, patternMessage: 'Adresse email invalide.',
  },
  role: { type: 'string', required: true, enum: ROLES, label: 'Le rôle' },
  active: { type: 'int', min: 0, max: 1, default: 1, label: 'Le statut' },
};

const PUBLIC = 'id, email, name, role, active, created_at';

export function usersRouter(db) {
  const router = Router();
  router.use(requireAuth);

  // Liste minimale (sans données personnelles) pour alimenter les listes déroulantes.
  router.get('/people', requireRole('admin', 'teacher', 'technician'), (_req, res) => {
    res.json(db.prepare("SELECT id, name, role FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE").all());
  });

  router.use(requireRole('admin'));

  router.get('/', (_req, res) => {
    res.json(db.prepare(`SELECT ${PUBLIC} FROM users ORDER BY name COLLATE NOCASE`).all());
  });

  router.post('/', async (req, res) => {
    const clean = validate({ ...userFields, password: passwordField }, req.body);
    const { password, ...rest } = clean;
    const info = db.prepare('INSERT INTO users (name, email, role, active, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(rest.name, rest.email, rest.role, rest.active, await hashPassword(password));
    res.status(201).json(db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(info.lastInsertRowid));
  });

  router.put('/:id', async (req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT id, role FROM users WHERE id = ?').get(id);
    if (!existing) throw notFound();
    const clean = validate({ ...userFields, password: { ...passwordField, required: false } }, req.body, { partial: true });

    if (id === req.user.id && ((clean.role && clean.role !== 'admin') || clean.active === 0)) {
      throw conflict('Vous ne pouvez pas retirer vos propres droits d’administrateur ni désactiver votre compte.');
    }
    const { password, ...rest } = clean;
    const cols = Object.keys(rest);
    const values = cols.map((c) => rest[c]);
    if (password) {
      cols.push('password_hash');
      values.push(await hashPassword(password));
    }
    if (cols.length) {
      db.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...values, id);
    }
    // Un compte dont le mot de passe, le rôle ou l'activation change doit se reconnecter.
    // (La session de l'administrateur qui fait la modification n'est jamais coupée.)
    const roleChanged = clean.role !== undefined && clean.role !== existing.role;
    if (id !== req.user.id && (password || roleChanged || clean.active === 0)) destroyUserSessions(db, id);
    res.json(db.prepare(`SELECT ${PUBLIC} FROM users WHERE id = ?`).get(id));
  });

  router.delete('/:id', (req, res) => {
    const id = parseId(req.params.id);
    if (id === req.user.id) throw conflict('Vous ne pouvez pas supprimer votre propre compte.');
    const { changes } = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return router;
}
