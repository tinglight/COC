export type MemberRole = "kp" | "pl" | "ob";

export const DEFAULT_MEMBER_ROLE: MemberRole = "pl";

const ROLE_LABELS: Record<MemberRole, string> = {
  kp: "KP",
  pl: "PL",
  ob: "OB"
};

const ROLE_DESCRIPTIONS: Record<MemberRole, string> = {
  kp: "管理者/守密人，可使用全部指令并查看本团记录",
  pl: "参与者，可接收提示与KP传递的信息，但不能查看秘密或其他PL记录",
  ob: "围观者，不参与游戏，默认不能调用AI或守密人指令"
};

export function normalizeMemberRole(value: string | undefined): MemberRole | undefined {
  const normalized = value?.trim().normalize("NFKC").toLowerCase();
  if (!normalized) return undefined;
  if (["kp", "keeper", "gm", "dm", "admin", "管理员", "管理者", "守密人", "最高权力人"].includes(normalized)) return "kp";
  if (["pl", "pc", "player", "玩家", "参与者", "调查员"].includes(normalized)) return "pl";
  if (["ob", "observer", "spectator", "观众", "围观", "围观者"].includes(normalized)) return "ob";
  return undefined;
}

export function isMemberRole(value: string): value is MemberRole {
  return normalizeMemberRole(value) === value;
}

export function formatMemberRole(role: MemberRole | undefined): string {
  return ROLE_LABELS[role ?? DEFAULT_MEMBER_ROLE];
}

export function describeMemberRole(role: MemberRole | undefined): string {
  const resolved = role ?? DEFAULT_MEMBER_ROLE;
  return `${ROLE_LABELS[resolved]}：${ROLE_DESCRIPTIONS[resolved]}`;
}

export function canUseAiCommands(role: MemberRole): boolean {
  return role !== "ob";
}

export function canUseKeeperCommands(role: MemberRole): boolean {
  return role === "kp";
}

export function roleUsageText(): string {
  return "身份只能是 KP、PL 或 OB。例：.register KP / .role PL / .bind OB";
}
