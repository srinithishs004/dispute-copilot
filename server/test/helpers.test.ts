import { expect, test } from 'vitest';
import { makeTestDb } from './helpers.js';

test('makeTestDb returns independent databases', async () => {
  const a = await makeTestDb();
  const b = await makeTestDb();
  await a.exec('CREATE TABLE iso_probe (n int); INSERT INTO iso_probe VALUES (1);');
  expect((await a.query('SELECT n FROM iso_probe')).rows).toHaveLength(1);
  await expect(b.query('SELECT n FROM iso_probe')).rejects.toThrow();
  await a.close();
  await b.close();
});
