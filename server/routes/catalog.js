import { Router } from 'express';
import { crudRouter } from '../crud.js';
import { requireAuth, requireRole } from '../auth.js';
import { transaction } from '../db.js';
import { validate } from '../validate.js';
import { badRequest, conflict, notFound, parseId } from '../http.js';

export const HAZARDS = ['GHS01', 'GHS02', 'GHS03', 'GHS04', 'GHS05', 'GHS06', 'GHS07', 'GHS08', 'GHS09'];
export const REAGENT_UNITS = ['mL', 'L', 'g', 'kg', 'unité'];
export const EQUIPMENT_STATUS = ['ok', 'maintenance', 'out_of_service'];

const STAFF = ['admin', 'technician'];
const round = (n) => Math.round(n * 1e6) / 1e6;

const roomFields = {
  name: { type: 'string', required: true, max: 80, label: 'Le nom' },
  building: { type: 'string', max: 80, label: 'Le bâtiment' },
  capacity: { type: 'int', min: 1, max: 500, default: 24, label: 'La capacité' },
  description: { type: 'string', max: 500, label: 'La description' },
};

const groupFields = {
  name: { type: 'string', required: true, max: 80, label: 'Le nom' },
  level: { type: 'string', max: 80, label: 'Le niveau' },
  size: { type: 'int', min: 1, max: 500, default: 24, label: 'L’effectif' },
};

const equipmentFields = {
  name: { type: 'string', required: true, max: 120, label: 'Le nom' },
  category: { type: 'string', max: 80, label: 'La catégorie' },
  serial: { type: 'string', max: 80, label: 'Le n° de série' },
  location: { type: 'string', max: 120, label: 'L’emplacement' },
  quantity: { type: 'int', min: 0, max: 100000, default: 1, label: 'La quantité' },
  status: { type: 'string', enum: EQUIPMENT_STATUS, default: 'ok', label: 'L’état' },
  notes: { type: 'string', max: 1000, label: 'Les notes' },
};

const reagentFields = {
  name: { type: 'string', required: true, max: 120, label: 'Le nom' },
  formula: { type: 'string', max: 60, label: 'La formule' },
  cas: {
    type: 'string', max: 12, pattern: /^\d{2,7}-\d{2}-\d$/,
    patternMessage: 'Le n° CAS doit avoir le format 7647-01-0.', label: 'Le n° CAS',
  },
  quantity: { type: 'number', required: true, min: 0, max: 1e7, label: 'La quantité' },
  unit: { type: 'string', enum: REAGENT_UNITS, default: 'mL', label: 'L’unité' },
  min_quantity: { type: 'number', min: 0, max: 1e7, default: 0, label: 'Le seuil d’alerte' },
  expiry_date: { type: 'date', label: 'La date de péremption' },
  hazards: { type: 'list', enum: HAZARDS, label: 'Les dangers' },
  location: { type: 'string', max: 120, label: 'L’emplacement' },
  notes: { type: 'string', max: 1000, label: 'Les notes' },
};

export function catalogRouters(db) {
  const rooms = crudRouter(db, {
    table: 'rooms',
    fields: roomFields,
    select: 'SELECT t.* FROM rooms t',
    orderBy: 't.name COLLATE NOCASE',
    write: STAFF,
  });

  const groups = crudRouter(db, {
    table: 'groups',
    fields: groupFields,
    select: 'SELECT t.* FROM groups t',
    orderBy: 't.name COLLATE NOCASE',
    write: ['admin', 'teacher'],
  });

  const equipment = crudRouter(db, {
    table: 'equipment',
    fields: equipmentFields,
    select: `SELECT t.*,
      t.quantity - COALESCE((SELECT SUM(l.quantity) FROM loans l
                             WHERE l.equipment_id = t.id AND l.returned_at IS NULL), 0) AS available
      FROM equipment t`,
    orderBy: 't.name COLLATE NOCASE',
    write: STAFF,
  });

  const logMovement = db.prepare(
    'INSERT INTO stock_movements (reagent_id, delta, quantity_after, reason, user_id) VALUES (?, ?, ?, ?, ?)',
  );

  const reagents = crudRouter(db, {
    table: 'reagents',
    fields: reagentFields,
    select: 'SELECT t.* FROM reagents t',
    orderBy: 't.name COLLATE NOCASE',
    write: STAFF,
    toApi: (r) => ({ ...r, hazards: r.hazards ? r.hazards.split(',') : [] }),
    onCreate: (r, req) => {
      if (r.quantity > 0) logMovement.run(r.id, r.quantity, r.quantity, 'Stock initial', req.user.id);
    },
    onUpdate: (before, after, req) => {
      if (before.quantity !== after.quantity) {
        logMovement.run(after.id, round(after.quantity - before.quantity), after.quantity,
          'Correction d’inventaire', req.user.id);
      }
    },
  });

  // Journal des mouvements de stock d'un produit
  const movements = Router();
  movements.use(requireAuth);

  movements.get('/:id/movements', (req, res) => {
    const id = parseId(req.params.id);
    if (!db.prepare('SELECT 1 FROM reagents WHERE id = ?').get(id)) throw notFound();
    res.json(db.prepare(`
      SELECT m.id, m.delta, m.quantity_after, m.reason, m.created_at, u.name AS user_name
      FROM stock_movements m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.reagent_id = ? ORDER BY m.id DESC LIMIT 100`).all(id));
  });

  const movementFields = {
    delta: { type: 'number', required: true, min: -1e7, max: 1e7, label: 'La variation' },
    reason: { type: 'string', max: 200, label: 'Le motif' },
  };

  movements.post('/:id/movements', requireRole(...STAFF), (req, res) => {
    const id = parseId(req.params.id);
    const { delta, reason } = validate(movementFields, req.body);
    if (delta === 0) throw badRequest('La variation ne peut pas être nulle.', { delta: 'La variation ne peut pas être nulle.' });
    const reagent = transaction(db, () => {
      const current = db.prepare('SELECT quantity FROM reagents WHERE id = ?').get(id);
      if (!current) throw notFound();
      const next = round(current.quantity + delta);
      if (next < 0) throw conflict(`Stock insuffisant : il reste ${current.quantity} en stock.`);
      db.prepare('UPDATE reagents SET quantity = ? WHERE id = ?').run(next, id);
      logMovement.run(id, delta, next, reason ?? (delta > 0 ? 'Réapprovisionnement' : 'Consommation'), req.user.id);
      return db.prepare('SELECT * FROM reagents WHERE id = ?').get(id);
    });
    res.status(201).json({ ...reagent, hazards: reagent.hazards ? reagent.hazards.split(',') : [] });
  });

  reagents.use(movements);
  return { rooms, groups, equipment, reagents };
}
