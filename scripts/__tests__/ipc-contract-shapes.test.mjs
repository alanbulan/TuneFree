// @vitest-environment node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkCommandShapes } from '../ipc-contract-shapes.mjs';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const rustTree = (path) => readdirSync(new URL(`../../${path}`, import.meta.url), { withFileTypes: true })
  .flatMap((entry) => entry.isDirectory() ? rustTree(join(path, entry.name))
    : entry.name.endsWith('.rs') ? [read(join(path, entry.name))] : []);
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
const rust = stripComments([...rustTree('src-tauri/src/app'), read('src-tauri/src/recommendation/model.rs')].join('\n'));
const commands = stripComments(read('src/core/ipc/commands.ts'));
const types = stripComments(read('src/core/ipc/types.ts'));
const names = ['download_song_to_local', 'sync_recommendation_library', 'mark_frontend_ready'];
const check = (commandText = commands, typeText = types, rustText = rust) =>
  checkCommandShapes(rustText, commandText, typeText, names);

describe('IPC 参数和数据结构门禁', () => {
  it('检查真实代码，并排除 Tauri 注入的窗口和 State 参数', () => {
    expect(check()).toBe(10);
  });
  it('参数名称或返回类型漂移时失败', () => {
    expect(() => check(commands.replace('taskId: string; metadata:', 'task_id: string; metadata:'))).toThrow(/字段不一致/);
    expect(() => check(commands.replace('result: DownloadedFileResult', 'result: boolean'))).toThrow(/返回类型不一致/);
  });
  it('新任务截止时间被删除、错名或错改成字符串时失败', () => {
    for (const replacement of ['', 'deadline_at?: number | null;', 'deadlineAt?: string | null;']) {
      expect(() => check(commands, types.replace('deadlineAt?: number | null;', replacement))).toThrow(/不一致/);
    }
  });
  it('Rust serde 字段命名或下载元数据类型变更时失败', () => {
    expect(() => check(commands, types.replace('quality: string;', 'quality: number;'))).toThrow(/quality 不一致/);
    expect(() => check(commands, types, rust.replace('pub deadline_at: Option<i64>', 'pub deadline: Option<i64>'))).toThrow(/字段不一致/);
  });
});
