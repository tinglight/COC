import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

export interface RecentNarrativeEventQuery {
  scopeType: "group" | "c2c";
  scopeId: string;
  kind?: string;
  limit: number;
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

      CREATE TABLE IF NOT EXISTS proactive_story_lines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_openid TEXT NOT NULL,
        line_text TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_proactive_story_lines_group_id
      ON proactive_story_lines(group_openid, id);

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
  }
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
