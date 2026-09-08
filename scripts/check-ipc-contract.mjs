#!/usr/bin/env node
/**
 * IPC contract guard: bidirectional diff between the Rust command registry
 * (`tauri::generate_handler![...]` in bootstrap.rs) and the TypeScript facade
 * (`CommandMap` in src/core/ipc/commands.ts). Either side drifting fails.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkCommandShapes } from './ipc-contract-shapes.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const RUST_SOURCE = 'src-tauri/src/app/bootstrap.rs';
const TS_SOURCE = 'src/core/ipc/commands.ts';

const read = (relativePath) => {
  try {
    return readFileSync(join(root, relativePath), 'utf8');
  } catch (error) {
    console.error(`IPC 契约检查失败：无法读取 ${relativePath}（${error.message}）`);
    process.exit(1);
  }
};

/** Strip line and block comments so commented-out entries never count. */
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Extract the balanced body that starts at `openIndex` (index of the opener). */
const readBalanced = (text, openIndex, open, close) => {
  let depth = 0;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex + 1, index);
    }
  }
  return null;
};

const fail = (message) => {
  console.error(`IPC 契约检查未通过：${message}`);
  process.exit(1);
};

const parseRustCommands = () => {
  const text = stripComments(read(RUST_SOURCE));
  const marker = text.indexOf('generate_handler![');
  if (marker === -1) fail(`${RUST_SOURCE} 中没有找到 tauri::generate_handler![...]`);
  const body = readBalanced(text, text.indexOf('[', marker), '[', ']');
  if (body === null) fail(`${RUST_SOURCE} 的 generate_handler![...] 括号不匹配`);
  return body
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => entry.split('::').at(-1));
};

const parseTypeScriptCommands = () => {
  const text = stripComments(read(TS_SOURCE));
  const marker = /export\s+interface\s+CommandMap\s*\{/.exec(text);
  if (!marker) fail(`${TS_SOURCE} 中没有找到 export interface CommandMap`);
  const body = readBalanced(text, marker.index + marker[0].length - 1, '{', '}');
  if (body === null) fail(`${TS_SOURCE} 的 CommandMap 花括号不匹配`);

  const keys = [];
  let depth = 0;
  for (const line of body.split(/\r?\n/)) {
    if (depth === 0) {
      const key = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line);
      if (key) keys.push(key[1]);
    }
    for (const character of line) {
      if (character === '{') depth += 1;
      else if (character === '}') depth -= 1;
    }
  }
  return keys;
};

const rustCommands = parseRustCommands();
const tsCommands = parseTypeScriptCommands();

if (rustCommands.length === 0) fail('Rust 侧解析出 0 条命令，脚本解析逻辑可能已失效');
if (tsCommands.length === 0) fail('TypeScript 侧解析出 0 条命令，脚本解析逻辑可能已失效');

const findDuplicates = (names) =>
  [...new Set(names.filter((name, index) => names.indexOf(name) !== index))];

const rustSet = new Set(rustCommands);
const tsSet = new Set(tsCommands);
const missingInTs = rustCommands.filter((name) => !tsSet.has(name)).sort();
const missingInRust = tsCommands.filter((name) => !rustSet.has(name)).sort();
const duplicates = [...findDuplicates(rustCommands), ...findDuplicates(tsCommands)];

if (missingInTs.length > 0 || missingInRust.length > 0 || duplicates.length > 0) {
  console.error('IPC 契约检查未通过：Rust 命令表与 CommandMap 不一致');
  for (const name of missingInTs) {
    console.error(`  - ${name}：已在 ${RUST_SOURCE} 注册，但 ${TS_SOURCE} 的 CommandMap 缺少该键`);
  }
  for (const name of missingInRust) {
    console.error(`  - ${name}：已在 ${TS_SOURCE} 声明，但 ${RUST_SOURCE} 没有注册该命令`);
  }
  for (const name of duplicates) {
    console.error(`  - ${name}：存在重复声明`);
  }
  process.exit(1);
}

const readRustTree = (directory) => readdirSync(join(root, directory), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? readRustTree(join(directory, entry.name))
    : entry.name.endsWith('.rs') ? [read(join(directory, entry.name))] : []);

try {
  const shapes = checkCommandShapes(
    stripComments(readRustTree('src-tauri/src/app').concat(read('src-tauri/src/recommendation/model.rs')).join('\n')),
    stripComments(read(TS_SOURCE)), stripComments(read('src/core/ipc/types.ts')), rustCommands,
  );
  console.log(`IPC 契约检查通过（${rustCommands.length} 条命令名称、参数和返回类型，${shapes} 个数据结构）`);
} catch (error) {
  fail(error.message);
}
