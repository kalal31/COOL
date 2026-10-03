export const ROLES = { admin: 'Administrateur', teacher: 'Enseignant', technician: 'Technicien', student: 'Élève' };
export const EQUIPMENT_STATUS = { ok: 'Disponible', maintenance: 'En maintenance', out_of_service: 'Hors service' };
export const SEVERITY = { low: 'Faible', medium: 'Moyenne', high: 'Élevée' };
export const INCIDENT_STATUS = { open: 'Ouvert', in_progress: 'En cours', closed: 'Clos' };
export const SUBJECTS = { chimie: 'Chimie', physique: 'Physique', biologie: 'Biologie', geologie: 'Géologie', autre: 'Autre' };
export const UNITS = ['mL', 'L', 'g', 'kg', 'unité'];

export const HAZARDS = {
  GHS01: 'Explosif',
  GHS02: 'Inflammable',
  GHS03: 'Comburant',
  GHS04: 'Gaz sous pression',
  GHS05: 'Corrosif',
  GHS06: 'Toxique',
  GHS07: 'Nocif / irritant',
  GHS08: 'Danger pour la santé',
  GHS09: 'Danger pour l’environnement',
};

export const options = (map) => Object.entries(map).map(([value, label]) => ({ value, label }));
