// Copies the built web app (web/dist) into server/dist/web so the server can serve it.
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const from = fileURLToPath(new URL('../web/dist', import.meta.url));
const to = fileURLToPath(new URL('../server/dist/web', import.meta.url));

if (!existsSync(from)) {
  console.log('copy-web: web/dist not found, skipping');
} else {
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  console.log('copy-web: copied web/dist to server/dist/web');
}
