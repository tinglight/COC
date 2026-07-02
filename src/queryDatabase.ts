import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

type OutputFormat = "json" | "table";
type Row = Record<string, unknown>;

interface CliOptions {
  database?: string;
  file?: string;
  sql?: string;
  format: OutputFormat;
  maxRows: number;
  help: boolean;
}

const DEFAULT_DATABASE_PATH = "./data/bot.sqlite";
const DEFAULT_MAX_ROWS = 200;
const MAX_CELL_LENGTH = 120;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printUsage();
    return;
  }

  const sql = (await readSql(options)).trim();
  if (sql === "") {
    throw new Error("No SQL provided. Pass --sql, --file, or pipe SQL through stdin.");
  }

  const databasePath = resolveDatabasePath(options.database ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH);
  const database = new DatabaseSync(databasePath, {
    readOnly: true,
    timeout: 5000
  });

  try {
    database.exec("PRAGMA query_only = ON");
    const statement = database.prepare(sql);
    const columns = getColumns(statement.columns().map((column) => column.name));
    const { rows, truncated } = collectRows(statement.iterate(), options.maxRows);

    if (options.format === "json") {
      console.log(JSON.stringify({ database: databasePath, rowCount: rows.length, truncated, rows }, null, 2));
      return;
    }

    console.log(formatTable(rows, columns));
    if (truncated) {
      console.error(`Showing first ${options.maxRows} rows only. Raise --max-rows if needed.`);
    }
  } finally {
    database.close();
  }
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    format: "json",
    maxRows: DEFAULT_MAX_ROWS,
    help: false
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--database":
      case "--db":
        options.database = requireValue(args, ++index, arg);
        break;
      case "--file":
        options.file = requireValue(args, ++index, arg);
        break;
      case "--sql":
        options.sql = requireValue(args, ++index, arg);
        break;
      case "--format": {
        const format = requireValue(args, ++index, arg);
        if (format !== "json" && format !== "table") {
          throw new Error("--format must be json or table");
        }
        options.format = format;
        break;
      }
      case "--json":
        options.format = "json";
        break;
      case "--table":
        options.format = "table";
        break;
      case "--max-rows": {
        const maxRows = Number(requireValue(args, ++index, arg));
        if (!Number.isInteger(maxRows) || maxRows <= 0) {
          throw new Error("--max-rows must be a positive integer");
        }
        options.maxRows = maxRows;
        break;
      }
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.sql != null && options.file != null) {
    throw new Error("Use only one SQL source: --sql or --file.");
  }

  return options;
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (value == null || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

async function readSql(options: CliOptions): Promise<string> {
  if (options.sql != null) return options.sql;
  if (options.file != null) return fs.readFileSync(options.file, "utf8");
  if (process.stdin.isTTY) return "";

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function resolveDatabasePath(databasePath: string): string {
  const trimmed = databasePath.trim();
  return trimmed === ":memory:" ? trimmed : path.resolve(trimmed);
}

function collectRows(iterator: Iterable<Row>, maxRows: number): { rows: Row[]; truncated: boolean } {
  const rows: Row[] = [];
  let truncated = false;

  for (const row of iterator) {
    if (rows.length >= maxRows) {
      truncated = true;
      break;
    }
    rows.push(normalizeRow(row));
  }

  return { rows, truncated };
}

function normalizeRow(row: Row): Row {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, normalizeValue(value)]));
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Uint8Array) return `base64:${Buffer.from(value).toString("base64")}`;
  return value;
}

function getColumns(names: string[]): string[] {
  return Array.from(new Set(names.filter((name) => name !== "")));
}

function formatTable(rows: Row[], statementColumns: string[]): string {
  const columns = statementColumns.length > 0 ? statementColumns : getColumns(rows.flatMap((row) => Object.keys(row)));
  if (columns.length === 0) return "(0 rows)";

  const header = `| ${columns.map(escapeTableCell).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map((row) => `| ${columns.map((column) => escapeTableCell(row[column])).join(" | ")} |`);

  return [header, separator, ...body, `(${rows.length} rows)`].join("\n");
}

function escapeTableCell(value: unknown): string {
  const text = stringifyCell(value).replace(/\r?\n/g, "\\n").replace(/\|/g, "\\|");
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH - 1)}...` : text;
}

function stringifyCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function printUsage(): void {
  console.log(`Usage:
  npm.cmd --silent run db:query -- --sql "SELECT name FROM sqlite_master"
  Get-Content .\\query.sql -Raw -Encoding UTF8 | npm.cmd --silent run db:query -- --format table

Options:
  --db, --database <path>  Database path. Defaults to DATABASE_PATH or ./data/bot.sqlite.
  --sql <sql>             SQL text for short one-line reads.
  --file <path>           Read SQL from a UTF-8 .sql file.
  --format <json|table>   Output format. Defaults to json.
  --table                 Shortcut for --format table.
  --json                  Shortcut for --format json.
  --max-rows <number>     Maximum rows to print. Defaults to ${DEFAULT_MAX_ROWS}.
  --help                  Show this help.

The database is opened read-only and query_only is enabled.`);
}
