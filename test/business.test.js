import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, day } from './helpers.js';

let app;
let admin, prof, sophie, tech, eleve;
const roomId = (name) => app.id('SELECT id FROM rooms WHERE name = ?', name);
const groupId = (name) => app.id('SELECT id FROM groups WHERE name = ?', name);
const equipmentId = (name) => app.id('SELECT id FROM equipment WHERE name = ?', name);
const reagentId = (name) => app.id('SELECT id FROM reagents WHERE name = ?', name);
const practicalId = (title) => app.id('SELECT id FROM practicals WHERE title LIKE ?', `${title}%`);

before(async () => {
  app = await startApp();
  [admin, prof, sophie, tech, eleve] = await Promise.all(
    ['admin', 'prof', 'sophie', 'tech', 'eleve'].map((n) => app.login(`${n}@lab.local`)),
  );
});
after(() => app.close());

// ---------- Catalogue : validation et permissions ----------

test('seul le personnel technique modifie l’inventaire', async () => {
  const body = { name: 'Thermomètre', quantity: 5 };
  assert.equal((await eleve('POST', '/api/equipment', body)).status, 403);
  assert.equal((await prof('POST', '/api/equipment', body)).status, 403);
  const ok = await tech('POST', '/api/equipment', body);
  assert.equal(ok.status, 201);
  assert.equal(ok.body.status, 'ok');
  assert.equal(ok.body.available, 5);
  assert.equal((await eleve('GET', '/api/equipment')).status, 200);
});

test('la validation renvoie les erreurs champ par champ', async () => {
  const res = await tech('POST', '/api/equipment', { name: '', quantity: -2, status: 'cassé' });
  assert.equal(res.status, 400);
  assert.ok(res.body.fields.name);
  assert.ok(res.body.fields.quantity);
  assert.ok(res.body.fields.status);
  const rg = await tech('POST', '/api/reagents', { name: 'X', quantity: 1, cas: '12345', hazards: ['GHS99'] });
  assert.equal(rg.status, 400);
  assert.ok(rg.body.fields.cas);
  assert.ok(rg.body.fields.hazards);
  const arr = await tech('POST', '/api/equipment', { name: ['a'], quantity: 1 });
  assert.equal(arr.status, 400, 'un tableau n’est pas un nom valide');
});

test('une tentative d’injection SQL est traitée comme un simple texte', async () => {
  const evil = "x'); DROP TABLE equipment; --";
  const res = await tech('POST', '/api/equipment', { name: evil, quantity: 1 });
  assert.equal(res.status, 201);
  assert.equal(res.body.name, evil);
  assert.equal((await tech('GET', '/api/equipment')).status, 200);
});

test('chaque variation de stock d’un produit est journalisée et le stock ne peut pas devenir négatif', async () => {
  const id = reagentId('Éthanol 95 %');
  const before = (await tech('GET', `/api/reagents/${id}`)).body.quantity;

  const used = await tech('POST', `/api/reagents/${id}/movements`, { delta: -250, reason: 'TP chromatographie' });
  assert.equal(used.status, 201);
  assert.equal(used.body.quantity, before - 250);

  assert.equal((await tech('POST', `/api/reagents/${id}/movements`, { delta: -1e6 })).status, 409);
  assert.equal((await tech('POST', `/api/reagents/${id}/movements`, { delta: 0 })).status, 400);
  assert.equal((await prof('POST', `/api/reagents/${id}/movements`, { delta: 1 })).status, 403);
  assert.equal((await tech('GET', `/api/reagents/${id}`)).body.quantity, before - 250, 'refus = aucun effet');

  // Corriger la fiche à la main laisse aussi une trace
  await tech('PUT', `/api/reagents/${id}`, { quantity: before });
  const log = (await prof('GET', `/api/reagents/${id}/movements`)).body;
  assert.equal(log[0].reason, 'Correction d’inventaire');
  assert.equal(log[0].delta, 250);
  assert.equal(log[1].reason, 'TP chromatographie');
  assert.equal(log[1].user_name, 'Karim Benali');
});

