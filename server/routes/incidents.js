import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { todayISO } from '../db.js';
import { validate } from '../validate.js';
import { badRequest, notFound, parseId } from '../http.js';

const STAFF = ['admin', 'technician'];

const createFields = {
  room_id: { type: 'id', label: 'La salle' },
  severity: { type: 'string', required: true, enum: ['low', 'medium', 'high'], label: 'La gravité' },
  occurred_at: { type: 'date', label: 'La date' },
  description: { type: 'string', required: true, max: 2000, label: 'La description' },
};
const updateFields = {
  ...createFields,
  status: { type: 'string', enum: ['open', 'in_progress', 'closed'], default: 'open', label: 'Le statut' },
  resolution: { type: 'string', max: 2000, label: 'La résolution' },
};

const SELECT = `
  SELECT i.*, r.name AS room_name, u.name AS reporter_name
  FROM incidents i
  LEFT JOIN rooms r ON r.id = i.room_id
  JOIN users u ON u.id = i.reporter_id`;

export function incidentsRouter(db) {
  const router = Router();
  router.use(requireAuth);

  const byId = (id) => db.prepare(`${SELECT} WHERE i.id = ?`).get(id);

  // Les élèves ne voient que leurs propres signalements.
  router.get('/', (req, res) => {
    const staffView = req.user.role !== 'student';
    const rows = staffView
      ? db.prepare(`${SELECT} ORDER BY (i.status = 'closed'), i.occurred_at DESC, i.id DESC`).all()
      : db.prepare(`${SELECT} WHERE i.reporter_id = ? ORDER BY (i.status = 'closed'), i.occurred_at DESC, i.id DESC`).all(req.user.id);
    res.json(rows);
  });

  router.post('/', (req, res) => {
    // Seul le personnel traite un incident : statut et résolution sont ignorés à la création.
    const clean = validate(createFields, req.body);
    clean.occurred_at ??= todayISO();
    const cols = [...Object.keys(clean), 'reporter_id'];
    const info = db.prepare(`INSERT INTO incidents (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...Object.values(clean), req.user.id);
    res.status(201).json(byId(info.lastInsertRowid));
  });

  router.put('/:id', requireRole(...STAFF), (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare('SELECT 1 FROM incidents WHERE id = ?').get(id)) throw notFound();
    const clean = validate(updateFields, req.body, { partial: true });
    const cols = Object.keys(clean);
    if (!cols.length) throw badRequest('Aucune modification fournie.');
    db.prepare(`UPDATE incidents SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
      .run(...cols.map((c) => clean[c]), id);
    res.json(byId(id));
  });

  router.delete('/:id', requireRole('admin'), (req, res) => {
    const { changes } = db.prepare('DELETE FROM incidents WHERE id = ?').run(parseId(req.params.id));
    if (!changes) throw notFound();
    res.status(204).end();
  });

  return router;
}
