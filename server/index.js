import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createApp } from './app.js';
import { seedIfEmpty } from './seed.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const dbFile = process.env.LAB_DB ?? fileURLToPath(new URL('../data/lab.db', import.meta.url));

const db = openDb(dbFile);
const result = await seedIfEmpty(db, {
  demo: process.env.LAB_DEMO !== '0',
  adminEmail: process.env.ADMIN_EMAIL ?? 'admin@lab.local',
  adminPassword: process.env.ADMIN_PASSWORD ?? (process.env.LAB_DEMO === '0' ? randomBytes(9).toString('base64url') : undefined),
  demoPassword: process.env.DEMO_PASSWORD ?? 'demo1234',
});

if (result?.demo) {
  console.log('\n  MODE DÉMO : base initialisée avec des données d’exemple.');
  console.log(`  Mot de passe de tous les comptes de démo : ${result.password}`);
  console.log('  Comptes : admin@lab.local, prof@lab.local, sophie@lab.local, tech@lab.local, eleve@lab.local');
  console.log('  Pour une installation réelle, supprimez data/lab.db et relancez avec LAB_DEMO=0.\n');
} else if (result) {
  console.log(`\n  Compte administrateur créé : ${result.email}`);
  console.log(`  Mot de passe : ${result.password}  (changez-le après la première connexion)\n`);
}

const app = createApp({ db, secureCookies: process.env.COOKIE_SECURE === '1' });
const server = app.listen(port, host, () => {
  console.log(`COOL – gestion de laboratoire : http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
