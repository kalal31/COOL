import { Router } from 'express';
import { requireAuth, requireRole } from './auth.js';
import { transaction } from './db.js';
import { validate } from './validate.js';
import { badRequest, notFound, parseId } from './http.js';

/**
 * Routeur CRUD générique piloté par une configuration.
 * `select` est une requête SELECT dont la table principale porte l'alias `t`.
 * Les noms de colonnes viennent de `fields` (code serveur), jamais de la requête.
 */
export function crudRouter(db, cfg) {
  const { table, fields, select, orderBy, write, toApi = (r) => r, onCreate, onUpdate } = cfg;
  const router = Router();
  router.use(requireAuth);

  const one = db.prepare(`${select} WHERE t.id = ?`);
  const all = db.prepare(`${select} ORDER BY ${orderBy}`);
  const remove = db.prepare(`DELETE FROM ${table} WHERE id = ?`);

  router.get('/', (_req, res) => {
    res.json(all.all().map(toApi));
  });

  router.get('/:id', (req, res) => {
    const row = one.get(parseId(req.params.id));
    if (!row) throw notFound();
    res.json(toApi(row));
  });

  router.post('/', requireRole(...write), (req, res) => {
    const clean = validate(fields, req.body);
    const cols = Object.keys(clean);
    const row = transaction(db, () => {
      const info = db
        .prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => clean[c]));
      const created = one.get(info.lastInsertRowid);
      onCreate?.(created, req);
      return created;
    });
    res.status(201).json(toApi(row));
  });

  router.put('/:id', requireRole(...write), (req, res) => {
    const id = parseId(req.params.id);
    const clean = validate(fields, req.body, { partial: true });
    const cols = Object.keys(clean);
    if (!cols.length) throw badRequest('Aucune modification fournie.');
    const row = transaction(db, () => {
      const before = one.get(id);
      if (!before) throw notFound();
      db.prepare(`UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => clean[c]), id);
      const after = one.get(id);
      onUpdate?.(before, after, req);
      return after;
    });
    res.json(toApi(row));
  });

  router.delete('/:id', requireRole(...write), (req, res) => {
    const { changes } = remove.run(parseId(req.params.id));
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return router;
}
