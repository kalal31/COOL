import { badRequest } from './http.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
}

/**
 * Valide et nettoie `body` selon `fields`.
 * Types : string, int, number, date, time, id, list.
 * Options : required, max, min, enum, label.
 * En mode `partial`, les champs absents sont ignorés (mise à jour).
 */
export function validate(fields, body, { partial = false } = {}) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw badRequest('Corps de requête invalide.');
  }
  const out = {};
  const errors = {};

  for (const [key, spec] of Object.entries(fields)) {
    const label = spec.label ?? key;
    if (!(key in body)) {
      if (!partial && spec.required) errors[key] = `${label} est obligatoire.`;
      else if (!partial && 'default' in spec) out[key] = spec.default;
      continue;
    }
    let v = body[key];
    if (typeof v === 'string') v = v.trim();
    const empty = v === undefined || v === null || v === '' || (spec.type === 'list' && Array.isArray(v) && v.length === 0);
    if (empty) {
      if (spec.required) errors[key] = `${label} est obligatoire.`;
      else out[key] = 'default' in spec ? spec.default : spec.type === 'list' ? '' : null;
      continue;
    }

    switch (spec.type) {
      case 'string': {
        if (typeof v !== 'string') { errors[key] = `${label} doit être un texte.`; break; }
        const max = spec.max ?? 255;
        if (v.length > max) { errors[key] = `${label} est trop long (${max} caractères maximum).`; break; }
        if (spec.enum && !spec.enum.includes(v)) { errors[key] = `${label} : valeur non reconnue.`; break; }
        if (spec.pattern && !spec.pattern.test(v)) { errors[key] = spec.patternMessage ?? `${label} : format invalide.`; break; }
        out[key] = v;
        break;
      }
      case 'int':
      case 'number':
      case 'id': {
        const n = typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : NaN;
        if (!Number.isFinite(n)) { errors[key] = `${label} doit être un nombre.`; break; }
        if (spec.type !== 'number' && !Number.isInteger(n)) { errors[key] = `${label} doit être un entier.`; break; }
        const min = spec.min ?? (spec.type === 'id' ? 1 : -Infinity);
        const max = spec.max ?? 1e9;
        if (n < min) { errors[key] = `${label} doit être supérieur ou égal à ${min}.`; break; }
        if (n > max) { errors[key] = `${label} doit être inférieur ou égal à ${max}.`; break; }
        out[key] = n;
        break;
      }
      case 'date':
        if (!isValidDate(v)) errors[key] = `${label} : date invalide (format AAAA-MM-JJ).`;
        else out[key] = v;
        break;
      case 'time':
        if (typeof v !== 'string' || !TIME_RE.test(v)) errors[key] = `${label} : heure invalide (format HH:MM).`;
        else out[key] = v;
        break;
      case 'list': {
        if (!Array.isArray(v) || v.some((x) => typeof x !== 'string' || !spec.enum.includes(x))) {
          errors[key] = `${label} : valeurs non reconnues.`;
          break;
        }
        out[key] = [...new Set(v)].join(',');
        break;
      }
      default:
        throw new Error(`Type de champ inconnu : ${spec.type}`);
    }
  }

  if (Object.keys(errors).length) {
    throw badRequest('Certains champs sont invalides.', errors);
  }
  return out;
}