test('une salle encore réservée ne peut pas être supprimée', async () => {
  const res = await tech('DELETE', `/api/rooms/${roomId('Labo Chimie A')}`);
  assert.equal(res.status, 409);
  const empty = (await tech('POST', '/api/rooms', { name: 'Salle vide', capacity: 10 })).body;
  assert.equal((await tech('DELETE', `/api/rooms/${empty.id}`)).status, 204);
});

// ---------- Réservations ----------

const slot = (over = {}) => ({
  room_id: roomId('Labo Chimie B'), group_id: groupId('BTS Biotechnologies'),
  title: 'Séance test', date: day(10), start_time: '09:00', end_time: '11:00', ...over,
});

test('les réservations qui se chevauchent dans une même salle sont refusées', async () => {
  assert.equal((await prof('POST', '/api/bookings', slot())).status, 201);
  const clash = await sophie('POST', '/api/bookings', slot({ start_time: '10:00', end_time: '12:00' }));
  assert.equal(clash.status, 409);
  assert.match(clash.body.error, /09:00 à 11:00/);
  assert.equal((await sophie('POST', '/api/bookings', slot({ start_time: '08:00', end_time: '10:00' }))).status, 409);
  assert.equal((await sophie('POST', '/api/bookings', slot({ start_time: '09:30', end_time: '10:00' }))).status, 409, 'créneau inclus');
  // Séances adjacentes, autre salle ou autre jour : autorisées
  assert.equal((await sophie('POST', '/api/bookings', slot({ start_time: '11:00', end_time: '12:00' }))).status, 201);
  assert.equal((await sophie('POST', '/api/bookings', slot({ room_id: roomId('Labo Physique') }))).status, 201);
  assert.equal((await sophie('POST', '/api/bookings', slot({ date: day(11) }))).status, 201);
});

test('horaires incohérents et groupe plus grand que la salle sont refusés', async () => {
  assert.equal((await prof('POST', '/api/bookings', slot({ start_time: '12:00', end_time: '12:00' }))).status, 400);
  assert.equal((await prof('POST', '/api/bookings', slot({ start_time: '25:00' }))).status, 400);
  assert.equal((await prof('POST', '/api/bookings', slot({ date: '2026-02-31' }))).status, 400, 'date inexistante');
  const tooBig = await prof('POST', '/api/bookings', slot({ group_id: groupId('Seconde 1'), date: day(20) }));
  assert.equal(tooBig.status, 409);
  assert.match(tooBig.body.error, /capacité/);
});

test('seuls les enseignants réservent, et chacun ne modifie que ses réservations', async () => {
  assert.equal((await eleve('POST', '/api/bookings', slot({ date: day(30) }))).status, 403);
  assert.equal((await tech('POST', '/api/bookings', slot({ date: day(30) }))).status, 403);
  const mine = await prof('POST', '/api/bookings', slot({ date: day(31) }));
  assert.equal(mine.status, 201);
  const id = mine.body.id;
  assert.equal((await sophie('PUT', `/api/bookings/${id}`, { notes: 'intrus' })).status, 403);
  assert.equal((await sophie('DELETE', `/api/bookings/${id}`)).status, 403);
  assert.equal((await prof('PUT', `/api/bookings/${id}`, { notes: 'ok' })).status, 200);
  assert.equal((await admin('PUT', `/api/bookings/${id}`, { notes: 'admin' })).status, 200);
  // Réserver au nom d'un collègue est interdit, sauf pour l'administrateur
  const sophieId = app.id("SELECT id FROM users WHERE email = 'sophie@lab.local'");
  assert.equal((await prof('POST', '/api/bookings', slot({ date: day(32), teacher_id: sophieId }))).status, 403);
  assert.equal((await admin('POST', '/api/bookings', slot({ date: day(32), teacher_id: sophieId }))).status, 201);
  assert.equal((await prof('DELETE', `/api/bookings/${id}`)).status, 204);
});

