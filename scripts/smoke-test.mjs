/**
 * 启动冒烟测试：真正跑起构建产物，断言前端完成首次 IPC 往返。
 *
 * 存在的理由：v1.1.28 通过了编译、clippy、全部单元测试与 tauri build，
 * 却完全无法启动——`LocalServerState` 在 setup 中注册，而窗口早于 setup 开始
 * 加载前端，渲染进程的第一条命令必然报 "state not managed"。CI 里没有任何一步
 * 启动过应用，所以谁都没拦住。
 *
 * 断言方式：应用在 `TUNEFREE_SMOKE_MARKER` 指定路径写入就绪标记（见
 * src-tauri/src/app/smoke.rs），该写入发生在渲染进程成功调用
 * get_local_server_info 之后，等价于证明「窗口创建 → 前端 bundle 执行 →
 * 命令派发」整条链路可用。
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const READY_TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
const POLL_INTERVAL_MS = 500;

const candidates = [
  join(root, 'src-tauri', 'target', 'release', 'app.exe'),
  join(root, 'src-tauri', 'target', 'release', 'app'),
  join(root, 'src-tauri', 'target', 'debug', 'app.exe'),
  join(root, 'src-tauri', 'target', 'debug', 'app'),
];

const executable = candidates.find((candidate) => existsSync(candidate));
if (!executable) {
  console.error('冒烟测试失败：未找到构建产物，请先运行 `npx tauri build --no-bundle`。');
  console.error(`已查找：\n${candidates.map((c) => `  - ${c}`).join('\n')}`);
  process.exit(1);
}

const workDir = mkdtempSync(join(tmpdir(), 'tunefree-smoke-'));
const markerPath = join(workDir, 'ready.txt');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

console.log(`冒烟测试启动：${executable}`);

const child = spawn(executable, [], {
  env: { ...process.env, TUNEFREE_SMOKE_MARKER: markerPath },
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

let output = '';
const capture = (chunk) => {
  output += chunk.toString();
  if (output.length > 20_000) output = output.slice(-20_000);
};
child.stdout.on('data', capture);
child.stderr.on('data', capture);

let exited = null;
child.on('exit', (code, signal) => {
  exited = { code, signal };
});

const finish = (ok, reason) => {
  if (exited === null) child.kill();
  if (!ok) {
    console.error(`冒烟测试失败：${reason}`);
    if (output.trim()) console.error(`--- 应用输出 ---\n${output.trim()}`);
  }
  // 清理临时目录；失败时不因清理异常掩盖真实原因。
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(ok ? 0 : 1);
};

const deadline = Date.now() + READY_TIMEOUT_MS;
while (Date.now() < deadline) {
  if (existsSync(markerPath)) {
    const marker = readFileSync(markerPath, 'utf8').trim();
    console.log(`冒烟测试通过：前端已完成首次 IPC 往返（${marker}）`);
    finish(true);
  }
  if (exited !== null) {
    finish(false, `应用在就绪前退出（code=${exited.code} signal=${exited.signal}）`);
  }
  await sleep(POLL_INTERVAL_MS);
}

finish(false, `${READY_TIMEOUT_MS}ms 内前端未完成首次 IPC 往返（窗口可能白屏或命令派发失败）`);
