import { describe, expect, it } from 'vitest';
import { classifyPostgresFailure, postgresOptions } from './db.js';

describe('configuration PostgreSQL', () => {
  it('transmet un secret avec caractères réservés en champ séparé, sans construire une URI', () => {
    const opaque = `test${String.fromCharCode(64,35,47,37,58)}fin`;
    const options = postgresOptions({POSTGRES_HOST:'postgres',POSTGRES_PORT:5432,
      POSTGRES_DB:'sq_test',POSTGRES_USER:'sq_test',POSTGRES_PASSWORD:opaque});
    expect(options.password).toBe(opaque);
    expect(options).not.toHaveProperty('connectionString');
  });
  it('reconnaît un désaccord entre le mot de passe .env et celui du volume persistant sans divulgation', () => {
    const error = classifyPostgresFailure({code:'28P01',message:'un contenu sensible'});
    expect(error.code).toBe('PG_AUTH');
    expect(error.message).toContain('postgres_data');
    expect(error.message).not.toContain('un contenu sensible');
  });
  it('conserve DATABASE_URL comme option pour les outils locaux', () => {
    expect(postgresOptions({DATABASE_URL:'postgres://local/essai'}).connectionString).toBe('postgres://local/essai');
  });
});
