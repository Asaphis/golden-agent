import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Database, type WorkspaceInvitationRecord, type WorkspaceMemberRecord } from "../../database/database.js";

const hash = (value: string): string => createHash("sha256").update(value).digest("hex");

export class WorkspaceAccessService {
  constructor(private readonly database: Database) {}

  members(workspaceId: string, userId: string): Array<WorkspaceMemberRecord & { email: string; displayName: string }> {
    this.requireRole(workspaceId, userId, ["owner", "admin", "member", "viewer"]);
    return this.database.listWorkspaceMembers(workspaceId);
  }

  invite(workspaceId: string, actorId: string, input: { email: string; role?: WorkspaceMemberRecord["role"] }): { invitation: Omit<WorkspaceInvitationRecord, "tokenHash">; token: string } {
    this.requireRole(workspaceId, actorId, ["owner", "admin"]);
    const email = input.email.trim().toLowerCase();
    const role = input.role === "admin" || input.role === "member" || input.role === "viewer" ? input.role : "member";
    const token = randomBytes(32).toString("base64url");
    const now = new Date();
    const record: WorkspaceInvitationRecord = { invitationId: randomUUID(), workspaceId, email, role, tokenHash: hash(token), status: "pending", expiresAt: new Date(now.getTime() + 7 * 86_400_000).toISOString(), createdAt: now.toISOString() };
    this.database.createWorkspaceInvitation(record);
    this.database.addAudit("workspace.invitation.created", null, { workspaceId, invitationId: record.invitationId, email, role, actorId });
    const { tokenHash: _tokenHash, ...invitation } = record;
    return { invitation, token };
  }

  accept(token: string, userId: string, email: string): WorkspaceMemberRecord {
    const invitation = this.database.getWorkspaceInvitationByToken(hash(token));
    if (!invitation || invitation.status !== "pending" || invitation.expiresAt <= new Date().toISOString() || invitation.email !== email.trim().toLowerCase()) throw new Error("INVITATION_INVALID_OR_EXPIRED");
    this.database.addWorkspaceMember({ workspaceId: invitation.workspaceId, userId, role: invitation.role, createdAt: new Date().toISOString() });
    this.database.updateWorkspaceInvitation(invitation.invitationId, "accepted");
    this.database.addAudit("workspace.invitation.accepted", null, { workspaceId: invitation.workspaceId, invitationId: invitation.invitationId, userId });
    return { workspaceId: invitation.workspaceId, userId, role: invitation.role, createdAt: new Date().toISOString() };
  }

  requireRole(workspaceId: string, userId: string, roles: WorkspaceMemberRecord["role"][]): WorkspaceMemberRecord {
    const member = this.database.getWorkspaceMember(workspaceId, userId);
    if (!member || !roles.includes(member.role)) throw new Error("WORKSPACE_ACCESS_DENIED");
    return member;
  }
}
