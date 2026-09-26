import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class AppError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const asyncRoute = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if ((error as {type?:string})?.type === 'entity.too.large') {res.status(413).json({error:'REQUÊTE_TROP_GRANDE',message:'Réduisez la taille du fichier ou de la configuration (128 Ko maximum).'});return;}
  if ((error as {type?:string})?.type === 'entity.parse.failed') {res.status(400).json({error:'JSON_INVALIDE',message:'Le contenu JSON est invalide.'});return;}
  if (error instanceof AppError) { res.status(error.status).json({ error: error.code, message: error.message }); return; }
  if (error instanceof ZodError) {
    res.status(400).json({ error: 'VALIDATION', message: 'Donnees invalides.', fields: error.issues.map(i => ({ field: i.path.join('.'), message: i.message })) }); return;
  }
  // Aucun message d'une bibliotheque HTTP / SQL ne doit fuir vers le navigateur ni les logs.
  console.error('[api] Erreur interne', { type: error instanceof Error ? error.name : 'unknown' });
  res.status(500).json({ error: 'INTERNE', message: 'Une erreur interne est survenue.' });
};
