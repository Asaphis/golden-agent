import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { Database, type SessionRecord, type UserRecord } from "../../database/database.js";

const SESSION_DAYS = 30;

function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64, { N: 16_384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function verifyPassword(password: string, encoded: string): boolean {
  const [algorithm, n, r, p, saltHex, digestHex] = encoded.split("$");
  if (algorithm !== "scrypt" || !n || !r || !p || !saltHex || !digestHex) return false;
  const expected = Buffer.from(digestHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export interface AuthenticatedSession {
  session: Omit<SessionRecord, "tokenHash">;
  user: Omit<UserRecord, "passwordHash">;
}

export class AccountService {
  constructor(private readonly database: Database) {}

  register(input: { email: string; password: string; displayName?: string }): { user: Omit<UserRecord, "passwordHash">; token: string; session: Omit<SessionRecord, "tokenHash"> } {
    const email = normalizeEmail(input.email);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("INVALID_EMAIL");
    if (input.password.length < 12) throw new Error("PASSWORD_TOO_SHORT");
    if (this.database.getUserByEmail(email)) throw new Error("EMAIL_ALREADY_REGISTERED");
    const now = new Date().toISOString();
    const user: UserRecord = { userId: randomUUID(), email, passwordHash: hashPassword(input.password), displayName: (input.displayName?.trim() || email.split("@")[0]).slice(0, 120), createdAt: now };
    this.database.createUser(user);
    this.database.addWorkspaceMember({ workspaceId: "default", userId: user.userId, role: "owner", createdAt: now });
    const session = this.issueSession(user.userId);
    this.database.addAudit("account.registered", null, { userId: user.userId });
    return { user: this.publicUser(user), ...session };
  }

  login(emailInput: string, password: string): { user: Omit<UserRecord, "passwordHash">; token: string; session: Omit<SessionRecord, "tokenHash"> } {
    const user = this.database.getUserByEmail(normalizeEmail(emailInput));
    if (!user || !verifyPassword(password, user.passwordHash)) throw new Error("INVALID_CREDENTIALS");
    const session = this.issueSession(user.userId);
    this.database.addAudit("account.login", null, { userId: user.userId, sessionId: session.session.sessionId });
    return { user: this.publicUser(user), ...session };
  }

  authenticate(token: string): AuthenticatedSession | null {
    if (!token) return null;
    const session = this.database.getSessionByTokenHash(tokenHash(token));
    if (!session || session.revokedAt || session.expiresAt <= new Date().toISOString()) return null;
    this.database.touchSession(session.sessionId, new Date().toISOString());
    const user = this.database.getUser(session.userId);
    if (!user) return null;
    return { session: this.publicSession(session), user: this.publicUser(user) };
  }

  logout(sessionId: string, userId: string): boolean { return this.database.revokeSession(sessionId, userId); }
  sessions(userId: string): Array<Omit<SessionRecord, "tokenHash">> { return this.database.listSessions(userId); }

  private issueSession(userId: string): { token: string; session: Omit<SessionRecord, "tokenHash"> } {
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const record: SessionRecord = { sessionId: randomUUID(), userId, tokenHash: tokenHash(token), expiresAt: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(), revokedAt: null, createdAt: now.toISOString(), lastSeenAt: now.toISOString() };
    this.database.createSession(record);
    return { token, session: this.publicSession(record) };
  }

  private publicUser(user: UserRecord): Omit<UserRecord, "passwordHash"> { const { passwordHash: _passwordHash, ...publicUser } = user; return publicUser; }
  private publicSession(session: SessionRecord): Omit<SessionRecord, "tokenHash"> { const { tokenHash: _tokenHash, ...publicSession } = session; return publicSession; }
}
