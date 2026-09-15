import { createContext, runInContext } from 'node:vm';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildRuntimeSource } from '../runtime/runtimeSource';
import { LxSandbox, type SandboxDependencies } from '../workerHost';
import type { HostToSandboxMessage, SandboxToHostMessage } from '../protocol';

// ============================================================ 运行时片段：端到端

class FakeBlob {
  constructor(public readonly parts: string[]) {}
  text(): string {
    return this.parts.join('');
  }
}

/**
 * 在 `node:vm` 里模拟 Worker 全局，跑真实的运行时片段：
 * `importScripts` 会把用户脚本求值到同一个上下文，等价于真实 Worker 的加载方式。
 */
const createRuntimeHarness = () => {
  const received: SandboxToHostMessage[] = [];
  const blobs = new Map<string, string>();
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const otherListeners: Record<string, (event: unknown) => void> = {};
  let blobSeq = 0;
  const context = createContext({
    console: { log: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    TextEncoder,
    TextDecoder,
    atob,
    btoa,
    crypto: globalThis.crypto,
    Blob: FakeBlob,
    URL: {
      createObjectURL: (blob: FakeBlob) => {
        blobSeq += 1;
        const url = `blob:test/${blobSeq}`;
        blobs.set(url, blob.text());
        return url;
      },
      revokeObjectURL: (url: string) => blobs.delete(url),
    },
    postMessage: (message: SandboxToHostMessage) => received.push(message),
    importScripts: (url: string) => {
      const code = blobs.get(url);
      if (code === undefined) throw new Error(`unknown script url: ${url}`);
      runInContext(code, context);
    },
    addEventListener: (type: string, listener: (event: { data: unknown }) => void) => {
      if (type === 'message') messageListeners.push(listener);
      else otherListeners[type] = listener as (event: unknown) => void;
    },
  });
  runInContext(buildRuntimeSource({ appVersion: '1.2.3' }), context);
  const send = (message: HostToSandboxMessage): void => {
    for (const listener of messageListeners) listener({ data: message });
  };
  const dispatch = (type: string, event: unknown): void => {
    otherListeners[type]?.(event);
  };
  return { received, send, dispatch, run: (code: string) => runInContext(code, context) };
};

/** TS lib 目标不含 Array.prototype.at / findLast，这里提供等价工具。 */
const lastOf = <T,>(items: readonly T[]): T | undefined =>
  items.length > 0 ? items[items.length - 1] : undefined;

/** 从后往前找第一个满足条件的元素；保留类型守卫的收窄能力。 */
const lastMatching = <T, U extends T>(
  items: readonly T[],
  predicate: (item: T) => item is U,
): U | undefined => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (predicate(item)) return item;
  }
  return undefined;
};

const LOAD_MESSAGE = (code: string): HostToSandboxMessage => ({
  kind: 'load',
  code,
  meta: { name: '测试源', description: '说明', version: '9.9.9', author: 'me', homepage: '' },
});

