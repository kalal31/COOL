import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { validate, isValidDate } from '../validate.js';
import { badRequest, conflict, forbidden, notFound, parseId } from '../http.js';

const bookingFields = {
  room_id: { type: 'id', required: true, label: 'La salle' },
  practical_id: { type: 'id', label: 'Le TP' },
  group_id: { type: 'id', label: 'Le groupe' },
  teacher_id: { type: 'id', label: 'L’enseignant' },
  title: { type: 'string', max: 160, label: 'Le titre' },
  date: { type: 'date', required: true, label: 'La date' },
  start_time: { type: 'time', required: true, label: 'L’heure de début' },
  end_time: { type: 'time', required: true, label: 'L’heure de fin' },
  stations: { type: 'int', min: 1, max: 200, default: 1, label: 'Le nombre de postes' },
  notes: { type: 'string', max: 1000, label: 'Les notes' },
};

const SELECT = `
  SELECT b.*, r.name AS room_name, u.name AS teacher_name, g.name AS group_name, p.title AS practical_title
  FROM bookings b
  JOIN rooms r ON r.id = b.room_id
  JOIN users u ON u.id = b.teacher_id
  LEFT JOIN groups g ON g.id = b.group_id
  LEFT JOIN practicals p ON p.id = b.practical_id`;

