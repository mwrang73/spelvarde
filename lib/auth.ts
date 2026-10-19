import bcrypt from "bcryptjs";

// Node-bara (bcryptjs). Importeras aldrig från middleware.ts - se lib/jwt.ts
// för sessionshantering som måste fungera i edge-runtimen.
export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, passwordHash: string) {
  return bcrypt.compare(password, passwordHash);
}