test('déplacer une réservation ne la fait pas entrer en conflit avec elle-même', async () => {
  const made = await prof('POST', '/api/bookings', slot({ date: day(40) }));
  const res = await prof('PUT', `/api/bookings/${made.body.id}`, { start_time: '09:30', end_time: '11:30' });
  assert.equal(res.status, 200);
  assert.equal(res.body.start_time, '09:30');
});

test('le titre est repris du TP choisi lorsqu’il est omis', async () => {
  const res = await prof('POST', '/api/bookings', {
    room_id: roomId('Labo Chimie A'), practical_id: practicalId('Dosage acido-basique'),
    date: day(50), start_time: '08:00', end_time: '10:00',
  });
  assert.equal(res.status, 201);
  assert.match(res.body.title, /Dosage acido-basique/);
  assert.equal((await prof('POST', '/api/bookings', { room_id: roomId('Labo Chimie A'), date: day(51), start_time: '08:00', end_time: '10:00' })).status, 400);
});

test('la fiche de préparation signale les manques de matériel, de produit et les péremptions', async () => {
  const list = (await prof('GET', `/api/bookings?from=${day(0)}&to=${day(0)}`)).body;
  const dosage = list.find((b) => b.title.startsWith('Dosage acido-basique'));
  const prep = (await tech('GET', `/api/bookings/${dosage.id}/preparation`)).body;
  assert.equal(prep.ready, false);
  const ph = prep.equipment.find((e) => e.name === 'pH-mètre');
  assert.equal(ph.ok, false, 'pH-mètre en maintenance : indisponible');
  assert.equal(ph.needed, 11);
  const naoh = prep.reagents.find((r) => r.name.startsWith('Hydroxyde'));
  assert.equal(naoh.needed, 40 * 11);
  assert.equal(naoh.stock, 400);
  assert.equal(naoh.ok, false, '440 mL requis pour 400 mL en stock');
  assert.equal(prep.equipment.find((e) => e.name.startsWith('Burette')).ok, true);

  // 2 des 10 multimètres sont prêtés (emprunt en retard) : 5 postes x 2 = 10 requis, 8 disponibles.
  const ohm = list.find((b) => b.title.startsWith('Loi d’Ohm'));
  const short = (await tech('GET', `/api/bookings/${ohm.id}/preparation`)).body;
  assert.equal(short.ready, false);
  assert.deepEqual(short.equipment.filter((e) => !e.ok).map((e) => [e.name, e.needed, e.available]), [['Multimètre numérique', 10, 8]]);
  await sophie('PUT', `/api/bookings/${ohm.id}`, { stations: 4 });
  assert.equal((await tech('GET', `/api/bookings/${ohm.id}/preparation`)).body.ready, true, '4 postes = 8 multimètres');

  // Le permanganate périme avant la séance prévue dans 25 jours
  const perm = (await prof('GET', `/api/bookings?from=${day(25)}&to=${day(25)}`)).body[0];
  const permPrep = (await prof('GET', `/api/bookings/${perm.id}/preparation`)).body;
  assert.equal(permPrep.reagents.find((r) => r.name.startsWith('Permanganate')).expired, true);
  assert.equal(permPrep.ready, false);
  assert.equal((await eleve('GET', `/api/bookings/${perm.id}/preparation`)).status, 403);
});

// ---------- Emprunts ----------

test('un emprunt réduit la disponibilité et le retour la restitue', async () => {
  const id = equipmentId('Oscilloscope'); // 4 exemplaires
  const borrower = app.id("SELECT id FROM users WHERE email = 'prof@lab.local'");
  const loan = { equipment_id: id, borrower_id: borrower, quantity: 3, due_date: day(7) };
  const first = await tech('POST', '/api/loans', loan);
  assert.equal(first.status, 201);
  assert.equal((await tech('GET', `/api/equipment/${id}`)).body.available, 1);

  const tooMany = await tech('POST', '/api/loans', { ...loan, quantity: 2 });
  assert.equal(tooMany.status, 409);
  assert.match(tooMany.body.error, /1 exemplaire/);

  assert.equal((await tech('POST', `/api/loans/${first.body.id}/return`)).status, 200);
  assert.equal((await tech('POST', `/api/loans/${first.body.id}/return`)).status, 409, 'double retour refusé');
  assert.equal((await tech('GET', `/api/equipment/${id}`)).body.available, 4);
});

