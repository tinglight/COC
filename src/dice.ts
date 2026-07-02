export interface RollTerm {
  sign: 1 | -1;
  source: string;
  total: number;
  rolls?: number[];
  sides?: number;
}

export interface RollResult {
  expression: string;
  total: number;
  terms: RollTerm[];
  detail: string;
}

const MAX_DICE = 100;
const MAX_SIDES = 100_000;
const MAX_TERMS = 30;

export class DiceError extends Error {}

export type RandomSource = () => number;

export function rollExpression(expression: string, rng: RandomSource = Math.random): RollResult {
  const compact = expression.replace(/\s+/g, "");
  if (compact === "") throw new DiceError("缺少骰子表达式");
  if (!/^[+\-]?(?:\d*d\d+|\d+)(?:[+\-](?:\d*d\d+|\d+))*$/i.test(compact)) {
    throw new DiceError("骰子表达式只支持 NdM、整数、加号和减号，例如 2d6+3");
  }

  const parts = compact.match(/[+\-]?(?:\d*d\d+|\d+)/gi) ?? [];
  if (parts.length === 0 || parts.length > MAX_TERMS) {
    throw new DiceError(`表达式项目数量需在 1-${MAX_TERMS} 之间`);
  }

  const terms = parts.map((part) => rollPart(part, rng));
  const total = terms.reduce((sum, term) => sum + term.sign * term.total, 0);
  const detail = terms.map(formatTerm).join("");
  return { expression: compact, total, terms, detail: `${detail} = ${total}` };
}

function rollPart(part: string, rng: RandomSource): RollTerm {
  const sign: 1 | -1 = part.startsWith("-") ? -1 : 1;
  const source = part.replace(/^[+\-]/, "");
  const diceMatch = source.match(/^(\d*)d(\d+)$/i);
  if (!diceMatch) {
    const value = Number(source);
    if (!Number.isSafeInteger(value)) throw new DiceError("整数过大");
    return { sign, source, total: value };
  }

  const count = diceMatch[1] === "" ? 1 : Number(diceMatch[1]);
  const sides = Number(diceMatch[2]);
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_DICE) {
    throw new DiceError(`骰子数量需在 1-${MAX_DICE} 之间`);
  }
  if (!Number.isSafeInteger(sides) || sides < 2 || sides > MAX_SIDES) {
    throw new DiceError(`骰面需在 2-${MAX_SIDES} 之间`);
  }

  const rolls = Array.from({ length: count }, () => Math.floor(clampRandom(rng()) * sides) + 1);
  return { sign, source: `${count}d${sides}`, total: rolls.reduce((sum, value) => sum + value, 0), rolls, sides };
}

function clampRandom(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value >= 1) return 0.999999999999;
  return value;
}

function formatTerm(term: RollTerm): string {
  const prefix = term.sign < 0 ? "-" : "+";
  const body = term.rolls ? `${term.source}[${term.rolls.join(",")}]` : term.source;
  return `${prefix}${body}`;
}
