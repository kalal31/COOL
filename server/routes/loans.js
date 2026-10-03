import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { transaction, todayISO } from '../db.js';
import { validate } from '../validate.js';
import { badRequest, conflict, notFound, parseId } from '../http.js';

const STAFF = ['admin', 'technician'];

const createFields = {
  equipment_id: { type: 'id', required: true, label: 'Le matériel' },
  borrower_id: { type: 'id', required: true, label: 'L’emprunteur' },
  quantity: { type: 'int', min: 1, max: 1000, default: 1, label: 'La quantité' },
  loaned_at: { type: 'date', label: 'La date de sortie' },
  due_date: { type: 'date', required: true, label: 'La date de retour prévue' },
  notes: { type: 'string', max: 500, label: 'Les notes' },
};
const updateFields = { due_date: createFields.due_date, notes: createFields.notes };

const SELECT = `
  SELECT l.*, e.name AS equipment_name, u.name AS borrower_name,
    (l.returned_at IS NULL AND l.due_date < ?) AS overdue
  FROM loans l
  JOIN equipment e ON e.id = l.equipment_id
  JOIN users u ON u.id = l.borrower_id`;

export function loansRouter(db) {
  const router = Router();
  router.use(requireAuth);

  const byId = (id) => db.prepare(`${SELECT} WHERE l.id = ?`).get(todayISO(), id);
  const present = (r) => ({ ...r, overdue: Boolean(r.overdue) });

  router.get('/', (req, res) => {
    const where = [];
    const params = [todayISO()];
    if (!STAFF.includes(req.user.role)) {
      where.push('l.borrower_id = ?');
      params.push(req.user.id);
    }
    const status = req.query.status;
    if (status === 'open') where.push('l.returned_at IS NULL');
    else if (status === 'returned') where.push('l.returned_at IS NOT NULL');
    else if (status === 'overdue') {
      where.push('l.returned_at IS NULL AND l.due_date < ?');
      params.push(todayISO());
    } else if (status !== undefined) throw badRequest('Statut inconnu.');
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''}
      ORDER BY (l.returned_at IS NOT NULL), l.due_date, l.id DESC`;
    res.json(db.prepare(sql).all(...params).map(present));
  });

  router.post('/', requireRole(...STAFF), (req, res) => {
    const clean = validate(createFields, req.body);
    clean.loaned_at ??= todayISO();
    if (clean.due_date < clean.loaned_at) {
      throw badRequest('Le retour ne peut pas précéder la sortie.', { due_date: 'Doit être postérieure à la date de sortie.' });
    }
    const id = transaction(db, () => {
      const eq = db.prepare(`
        SELECT name, status, quantity - COALESCE((SELECT SUM(quantity) FROM loans
          WHERE equipment_id = equipment.id AND returned_at IS NULL), 0) AS free
        FROM equipment WHERE id = ?`).get(clean.equipment_id);
      if (!eq) throw badRequest('Matériel inconnu.', { equipment_id: 'Matériel inconnu.' });
      if (eq.status !== 'ok') throw conflict(`« ${eq.name} » n’est pas disponible (état : ${eq.status === 'maintenance' ? 'en maintenance' : 'hors service'}).`);
      if (eq.free < clean.quantity) throw conflict(`Stock insuffisant : ${Math.max(eq.free, 0)} exemplaire(s) disponible(s) pour « ${eq.name} ».`);
      const user = db.prepare('SELECT 1 FROM users WHERE id = ? AND active = 1').get(clean.borrower_id);
      if (!user) throw badRequest('Emprunteur inconnu.', { borrower_id: 'Emprunteur inconnu.' });
      const cols = Object.keys(clean);
      return db.prepare(`INSERT INTO loans (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...cols.map((c) => clean[c])).lastInsertRowid;
    });
    res.status(201).json(present(byId(id)));
  });

  router.put('/:id', requireRole(...STAFF), (req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT * FROM loans WHERE id = ?').get(id);
    if (!existing) throw notFound();
    const clean = validate(updateFields, req.body, { partial: true });
    if (clean.due_date && clean.due_date < existing.loaned_at) {
      throw badRequest('Le retour ne peut pas précéder la sortie.', { due_date: 'Doit être postérieure à la date de sortie.' });
    }
    const cols = Object.keys(clean);
    if (cols.length) {
      db.prepare(`UPDATE loans SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => clean[c]), id);
    }
    res.json(present(byId(id)));
  });

  router.post('/:id/return', requireRole(...STAFF), (req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT returned_at FROM loans WHERE id = ?').get(id);
    if (!existing) throw notFound();
    if (existing.returned_at) throw conflict('Cet emprunt est déjà clôturé.');
    db.prepare('UPDATE loans SET returned_at = ? WHERE id = ?').run(todayISO(), id);
    res.json(present(byId(id)));
  });

  router.delete('/:id', requireRole('admin'), (req, res) => {
    const { changes } = db.prepare('DELETE FROM loans WHERE id = ?').run(parseId(req.params.id));
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return router;
}
