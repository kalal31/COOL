import { Router } from 'express';
import { requireAuth, requireRole } from '../auth.js';
import { todayISO } from '../db.js';

const EXPIRY_WARNING_DAYS = 30;

function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

/** Neutralise l'injection de formules (=, +, -, @) à l'ouverture d'un CSV dans un tableur. */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(columns, rows) {
  const header = columns.map((c) => csvCell(c.label)).join(';');
  const lines = rows.map((r) => columns.map((c) => csvCell(r[c.key])).join(';'));
  // BOM pour qu'Excel détecte l'UTF-8 ; séparateur « ; » pour les paramètres régionaux français.
  return `﻿${[header, ...lines].join('\r\n')}\r\n`;
}

export function dashboardRouter(db) {
  const router = Router();
  router.use(requireAuth);

  router.get('/dashboard', (req, res) => {
    const today = todayISO();
    const soon = addDays(today, EXPIRY_WARNING_DAYS);
    const staff = req.user.role !== 'student';
    const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;

    const bookingSql = `
      SELECT b.id, b.date, b.start_time, b.end_time, b.title, r.name AS room_name, g.name AS group_name, u.name AS teacher_name
      FROM bookings b JOIN rooms r ON r.id = b.room_id JOIN users u ON u.id = b.teacher_id
      LEFT JOIN groups g ON g.id = b.group_id`;

    const loanScope = staff ? '' : ' AND l.borrower_id = ?';
    const loanParams = staff ? [] : [req.user.id];

    res.json({
      today,
      counts: {
        equipment: count('equipment'),
        reagents: count('reagents'),
        practicals: count('practicals'),
        rooms: count('rooms'),
        openLoans: db.prepare(`SELECT COUNT(*) AS n FROM loans l WHERE returned_at IS NULL${loanScope}`).get(...loanParams).n,
        openIncidents: staff ? db.prepare("SELECT COUNT(*) AS n FROM incidents WHERE status != 'closed'").get().n : null,
      },
      alerts: {
        lowStock: db.prepare(`SELECT id, name, quantity, unit, min_quantity FROM reagents
          WHERE quantity <= min_quantity AND min_quantity > 0 ORDER BY name COLLATE NOCASE`).all(),
        expired: db.prepare(`SELECT id, name, expiry_date FROM reagents
          WHERE expiry_date IS NOT NULL AND expiry_date < ? ORDER BY expiry_date`).all(today),
        expiringSoon: db.prepare(`SELECT id, name, expiry_date FROM reagents
          WHERE expiry_date IS NOT NULL AND expiry_date >= ? AND expiry_date <= ? ORDER BY expiry_date`).all(today, soon),
        unavailableEquipment: db.prepare(`SELECT id, name, status FROM equipment
          WHERE status != 'ok' ORDER BY name COLLATE NOCASE`).all(),
        overdueLoans: db.prepare(`
          SELECT l.id, l.due_date, l.quantity, e.name AS equipment_name, u.name AS borrower_name
          FROM loans l JOIN equipment e ON e.id = l.equipment_id JOIN users u ON u.id = l.borrower_id
          WHERE l.returned_at IS NULL AND l.due_date < ?${loanScope} ORDER BY l.due_date`).all(today, ...loanParams),
      },
      todayBookings: db.prepare(`${bookingSql} WHERE b.date = ? ORDER BY b.start_time`).all(today),
      upcomingBookings: db.prepare(`${bookingSql} WHERE b.date > ? AND b.date <= ? ORDER BY b.date, b.start_time LIMIT 10`)
        .all(today, addDays(today, 7)),
    });
  });

  const exports = {
    equipment: {
      sql: `SELECT t.*, t.quantity - COALESCE((SELECT SUM(l.quantity) FROM loans l
              WHERE l.equipment_id = t.id AND l.returned_at IS NULL), 0) AS available
            FROM equipment t ORDER BY t.name COLLATE NOCASE`,
      columns: [
        { key: 'name', label: 'Nom' }, { key: 'category', label: 'Catégorie' }, { key: 'serial', label: 'N° de série' },
        { key: 'location', label: 'Emplacement' }, { key: 'quantity', label: 'Quantité' },
        { key: 'available', label: 'Disponible' }, { key: 'status', label: 'État' }, { key: 'notes', label: 'Notes' },
      ],
    },
    reagents: {
      sql: 'SELECT * FROM reagents ORDER BY name COLLATE NOCASE',
      columns: [
        { key: 'name', label: 'Nom' }, { key: 'formula', label: 'Formule' }, { key: 'cas', label: 'N° CAS' },
        { key: 'quantity', label: 'Quantité' }, { key: 'unit', label: 'Unité' }, { key: 'min_quantity', label: 'Seuil d’alerte' },
        { key: 'expiry_date', label: 'Péremption' }, { key: 'hazards', label: 'Dangers (SGH)' },
        { key: 'location', label: 'Emplacement' }, { key: 'notes', label: 'Notes' },
      ],
    },
  };

  router.get('/export/:name.csv', requireRole('admin', 'technician'), (req, res, next) => {
    const spec = Object.hasOwn(exports, req.params.name) ? exports[req.params.name] : null;
    if (!spec) return next();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}-${todayISO()}.csv"`);
    res.send(toCsv(spec.columns, db.prepare(spec.sql).all()));
  });

  return router;
}