test('le matériel en maintenance ne peut pas être emprunté ; dates cohérentes exigées', async () => {
  const borrower = app.id("SELECT id FROM users WHERE email = 'prof@lab.local'");
  const ph = await tech('POST', '/api/loans', { equipment_id: equipmentId('pH-mètre'), borrower_id: borrower, due_date: day(3) });
  assert.equal(ph.status, 409);
  const past = await tech('POST', '/api/loans', { equipment_id: equipmentId('Bec Bunsen'), borrower_id: borrower, due_date: day(-1) });
  assert.equal(past.status, 400);
  const ghost = await tech('POST', '/api/loans', { equipment_id: 99999, borrower_id: borrower, due_date: day(3) });
  assert.equal(ghost.status, 400);
});

test('les élèves ne voient que leurs emprunts ; le retard est calculé', async () => {
  const mine = (await eleve('GET', '/api/loans')).body;
  assert.equal(mine.length, 1);
  assert.equal(mine[0].borrower_name, 'Léa Moreau');
  assert.equal((await eleve('POST', '/api/loans', { equipment_id: 1, borrower_id: 1, due_date: day(3) })).status, 403);
  assert.equal((await eleve('POST', '/api/loans/1/return')).status, 403);

  const overdue = (await tech('GET', '/api/loans?status=overdue')).body;
  assert.ok(overdue.length >= 1);
  assert.ok(overdue.every((l) => l.overdue === true && l.returned_at === null));
  assert.equal((await tech('GET', '/api/loans?status=nimporte')).status, 400);
});

// ---------- Travaux pratiques ----------

test('un TP regroupe matériel, produits et dangers ; seul son auteur (ou un admin) le modifie', async () => {
  const body = {
    title: 'Test d’indicateurs colorés', subject: 'chimie', level: 'Seconde', duration_min: 60,
    equipment: [{ equipment_id: equipmentId('Bécher 250 mL'), quantity: 3 }],
    reagents: [{ reagent_id: reagentId('Acide chlorhydrique 1 mol/L'), quantity: 15 }, { reagent_id: reagentId('Acétone'), quantity: 5 }],
  };
  const created = await sophie('POST', '/api/practicals', body);
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.hazards, ['GHS02', 'GHS05', 'GHS07']);
  assert.equal(created.body.equipment[0].quantity, 3);
  const id = created.body.id;

  assert.equal((await prof('PUT', `/api/practicals/${id}`, { title: 'Volé' })).status, 403);
  assert.equal((await eleve('POST', '/api/practicals', body)).status, 403);
  assert.equal((await tech('POST', '/api/practicals', body)).status, 403);

  // La mise à jour sans listes laisse matériel et produits intacts ; avec listes, elle les remplace.
  const renamed = await sophie('PUT', `/api/practicals/${id}`, { title: 'Indicateurs colorés' });
  assert.equal(renamed.body.reagents.length, 2);
  const replaced = await admin('PUT', `/api/practicals/${id}`, { reagents: [{ reagent_id: reagentId('Acétone'), quantity: 8 }] });
  assert.equal(replaced.body.reagents.length, 1);
  assert.deepEqual(replaced.body.hazards, ['GHS02', 'GHS07']);

  const dup = await sophie('PUT', `/api/practicals/${id}`, { equipment: [
    { equipment_id: equipmentId('Bécher 250 mL'), quantity: 1 }, { equipment_id: equipmentId('Bécher 250 mL'), quantity: 2 }] });
  assert.equal(dup.status, 400);
  assert.equal((await sophie('PUT', `/api/practicals/${id}`, { equipment: [{ equipment_id: 99999, quantity: 1 }] })).status, 400);
  assert.equal((await sophie('GET', `/api/practicals/${id}`)).body.equipment.length, 1, 'une mise à jour refusée n’altère rien');

  assert.equal((await prof('DELETE', `/api/practicals/${id}`)).status, 403);
  assert.equal((await sophie('DELETE', `/api/practicals/${id}`)).status, 204);
});

