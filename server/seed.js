import { hashPassword } from './auth.js';
import { todayISO } from './db.js';

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return todayISO(d);
};

/** Crée le compte administrateur, et les données de démonstration si `demo`, quand la base est vide. */
export async function seedIfEmpty(db, { demo, adminEmail, adminPassword, demoPassword }) {
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) return null;

  if (!demo) {
    if (!adminPassword) throw new Error('ADMIN_PASSWORD requis pour initialiser une base vide hors mode démo.');
    db.prepare("INSERT INTO users (email, name, role, password_hash) VALUES (?, 'Administrateur', 'admin', ?)")
      .run(adminEmail, await hashPassword(adminPassword));
    return { demo: false, email: adminEmail, password: adminPassword };
  }
  await seedDemo(db, demoPassword);
  return { demo: true, password: demoPassword };
}

export async function seedDemo(db, password) {
  const hash = {};
  const people = [
    ['admin@lab.local', 'Claire Dubois', 'admin'],
    ['prof@lab.local', 'Marc Lefèvre', 'teacher'],
    ['sophie@lab.local', 'Sophie Martin', 'teacher'],
    ['tech@lab.local', 'Karim Benali', 'technician'],
    ['eleve@lab.local', 'Léa Moreau', 'student'],
    ['hugo@lab.local', 'Hugo Petit', 'student'],
  ];
  for (const [email] of people) hash[email] = await hashPassword(password);

  const insert = (sql, ...params) => Number(db.prepare(sql).run(...params).lastInsertRowid);
  const u = {};
  for (const [email, name, role] of people) {
    u[email.split('@')[0]] = insert('INSERT INTO users (email, name, role, password_hash) VALUES (?, ?, ?, ?)', email, name, role, hash[email]);
  }

  const room = (name, building, capacity, description) =>
    insert('INSERT INTO rooms (name, building, capacity, description) VALUES (?, ?, ?, ?)', name, building, capacity, description);
  const chimieA = room('Labo Chimie A', 'Bâtiment Sciences', 24, 'Paillasses avec hottes et point d’eau, 12 postes.');
  room('Labo Chimie B', 'Bâtiment Sciences', 16, 'Petite salle pour travaux en demi-groupe.');
  const physique = room('Labo Physique', 'Bâtiment Sciences', 30, 'Salle équipée en prises électriques et banc d’optique.');
  const svt = room('Salle SVT', 'Bâtiment B', 28, 'Microscopes et paillasses de dissection.');

  const group = (name, level, size) => insert('INSERT INTO groups (name, level, size) VALUES (?, ?, ?)', name, level, size);
  const seconde = group('Seconde 1', 'Seconde', 28);
  const premiere = group('Première Spé Chimie', 'Première', 22);
  const terminale = group('Terminale Physique-Chimie', 'Terminale', 20);
  const bts = group('BTS Biotechnologies', 'Post-bac', 14);

  const eq = (name, category, location, quantity, status = 'ok', notes = null) =>
    insert('INSERT INTO equipment (name, category, location, quantity, status, notes) VALUES (?, ?, ?, ?, ?, ?)',
      name, category, location, quantity, status, notes);
  const microscope = eq('Microscope optique', 'Optique', 'Armoire SVT-1', 12);
  eq('Balance de précision 0,01 g', 'Mesure', 'Salle de préparation', 6);
  eq('Bec Bunsen', 'Chauffage', 'Armoire C-2', 12);
  const multimetre = eq('Multimètre numérique', 'Électricité', 'Armoire P-1', 10);
  const alim = eq('Alimentation stabilisée 0–30 V', 'Électricité', 'Armoire P-1', 8);
  eq('Oscilloscope', 'Électricité', 'Armoire P-3', 4);
  eq('Bécher 250 mL', 'Verrerie', 'Armoire C-1', 40);
  const erlen = eq('Erlenmeyer 100 mL', 'Verrerie', 'Armoire C-1', 40);
  const burette = eq('Burette graduée 25 mL', 'Verrerie', 'Armoire C-1', 20);
  eq('Pipette jaugée 10 mL', 'Verrerie', 'Armoire C-1', 24);
  const agitateur = eq('Agitateur magnétique chauffant', 'Chauffage', 'Salle de préparation', 6);
  const phmetre = eq('pH-mètre', 'Mesure', 'Salle de préparation', 5, 'maintenance', 'Électrodes à remplacer, devis en cours.');
  eq('Spectrophotomètre UV-visible', 'Mesure', 'Salle de préparation', 2, 'out_of_service', 'Lampe grillée.');
  eq('Centrifugeuse de paillasse', 'Biologie', 'Salle SVT', 2);
  const lunettes = eq('Lunettes de protection', 'Sécurité', 'Entrée des labos', 30);
  eq('Hotte aspirante mobile', 'Sécurité', 'Labo Chimie A', 2);

  const rg = (name, formula, cas, quantity, unit, min, expiry, hazards, location) => {
    const id = insert(`INSERT INTO reagents (name, formula, cas, quantity, unit, min_quantity, expiry_date, hazards, location)
                       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, name, formula, cas, quantity, unit, min, expiry, hazards, location);
    insert('INSERT INTO stock_movements (reagent_id, delta, quantity_after, reason, user_id) VALUES (?, ?, ?, ?, ?)',
      id, quantity, quantity, 'Stock initial', u.tech);
    return id;
  };
  const hcl = rg('Acide chlorhydrique 1 mol/L', 'HCl', '7647-01-0', 2500, 'mL', 500, day(400), 'GHS05,GHS07', 'Armoire acides');
  const naoh = rg('Hydroxyde de sodium 1 mol/L', 'NaOH', '1310-73-2', 400, 'mL', 500, day(300), 'GHS05', 'Armoire bases');
  rg('Éthanol 95 %', 'C₂H₆O', '64-17-5', 3000, 'mL', 1000, day(500), 'GHS02,GHS07', 'Armoire inflammables');
  rg('Sulfate de cuivre(II) pentahydraté', 'CuSO₄·5H₂O', '7758-98-7', 800, 'g', 200, null, 'GHS07,GHS09', 'Armoire sels');
  const kmno4 = rg('Permanganate de potassium', 'KMnO₄', '7722-64-7', 150, 'g', 50, day(20), 'GHS03,GHS05,GHS07,GHS09', 'Armoire oxydants');
  rg('Acétone', 'C₃H₆O', '67-64-1', 2000, 'mL', 500, day(365), 'GHS02,GHS07', 'Armoire inflammables');
  rg('Chlorure de sodium', 'NaCl', '7647-14-5', 5, 'kg', 1, null, '', 'Armoire sels');
  const bleu = rg('Bleu de méthylène', 'C₁₆H₁₈ClN₃S', '61-73-4', 250, 'mL', 50, day(-10), 'GHS07', 'Armoire colorants');
  rg('Diiode', 'I₂', '7553-56-2', 50, 'g', 20, day(200), 'GHS07,GHS09', 'Armoire oxydants');
  rg('Peroxyde d’hydrogène 30 %', 'H₂O₂', '7722-84-1', 1000, 'mL', 300, day(120), 'GHS03,GHS05,GHS07', 'Réfrigérateur chimie');
  rg('Nitrate d’argent', 'AgNO₃', '7761-88-8', 8, 'g', 10, day(600), 'GHS03,GHS05,GHS09', 'Armoire sous clé');
  rg('Eau distillée', 'H₂O', '7732-18-5', 60, 'L', 20, null, '', 'Salle de préparation');
  // Historique de consommation
  for (const [id, delta, after, reason] of [[naoh, -600, 400, 'TP dosage — Première Spé'], [hcl, -500, 2500, 'TP dosage — Première Spé']]) {
    insert('INSERT INTO stock_movements (reagent_id, delta, quantity_after, reason, user_id) VALUES (?, ?, ?, ?, ?)', id, delta, after, reason, u.tech);
  }

  const practical = (title, subject, level, duration, objectives, description, safety, author) =>
    insert(`INSERT INTO practicals (title, subject, level, duration_min, objectives, description, safety_notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, title, subject, level, duration, objectives, description, safety, author);
  const link = (table, col, pid, id, qty) => insert(`INSERT INTO ${table} (practical_id, ${col}, quantity) VALUES (?, ?, ?)`, pid, id, qty);

  const tpDosage = practical(
    'Dosage acido-basique par titrage pH-métrique', 'chimie', 'Première', 120,
    'Déterminer la concentration d’une solution d’acide chlorhydrique par titrage avec une solution d’hydroxyde de sodium.',
    '1. Rincer et remplir la burette avec la solution de soude.\n2. Prélever 10 mL d’acide dans un bécher, ajouter l’agitateur magnétique.\n3. Plonger l’électrode du pH-mètre et verser la soude millilitre par millilitre.\n4. Tracer pH = f(V) et repérer l’équivalence par la méthode des tangentes.',
    'Port des lunettes et de la blouse obligatoire. Rincer immédiatement à l’eau en cas de projection. Ne pas pipeter à la bouche.',
    u.prof);
  link('practical_equipment', 'equipment_id', tpDosage, burette, 1);
  link('practical_equipment', 'equipment_id', tpDosage, erlen, 2);
  link('practical_equipment', 'equipment_id', tpDosage, agitateur, 1);
  link('practical_equipment', 'equipment_id', tpDosage, phmetre, 1);
  link('practical_equipment', 'equipment_id', tpDosage, lunettes, 2);
  link('practical_reagents', 'reagent_id', tpDosage, hcl, 20);
  link('practical_reagents', 'reagent_id', tpDosage, naoh, 40);

  const tpMicro = practical(
    'Observation de cellules végétales au microscope', 'biologie', 'BTS', 90,
    'Observer des cellules d’épiderme d’oignon et identifier paroi, noyau et cytoplasme.',
    '1. Prélever une fine pellicule d’épiderme d’oignon.\n2. La déposer sur une lame, ajouter une goutte de bleu de méthylène, couvrir d’une lamelle.\n3. Observer aux grossissements ×100 puis ×400 et réaliser un schéma annoté.',
    'Manipuler les lames avec précaution. Le bleu de méthylène tache : porter des gants.',
    u.sophie);
  link('practical_equipment', 'equipment_id', tpMicro, microscope, 1);
  link('practical_reagents', 'reagent_id', tpMicro, bleu, 2);

  const tpOhm = practical(
    'Loi d’Ohm et caractéristique d’un dipôle', 'physique', 'Seconde', 120,
    'Vérifier expérimentalement la proportionnalité entre tension et intensité pour un conducteur ohmique.',
    '1. Réaliser le circuit série : alimentation, résistance, ampèremètre.\n2. Brancher le voltmètre en dérivation aux bornes de la résistance.\n3. Relever U et I pour 8 valeurs de tension de 0 à 12 V.\n4. Tracer U = f(I) et déterminer R par modélisation.',
    'Faire vérifier le montage par l’enseignant avant la mise sous tension. Ne jamais dépasser 12 V.',
    u.sophie);
  link('practical_equipment', 'equipment_id', tpOhm, multimetre, 2);
  link('practical_equipment', 'equipment_id', tpOhm, alim, 1);

  const tpPerm = practical(
    'Dosage d’oxydoréduction au permanganate', 'chimie', 'Terminale', 150,
    'Doser une solution de fer(II) par une solution de permanganate de potassium.',
    '1. Préparer la solution de permanganate à partir du solide.\n2. Remplir la burette, prélever la solution de fer(II) et acidifier.\n3. Verser jusqu’à persistance de la coloration rose : repérer l’équivalence.',
    'Le permanganate est un oxydant fort : éviter tout contact avec les matières organiques. Gants et lunettes obligatoires.',
    u.prof);
  link('practical_equipment', 'equipment_id', tpPerm, burette, 1);
  link('practical_equipment', 'equipment_id', tpPerm, erlen, 2);
  link('practical_equipment', 'equipment_id', tpPerm, lunettes, 2);
  link('practical_reagents', 'reagent_id', tpPerm, kmno4, 5);
  link('practical_reagents', 'reagent_id', tpPerm, hcl, 10);

  const booking = (roomId, practicalId, groupId, teacher, title, date, start, end, stations) =>
    insert(`INSERT INTO bookings (room_id, practical_id, group_id, teacher_id, title, date, start_time, end_time, stations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, roomId, practicalId, groupId, teacher, title, date, start, end, stations);
  booking(chimieA, tpDosage, premiere, u.prof, 'Dosage acido-basique par titrage pH-métrique', day(0), '08:00', '10:00', 11);
  booking(physique, tpOhm, seconde, u.sophie, 'Loi d’Ohm et caractéristique d’un dipôle', day(0), '14:00', '16:00', 5);
  booking(svt, tpMicro, bts, u.sophie, 'Observation de cellules végétales au microscope', day(1), '10:00', '11:30', 7);
  booking(chimieA, tpDosage, premiere, u.prof, 'Dosage acido-basique (séance 2)', day(2), '08:00', '10:00', 11);
  booking(physique, tpOhm, seconde, u.sophie, 'Loi d’Ohm (groupe B)', day(3), '10:00', '12:00', 5);
  booking(chimieA, tpPerm, terminale, u.prof, 'Dosage d’oxydoréduction au permanganate', day(25), '14:00', '16:30', 10);

  const loan = (equipmentId, borrower, qty, loanedAt, due, returnedAt = null, notes = null) =>
    insert(`INSERT INTO loans (equipment_id, borrower_id, quantity, loaned_at, due_date, returned_at, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, equipmentId, borrower, qty, loanedAt, due, returnedAt, notes);
  loan(multimetre, u.prof, 2, day(-10), day(-3), null, 'Préparation du TP d’électricité');
  loan(lunettes, u.sophie, 10, day(-1), day(2));
  loan(microscope, u.eleve, 1, day(-2), day(5), null, 'Projet personnel de SVT');
  loan(alim, u.prof, 1, day(-20), day(-15), day(-14));

  const incident = (roomId, reporter, severity, status, occurred, description, resolution = null) =>
    insert(`INSERT INTO incidents (room_id, reporter_id, severity, status, occurred_at, description, resolution)
            VALUES (?, ?, ?, ?, ?, ?, ?)`, roomId, reporter, severity, status, occurred, description, resolution);
  incident(chimieA, u.prof, 'medium', 'in_progress', day(-3), 'Bris d’un bécher pendant un TP ; un élève s’est légèrement coupé. Soins donnés à l’infirmerie.');
  incident(svt, u.eleve, 'low', 'open', day(-1), 'Le robinet de la paillasse 4 fuit.');
  incident(physique, u.sophie, 'low', 'closed', day(-12), 'Prise électrique défectueuse sur la paillasse 2.', 'Prise remplacée par la maintenance.');

}
