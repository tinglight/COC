import path from "node:path";
import { loadConfig } from "./config.js";
import { formatImportedSkillsForSetCommand, parseCharacterSheetXlsx } from "./characterSheet.js";
import { BotStorage } from "./storage.js";

interface ImportArgs {
  file?: string;
  sheetName?: string;
  database?: string;
  scopeType?: "group" | "c2c";
  scopeId?: string;
  userId?: string;
  dryRun: boolean;
  help: boolean;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || !args.file) {
  printUsage();
  process.exit(args.file ? 0 : 1);
}

const result = await parseCharacterSheetXlsx(args.file, { sheetName: args.sheetName });
const title = result.identity.name ? `「${result.identity.name}」` : path.basename(args.file);
console.log(`读取 ${title}：${result.skills.length} 项属性/技能`);
console.log(summaryLine(result.identity));

if (result.warnings.length > 0) {
  console.warn(`警告：${result.warnings.join("；")}`);
}

const previewSkills = result.skills.slice(0, 18).map((skill) => `${skill.name}${skill.value}`).join("，");
console.log(`预览：${previewSkills}${result.skills.length > 18 ? " ..." : ""}`);

if (args.dryRun) {
  console.log("\n可复制的 .st 分段：");
  for (const command of formatImportedSkillsForSetCommand(result.skills)) {
    console.log(command);
  }
  process.exit(0);
}

if (!args.scopeType || !args.scopeId || !args.userId) {
  throw new Error("写入数据库需要 --scope-type、--scope-id、--user-id；只预览请加 --dry-run");
}

const databasePath = path.resolve(args.database ?? loadConfig().databasePath);
const storage = new BotStorage(databasePath);
try {
  storage.setSkills(args.scopeType, args.scopeId, args.userId, result.skills);
} finally {
  storage.close();
}

console.log(`已导入到 ${databasePath}`);

function parseArgs(argv: string[]): ImportArgs {
  const parsed: ImportArgs = { dryRun: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "--file":
      case "-f":
        parsed.file = requireValue(argv, ++index, arg);
        break;
      case "--sheet":
        parsed.sheetName = requireValue(argv, ++index, arg);
        break;
      case "--database":
        parsed.database = requireValue(argv, ++index, arg);
        break;
      case "--scope-type": {
        const value = requireValue(argv, ++index, arg);
        if (value !== "group" && value !== "c2c") throw new Error("--scope-type 只能是 group 或 c2c");
        parsed.scopeType = value;
        break;
      }
      case "--scope-id":
        parsed.scopeId = requireValue(argv, ++index, arg);
        break;
      case "--user-id":
        parsed.userId = requireValue(argv, ++index, arg);
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      default:
        throw new Error(`未知参数：${arg}`);
    }
  }
  return parsed;
}

function requireValue(argv: string[], index: number, flag: string): string {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${flag} 缺少参数值`);
  return value;
}

function summaryLine(identity: { player?: string; occupation?: string; age?: number; gender?: string }): string {
  const parts = [
    identity.player ? `玩家 ${identity.player}` : undefined,
    identity.occupation,
    identity.age == null ? undefined : `${identity.age}岁`,
    identity.gender
  ].filter(Boolean);
  return parts.length > 0 ? `信息：${parts.join(" / ")}` : "信息：未读取到调查员基础信息";
}

function printUsage(): void {
  console.log(`用法：
npm.cmd run import:sheet -- --file "C:\\path\\角色卡.xlsx" --dry-run
npm.cmd run import:sheet -- --file "C:\\path\\角色卡.xlsx" --scope-type group --scope-id 群openid --user-id 用户openid

选项：
  --sheet       默认读取「人物卡」
  --database    默认使用 .env 的 DATABASE_PATH 或 ./data/bot.sqlite
  --dry-run     只预览解析结果和 .st 分段，不写入数据库`);
}