// ---------- Incidents ----------

test('les élèves signalent mais ne voient et ne traitent que leurs propres incidents', async () => {
  const mine = await eleve('POST', '/api/incidents', {
    room_id: roomId('Labo Chimie A'), severity: 'high', description: 'Odeur de gaz près des becs.',
    status: 'closed', resolution: 'tentative de tricher',
  });
  assert.equal(mine.status, 201);
  assert.equal(mine.body.status, 'open', 'le statut ne se fixe pas à la création');
  assert.equal(mine.body.resolution, null);
  assert.equal(mine.body.reporter_name, 'Léa Moreau');

  const seenByStudent = (await eleve('GET', '/api/incidents')).body;
  assert.ok(seenByStudent.length >= 2 && seenByStudent.every((i) => i.reporter_name === 'Léa Moreau'));
  const seenByTech = (await tech('GET', '/api/incidents')).body;
  assert.ok(seenByTech.length > seenByStudent.length);

  assert.equal((await eleve('PUT', `/api/incidents/${mine.body.id}`, { status: 'closed' })).status, 403);
  const handled = await tech('PUT', `/api/incidents/${mine.body.id}`, { status: 'closed', resolution: 'Fuite réparée.' });
  assert.equal(handled.status, 200);
  assert.equal(handled.body.status, 'closed');
  assert.equal((await tech('DELETE', `/api/incidents/${mine.body.id}`)).status, 403);
  assert.equal((await admin('DELETE', `/api/incidents/${mine.body.id}`)).status, 204);
});

// ---------- Tableau de bord et exports ----------

test('le tableau de bord remonte les alertes de stock, péremption, retards et séances', async () => {
  const d = (await tech('GET', '/api/dashboard')).body;
  assert.deepEqual(d.alerts.lowStock.map((r) => r.name), ['Hydroxyde de sodium 1 mol/L', 'Nitrate d’argent']);
  assert.deepEqual(d.alerts.expired.map((r) => r.name), ['Bleu de méthylène']);
  assert.deepEqual(d.alerts.expiringSoon.map((r) => r.name), ['Permanganate de potassium']);
  assert.ok(d.alerts.unavailableEquipment.some((e) => e.name === 'pH-mètre'));
  assert.ok(d.alerts.overdueLoans.length >= 1);
  assert.equal(d.todayBookings.length, 2);
  assert.ok(d.counts.openIncidents >= 2);

  const s = (await eleve('GET', '/api/dashboard')).body;
  assert.equal(s.counts.openIncidents, null, 'information réservée au personnel');
  assert.equal(s.alerts.overdueLoans.length, 0, 'un élève ne voit pas les retards des autres');
});

test('l’export CSV est réservé au personnel technique et neutralise les formules', async () => {
  await tech('POST', '/api/equipment', { name: '=HYPERLINK("http://evil")', quantity: 1, notes: 'a;b' });
  assert.equal((await prof('GET', '/api/export/equipment.csv')).status, 403);
  assert.equal((await tech('GET', '/api/export/inconnu.csv')).status, 404);
  const res = await tech('GET', '/api/export/equipment.csv');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.ok(res.text.startsWith('﻿Nom;Catégorie'));
  assert.ok(res.text.includes('"\'=HYPERLINK(""http://evil"")"'), 'cellule préfixée par une apostrophe');
  assert.ok(!/(^|;)=HYPERLINK/m.test(res.text));
  const reagents = await admin('GET', '/api/export/reagents.csv');
  assert.match(reagents.text, /Acide chlorhydrique 1 mol\/L;HCl;7647-01-0;2500;mL/);
});
