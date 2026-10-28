import { hashPassword } from '../src/auth/session.js';

const password = process.argv[2];
if (!password) {
  console.error("Usage: npm run hash-password -w server -- '<password>'");
  process.exit(1);
}
console.log(await hashPassword(password));
