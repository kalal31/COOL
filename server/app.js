import express from 'express';
import { fileURLToPath } from 'node:url';
import { authenticate } from './auth.js';
import { HttpError, mapDbError } from './http.js';
import { sessionRouter } from './routes/session.js';
import { usersRouter } from './routes/users.js';
import { catalogRouters } from './routes/catalog.js';
import { practicalsRouter } from './routes/practicals.js';
import { bookingsRouter } from './routes/bookings.js';
import { loansRouter } from './routes/loans.js';
import { incidentsRouter } from './routes/incidents.js';
import { dashboardRouter } from './routes/dashboard.js';

const PUBLIC_DIR = fileURLToPath(new URL('../public/', import.meta.url));

function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
}

/**
 * Les requêtes qui modifient des données doivent porter un en-tête personnalisé :
 * un site tiers ne peut pas l'ajouter sans autorisation CORS (que nous n'accordons jamais).
 * Complète le cookie SameSite=Lax contre le CSRF.
 */
function requireAjaxHeader(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('x-requested-with') !== 'XMLHttpRequest') {
    return next(new HttpError(403, 'En-tête X-Requested-With manquant.'));
  }
  next();
}

export function createApp({ db, secureCookies = false }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(securityHeaders);

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(requireAjaxHeader);
  api.use(express.json({ limit: '100kb' }));
  api.use(authenticate(db));

  const { rooms, groups, equipment, reagents } = catalogRouters(db);
  api.use('/auth', sessionRouter(db, { secureCookies }));
  api.use('/users', usersRouter(db));
  api.use('/rooms', rooms);
  api.use('/groups', groups);
  api.use('/equipment', equipment);
  api.use('/reagents', reagents);
  api.use('/practicals', practicalsRouter(db));
  api.use('/bookings', bookingsRouter(db));
  api.use('/loans', loansRouter(db));
  api.use('/incidents', incidentsRouter(db));
  api.use('/', dashboardRouter(db));
  api.use((_req, _res, next) => next(new HttpError(404, 'Ressource inconnue.')));

  app.use('/api', api);
  app.use(express.static(PUBLIC_DIR, { index: 'index.html' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') err = new HttpError(400, 'Corps JSON invalide.');
    else if (err.type === 'entity.too.large') err = new HttpError(413, 'Requête trop volumineuse.');
    else err = mapDbError(err, req.method);

    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.message, ...(err.fields && { fields: err.fields }) });
    }
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
  });

  return app;
}
