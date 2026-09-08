/** 启动当前构建产物，在隔离目录验证主界面挂载、IPC 与本地 HTTP 服务。 */
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS ?? 120_000);
const executable = process.env.SMOKE_BINARY
  ? resolve(root, process.env.SMOKE_BINARY)
  : join(root, 'src-tauri', 'target', 'release', process.platform === 'win32' ? 'app.exe' : 'app');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function verifyBuild() {
  if (!existsSync(executable)) throw new Error('未找到产物，请先运行 npx tauri build --no-bundle');
  const inputs = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '-z', '--',
    'src', 'app', 'src-tauri/src', 'src-tauri/build.rs', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock',
    'src-tauri/tauri.conf.json', 'src-tauri/tauri.macos.conf.json', 'src-tauri/capabilities', 'package.json', 'package-lock.json', 'vite.config.ts',
    'scripts/build-info.ts', 'rust-toolchain.toml', 'vendor/bloub',
  ], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
  const builtAt = statSync(executable).mtimeMs;
  const newer = inputs.find((path) => existsSync(join(root, path)) && statSync(join(root, path)).mtimeMs > builtAt);
  if (newer) throw new Error(`构建产物早于 ${newer}，请重新构建后验收`);
}

async function runSmoke() {
  verifyBuild();
  const workDir = mkdtempSync(join(tmpdir(), 'tunefree-smoke-'));
  const markerPath = join(workDir, 'ready.json');
  const runId = randomUUID();
  console.log(`冒烟测试启动：${executable}`);
  const child = spawn(executable, [], {
    cwd: workDir,
    env: { ...process.env, TUNEFREE_SMOKE_MARKER: markerPath,
      TUNEFREE_SMOKE_DIR: workDir, TUNEFREE_SMOKE_RUN_ID: runId,
      WEBVIEW2_USER_DATA_FOLDER: join(workDir, 'webview') },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  });
  let output = '';
  let exited = false;
  let failure;
  const closed = new Promise((resolve) => child.once('close', () => { exited = true; resolve(); }));
  child.once('error', (error) => { failure = error; });
  const capture = (chunk) => { output = (output + chunk.toString()).slice(-20_000); };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (failure) throw new Error(`启动测试进程失败：${failure.message}`);
      if (exited) throw new Error('应用在就绪前退出');
      if (existsSync(markerPath)) {
        const marker = JSON.parse(readFileSync(markerPath, 'utf8'));
        if (!marker.ready || marker.pid !== child.pid || marker.runId !== runId) {
          throw new Error('就绪标记不属于本次测试进程');
        }
        const response = await fetch(`http://127.0.0.1:${marker.port}/health`, { signal: AbortSignal.timeout(5000) });
        if (!response.ok) throw new Error('本地服务健康检查失败');
        await response.text();
        console.log(`冒烟测试通过：主界面已挂载、本地服务可访问（PID ${marker.pid}，端口 ${marker.port}）`);
        return;
      }
      await sleep(500);
    }
    throw new Error(`${timeoutMs}ms 内主界面未确认就绪`);
  } catch (error) {
    if (output.trim()) console.error(output.trim());
    // 正式构建的 Rust 日志写入隔离目录；失败时在清理前输出，供 CI 诊断。
    const logDir = join(workDir, 'logs');
    try {
      if (existsSync(logDir)) {
        for (const entry of readdirSync(logDir, { withFileTypes: true }).filter(entry => entry.isFile())) {
          console.error(readFileSync(join(logDir, entry.name), 'utf8').slice(-20_000));
        }
      }
    } catch (logError) { console.warn(`无法读取冒烟日志：${logError.message}`); }
    throw error;
  } finally {
    if (!exited) child.kill();
    await Promise.race([closed, sleep(5000)]);
    // 只清理本次 mkdtemp 创建、并确认位于系统临时目录下的绝对路径。
    const resolved = realpathSync(workDir);
    if (dirname(resolved) === realpathSync(tmpdir()) && basename(resolved).startsWith('tunefree-smoke-')) {
      try { rmSync(resolved, { recursive: true, force: true }); }
      catch { console.warn(`测试进程仍占用临时目录：${resolved}`); }
    }
  }
}

try { await runSmoke(); }
catch (error) { console.error(`冒烟测试失败：${error.message}`); process.exitCode = 1; }
