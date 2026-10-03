export class HttpError extends Error {
  constructor(status, message, fields) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

export const badRequest = (msg, fields) => new HttpError(400, msg, fields);
export const forbidden = (msg = 'Action non autorisée pour votre rôle.') => new HttpError(403, msg);
export const notFound = (msg = 'Élément introuvable.') => new HttpError(404, msg);
export const conflict = (msg) => new HttpError(409, msg);

/** Identifiant de route : entier strictement positif, sinon 404. */
export function parseId(value) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw notFound();
  return n;
}

/** Traduit les erreurs SQLite de contrainte en erreurs HTTP lisibles. */
export function mapDbError(err, method) {
  if (err instanceof HttpError) return err;
  if (err?.code !== 'ERR_SQLITE_ERROR') return err;
  switch (err.errcode) {
    case 2067: // UNIQUE
    case 1555: // PRIMARY KEY
      return conflict('Une entrée identique existe déjà.');
    case 787: // FOREIGN KEY
      return method === 'DELETE'
        ? conflict('Suppression impossible : cet élément est encore utilisé ailleurs.')
        : badRequest('Référence invalide : un élément lié n’existe pas.');
    case 275: // CHECK
      return badRequest('Valeurs incohérentes (vérifiez les quantités et les horaires).');
    default:
      return err;
  }
}