export function bookingsRouter(db) {
  const router = Router();
  router.use(requireAuth);

  const byId = (id) => db.prepare(`${SELECT} WHERE b.id = ?`).get(id);

  router.get('/', (req, res) => {
    const where = [];
    const params = [];
    for (const [key, op] of [['from', '>='], ['to', '<=']]) {
      if (req.query[key] === undefined) continue;
      if (!isValidDate(req.query[key])) throw badRequest(`Paramètre « ${key} » invalide (AAAA-MM-JJ).`);
      where.push(`b.date ${op} ?`);
      params.push(req.query[key]);
    }
    if (req.query.room_id !== undefined) {
      where.push('b.room_id = ?');
      params.push(parseId(req.query.room_id));
    }
    const sql = `${SELECT}${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY b.date, b.start_time, b.id`;
    res.json(db.prepare(sql).all(...params));
  });

  /** Règles métier communes à la création et à la modification. */
  function checkRules(b, selfId) {
    if (b.end_time <= b.start_time) {
      throw badRequest('L’heure de fin doit être après l’heure de début.', { end_time: 'Doit être après l’heure de début.' });
    }
    const room = db.prepare('SELECT name, capacity FROM rooms WHERE id = ?').get(b.room_id);
    if (!room) throw badRequest('Salle inconnue.', { room_id: 'Salle inconnue.' });

    const teacher = db.prepare("SELECT 1 FROM users WHERE id = ? AND active = 1 AND role IN ('teacher','admin')").get(b.teacher_id);
    if (!teacher) throw badRequest('L’enseignant doit être un enseignant actif.', { teacher_id: 'Enseignant invalide.' });

    if (b.group_id != null) {
      const group = db.prepare('SELECT name, size FROM groups WHERE id = ?').get(b.group_id);
      if (!group) throw badRequest('Groupe inconnu.', { group_id: 'Groupe inconnu.' });
      if (group.size > room.capacity) {
        throw conflict(`Le groupe « ${group.name} » (${group.size} élèves) dépasse la capacité de ${room.name} (${room.capacity} places).`);
      }
    }
    const clash = db.prepare(`
      SELECT title, start_time, end_time FROM bookings
      WHERE room_id = ? AND date = ? AND start_time < ? AND end_time > ? AND id != ?
      ORDER BY start_time LIMIT 1`).get(b.room_id, b.date, b.end_time, b.start_time, selfId ?? 0);
    if (clash) {
      throw conflict(`${room.name} est déjà réservée de ${clash.start_time} à ${clash.end_time} (« ${clash.title} »).`);
    }
  }

  function resolveTitle(b) {
    if (b.title) return b.title;
    const p = b.practical_id != null && db.prepare('SELECT title FROM practicals WHERE id = ?').get(b.practical_id);
    if (!p) throw badRequest('Indiquez un titre ou choisissez un TP.', { title: 'Le titre est obligatoire sans TP.' });
    return p.title;
  }

  router.post('/', requireRole('admin', 'teacher'), (req, res) => {
    const clean = validate(bookingFields, req.body);
    clean.teacher_id ??= req.user.id;
    if (req.user.role !== 'admin' && clean.teacher_id !== req.user.id) {
      throw forbidden('Vous ne pouvez réserver qu’en votre nom.');
    }
    clean.title = resolveTitle(clean);
    checkRules(clean, null);
    const cols = Object.keys(clean);
    const info = db.prepare(`INSERT INTO bookings (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
      .run(...cols.map((c) => clean[c]));
    res.status(201).json(byId(info.lastInsertRowid));
  });

  const loadOwned = (req) => {
    const existing = db.prepare('SELECT * FROM bookings WHERE id = ?').get(parseId(req.params.id));
    if (!existing) throw notFound();
    if (req.user.role !== 'admin' && existing.teacher_id !== req.user.id) {
      throw forbidden('Vous ne pouvez modifier que vos propres réservations.');
    }
    return existing;
  };

  router.put('/:id', requireRole('admin', 'teacher'), (req, res) => {
    const existing = loadOwned(req);
    const clean = validate(bookingFields, req.body, { partial: true });
    if (req.user.role !== 'admin' && clean.teacher_id !== undefined && clean.teacher_id !== req.user.id) {
      throw forbidden('Seul un administrateur peut changer l’enseignant.');
    }
    const merged = { ...existing, ...clean };
    merged.title = resolveTitle(merged);
    checkRules(merged, existing.id);
    const cols = Object.keys(bookingFields).filter((c) => merged[c] !== existing[c]);
    if (cols.length) {
      db.prepare(`UPDATE bookings SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`)
        .run(...cols.map((c) => merged[c]), existing.id);
    }
    res.json(byId(existing.id));
  });

  router.delete('/:id', requireRole('admin', 'teacher'), (req, res) => {
    const existing = loadOwned(req);
    db.prepare('DELETE FROM bookings WHERE id = ?').run(existing.id);
    res.status(204).end();
  });

  // Fiche de préparation : besoins du TP (x nombre de postes) comparés aux disponibilités.
  router.get('/:id/preparation', requireRole('admin', 'teacher', 'technician'), (req, res) => {
    const booking = byId(parseId(req.params.id));
    if (!booking) throw notFound();
    const n = booking.stations;

    const equipment = booking.practical_id == null ? [] : db.prepare(`
      SELECT e.id AS equipment_id, e.name, e.status, pe.quantity AS per_station,
        e.quantity - COALESCE((SELECT SUM(l.quantity) FROM loans l
                               WHERE l.equipment_id = e.id AND l.returned_at IS NULL), 0) AS free
      FROM practical_equipment pe JOIN equipment e ON e.id = pe.equipment_id
      WHERE pe.practical_id = ? ORDER BY e.name COLLATE NOCASE`).all(booking.practical_id)
      .map((e) => {
        const needed = e.per_station * n;
        const available = e.status === 'ok' ? Math.max(e.free, 0) : 0;
        return { ...e, needed, available, ok: available >= needed };
      });

    const reagents = booking.practical_id == null ? [] : db.prepare(`
      SELECT r.id AS reagent_id, r.name, r.unit, r.expiry_date, pr.quantity AS per_station, r.quantity AS stock
      FROM practical_reagents pr JOIN reagents r ON r.id = pr.reagent_id
      WHERE pr.practical_id = ? ORDER BY r.name COLLATE NOCASE`).all(booking.practical_id)
      .map((r) => {
        const needed = Math.round(r.per_station * n * 1e6) / 1e6;
        const expired = r.expiry_date != null && r.expiry_date < booking.date;
        return { ...r, needed, expired, ok: r.stock >= needed && !expired };
      });

    res.json({
      booking,
      equipment,
      reagents,
      ready: equipment.every((e) => e.ok) && reagents.every((r) => r.ok),
    });
  });

  return router;
}
