import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { DEFAULT_MEMBER_ROLE, normalizeMemberRole, type MemberRole } from "./roles.js";

export interface StoredSkill {
  key: string;
  name: string;
  value: number;
}

export interface SkillInput {
  key: string;
  name: string;
  value: number;
}

export interface NarrativeEventInput {
  kind: string;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  actorName?: string;
  inputText?: string;
  outputText: string;
  metadata?: Record<string, unknown>;
}

export interface StoredNarrativeEvent {
  id: number;
  kind: string;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  actorName?: string;
  inputText?: string;
  outputText: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type ChatAuditDirection = "incoming" | "outgoing";

export interface ChatAuditInput {
  direction: ChatAuditDirection;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId?: string;
  messageId?: string;
  eventType?: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface StoredChatAuditEntry {
  id: number;
  direction: ChatAuditDirection;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId?: string;
  messageId?: string;
  eventType?: string;
  content: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecentChatAuditQuery {
  scopeType?: "group" | "c2c";
  scopeId?: string;
  direction?: ChatAuditDirection;
  limit: number;
}

export interface RecentNarrativeEventQuery {
  scopeType: "group" | "c2c";
  scopeId: string;
  kind?: string;
  limit: number;
}

export interface PrivateGroupBinding {
  privateUserId: string;
  groupOpenid: string;
  groupUserId?: string;
  role: MemberRole;
  updatedAt: string;
}

export interface PrivateMessagePermission {
  privateUserId: string;
  enabled: boolean;
  activeMessagesAllowed: boolean;
  lastPrivateActivityAtMs?: number;
  updatedAt: string;
}

export interface PrivateGroupRecipient {
  privateUserId: string;
  groupOpenid: string;
  groupUserId: string;
  privateMessagesEnabled: boolean;
  activeMessagesAllowed: boolean;
  lastPrivateActivityAtMs?: number;
}

export interface ContextBindingCode {
  code: string;
  groupOpenid: string;
  groupUserId: string;
  expiresAtMs: number;
  role?: MemberRole;
}

export interface StoredMemberRole {
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  role: MemberRole;
  updatedByUserId?: string;
  updatedAt: string;
}

export interface PlayerMemoryInput {
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  category?: string;
  memoryText: string;
  usageHint?: string;
  sourceKind?: string;
  metadata?: Record<string, unknown>;
}

export interface StoredPlayerMemory {
  id: number;
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  category: string;
  memoryText: string;
  usageHint?: string;
  sourceKind?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RecentPlayerMemoryQuery {
  scopeType: "group" | "c2c";
  scopeId: string;
  userId: string;
  limit: number;
}

export interface RecentScopePlayerMemoryQuery {
  scopeType: "group" | "c2c";
  scopeId: string;
  excludeUserId?: string;
  limit: number;
}

export interface PrivateOutboxMessageInput {
  privateUserId: string;
  groupOpenid: string;
  groupUserId?: string;
  sourceKind: string;
  actorName?: string;
  content: string;
  createdByUserId: string;
  metadata?: Record<string, unknown>;
}

export interface StoredPrivateOutboxMessage {
  id: number;
  privateUserId: string;
  groupOpenid: string;
  groupUserId?: string;
  sourceKind: string;
  actorName?: string;
  content: string;
  status: "pending" | "sent";
  createdByUserId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  sentAt?: string;
}

export interface PrivateDeliveryInput {
  privateUserId: string;
  groupOpenid: string;
  groupUserId?: string;
  sourceKind: string;
  sentAtMs?: number;
}

export interface ProactiveGroupSettings {
  groupOpenid: string;
  enabled: boolean;
  moduleId?: string;
  moduleName?: string;
  flavorText?: string;
  updatedByUserId?: string;
  updatedAt: string;
}

export interface ProactiveGroupSettingsInput {
  groupOpenid: string;
  enabled: boolean;
  moduleId?: string | null;
  moduleName?: string | null;
  flavorText?: string | null;
  updatedByUserId?: string;
}

export type PersonaCardRole = "bot" | "npc" | "narrator";

export interface PersonaCardInput {
  id?: string;
  name: string;
  role?: PersonaCardRole;
  publicDescription?: string;
  privateNotes?: string;
  speechStyle?: string;
  knowledgeBoundary?: string;
  exampleDialogues?: string[];
  avoidRules?: string;
  patiencePolicy?: string;
  agencyRules?: string;
  abnormalInputPolicy?: string;
  tableBoundaryPolicy?: string;
  anchorStyle?: string;
  continuityRepairPolicy?: string;
  tags?: string[];
}

export interface StoredPersonaCard extends Required<PersonaCardInput> {
  id: string;
  role: PersonaCardRole;
  createdAt: string;
  updatedAt: string;
}

export interface TrainingExampleInput {
  id?: string;
  npcName: string;
  issueType?: string;
  badReply?: string;
  correction?: string;
  goodReply?: string;
  score?: number | null;
  tags?: string[];
}

export interface StoredTrainingExample extends Required<Omit<TrainingExampleInput, "score">> {
  id: string;
  issueType: string;
  score?: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface TrainingExampleQuery {
  npcName?: string;
  limit?: number;
}

export type MemoryAnchorScopeType = "campaign" | "session" | "scene" | "npc";
export type MemoryAnchorType = "time" | "location" | "object" | "person" | "event" | "contradiction";
export type MemoryAnchorSourceType = "worldbook" | "chat" | "kp-note" | "training" | "model-draft";
export type MemoryAnchorVisibility = "player" | "kp";
export type MemoryAnchorStatus = "confirmed" | "candidate" | "rejected";

export interface MemoryAnchorInput {
  id?: string;
  scopeType?: MemoryAnchorScopeType;
  scopeId?: string;
  npcName?: string;
  anchorType?: MemoryAnchorType;
  label: string;
  content: string;
  sourceMessageId?: string;
  sourceType?: MemoryAnchorSourceType;
  visibility?: MemoryAnchorVisibility;
  status?: MemoryAnchorStatus;
}

export interface StoredMemoryAnchor extends Required<Omit<MemoryAnchorInput, "sourceMessageId">> {
  id: string;
  scopeType: MemoryAnchorScopeType;
  anchorType: MemoryAnchorType;
  sourceType: MemoryAnchorSourceType;
  visibility: MemoryAnchorVisibility;
  status: MemoryAnchorStatus;
  sourceMessageId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryAnchorQuery {
  npcName?: string;
  scopeType?: MemoryAnchorScopeType;
  scopeId?: string;
  visibility?: MemoryAnchorVisibility;
  status?: MemoryAnchorStatus;
  limit?: number;
}

export class BotStorage {
  private readonly db: DatabaseSync;

  constructor(databasePath: string) {
    if (databasePath !== ":memory:") {
      fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    }
    this.db = new DatabaseSync(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  markMessageProcessed(messageId: string): boolean {
    const result = this.db.prepare(
      "INSERT OR IGNORE INTO processed_messages (message_id, created_at) VALUES (?, datetime('now'))"
    ).run(messageId);
    return result.changes > 0;
  }

  isMessageProcessed(messageId: string): boolean {
    const row = this.db.prepare(
      "SELECT 1 FROM processed_messages WHERE message_id = ?"
    ).get(messageId);
    return row != null;
  }

  recordChatAudit(entry: ChatAuditInput): number | undefined {
    const scopeId = entry.scopeId.trim();
    if (scopeId === "") return undefined;

    const result = this.db.prepare(`
      INSERT INTO chat_audit_log
        (direction, scope_type, scope_id, user_id, message_id, event_type, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      entry.direction,
      entry.scopeType,
      scopeId,
      entry.userId?.trim() || null,
      entry.messageId?.trim() || null,
      entry.eventType?.trim() || null,
      entry.content.trim(),
      JSON.stringify(entry.metadata ?? {})
    );
    return Number(result.lastInsertRowid);
  }

  getRecentChatAuditEntries(query: RecentChatAuditQuery): StoredChatAuditEntry[] {
    const limit = Math.max(1, Math.floor(query.limit));
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];

    if (query.scopeType) {
      conditions.push("scope_type = ?");
      params.push(query.scopeType);
    }
    if (query.scopeId != null && query.scopeId.trim() !== "") {
      conditions.push("scope_id = ?");
      params.push(query.scopeId.trim());
    }
    if (query.direction) {
      conditions.push("direction = ?");
      params.push(query.direction);
    }

    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(`
      SELECT
        id,
        direction,
        scope_type as scopeType,
        scope_id as scopeId,
        user_id as userId,
        message_id as messageId,
        event_type as eventType,
        content,
        metadata_json as metadataJson,
        created_at as createdAt
      FROM chat_audit_log
      ${where}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params, limit) as unknown as Array<Omit<StoredChatAuditEntry, "metadata" | "direction"> & {
      direction: ChatAuditDirection;
      metadataJson: string | null;
    }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      direction: row.direction,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      userId: row.userId ?? undefined,
      messageId: row.messageId ?? undefined,
      eventType: row.eventType ?? undefined,
      content: row.content,
      metadata: parseMetadata(row.metadataJson),
      createdAt: row.createdAt
    }));
  }

  addProactiveLine(groupOpenid: string, text: string): void {
    const normalized = text.trim();
    if (normalized === "") return;

    this.db.prepare(`
      INSERT INTO proactive_story_lines (group_openid, line_text, created_at)
      VALUES (?, ?, datetime('now'))
    `).run(groupOpenid, normalized);

    this.db.prepare(`
      DELETE FROM proactive_story_lines
      WHERE group_openid = ?
        AND id NOT IN (
          SELECT id
          FROM proactive_story_lines
          WHERE group_openid = ?
          ORDER BY id DESC
          LIMIT 50
        )
    `).run(groupOpenid, groupOpenid);
  }

  getRecentProactiveLines(groupOpenid: string, limit: number): string[] {
    const rows = this.db.prepare(`
      SELECT line_text as text
      FROM proactive_story_lines
      WHERE group_openid = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(groupOpenid, limit) as unknown as { text: string }[];
    return rows.reverse().map((row) => row.text);
  }

  getProactiveLineCount(groupOpenid: string): number {
    const row = this.db.prepare(`
      SELECT count(*) as count
      FROM proactive_story_lines
      WHERE group_openid = ?
    `).get(groupOpenid) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  setProactiveGroupSettings(input: ProactiveGroupSettingsInput): void {
    const groupOpenid = input.groupOpenid.trim();
    if (groupOpenid === "") return;

    this.db.prepare(`
      INSERT INTO proactive_group_settings
        (group_openid, enabled, module_id, module_name, flavor_text, updated_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(group_openid)
      DO UPDATE SET
        enabled = excluded.enabled,
        module_id = excluded.module_id,
        module_name = excluded.module_name,
        flavor_text = excluded.flavor_text,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = datetime('now')
    `).run(
      groupOpenid,
      input.enabled ? 1 : 0,
      normalizeOptionalStorageText(input.moduleId),
      normalizeOptionalStorageText(input.moduleName),
      normalizeOptionalStorageText(input.flavorText),
      normalizeOptionalStorageText(input.updatedByUserId)
    );
  }

  getProactiveGroupSettings(groupOpenid: string): ProactiveGroupSettings | undefined {
    const row = this.db.prepare(`
      SELECT
        group_openid as groupOpenid,
        enabled,
        module_id as moduleId,
        module_name as moduleName,
        flavor_text as flavorText,
        updated_by_user_id as updatedByUserId,
        updated_at as updatedAt
      FROM proactive_group_settings
      WHERE group_openid = ?
    `).get(groupOpenid.trim()) as (Omit<ProactiveGroupSettings, "enabled"> & { enabled: number }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      enabled: row.enabled === 1,
      moduleId: row.moduleId ?? undefined,
      moduleName: row.moduleName ?? undefined,
      flavorText: row.flavorText ?? undefined,
      updatedByUserId: row.updatedByUserId ?? undefined
    };
  }

  getEnabledProactiveGroups(): string[] {
    const rows = this.db.prepare(`
      SELECT group_openid as groupOpenid
      FROM proactive_group_settings
      WHERE enabled = 1
      ORDER BY updated_at ASC
    `).all() as unknown as { groupOpenid: string }[];
    return rows.map((row) => row.groupOpenid);
  }

  setPrivateGroupBinding(privateUserId: string, groupOpenid: string, groupUserId?: string, role?: MemberRole): void {
    const normalizedPrivateUserId = privateUserId.trim();
    const normalizedGroupOpenid = groupOpenid.trim();
    const normalizedGroupUserId = groupUserId?.trim() || null;
    const normalizedRole = role ?? (
      normalizedGroupUserId
        ? this.getMemberRole("group", normalizedGroupOpenid, normalizedGroupUserId) ?? DEFAULT_MEMBER_ROLE
        : DEFAULT_MEMBER_ROLE
    );
    if (normalizedPrivateUserId === "" || normalizedGroupOpenid === "") return;

    this.db.prepare(`
      INSERT INTO private_group_bindings
        (private_user_id, group_openid, group_user_id, role, updated_at)
      VALUES (?, ?, ?, ?, datetime('now'))
      ON CONFLICT(private_user_id)
      DO UPDATE SET
        group_openid = excluded.group_openid,
        group_user_id = excluded.group_user_id,
        role = excluded.role,
        updated_at = datetime('now')
    `).run(normalizedPrivateUserId, normalizedGroupOpenid, normalizedGroupUserId, normalizedRole);

    if (normalizedGroupUserId) {
      this.setMemberRole("group", normalizedGroupOpenid, normalizedGroupUserId, normalizedRole, normalizedGroupUserId);
    }
  }

  getPrivateGroupBinding(privateUserId: string): PrivateGroupBinding | undefined {
    const row = this.db.prepare(`
      SELECT
        private_group_bindings.private_user_id as privateUserId,
        private_group_bindings.group_openid as groupOpenid,
        private_group_bindings.group_user_id as groupUserId,
        COALESCE(member_roles.role, private_group_bindings.role, ?) as role,
        private_group_bindings.updated_at as updatedAt
      FROM private_group_bindings
      LEFT JOIN member_roles
        ON member_roles.scope_type = 'group'
        AND member_roles.scope_id = private_group_bindings.group_openid
        AND member_roles.user_id = private_group_bindings.group_user_id
      WHERE private_user_id = ?
    `).get(DEFAULT_MEMBER_ROLE, privateUserId) as PrivateGroupBinding | undefined;
    return row == null
      ? undefined
      : {
          ...row,
          role: normalizeMemberRole(row.role) ?? DEFAULT_MEMBER_ROLE,
          groupUserId: row.groupUserId ?? undefined
        };
  }

  clearPrivateGroupBinding(privateUserId: string): boolean {
    const result = this.db.prepare(`
      DELETE FROM private_group_bindings
      WHERE private_user_id = ?
    `).run(privateUserId);
    return result.changes > 0;
  }

  recordPrivateActivity(privateUserId: string, atMs = Date.now()): void {
    const normalizedPrivateUserId = privateUserId.trim();
    if (normalizedPrivateUserId === "") return;

    this.db.prepare(`
      INSERT INTO private_message_permissions
        (private_user_id, enabled, active_messages_allowed, last_private_activity_at_ms, updated_at)
      VALUES (?, 0, 1, ?, datetime('now'))
      ON CONFLICT(private_user_id)
      DO UPDATE SET
        active_messages_allowed = 1,
        last_private_activity_at_ms = excluded.last_private_activity_at_ms,
        updated_at = datetime('now')
    `).run(normalizedPrivateUserId, atMs);
  }

  setPrivateMessagingEnabled(privateUserId: string, enabled: boolean, atMs = Date.now()): void {
    const normalizedPrivateUserId = privateUserId.trim();
    if (normalizedPrivateUserId === "") return;

    this.db.prepare(`
      INSERT INTO private_message_permissions
        (private_user_id, enabled, active_messages_allowed, last_private_activity_at_ms, updated_at)
      VALUES (?, ?, 1, ?, datetime('now'))
      ON CONFLICT(private_user_id)
      DO UPDATE SET
        enabled = excluded.enabled,
        active_messages_allowed = CASE WHEN excluded.enabled = 1 THEN 1 ELSE active_messages_allowed END,
        last_private_activity_at_ms = CASE
          WHEN excluded.enabled = 1 THEN excluded.last_private_activity_at_ms
          ELSE last_private_activity_at_ms
        END,
        updated_at = datetime('now')
    `).run(normalizedPrivateUserId, enabled ? 1 : 0, atMs);
  }

  setPrivateActiveMessagesAllowed(privateUserId: string, allowed: boolean): void {
    const normalizedPrivateUserId = privateUserId.trim();
    if (normalizedPrivateUserId === "") return;

    this.db.prepare(`
      INSERT INTO private_message_permissions
        (private_user_id, enabled, active_messages_allowed, last_private_activity_at_ms, updated_at)
      VALUES (?, 0, ?, NULL, datetime('now'))
      ON CONFLICT(private_user_id)
      DO UPDATE SET
        active_messages_allowed = excluded.active_messages_allowed,
        updated_at = datetime('now')
    `).run(normalizedPrivateUserId, allowed ? 1 : 0);
  }

  getPrivateMessagePermission(privateUserId: string): PrivateMessagePermission | undefined {
    const row = this.db.prepare(`
      SELECT
        private_user_id as privateUserId,
        enabled,
        active_messages_allowed as activeMessagesAllowed,
        last_private_activity_at_ms as lastPrivateActivityAtMs,
        updated_at as updatedAt
      FROM private_message_permissions
      WHERE private_user_id = ?
    `).get(privateUserId.trim()) as (Omit<PrivateMessagePermission, "enabled" | "activeMessagesAllowed"> & {
      enabled: number;
      activeMessagesAllowed: number;
    }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      enabled: row.enabled === 1,
      activeMessagesAllowed: row.activeMessagesAllowed === 1,
      lastPrivateActivityAtMs: row.lastPrivateActivityAtMs ?? undefined
    };
  }

  getPrivateRecipientByGroupMember(groupOpenid: string, groupUserId: string): PrivateGroupRecipient | undefined {
    const row = this.db.prepare(`
      SELECT
        private_group_bindings.private_user_id as privateUserId,
        private_group_bindings.group_openid as groupOpenid,
        private_group_bindings.group_user_id as groupUserId,
        COALESCE(private_message_permissions.enabled, 0) as privateMessagesEnabled,
        COALESCE(private_message_permissions.active_messages_allowed, 1) as activeMessagesAllowed,
        private_message_permissions.last_private_activity_at_ms as lastPrivateActivityAtMs
      FROM private_group_bindings
      LEFT JOIN private_message_permissions
        ON private_message_permissions.private_user_id = private_group_bindings.private_user_id
      WHERE private_group_bindings.group_openid = ?
        AND private_group_bindings.group_user_id = ?
      ORDER BY private_group_bindings.updated_at DESC
      LIMIT 1
    `).get(groupOpenid.trim(), groupUserId.trim()) as (Omit<
      PrivateGroupRecipient,
      "privateMessagesEnabled" | "activeMessagesAllowed"
    > & {
      privateMessagesEnabled: number;
      activeMessagesAllowed: number;
    }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      privateMessagesEnabled: row.privateMessagesEnabled === 1,
      activeMessagesAllowed: row.activeMessagesAllowed === 1,
      lastPrivateActivityAtMs: row.lastPrivateActivityAtMs ?? undefined
    };
  }

  setMemberRole(
    scopeType: "group" | "c2c",
    scopeId: string,
    userId: string,
    role: MemberRole,
    updatedByUserId?: string
  ): void {
    const normalizedScopeId = scopeId.trim();
    const normalizedUserId = userId.trim();
    if (normalizedScopeId === "" || normalizedUserId === "") return;

    this.db.prepare(`
      INSERT INTO member_roles
        (scope_type, scope_id, user_id, role, updated_by_user_id, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope_type, scope_id, user_id)
      DO UPDATE SET
        role = excluded.role,
        updated_by_user_id = excluded.updated_by_user_id,
        updated_at = datetime('now')
    `).run(scopeType, normalizedScopeId, normalizedUserId, role, updatedByUserId?.trim() || null);
  }

  getMemberRole(scopeType: "group" | "c2c", scopeId: string, userId: string): MemberRole | undefined {
    const row = this.db.prepare(`
      SELECT role
      FROM member_roles
      WHERE scope_type = ? AND scope_id = ? AND user_id = ?
    `).get(scopeType, scopeId.trim(), userId.trim()) as { role: string } | undefined;
    return normalizeMemberRole(row?.role);
  }

  getStoredMemberRole(scopeType: "group" | "c2c", scopeId: string, userId: string): StoredMemberRole | undefined {
    const row = this.db.prepare(`
      SELECT
        scope_type as scopeType,
        scope_id as scopeId,
        user_id as userId,
        role,
        updated_by_user_id as updatedByUserId,
        updated_at as updatedAt
      FROM member_roles
      WHERE scope_type = ? AND scope_id = ? AND user_id = ?
    `).get(scopeType, scopeId.trim(), userId.trim()) as (Omit<StoredMemberRole, "role"> & { role: string }) | undefined;
    if (!row) return undefined;
    return {
      ...row,
      role: normalizeMemberRole(row.role) ?? DEFAULT_MEMBER_ROLE,
      updatedByUserId: row.updatedByUserId ?? undefined
    };
  }

  scopeHasRole(scopeType: "group" | "c2c", scopeId: string, role: MemberRole): boolean {
    const row = this.db.prepare(`
      SELECT 1
      FROM member_roles
      WHERE scope_type = ? AND scope_id = ? AND role = ?
      LIMIT 1
    `).get(scopeType, scopeId.trim(), role);
    return row != null;
  }

  createContextBindingCode(input: ContextBindingCode): void {
    const code = input.code.trim().toLowerCase();
    const groupOpenid = input.groupOpenid.trim();
    const groupUserId = input.groupUserId.trim();
    const role = input.role ?? DEFAULT_MEMBER_ROLE;
    if (code === "" || groupOpenid === "" || groupUserId === "") return;

    this.db.prepare(`
      INSERT OR REPLACE INTO context_binding_codes
        (code, group_openid, group_user_id, role, expires_at_ms, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(code, groupOpenid, groupUserId, role, input.expiresAtMs);
  }

  consumeContextBindingCode(code: string, nowMs = Date.now()): ContextBindingCode | undefined {
    const normalizedCode = code.trim().toLowerCase();
    if (normalizedCode === "") return undefined;

    this.db.prepare(`
      DELETE FROM context_binding_codes
      WHERE expires_at_ms <= ?
    `).run(nowMs);

    const row = this.db.prepare(`
      SELECT
        code,
        group_openid as groupOpenid,
        group_user_id as groupUserId,
        expires_at_ms as expiresAtMs,
        role
      FROM context_binding_codes
      WHERE code = ? AND expires_at_ms > ?
    `).get(normalizedCode, nowMs) as ContextBindingCode | undefined;
    if (!row) return undefined;

    this.db.prepare(`
      DELETE FROM context_binding_codes
      WHERE code = ?
    `).run(normalizedCode);
    return {
      ...row,
      role: normalizeMemberRole(row.role) ?? DEFAULT_MEMBER_ROLE
    };
  }

  addTableMessage(groupOpenid: string, userId: string, text: string): void {
    const normalized = text.trim();
    if (normalized === "") return;

    this.db.prepare(`
      INSERT INTO narrative_events
        (kind, scope_type, scope_id, user_id, actor_name, input_text, output_text, metadata_json, created_at)
      VALUES ('table_message', 'group', ?, ?, NULL, ?, ?, '{"source":"group_message"}', datetime('now'))
    `).run(groupOpenid, userId, normalized, normalized);

    this.db.prepare(`
      DELETE FROM narrative_events
      WHERE scope_type = 'group'
        AND scope_id = ?
        AND kind = 'table_message'
        AND id NOT IN (
          SELECT id
          FROM narrative_events
          WHERE scope_type = 'group'
            AND scope_id = ?
            AND kind = 'table_message'
          ORDER BY id DESC
          LIMIT 100
        )
    `).run(groupOpenid, groupOpenid);
  }

  listPersonaCards(): StoredPersonaCard[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM persona_cards
      ORDER BY lower(name), updated_at DESC
    `).all() as unknown as StoredPersonaCardRow[];
    return rows.map(mapPersonaCardRow);
  }

  getPersonaCard(id: string): StoredPersonaCard | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM persona_cards
      WHERE id = ?
    `).get(id.trim()) as StoredPersonaCardRow | undefined;
    return row ? mapPersonaCardRow(row) : undefined;
  }

  getPersonaCardByName(name: string): StoredPersonaCard | undefined {
    const normalizedName = name.trim();
    if (normalizedName === "") return undefined;
    const row = this.db.prepare(`
      SELECT *
      FROM persona_cards
      WHERE lower(name) = lower(?)
      ORDER BY updated_at DESC
      LIMIT 1
    `).get(normalizedName) as StoredPersonaCardRow | undefined;
    return row ? mapPersonaCardRow(row) : undefined;
  }

  savePersonaCard(input: PersonaCardInput): StoredPersonaCard {
    const name = input.name.trim();
    if (name === "") throw new Error("人格卡名称不能为空");
    const existing = input.id ? undefined : this.getPersonaCardByName(name);
    const id = input.id?.trim() || existing?.id || crypto.randomUUID();
    const role = normalizePersonaRole(input.role);

    this.db.prepare(`
      INSERT INTO persona_cards
        (
          id,
          name,
          role,
          public_description,
          private_notes,
          speech_style,
          knowledge_boundary,
          example_dialogues_json,
          avoid_rules,
          patience_policy,
          agency_rules,
          abnormal_input_policy,
          table_boundary_policy,
          anchor_style,
          continuity_repair_policy,
          tags_json,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id)
      DO UPDATE SET
        name = excluded.name,
        role = excluded.role,
        public_description = excluded.public_description,
        private_notes = excluded.private_notes,
        speech_style = excluded.speech_style,
        knowledge_boundary = excluded.knowledge_boundary,
        example_dialogues_json = excluded.example_dialogues_json,
        avoid_rules = excluded.avoid_rules,
        patience_policy = excluded.patience_policy,
        agency_rules = excluded.agency_rules,
        abnormal_input_policy = excluded.abnormal_input_policy,
        table_boundary_policy = excluded.table_boundary_policy,
        anchor_style = excluded.anchor_style,
        continuity_repair_policy = excluded.continuity_repair_policy,
        tags_json = excluded.tags_json,
        updated_at = datetime('now')
    `).run(
      id,
      name,
      role,
      input.publicDescription?.trim() ?? "",
      input.privateNotes?.trim() ?? "",
      input.speechStyle?.trim() ?? "",
      input.knowledgeBoundary?.trim() ?? "",
      JSON.stringify(normalizeStringList(input.exampleDialogues)),
      input.avoidRules?.trim() ?? "",
      input.patiencePolicy?.trim() ?? "",
      input.agencyRules?.trim() ?? "",
      input.abnormalInputPolicy?.trim() ?? "",
      input.tableBoundaryPolicy?.trim() ?? "",
      input.anchorStyle?.trim() ?? "",
      input.continuityRepairPolicy?.trim() ?? "",
      JSON.stringify(normalizeStringList(input.tags))
    );

    const saved = this.getPersonaCard(id);
    if (!saved) throw new Error("保存人格卡失败");
    return saved;
  }

  getTrainingExamples(query: TrainingExampleQuery = {}): StoredTrainingExample[] {
    const limit = Math.max(1, Math.floor(query.limit ?? 80));
    const npcName = query.npcName?.trim();
    const rows = npcName
      ? this.db.prepare(`
          SELECT *
          FROM rp_training_examples
          WHERE lower(npc_name) = lower(?)
          ORDER BY id DESC
          LIMIT ?
        `).all(npcName, limit)
      : this.db.prepare(`
          SELECT *
          FROM rp_training_examples
          ORDER BY id DESC
          LIMIT ?
        `).all(limit);
    return (rows as unknown as StoredTrainingExampleRow[]).reverse().map(mapTrainingExampleRow);
  }

  saveTrainingExample(input: TrainingExampleInput): StoredTrainingExample {
    const npcName = input.npcName.trim();
    if (npcName === "") throw new Error("训练样本 NPC 名称不能为空");
    const id = input.id?.trim() || crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO rp_training_examples
        (
          id,
          npc_name,
          issue_type,
          bad_reply,
          correction,
          good_reply,
          score,
          tags_json,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id)
      DO UPDATE SET
        npc_name = excluded.npc_name,
        issue_type = excluded.issue_type,
        bad_reply = excluded.bad_reply,
        correction = excluded.correction,
        good_reply = excluded.good_reply,
        score = excluded.score,
        tags_json = excluded.tags_json,
        updated_at = datetime('now')
    `).run(
      id,
      npcName,
      input.issueType?.trim() || "未分类",
      input.badReply?.trim() ?? "",
      input.correction?.trim() ?? "",
      input.goodReply?.trim() ?? "",
      input.score == null ? null : Math.max(0, Math.min(10, Math.floor(input.score))),
      JSON.stringify(normalizeStringList(input.tags))
    );

    const saved = this.getTrainingExample(id);
    if (!saved) throw new Error("保存训练样本失败");
    return saved;
  }

  getTrainingExample(id: string): StoredTrainingExample | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM rp_training_examples
      WHERE id = ?
    `).get(id.trim()) as StoredTrainingExampleRow | undefined;
    return row ? mapTrainingExampleRow(row) : undefined;
  }

  getMemoryAnchors(query: MemoryAnchorQuery = {}): StoredMemoryAnchor[] {
    const limit = Math.max(1, Math.floor(query.limit ?? 120));
    const conditions: string[] = [];
    const params: SQLInputValue[] = [];
    if (query.npcName?.trim()) {
      conditions.push("lower(npc_name) = lower(?)");
      params.push(query.npcName.trim());
    }
    if (query.scopeType) {
      conditions.push("scope_type = ?");
      params.push(query.scopeType);
    }
    if (query.scopeId?.trim()) {
      conditions.push("scope_id = ?");
      params.push(query.scopeId.trim());
    }
    if (query.visibility) {
      conditions.push("visibility = ?");
      params.push(query.visibility);
    }
    if (query.status) {
      conditions.push("status = ?");
      params.push(query.status);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.db.prepare(`
      SELECT *
      FROM rp_memory_anchors
      ${where}
      ORDER BY id DESC
      LIMIT ?
    `).all(...params, limit) as unknown as StoredMemoryAnchorRow[];
    return rows.reverse().map(mapMemoryAnchorRow);
  }

  saveMemoryAnchor(input: MemoryAnchorInput): StoredMemoryAnchor {
    const label = input.label.trim();
    const content = input.content.trim();
    if (label === "" || content === "") throw new Error("记忆锚点标题和内容不能为空");
    const id = input.id?.trim() || crypto.randomUUID();
    this.db.prepare(`
      INSERT INTO rp_memory_anchors
        (
          id,
          scope_type,
          scope_id,
          npc_name,
          anchor_type,
          label,
          content,
          source_message_id,
          source_type,
          visibility,
          status,
          created_at,
          updated_at
        )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      ON CONFLICT(id)
      DO UPDATE SET
        scope_type = excluded.scope_type,
        scope_id = excluded.scope_id,
        npc_name = excluded.npc_name,
        anchor_type = excluded.anchor_type,
        label = excluded.label,
        content = excluded.content,
        source_message_id = excluded.source_message_id,
        source_type = excluded.source_type,
        visibility = excluded.visibility,
        status = excluded.status,
        updated_at = datetime('now')
    `).run(
      id,
      normalizeMemoryAnchorScopeType(input.scopeType),
      input.scopeId?.trim() ?? "",
      input.npcName?.trim() ?? "",
      normalizeMemoryAnchorType(input.anchorType),
      label,
      content,
      input.sourceMessageId?.trim() || null,
      normalizeMemoryAnchorSourceType(input.sourceType),
      normalizeMemoryAnchorVisibility(input.visibility),
      normalizeMemoryAnchorStatus(input.status)
    );

    const saved = this.getMemoryAnchor(id);
    if (!saved) throw new Error("保存记忆锚点失败");
    return saved;
  }

  getMemoryAnchor(id: string): StoredMemoryAnchor | undefined {
    const row = this.db.prepare(`
      SELECT *
      FROM rp_memory_anchors
      WHERE id = ?
    `).get(id.trim()) as StoredMemoryAnchorRow | undefined;
    return row ? mapMemoryAnchorRow(row) : undefined;
  }

  addPlayerMemory(memory: PlayerMemoryInput): boolean {
    const memoryText = normalizeMemoryText(memory.memoryText);
    const usageHint = normalizeMemoryText(memory.usageHint ?? "");
    if (memoryText === "") return false;

    const result = this.db.prepare(`
      INSERT OR IGNORE INTO player_memories
        (scope_type, scope_id, user_id, category, memory_text, usage_hint, source_kind, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      memory.scopeType,
      memory.scopeId,
      memory.userId,
      memory.category?.trim() || "玩家记忆",
      memoryText,
      usageHint === "" ? null : usageHint,
      memory.sourceKind?.trim() || null,
      JSON.stringify(memory.metadata ?? {})
    );

    if (result.changes <= 0) return false;

    this.db.prepare(`
      DELETE FROM player_memories
      WHERE scope_type = ?
        AND scope_id = ?
        AND user_id = ?
        AND id NOT IN (
          SELECT id
          FROM player_memories
          WHERE scope_type = ?
            AND scope_id = ?
            AND user_id = ?
          ORDER BY id DESC
          LIMIT 80
        )
    `).run(memory.scopeType, memory.scopeId, memory.userId, memory.scopeType, memory.scopeId, memory.userId);

    return true;
  }

  addPrivateOutboxMessage(input: PrivateOutboxMessageInput): number | undefined {
    const privateUserId = input.privateUserId.trim();
    const groupOpenid = input.groupOpenid.trim();
    const content = input.content.trim();
    const createdByUserId = input.createdByUserId.trim();
    if (privateUserId === "" || groupOpenid === "" || content === "" || createdByUserId === "") return undefined;

    const result = this.db.prepare(`
      INSERT INTO private_message_outbox
        (
          private_user_id,
          group_openid,
          group_user_id,
          source_kind,
          actor_name,
          content,
          status,
          created_by_user_id,
          metadata_json,
          created_at,
          sent_at
        )
      VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), NULL)
    `).run(
      privateUserId,
      groupOpenid,
      input.groupUserId?.trim() || null,
      input.sourceKind.trim() || "private_message",
      input.actorName?.trim() || null,
      content,
      createdByUserId,
      JSON.stringify(input.metadata ?? {})
    );
    return Number(result.lastInsertRowid);
  }

  markPrivateOutboxSent(id: number): boolean {
    const result = this.db.prepare(`
      UPDATE private_message_outbox
      SET status = 'sent',
          sent_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `).run(id);
    return result.changes > 0;
  }

  markPrivateOutboxMessagesSent(ids: readonly number[]): number {
    if (ids.length === 0) return 0;
    const statement = this.db.prepare(`
      UPDATE private_message_outbox
      SET status = 'sent',
          sent_at = datetime('now')
      WHERE id = ? AND status = 'pending'
    `);
    let changed = 0;
    this.db.exec("BEGIN");
    try {
      for (const id of ids) {
        changed += Number(statement.run(id).changes);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return changed;
  }

  getPendingPrivateOutboxMessages(privateUserId: string, limit: number): StoredPrivateOutboxMessage[] {
    const rows = this.db.prepare(`
      SELECT
        id,
        private_user_id as privateUserId,
        group_openid as groupOpenid,
        group_user_id as groupUserId,
        source_kind as sourceKind,
        actor_name as actorName,
        content,
        status,
        created_by_user_id as createdByUserId,
        metadata_json as metadataJson,
        created_at as createdAt,
        sent_at as sentAt
      FROM private_message_outbox
      WHERE private_user_id = ?
        AND status = 'pending'
      ORDER BY id ASC
      LIMIT ?
    `).all(privateUserId.trim(), Math.max(1, Math.floor(limit))) as unknown as Array<
      Omit<StoredPrivateOutboxMessage, "metadata" | "status"> & {
        status: "pending" | "sent";
        metadataJson: string | null;
      }
    >;
    return rows.map((row) => ({
      id: row.id,
      privateUserId: row.privateUserId,
      groupOpenid: row.groupOpenid,
      groupUserId: row.groupUserId ?? undefined,
      sourceKind: row.sourceKind,
      actorName: row.actorName ?? undefined,
      content: row.content,
      status: row.status,
      createdByUserId: row.createdByUserId,
      metadata: parseMetadata(row.metadataJson),
      createdAt: row.createdAt,
      sentAt: row.sentAt ?? undefined
    }));
  }

  addPrivateDelivery(input: PrivateDeliveryInput): void {
    const privateUserId = input.privateUserId.trim();
    const groupOpenid = input.groupOpenid.trim();
    if (privateUserId === "" || groupOpenid === "") return;

    this.db.prepare(`
      INSERT INTO private_message_deliveries
        (private_user_id, group_openid, group_user_id, source_kind, sent_at_ms, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(
      privateUserId,
      groupOpenid,
      input.groupUserId?.trim() || null,
      input.sourceKind.trim() || "private_message",
      input.sentAtMs ?? Date.now()
    );
  }

  countPrivateDeliveriesSince(privateUserId: string, sinceMs: number): number {
    const row = this.db.prepare(`
      SELECT count(*) as count
      FROM private_message_deliveries
      WHERE private_user_id = ?
        AND sent_at_ms >= ?
    `).get(privateUserId.trim(), sinceMs) as { count: number } | undefined;
    return row?.count ?? 0;
  }

  getRecentPlayerMemories(query: RecentPlayerMemoryQuery): StoredPlayerMemory[] {
    const limit = Math.max(1, Math.floor(query.limit));
    const rows = this.db.prepare(`
      SELECT
        id,
        scope_type as scopeType,
        scope_id as scopeId,
        user_id as userId,
        category,
        memory_text as memoryText,
        usage_hint as usageHint,
        source_kind as sourceKind,
        metadata_json as metadataJson,
        created_at as createdAt
      FROM player_memories
      WHERE scope_type = ? AND scope_id = ? AND user_id = ?
      ORDER BY id DESC
      LIMIT ?
    `).all(query.scopeType, query.scopeId, query.userId, limit) as unknown as Array<Omit<StoredPlayerMemory, "metadata"> & { metadataJson: string | null }>;

    return rows.reverse().map((row) => ({
      id: row.id,
      scopeType: row.scopeType,
      scopeId: row.scopeId,
      userId: row.userId,
      category: row.category,
      memoryText: row.memoryText,
      usageHint: row.usageHint ?? undefined,
      sourceKind: row.sourceKind ?? undefined,
      metadata: parseMetadata(row.metadataJson),
      createdAt: row.createdAt
    }));
  }

  getRecentScopePlayerMemories(query: RecentScopePlayerMemoryQuery): StoredPlayerMemory[] {
    const limit = Math.max(1, Math.floor(query.limit));
    const rows = query.excludeUserId == null
      ? this.db.prepare(`
          SELECT
            id,
            scope_type as scopeType,
            scope_id as scopeId,
            user_id as userId,
            category,
            memory_text as memoryText,
            usage_hint as usageHint,
            source_kind as sourceKind,
            metadata_json as metadataJson,
            created_at as createdAt
          FROM player_memories
          WHERE scope_type = ? AND scope_id = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(query.scopeType, query.scopeId, limit)
      : this.db.prepare(`
          SELECT
            id,
            scope_type as scopeType,
            scope_id as scopeId,
            user_id as userId,
            category,
            memory_text as memoryText,
            usage_hint as usageHint,
            source_kind as sourceKind,
            metadata_json as metadataJson,
            created_at as createdAt
          FROM player_memories
          WHERE scope_type = ? AND scope_id = ? AND user_id <> ?
          ORDER BY id DESC
          LIMIT ?
        `).all(query.scopeType, query.scopeId, query.excludeUserId, limit);

    return (rows as unknown as Array<Omit<StoredPlayerMemory, "metadata"> & { metadataJson: string | null }>)
      .reverse()
      .map((row) => ({
        id: row.id,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        userId: row.userId,
        category: row.category,
        memoryText: row.memoryText,
        usageHint: row.usageHint ?? undefined,
        sourceKind: row.sourceKind ?? undefined,
        metadata: parseMetadata(row.metadataJson),
        createdAt: row.createdAt
      }));
  }

  addNarrativeEvent(event: NarrativeEventInput): void {
    const outputText = event.outputText.trim();
    if (outputText === "") return;

    this.db.prepare(`
      INSERT INTO narrative_events
        (kind, scope_type, scope_id, user_id, actor_name, input_text, output_text, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      event.kind,
      event.scopeType,
      event.scopeId,
      event.userId,
      event.actorName?.trim() || null,
      event.inputText?.trim() || null,
      outputText,
      JSON.stringify(event.metadata ?? {})
    );
  }

  getRecentNarrativeEvents(query: RecentNarrativeEventQuery): StoredNarrativeEvent[] {
    const limit = Math.max(1, Math.floor(query.limit));
    const rows = query.kind == null
      ? this.db.prepare(`
          SELECT
            id,
            kind,
            scope_type as scopeType,
            scope_id as scopeId,
            user_id as userId,
            actor_name as actorName,
            input_text as inputText,
            output_text as outputText,
            metadata_json as metadataJson,
            created_at as createdAt
          FROM narrative_events
          WHERE scope_type = ? AND scope_id = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(query.scopeType, query.scopeId, limit)
      : this.db.prepare(`
          SELECT
            id,
            kind,
            scope_type as scopeType,
            scope_id as scopeId,
            user_id as userId,
            actor_name as actorName,
            input_text as inputText,
            output_text as outputText,
            metadata_json as metadataJson,
            created_at as createdAt
          FROM narrative_events
          WHERE scope_type = ? AND scope_id = ? AND kind = ?
          ORDER BY id DESC
          LIMIT ?
        `).all(query.scopeType, query.scopeId, query.kind, limit);

    return (rows as unknown as Array<Omit<StoredNarrativeEvent, "metadata"> & { metadataJson: string | null }>)
      .reverse()
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        scopeType: row.scopeType,
        scopeId: row.scopeId,
        userId: row.userId,
        actorName: row.actorName ?? undefined,
        inputText: row.inputText ?? undefined,
        outputText: row.outputText,
        metadata: parseMetadata(row.metadataJson),
        createdAt: row.createdAt
      }));
  }

  setSkills(scopeType: string, scopeId: string, userId: string, skills: SkillInput[]): void {
    const statement = this.db.prepare(`
      INSERT INTO character_skills
        (scope_type, scope_id, user_id, skill_key, skill_name, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(scope_type, scope_id, user_id, skill_key)
      DO UPDATE SET skill_name = excluded.skill_name, value = excluded.value, updated_at = datetime('now')
    `);

    this.db.exec("BEGIN");
    try {
      for (const skill of skills) {
        statement.run(scopeType, scopeId, userId, skill.key, skill.name, skill.value);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getSkills(scopeType: string, scopeId: string, userId: string): StoredSkill[] {
    return this.db.prepare(`
      SELECT skill_key as key, skill_name as name, value
      FROM character_skills
      WHERE scope_type = ? AND scope_id = ? AND user_id = ?
      ORDER BY lower(skill_name)
    `).all(scopeType, scopeId, userId) as unknown as StoredSkill[];
  }

  getSkill(scopeType: string, scopeId: string, userId: string, key: string): StoredSkill | undefined {
    const row = this.db.prepare(`
      SELECT skill_key as key, skill_name as name, value
      FROM character_skills
      WHERE scope_type = ? AND scope_id = ? AND user_id = ? AND skill_key = ?
    `).get(scopeType, scopeId, userId, key) as StoredSkill | undefined;
    return row;
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS processed_messages (
        message_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS character_skills (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        skill_key TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        value INTEGER NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id, user_id, skill_key)
      );

      CREATE TABLE IF NOT EXISTS chat_audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        direction TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        user_id TEXT,
        message_id TEXT,
        event_type TEXT,
        content TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_chat_audit_scope_id
      ON chat_audit_log(scope_type, scope_id, id);

      CREATE INDEX IF NOT EXISTS idx_chat_audit_direction_id
      ON chat_audit_log(direction, id);

      CREATE INDEX IF NOT EXISTS idx_chat_audit_message_id
      ON chat_audit_log(message_id);

      CREATE TABLE IF NOT EXISTS proactive_story_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_openid TEXT NOT NULL,
        line_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proactive_story_lines_group_id
      ON proactive_story_lines(group_openid, id);

      CREATE TABLE IF NOT EXISTS proactive_group_settings (
        group_openid TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        module_id TEXT,
        module_name TEXT,
        flavor_text TEXT,
        updated_by_user_id TEXT,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS private_group_bindings (
        private_user_id TEXT PRIMARY KEY,
        group_openid TEXT NOT NULL,
        group_user_id TEXT,
        role TEXT NOT NULL DEFAULT 'pl',
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS context_binding_codes (
        code TEXT PRIMARY KEY,
        group_openid TEXT NOT NULL,
        group_user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'pl',
        expires_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS member_roles (
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'pl',
        updated_by_user_id TEXT,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope_type, scope_id, user_id)
      );

      CREATE INDEX IF NOT EXISTS idx_member_roles_scope_role
      ON member_roles(scope_type, scope_id, role);

      CREATE TABLE IF NOT EXISTS private_message_permissions (
        private_user_id TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        active_messages_allowed INTEGER NOT NULL DEFAULT 1,
        last_private_activity_at_ms INTEGER,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS private_message_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        private_user_id TEXT NOT NULL,
        group_openid TEXT NOT NULL,
        group_user_id TEXT,
        source_kind TEXT NOT NULL,
        actor_name TEXT,
        content TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_by_user_id TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        sent_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_private_message_outbox_private_status_id
      ON private_message_outbox(private_user_id, status, id);

      CREATE TABLE IF NOT EXISTS private_message_deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        private_user_id TEXT NOT NULL,
        group_openid TEXT NOT NULL,
        group_user_id TEXT,
        source_kind TEXT NOT NULL,
        sent_at_ms INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_private_message_deliveries_private_time
      ON private_message_deliveries(private_user_id, sent_at_ms);

      CREATE TABLE IF NOT EXISTS narrative_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        actor_name TEXT,
        input_text TEXT,
        output_text TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_events_scope_kind_id
      ON narrative_events(scope_type, scope_id, kind, id);

      CREATE TABLE IF NOT EXISTS player_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        category TEXT NOT NULL,
        memory_text TEXT NOT NULL,
        usage_hint TEXT,
        source_kind TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_player_memories_unique
      ON player_memories(scope_type, scope_id, user_id, memory_text);

      CREATE INDEX IF NOT EXISTS idx_player_memories_scope_user_id
      ON player_memories(scope_type, scope_id, user_id, id);

      CREATE TABLE IF NOT EXISTS persona_cards (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'npc',
        public_description TEXT NOT NULL DEFAULT '',
        private_notes TEXT NOT NULL DEFAULT '',
        speech_style TEXT NOT NULL DEFAULT '',
        knowledge_boundary TEXT NOT NULL DEFAULT '',
        example_dialogues_json TEXT NOT NULL DEFAULT '[]',
        avoid_rules TEXT NOT NULL DEFAULT '',
        patience_policy TEXT NOT NULL DEFAULT '',
        agency_rules TEXT NOT NULL DEFAULT '',
        abnormal_input_policy TEXT NOT NULL DEFAULT '',
        table_boundary_policy TEXT NOT NULL DEFAULT '',
        anchor_style TEXT NOT NULL DEFAULT '',
        continuity_repair_policy TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_persona_cards_name
      ON persona_cards(lower(name));

      CREATE TABLE IF NOT EXISTS rp_training_examples (
        id TEXT PRIMARY KEY,
        npc_name TEXT NOT NULL,
        issue_type TEXT NOT NULL,
        bad_reply TEXT NOT NULL DEFAULT '',
        correction TEXT NOT NULL DEFAULT '',
        good_reply TEXT NOT NULL DEFAULT '',
        score INTEGER,
        tags_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rp_training_examples_npc_id
      ON rp_training_examples(lower(npc_name), id);

      CREATE TABLE IF NOT EXISTS rp_memory_anchors (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL DEFAULT 'npc',
        scope_id TEXT NOT NULL DEFAULT '',
        npc_name TEXT NOT NULL DEFAULT '',
        anchor_type TEXT NOT NULL DEFAULT 'event',
        label TEXT NOT NULL,
        content TEXT NOT NULL,
        source_message_id TEXT,
        source_type TEXT NOT NULL DEFAULT 'kp-note',
        visibility TEXT NOT NULL DEFAULT 'player',
        status TEXT NOT NULL DEFAULT 'candidate',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_rp_memory_anchors_npc_status
      ON rp_memory_anchors(lower(npc_name), visibility, status, id);

      CREATE INDEX IF NOT EXISTS idx_rp_memory_anchors_scope
      ON rp_memory_anchors(scope_type, scope_id, id);

      INSERT INTO narrative_events
        (kind, scope_type, scope_id, user_id, actor_name, input_text, output_text, metadata_json, created_at)
      SELECT
        'proactive_story',
        'group',
        proactive_story_lines.group_openid,
        'proactive-scheduler',
        '叙述者',
        NULL,
        proactive_story_lines.line_text,
        '{"backfilledFrom":"proactive_story_lines"}',
        proactive_story_lines.created_at
      FROM proactive_story_lines
      WHERE NOT EXISTS (
        SELECT 1
        FROM narrative_events
        WHERE narrative_events.kind = 'proactive_story'
          AND narrative_events.scope_type = 'group'
          AND narrative_events.scope_id = proactive_story_lines.group_openid
          AND narrative_events.output_text = proactive_story_lines.line_text
      );
    `);
    this.addColumnIfMissing("private_group_bindings", "role", "TEXT NOT NULL DEFAULT 'pl'");
    this.addColumnIfMissing("context_binding_codes", "role", "TEXT NOT NULL DEFAULT 'pl'");
    this.addColumnIfMissing("player_memories", "usage_hint", "TEXT");
    this.db.exec(`
      INSERT OR IGNORE INTO member_roles
        (scope_type, scope_id, user_id, role, updated_by_user_id, updated_at)
      SELECT
        'group',
        group_openid,
        group_user_id,
        COALESCE(role, 'pl'),
        group_user_id,
        updated_at
      FROM private_group_bindings
      WHERE group_user_id IS NOT NULL AND trim(group_user_id) <> '';
    `);
  }

  private addColumnIfMissing(tableName: string, columnName: string, columnDefinition: string): void {
    const columns = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as unknown as { name: string }[];
    if (columns.some((column) => column.name === columnName)) return;
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }
}

function normalizeMemoryText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeOptionalStorageText(text: string | null | undefined): string | null {
  const normalized = text?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed != null && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

interface StoredPersonaCardRow {
  id: string;
  name: string;
  role: string;
  public_description: string;
  private_notes: string;
  speech_style: string;
  knowledge_boundary: string;
  example_dialogues_json: string | null;
  avoid_rules: string;
  patience_policy: string;
  agency_rules: string;
  abnormal_input_policy: string;
  table_boundary_policy: string;
  anchor_style: string;
  continuity_repair_policy: string;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredTrainingExampleRow {
  id: string;
  npc_name: string;
  issue_type: string;
  bad_reply: string;
  correction: string;
  good_reply: string;
  score: number | null;
  tags_json: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredMemoryAnchorRow {
  id: string;
  scope_type: string;
  scope_id: string;
  npc_name: string;
  anchor_type: string;
  label: string;
  content: string;
  source_message_id: string | null;
  source_type: string;
  visibility: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function mapPersonaCardRow(row: StoredPersonaCardRow): StoredPersonaCard {
  return {
    id: row.id,
    name: row.name,
    role: normalizePersonaRole(row.role),
    publicDescription: row.public_description,
    privateNotes: row.private_notes,
    speechStyle: row.speech_style,
    knowledgeBoundary: row.knowledge_boundary,
    exampleDialogues: parseStringArray(row.example_dialogues_json),
    avoidRules: row.avoid_rules,
    patiencePolicy: row.patience_policy,
    agencyRules: row.agency_rules,
    abnormalInputPolicy: row.abnormal_input_policy,
    tableBoundaryPolicy: row.table_boundary_policy,
    anchorStyle: row.anchor_style,
    continuityRepairPolicy: row.continuity_repair_policy,
    tags: parseStringArray(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTrainingExampleRow(row: StoredTrainingExampleRow): StoredTrainingExample {
  return {
    id: row.id,
    npcName: row.npc_name,
    issueType: row.issue_type,
    badReply: row.bad_reply,
    correction: row.correction,
    goodReply: row.good_reply,
    score: row.score ?? undefined,
    tags: parseStringArray(row.tags_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMemoryAnchorRow(row: StoredMemoryAnchorRow): StoredMemoryAnchor {
  return {
    id: row.id,
    scopeType: normalizeMemoryAnchorScopeType(row.scope_type),
    scopeId: row.scope_id,
    npcName: row.npc_name,
    anchorType: normalizeMemoryAnchorType(row.anchor_type),
    label: row.label,
    content: row.content,
    sourceMessageId: row.source_message_id ?? undefined,
    sourceType: normalizeMemoryAnchorSourceType(row.source_type),
    visibility: normalizeMemoryAnchorVisibility(row.visibility),
    status: normalizeMemoryAnchorStatus(row.status),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizePersonaRole(value: unknown): PersonaCardRole {
  return value === "bot" || value === "narrator" ? value : "npc";
}

function normalizeMemoryAnchorScopeType(value: unknown): MemoryAnchorScopeType {
  return value === "campaign" || value === "session" || value === "scene" ? value : "npc";
}

function normalizeMemoryAnchorType(value: unknown): MemoryAnchorType {
  return value === "time"
    || value === "location"
    || value === "object"
    || value === "person"
    || value === "contradiction"
    ? value
    : "event";
}

function normalizeMemoryAnchorSourceType(value: unknown): MemoryAnchorSourceType {
  return value === "worldbook"
    || value === "chat"
    || value === "training"
    || value === "model-draft"
    ? value
    : "kp-note";
}

function normalizeMemoryAnchorVisibility(value: unknown): MemoryAnchorVisibility {
  return value === "kp" ? "kp" : "player";
}

function normalizeMemoryAnchorStatus(value: unknown): MemoryAnchorStatus {
  return value === "confirmed" || value === "rejected" ? value : "candidate";
}

function normalizeStringList(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of values ?? []) {
    const trimmed = value.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    normalized.push(trimmed);
  }
  return normalized;
}

function parseStringArray(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === "string").map((value) => value.trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}
