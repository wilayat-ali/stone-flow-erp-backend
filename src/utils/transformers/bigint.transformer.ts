import { ValueTransformer } from 'typeorm';

// Postgres returns bigint columns as strings. Money is whole PKR and stays far
// below Number.MAX_SAFE_INTEGER, so a plain number is safe in the app.
export const bigintTransformer: ValueTransformer = {
  to: (value?: number | null) => value,
  from: (value?: string | null) =>
    value === null || value === undefined ? value : Number(value),
};
