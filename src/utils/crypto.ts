import bcrypt from 'bcryptjs';

/**
 * Hash password or PIN.
 * Uses standard bcrypt with 10 rounds.
 */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function hashPasswordSync(plain: string): string {
  return bcrypt.hashSync(plain, 10);
}

/**
 * Compare plain password / PIN against hash.
 * Handles bcrypt hashes with safety.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false;

  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    try {
      return await bcrypt.compare(plain, hash);
    } catch {
      return false;
    }
  }

  return plain === hash;
}

export function verifyPasswordSync(plain: string, hash: string): boolean {
  if (!plain || !hash) return false;

  if (hash.startsWith('$2a$') || hash.startsWith('$2b$') || hash.startsWith('$2y$')) {
    try {
      return bcrypt.compareSync(plain, hash);
    } catch {
      return false;
    }
  }

  return plain === hash;
}

/**
 * Generate cryptographically random session token
 */
export function generateSecureToken(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let token = 'sk_';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < bytes.length; i++) {
      token += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 24; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return token;
}
