import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { transaction } from '../db.js';
import { validate } from '../validate.js';
import { badRequest, forbidden, notFound, parseId } from '../http.js';

export const SUBJECTS = ['chimie', 'physique', 'biologie', 'geologie', 'autre'];

const practicalFields = {
  title: { type: 'string', required: true, max: 160, label: 'Le titre' },
  subject: { type: 'string', required: true, enum: SUBJECTS, label: 'La discipline' },
  level: { type: 'string', max: 80, label: 'Le niveau' },
  duration_min: { type: 'int', min: 15, max: 720, default: 120, label: 'La durée' },
  objectives: { type: 'string', max: 2000, label: 'Les objectifs' },
  description: { type: 'string', max: 5000, label: 'Le protocole' },
  safety_notes: { type: 'string', max: 2000, label: 'Les consignes de sécurité' },
};

const equipmentLine = {
  equipment_id: { type: 'id', required: true, label: 'Le matériel' },
  quantity: { type: 'int', min: 1, max: 1000, default: 1, label: 'La quantité de matériel' },
};
const reagentLine = {
  reagent_id: { type: 'id', required: true, label: 'Le produit' },
  quantity: { type: 'number', required: true, min: 0.0001, max: 1e6, label: 'La quantité de produit' },
};

function parseLines(raw, fields, idKey, label) {
  if (raw === undefined) return undefined; // non fourni : liste inchangée
  if (!Array.isArray(raw) || raw.length > 100) throw badRequest(`${label} : liste invalide.`);
  const seen = new Set();
  return raw.map((line) => {
    const clean = validate(fields, line);
    if (seen.has(clean[idKey])) throw badRequest(`${label} : un même élément est listé deux fois.`);
    seen.add(clean[idKey]);
    return clean;
  });
}

const splitHazards = (csv) => [...new Set((csv ?? '').split(',').filter(Boolean))].sort();

export function practicalsRouter(db) {
  const router = Router();
  router.use(requireAuth);

  const canEdit = (req, row) => req.user.role === 'admin' || row.created_by === req.user.id;

  router.get('/', (_req, res) => {
    const rows = db.prepare(`
      SELECT p.*, u.name AS author,
        (SELECT COUNT(*) FROM practical_equipment WHERE practical_id = p.id) AS equipment_count,
        (SELECT COUNT(*) FROM practical_reagents WHERE practical_id = p.id) AS reagent_count,
        (SELECT group_concat(r.hazards) FROM practical_reagents pr JOIN reagents r ON r.id = pr.reagent_id
          WHERE pr.practical_id = p.id) AS hazards
      FROM practicals p LEFT JOIN users u ON u.id = p.created_by
      ORDER BY p.title COLLATE NOCASE`).all();
    res.json(rows.map((r) => ({ ...r, hazards: splitHazards(r.hazards) })));
  });

  function detail(id) {
    const p = db.prepare(`
      SELECT p.*, u.name AS author FROM practicals p
      LEFT JOIN users u ON u.id = p.created_by WHERE p.id = ?`).get(id);
    if (!p) return null;
    p.equipment = db.prepare(`
      SELECT pe.equipment_id, pe.quantity, e.name FROM practical_equipment pe
      JOIN equipment e ON e.id = pe.equipment_id WHERE pe.practical_id = ? ORDER BY e.name COLLATE NOCASE`).all(id);
    const reagents = db.prepare(`
      SELECT pr.reagent_id, pr.quantity, r.name, r.unit, r.hazards FROM practical_reagents pr
      JOIN reagents r ON r.id = pr.reagent_id WHERE pr.practical_id = ? ORDER BY r.name COLLATE NOCASE`).all(id);
    p.reagents = reagents.map((r) => ({ ...r, hazards: splitHazards(r.hazards) }));
    p.hazards = splitHazards(reagents.map((r) => r.hazards).join(','));
    return p;
  }

  router.get('/:id', (req, res) => {
    const p = detail(parseId(req.params.id));
    if (!p) throw notFound();
    res.json(p);
  });

  function writeLines(id, equipment, reagents) {
    if (equipment) {
      db.prepare('DELETE FROM practical_equipment WHERE practical_id = ?').run(id);
      const ins = db.prepare('INSERT INTO practical_equipment (practical_id, equipment_id, quantity) VALUES (?, ?, ?)');
      for (const l of equipment) ins.run(id, l.equipment_id, l.quantity);
    }
    if (reagents) {
      db.prepare('DELETE FROM practical_reagents WHERE practical_id = ?').run(id);
      const ins = db.prepare('INSERT INTO practical_reagents (practical_id, reagent_id, quantity) VALUES (?, ?, ?)');
      for (const l of reagents) ins.run(id, l.reagent_id, l.quantity);
    }
  }

  router.post('/', requireRole('admin', 'teacher'), (req, res) => {
    const clean = validate(practicalFields, req.body);
    const equipment = parseLines(req.body.equipment, equipmentLine, 'equipment_id', 'Matériel');
    const reagents = parseLines(req.body.reagents, reagentLine, 'reagent_id', 'Produits');
    const id = transaction(db, () => {
      const cols = [...Object.keys(clean), 'created_by'];
      const info = db.prepare(`INSERT INTO practicals (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .run(...Object.values(clean), req.user.id);
      writeLines(info.lastInsertRowid, equipment, reagents);
      return info.lastInsertRowid;
    });
    res.status(201).json(detail(id));
  });

  router.put('/:id', requireRole('admin', 'teacher'), (req, res) => {
    const id = parseId(req.params.id);
    const clean = validate(practicalFields, req.body, { partial: true });
    const equipment = parseLines(req.body.equipment, equipmentLine, 'equipment_id', 'Matériel');
    const reagents = parseLines(req.body.reagents, reagentLine, 'reagent_id', 'Produits');
    transaction(db, () => {
      const existing = db.prepare('SELECT created_by FROM practicals WHERE id = ?').get(id);
      if (!existing) throw notFound();
      if (!canEdit(req, existing)) throw forbidden('Vous ne pouvez modifier que vos propres travaux pratiques.');
      const cols = Object.keys(clean);
      if (cols.length) {
        db.prepare(`UPDATE practicals SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
          .run(...Object.values(clean), id);
      }
      writeLines(id, equipment, reagents);
    });
    res.json(detail(id));
  });

  router.delete('/:id', requireRole('admin', 'teacher'), (req, res) => {
    const id = parseId(req.params.id);
    const existing = db.prepare('SELECT created_by FROM practicals WHERE id = ?').get(id);
    if (!existing) throw notFound();
    if (!canEdit(req, existing)) throw forbidden('Vous ne pouvez supprimer que vos propres travaux pratiques.');
    db.prepare('DELETE FROM practicals WHERE id = ?').run(id);
    res.status(204).end();
  });

  return router;
}