const envelopeOf = (payload: unknown): { status: number; statusText: string; headers: Record<string, string>; bodyBase64: string } => ({
  status: 200,
  statusText: 'OK',
  headers: { 'content-type': 'application/json' },
  bodyBase64: Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64'),
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('沙箱运行时（真实片段 + vm）', () => {
  it('启动后先握手，再按父窗口指令加载并执行用户脚本', () => {
    const harness = createRuntimeHarness();
    expect(harness.received[0]).toEqual({ kind: 'ready', version: '1.2.3' });

    const userScript = `
      globalThis.__sawMeta = globalThis.lx.currentScriptInfo;
      globalThis.lx.on(globalThis.lx.EVENT_NAMES.request, ({ source, action, info }) =>
        Promise.resolve('url://' + source + '/' + action + '/' + info.musicInfo.songmid));
      globalThis.lx.send(globalThis.lx.EVENT_NAMES.inited, { sources: { kw: { name: '酷我', qualitys: ['320k'], actions: ['musicUrl'] } } });
    `;
    harness.send(LOAD_MESSAGE(userScript));

    expect(harness.received.some((message) => message.kind === 'loaded')).toBe(true);
    expect(harness.received.find((message) => message.kind === 'send')).toEqual({
      kind: 'send',
      event: 'inited',
      data: { sources: { kw: { name: '酷我', qualitys: ['320k'], actions: ['musicUrl'] } } },
    });
    const meta = harness.run('__sawMeta') as Record<string, string>;
    expect(meta.name).toBe('测试源');
    expect(meta.version).toBe('9.9.9');
    expect(meta.rawScript).toBe(userScript);
  });

  it('env / version / EVENT_NAMES 与洛雪一致', () => {
    const harness = createRuntimeHarness();
    expect(harness.run('lx.env')).toBe('desktop');
    expect(harness.run('lx.version')).toBe('1.2.3');
    const events = harness.run('JSON.stringify(lx.EVENT_NAMES)') as string;
    expect(JSON.parse(events)).toEqual({ request: 'request', inited: 'inited', updateAlert: 'updateAlert' });
  });

  it('invoke 触发处理器，lx.request 经父窗口往返后 resolve（含 form 编码与超时字段）', async () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        lx.on(lx.EVENT_NAMES.request, ({ source }) =>
          new Promise((resolve, reject) => {
            lx.request('https://api.test/' + source, {
              method: 'post',
              headers: { 'x-a': 1 },
              form: { q: '歌名', n: 2 },
              timeout: 3000,
            }, (error, response) => {
              if (error) reject(error);
              else resolve(response.statusCode + '|' + response.body.value + '|' + response.raw.length);
            });
          }));
      `),
    );
    harness.send({
      kind: 'invoke',
      callId: 'invoke-1',
      event: 'request',
      payload: { source: 'kw', action: 'musicUrl', info: { musicInfo: { songmid: '42' }, type: '320k' } },
    });
    await flush();

    const request = harness.received.find(
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    expect(request).toBeDefined();
    expect(request!.payload.url).toBe('https://api.test/kw');
    expect(request!.payload.method).toBe('POST');
    expect(request!.payload.headers).toEqual({
      'x-a': '1',
      'content-type': 'application/x-www-form-urlencoded',
    });
    expect(request!.payload.timeoutMs).toBe(3000);
    expect(Buffer.from(request!.payload.bodyBase64, 'base64').toString('utf-8')).toBe(
      'q=%E6%AD%8C%E5%90%8D&n=2',
    );

    harness.send({ kind: 'reply', callId: request!.callId, envelope: envelopeOf({ value: 'ok' }) });
    await flush();
    expect(harness.received.find((message) => message.kind === 'invoke-result')).toEqual({
      kind: 'invoke-result',
      callId: 'invoke-1',
      result: `200|ok|${Buffer.byteLength('{"value":"ok"}')}`,
    });
  });

  it('json 选项与 Buffer body 都能正确编码', async () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        lx.on(lx.EVENT_NAMES.request, () => {
          lx.request('https://api.test/j', { method: 'PUT', json: { a: 1 } }, () => {});
          lx.request('https://api.test/b', { method: 'POST', body: Buffer.from('raw') }, () => {});
          return 'done';
        });
      `),
    );
    harness.send({ kind: 'invoke', callId: 'c', event: 'request', payload: { source: 'kw', action: 'musicUrl', info: {} } });
    await flush();
    const requests = harness.received.filter(
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    expect(requests[0].payload.headers['content-type']).toBe('application/json');
    expect(Buffer.from(requests[0].payload.bodyBase64, 'base64').toString('utf-8')).toBe('{"a":1}');
    expect(Buffer.from(requests[1].payload.bodyBase64, 'base64').toString('utf-8')).toBe('raw');
    await flush();
  });

  it('请求失败、处理器抛错、缺少处理器都会回执 invoke-error', async () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        lx.on(lx.EVENT_NAMES.request, ({ action }) => {
          if (action === 'boom') throw new Error('处理器炸了');
          return new Promise((resolve, reject) => {
            lx.request('https://api.test/x', {}, (error) => {
              if (error) reject(error);
              else resolve('ok');
            });
          });
        });
      `),
    );

    harness.send({ kind: 'invoke', callId: 'invoke-boom', event: 'request', payload: { source: 'kw', action: 'boom', info: {} } });
    await flush();
    expect(
      harness.received.find((message) => message.kind === 'invoke-error' && message.callId === 'invoke-boom'),
    ).toEqual({ kind: 'invoke-error', callId: 'invoke-boom', message: '处理器炸了' });

    harness.send({ kind: 'invoke', callId: 'invoke-req', event: 'request', payload: { source: 'kw', action: 'url', info: {} } });
    await flush();
    const request = harness.received.find(
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    harness.send({ kind: 'reply', callId: request!.callId, error: '源代理请求失败（HTTP 502）' });
    await flush();
    expect(
      harness.received.find((message) => message.kind === 'invoke-error' && message.callId === 'invoke-req'),
    ).toEqual({ kind: 'invoke-error', callId: 'invoke-req', message: '源代理请求失败（HTTP 502）' });

    harness.send({ kind: 'invoke', callId: 'invoke-none', event: 'musicUrl', payload: { source: 'kw', action: 'musicUrl', info: {} } });
    await flush();
    expect(
      harness.received.find((message) => message.kind === 'invoke-error' && message.callId === 'invoke-none'),
    ).toEqual({ kind: 'invoke-error', callId: 'invoke-none', message: '脚本未注册 musicUrl 处理器' });
  });

  it('回包里的 set-cookie 会以数组形式暴露给脚本', async () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        lx.on(lx.EVENT_NAMES.request, () => new Promise((resolve, reject) => {
          lx.request('https://api.test/login', {}, (error, response) => {
            if (error) return reject(error);
            const cookies = response.headers['set-cookie'];
            resolve(Array.isArray(cookies) ? cookies.join('|') : 'not-array');
          });
        }));
      `),
    );
    harness.send({ kind: 'invoke', callId: 'c-cookie', event: 'request', payload: { source: 'kw', action: 'musicUrl', info: {} } });
    await flush();
    const request = harness.received.find(
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    harness.send({
      kind: 'reply',
      callId: request!.callId,
      envelope: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        cookies: ['sid=1; Path=/', 'Hm_Iuvt_abc=xyz; Path=/'],
        bodyBase64: '',
      },
    });
    await flush();
    expect(
      harness.received.find((message) => message.kind === 'invoke-result'),
    ).toEqual({ kind: 'invoke-result', callId: 'c-cookie', result: 'sid=1; Path=/|Hm_Iuvt_abc=xyz; Path=/' });
  });

  it('响应体按内容类型解析：JSON 自动解析、普通文本保留原文', async () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        lx.on(lx.EVENT_NAMES.request, () => new Promise((resolve, reject) => {
          lx.request('https://api.test/a', {}, (error, response) => {
            if (error) return reject(error);
            resolve(JSON.stringify({ body: response.body, rawLen: response.raw.length, status: response.statusCode }));
          });
        }));
      `),
    );

    harness.send({ kind: 'invoke', callId: 'c1', event: 'request', payload: { source: 'kw', action: 'musicUrl', info: {} } });
    await flush();
    const first = harness.received.find(
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    harness.send({
      kind: 'reply',
      callId: first!.callId,
      envelope: {
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        bodyBase64: Buffer.from('{"a":1}', 'utf-8').toString('base64'),
      },
    });
    await flush();
    const textResult = harness.received.find(
      (message): message is Extract<SandboxToHostMessage, { kind: 'invoke-result' }> => message.kind === 'invoke-result',
    );
    expect(JSON.parse(textResult!.result as string)).toEqual({ body: { a: 1 }, rawLen: 7, status: 200 });

    harness.send({ kind: 'invoke', callId: 'c2', event: 'request', payload: { source: 'kw', action: 'musicUrl', info: {} } });
    await flush();
    const second = lastMatching(
      harness.received,
      (message): message is Extract<SandboxToHostMessage, { kind: 'request' }> => message.kind === 'request',
    );
    harness.send({
      kind: 'reply',
      callId: second!.callId,
      envelope: {
        status: 500,
        statusText: 'Server Error',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('not json', 'utf-8').toString('base64'),
      },
    });
    await flush();
    const lastResult = lastMatching(
      harness.received,
      (message): message is Extract<SandboxToHostMessage, { kind: 'invoke-result' }> => message.kind === 'invoke-result',
    );
    expect(JSON.parse(lastResult!.result as string)).toEqual({ body: 'not json', rawLen: 8, status: 500 });
  });

  it('utils.crypto / utils.buffer / Buffer 在沙箱里可用，错误与日志会回传', () => {
    const harness = createRuntimeHarness();
    harness.send(
      LOAD_MESSAGE(`
        console.log('加载日志', 1);
        lx.send(lx.EVENT_NAMES.updateAlert, { log: '有新版本', updateUrl: 'https://example.test' });
        globalThis.__cryptoOk = lx.utils.crypto.md5('abc') === '900150983cd24fb0d6963f7d28e17f72';
        globalThis.__bufferOk = lx.utils.buffer.bufToString(lx.utils.buffer.from('hi'), 'base64') === 'aGk=';
        globalThis.__globalBufferOk = Buffer.isBuffer(Buffer.from([1, 2]));
        globalThis.__documentOk = document.getElementsByTagName('script')[0].innerText === lx.currentScriptInfo.rawScript;
        globalThis.__windowOk = window === globalThis;
        throw new Error('加载期错误');
      `),
    );
    expect(harness.run('__cryptoOk')).toBe(true);
    expect(harness.run('__bufferOk')).toBe(true);
    expect(harness.run('__globalBufferOk')).toBe(true);
    expect(harness.run('__documentOk')).toBe(true);
    expect(harness.run('__windowOk')).toBe(true);
    expect(harness.received.find((message) => message.kind === 'console')).toEqual({
      kind: 'console',
      level: 'log',
      message: '加载日志 1',
    });
    expect(
      harness.received.find((message) => message.kind === 'send' && message.event === 'updateAlert'),
    ).toEqual({ kind: 'send', event: 'updateAlert', data: { log: '有新版本', updateUrl: 'https://example.test' } });
    // 用户脚本顶层抛错时 importScripts 会同步抛出，运行时把它转成 load-error。
    expect(harness.received.find((message) => message.kind === 'load-error')).toEqual({
      kind: 'load-error',
      message: '加载期错误',
    });
  });

  it('未处理的拒绝、全局错误与 ping 都有定义行为', () => {
    const harness = createRuntimeHarness();
    harness.dispatch('unhandledrejection', { reason: new Error('未处理') });
    harness.dispatch('error', { message: '全局错误' });
    harness.send({ kind: 'ping' });
    expect(harness.received).toContainEqual({ kind: 'error', message: 'unhandledrejection: 未处理' });
    expect(harness.received).toContainEqual({ kind: 'error', message: '全局错误' });
    expect(harness.received).toContainEqual({ kind: 'pong' });
  });
});

// ============================================================ 宿主：Worker 生命周期

interface FakeWorkerControls {
  worker: Worker;
  posted: HostToSandboxMessage[];
  emit: (message: SandboxToHostMessage) => void;
  emitError: (message: string) => void;
  terminated: () => boolean;
}

const createFakeWorker = (
  onPost?: (message: HostToSandboxMessage, controls: FakeWorkerControls) => void,
): FakeWorkerControls => {
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const posted: HostToSandboxMessage[] = [];
  let terminated = false;
  const controls = {
    posted,
    emit: (message: SandboxToHostMessage) => {
      for (const listener of listeners.get('message') || []) listener({ data: message });
    },
    emitError: (message: string) => {
      for (const listener of listeners.get('error') || []) listener({ message });
    },
    terminated: () => terminated,
  } as FakeWorkerControls;
  controls.worker = {
    postMessage: (message: HostToSandboxMessage) => {
      posted.push(message);
      onPost?.(message, controls);
    },
    addEventListener: (type: string, listener: (event: never) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener as (event: unknown) => void);
    },
    removeEventListener: (type: string, listener: (event: never) => void) => {
      listeners.get(type)?.delete(listener as (event: unknown) => void);
    },
    terminate: () => {
      terminated = true;
    },
  } as unknown as Worker;
  return controls;
};

const META = { name: 'S', description: '', version: '1', author: '', homepage: '' };

const buildDeps = (
  controls: FakeWorkerControls,
  overrides: Partial<SandboxDependencies> = {},
): SandboxDependencies => ({
  createWorker: () => controls.worker,
  createObjectUrl: () => 'blob:runtime',
  revokeObjectUrl: () => {},
  relay: async () => ({ envelope: { status: 200, statusText: 'OK', headers: {}, bodyBase64: '' } }),
  appVersion: '1.0.0',
  ...overrides,
});

const announceReady = (controls: FakeWorkerControls) => {
  controls.emit({ kind: 'ready', version: '1.0.0' });
  controls.emit({ kind: 'loaded' });
  controls.emit({
    kind: 'send',
    event: 'inited',
    data: { sources: { wy: { name: '网易', qualitys: ['320k'], actions: ['musicUrl'] } } },
  });
};

const mountSandbox = async (
  onPost?: Parameters<typeof createFakeWorker>[0],
  overrides: Partial<SandboxDependencies> = {},
) => {
  const controls = createFakeWorker(onPost);
  const sandbox = new LxSandbox({ code: 'code', meta: META }, buildDeps(controls, overrides));
  const initialized = sandbox.initialize();
  announceReady(controls);
  await initialized;
  return { sandbox, controls };
};

describe('LxSandbox', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('脚本明确报告初始化失败时释放 Worker，不注册为就绪', async () => {
    const controls = createFakeWorker();
    const sandbox = new LxSandbox({ code: 'code', meta: META }, buildDeps(controls));
    const initialized = sandbox.initialize();
    controls.emit({ kind: 'send', event: 'inited', data: { status: false, message: '认证失败' } });
    await initialized;
    expect(sandbox.getSnapshot()).toMatchObject({ status: 'failed', error: '认证失败', sources: {} });
    expect(controls.terminated()).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([null, {}, { url: 'https://api.test', method: 'GET', headers: null, bodyBase64: '' }])(
    '畸形请求不会抛出宿主异常或调用 relay：%j', async (payload) => {
      const relay = vi.fn();
      const { sandbox, controls } = await mountSandbox(undefined, { relay });
      expect(() => controls.emit({ kind: 'request', callId: 'bad-request', payload } as unknown as SandboxToHostMessage)).not.toThrow();
      expect(lastOf(controls.posted)).toEqual({ kind: 'reply', callId: 'bad-request', error: '音源请求格式无效' });
      expect(relay).not.toHaveBeenCalled();
      sandbox.dispose();
    },
  );

  it('初始化：握手后下发脚本，inited 到达即就绪', async () => {
    const controls = createFakeWorker();
    const sandbox = new LxSandbox({ code: 'code', meta: META }, buildDeps(controls));
    const initialized = sandbox.initialize();

    expect(controls.posted).toEqual([]);
    controls.emit({ kind: 'ready', version: '1.0.0' });
    expect(controls.posted[0]).toEqual({ kind: 'load', code: 'code', meta: META });

    announceReady(controls);
    await initialized;

    const snapshot = sandbox.getSnapshot();
    expect(snapshot.status).toBe('ready');
    expect(snapshot.sources.wy?.qualitys).toEqual(['320k']);
    expect(snapshot.logs.some((line) => line.includes('声明平台：wy'))).toBe(true);
  });

  it('初始化：Worker 报错或脚本加载失败都进入 failed 且带原因', async () => {
    const errorControls = createFakeWorker();
    const errorSandbox = new LxSandbox({ code: 'x', meta: META }, buildDeps(errorControls));
    const errorInit = errorSandbox.initialize();
    errorControls.emitError('WebAssembly 不可用');
    await errorInit;
    expect(errorSandbox.getSnapshot()).toMatchObject({ status: 'failed', error: 'WebAssembly 不可用' });

    const loadControls = createFakeWorker();
    const loadSandbox = new LxSandbox({ code: 'x', meta: META }, buildDeps(loadControls));
    const loadInit = loadSandbox.initialize();
    loadControls.emit({ kind: 'load-error', message: '语法错误' });
    await loadInit;
    expect(loadSandbox.getSnapshot()).toMatchObject({ status: 'failed', error: '脚本加载失败：语法错误' });
    expect(errorControls.terminated()).toBe(true);
    expect(loadControls.terminated()).toBe(true);
  });

  it('初始化期间释放会立即结束等待，且不会留下迟到的超时通知', async () => {
    const controls = createFakeWorker();
    const sandbox = new LxSandbox({ code: 'x', meta: META }, buildDeps(controls));
    const initialized = sandbox.initialize();
    const settled = vi.fn();
    void initialized.then(settled);
    sandbox.dispose();
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(sandbox.getSnapshot().status).toBe('idle');
    expect(sandbox.getSnapshot().error).toBe('');
  });

  it('初始化：Worker 迟迟不回握手会超时失败；已执行但没发 inited 则按就绪处理', async () => {
    const silentControls = createFakeWorker();
    const silent = new LxSandbox({ code: 'x', meta: META }, buildDeps(silentControls));
    const silentInit = silent.initialize();
    await vi.advanceTimersByTimeAsync(10_000);
    await silentInit;
    expect(silent.getSnapshot().status).toBe('failed');

    const lateControls = createFakeWorker();
    const late = new LxSandbox({ code: 'x', meta: META }, buildDeps(lateControls));
    const lateInit = late.initialize();
    lateControls.emit({ kind: 'ready', version: '1' });
    lateControls.emit({ kind: 'loaded' });
    await vi.advanceTimersByTimeAsync(10_000);
    await lateInit;
    expect(late.getSnapshot().status).toBe('ready');
  });

  it('创建 Worker 抛错（例如 CSP 拒绝）时记录失败原因', async () => {
    const sandbox = new LxSandbox(
      { code: 'x', meta: META },
      buildDeps(createFakeWorker(), {
        createWorker: () => {
          throw new Error('CSP 拒绝创建 Worker');
        },
      }),
    );
    await sandbox.initialize();
    expect(sandbox.getSnapshot()).toMatchObject({ status: 'failed', error: 'CSP 拒绝创建 Worker' });
  });

  it('call：回执成功与失败', async () => {
    const { sandbox } = await mountSandbox((message, controls) => {
      if (message.kind === 'invoke') {
        controls.emit({ kind: 'invoke-result', callId: message.callId, result: 'url://x' });
      }
    });
    await expect(sandbox.call('wy', 'musicUrl', {})).resolves.toEqual({ ok: true, result: 'url://x', error: '' });

    const { sandbox: failing } = await mountSandbox((message, controls) => {
      if (message.kind === 'invoke') {
        controls.emit({ kind: 'invoke-error', callId: message.callId, message: '源接口 500' });
      }
    });
    await expect(failing.call('wy', 'musicUrl', {})).resolves.toEqual({
      ok: false,
      result: null,
      error: '源接口 500',
    });
  });

  it('call：超时与取消', async () => {
    const { sandbox } = await mountSandbox();

    const stalled = sandbox.call('wy', 'musicUrl', {}, { timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await expect(stalled).resolves.toEqual({ ok: false, result: null, error: '音源调用超时' });

    const controller = new AbortController();
    const cancelled = sandbox.call('wy', 'musicUrl', {}, { signal: controller.signal });
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });

    await expect(sandbox.call('wy', 'musicUrl', {}, { signal: AbortSignal.abort() })).rejects.toMatchObject({
      name: 'AbortError',
    });
  });

  it('调用超时后移除调用方的 abort 监听器', async () => {
    const { sandbox } = await mountSandbox();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const pending = sandbox.call('wy', 'musicUrl', {}, { signal: controller.signal, timeoutMs: 500 });
    await vi.advanceTimersByTimeAsync(500);
    await pending;
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('call：沙箱不可用时不调用脚本', async () => {
    const controls = createFakeWorker();
    const sandbox = new LxSandbox({ code: 'code', meta: META }, buildDeps(controls));
    await expect(sandbox.call('wy', 'musicUrl', {})).resolves.toEqual({
      ok: false,
      result: null,
      error: '沙箱不可用',
    });

    const failedControls = createFakeWorker();
    const broken = new LxSandbox({ code: 'code', meta: META }, buildDeps(failedControls));
    const brokenInit = broken.initialize();
    failedControls.emit({ kind: 'load-error', message: '炸' });
    await brokenInit;
    await expect(broken.call('wy', 'musicUrl', {})).resolves.toEqual({
      ok: false,
      result: null,
      error: '脚本加载失败：炸',
    });
  });

  it('源请求：转发给 relay 并回包，记录访问过的主机', async () => {
    const relayCalls: unknown[] = [];
    const { sandbox, controls } = await mountSandbox(undefined, {
      relay: async (payload) => {
        relayCalls.push(payload);
        return { envelope: { status: 200, statusText: 'OK', headers: {}, bodyBase64: 'AA==' } };
      },
    });

    controls.emit({
      kind: 'request',
      callId: 'req-1',
      payload: { url: 'https://api.example.test/url', method: 'GET', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(relayCalls).toHaveLength(1);
    expect(lastOf(controls.posted)).toEqual({
      kind: 'reply',
      callId: 'req-1',
      envelope: { status: 200, statusText: 'OK', headers: {}, bodyBase64: 'AA==' },
    });
    expect(sandbox.getSnapshot().hosts).toEqual(['api.example.test']);

    // 非法 URL 不记录主机，也不会抛错。
    controls.emit({
      kind: 'request',
      callId: 'req-2',
      payload: { url: 'not a url', method: 'GET', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(sandbox.getSnapshot().hosts).toEqual(['api.example.test']);
  });

  it('源请求：relay 返回错误或抛异常都会回传', async () => {
    let mode: 'error' | 'throw' = 'error';
    const { controls } = await mountSandbox(undefined, {
      relay: async () => {
        if (mode === 'error') return { error: '源代理请求失败（HTTP 403）' };
        throw new Error('网络中断');
      },
    });

    controls.emit({ kind: 'request', callId: 'r1', payload: { url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastOf(controls.posted)).toEqual({ kind: 'reply', callId: 'r1', error: '源代理请求失败（HTTP 403）' });

    mode = 'throw';
    controls.emit({ kind: 'request', callId: 'r2', payload: { url: 'https://a.test/x', method: 'GET', headers: {}, bodyBase64: '' } });
    await vi.advanceTimersByTimeAsync(0);
    expect(lastOf(controls.posted)).toEqual({ kind: 'reply', callId: 'r2', error: '网络中断' });
  });

  it('源请求：带上会话 cookie，并记录回包里的 set-cookie', async () => {
    const relayed: Array<Record<string, string>> = [];
    const { controls } = await mountSandbox(undefined, {
      relay: async (payload) => {
        relayed.push(payload.headers);
        return {
          envelope: {
            status: 200,
            statusText: 'OK',
            headers: {},
            cookies: ['sid=abc; Path=/; HttpOnly'],
            bodyBase64: '',
          },
        };
      },
    });

    controls.emit({
      kind: 'request',
      callId: 'r-login',
      payload: { url: 'https://api.test/login', method: 'POST', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(relayed[0].cookie).toBeUndefined();

    // 第二次请求应自动带上第一次登录得到的 cookie
    controls.emit({
      kind: 'request',
      callId: 'r-next',
      payload: { url: 'https://api.test/song', method: 'GET', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(relayed[1].cookie).toBe('sid=abc');

    // 脚本自己设了 Cookie 头时以脚本为准
    controls.emit({
      kind: 'request',
      callId: 'r-manual',
      payload: { url: 'https://api.test/song', method: 'GET', headers: { Cookie: 'custom=1' }, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(relayed[2].Cookie).toBe('custom=1');
    expect(relayed[2].cookie).toBeUndefined();

    // 其它主机拿不到这个 cookie
    controls.emit({
      kind: 'request',
      callId: 'r-other',
      payload: { url: 'https://other.test/x', method: 'GET', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(relayed[3].cookie).toBeUndefined();
  });

  it('源请求：abortActiveRequests 取消在途请求并回包', async () => {
    const { sandbox, controls } = await mountSandbox(undefined, {
      relay: (_payload, signal) =>
        new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
        }),
    });
    controls.emit({
      kind: 'request',
      callId: 'r-cancel',
      payload: { url: 'https://a.test/slow', method: 'GET', headers: {}, bodyBase64: '' },
    });
    await vi.advanceTimersByTimeAsync(0);
    sandbox.abortActiveRequests();
    await vi.advanceTimersByTimeAsync(0);
    expect(lastOf(controls.posted)).toEqual({ kind: 'reply', callId: 'r-cancel', error: '请求已取消' });
  });

  it('源请求：并发超过上限时排队执行', async () => {
    const started: string[] = [];
    const resolvers: Array<() => void> = [];
    const { controls } = await mountSandbox(undefined, {
      relay: async (payload) => {
        started.push(payload.url);
        await new Promise<void>((resolve) => resolvers.push(resolve));
        return { envelope: { status: 200, statusText: 'OK', headers: {}, bodyBase64: '' } };
      },
    });

    for (let index = 0; index < 8; index += 1) {
      controls.emit({
        kind: 'request',
        callId: `req-${index}`,
        payload: { url: `https://a.test/${index}`, method: 'GET', headers: {}, bodyBase64: '' },
      });
    }
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(6);
    resolvers.shift()?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(7);
    resolvers.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toHaveLength(8);
  });

  it('记录 updateAlert、日志上限与订阅通知', async () => {
    const { sandbox, controls } = await mountSandbox();
    const listener = vi.fn();
    const unsubscribe = sandbox.subscribe(listener);

    controls.emit({ kind: 'send', event: 'other', data: {} });
    controls.emit({ kind: 'send', event: 'updateAlert', data: { log: '' } });
    controls.emit({ kind: 'send', event: 'updateAlert', data: { log: '升级到 2.0', updateUrl: 'https://u' } });
    controls.emit({ kind: 'console', level: 'warn', message: '警告' });
    controls.emit({ kind: 'error', message: '崩了' });
    controls.emit({ kind: 'pong' });
    for (let index = 0; index < 60; index += 1) {
      controls.emit({ kind: 'console', level: 'log', message: `第 ${index} 条` });
    }

    const snapshot = sandbox.getSnapshot();
    expect(snapshot.updateAlert).toEqual({ log: '升级到 2.0', updateUrl: 'https://u' });
    expect(snapshot.logs).toHaveLength(50);
    expect(lastOf(snapshot.logs)).toBe('[log] 第 59 条');
    expect(listener).toHaveBeenCalled();

    unsubscribe();
    const before = listener.mock.calls.length;
    controls.emit({ kind: 'console', level: 'log', message: '卸载后' });
    expect(listener.mock.calls.length).toBe(before);
  });

  it('畸形消息被忽略', async () => {
    const { controls } = await mountSandbox();
    expect(() => {
      controls.emit(null as unknown as SandboxToHostMessage);
      controls.emit(42 as unknown as SandboxToHostMessage);
      controls.emit({ kind: 'unknown' } as unknown as SandboxToHostMessage);
    }).not.toThrow();
  });

  it('就绪之后到达的运行期错误只记日志，不改状态', async () => {
    const { sandbox, controls } = await mountSandbox();
    controls.emitError('晚到的错误');
    expect(sandbox.getSnapshot().status).toBe('ready');
    expect(sandbox.getSnapshot().logs.some((line) => line.includes('晚到的错误'))).toBe(true);

    controls.emitError('');
    expect(sandbox.getSnapshot().logs.some((line) => line.includes('沙箱运行期错误'))).toBe(true);
  });

  it('默认依赖不可用（环境不支持 Worker 或 blob）时失败而不是抛出', async () => {
    const sandbox = new LxSandbox({ code: 'x', meta: META });
    await sandbox.initialize();
    expect(sandbox.getSnapshot().status).toBe('failed');
    expect(sandbox.getSnapshot().error).not.toBe('');
    // 释放路径同样使用默认依赖（撤销 blob），不应抛出。
    expect(() => sandbox.dispose()).not.toThrow();
  });

  it('dispose 终止 Worker、释放 blob，并把在途调用结算为失败', async () => {
    const revoked: string[] = [];
    const { sandbox, controls } = await mountSandbox(undefined, {
      createObjectUrl: () => 'blob:runtime',
      revokeObjectUrl: (url) => revoked.push(url),
    });

    const pending = sandbox.call('wy', 'musicUrl', {});
    sandbox.dispose();
    await expect(pending).resolves.toEqual({ ok: false, result: null, error: '沙箱已释放' });
    expect(controls.terminated()).toBe(true);
    expect(revoked).toEqual(['blob:runtime']);

    sandbox.dispose();
    expect(revoked).toEqual(['blob:runtime']);
  });
});
