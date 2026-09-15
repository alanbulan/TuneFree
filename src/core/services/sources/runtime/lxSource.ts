/**
 * 沙箱运行时片段：`globalThis.lx` 宿主桥。
 *
 * 必须最后拼接（依赖 buffer/crypto 片段的工具函数）。这里只负责：
 * - 定义 `lx`（EVENT_NAMES / env / version / on / send / request / utils / currentScriptInfo）；
 * - 把 `send` 与 `request` 桥接到父窗口 RPC；
 * - 接收父窗口的 `load` / `invoke` / `reply` 指令，执行脚本并回调结果；
 * - 捕获错误与 console，交给父窗口落日志。
 */
export const RUNTIME_LX_SOURCE = String.raw`
/* ---------- lx 宿主桥 ---------- */

const tfRuntimeConfig = globalThis.__TUNEFREE_RUNTIME__ || {};
const tfHandlers = {};
const tfPending = {};
let tfCallSeq = 0;

const tfPost = (message) => {
  postMessage(message);
};

const tfDescribe = (value) => {
  if (value instanceof Error) return value.message || value.name || 'Error';
  if (value && typeof value.message === 'string' && value.message) return value.message;
  try {
    return typeof value === 'string' ? value : JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const tfSafeResult = (value) => {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (error) {
    return String(value);
  }
};

const tfHasHeader = (headers, name) =>
  Object.keys(headers).some((key) => key.toLowerCase() === name);

const tfNormalizeHeaders = (headers) => {
  const out = {};
  if (headers && typeof headers === 'object') {
    Object.keys(headers).forEach((name) => {
      const value = headers[name];
      if (value !== undefined && value !== null) out[String(name)] = String(value);
    });
  }
  return out;
};

const tfUrlEncodeForm = (form) =>
  Object.keys(form)
    .map((key) => encodeURIComponent(key) + '=' + encodeURIComponent(form[key]))
    .join('&');

/* 洛雪 request 的 body 语义：form（表单）、json、string、Buffer。 */
const tfBuildRequestBody = (settings, headers) => {
  if (settings.form && typeof settings.form === 'object') {
    if (!tfHasHeader(headers, 'content-type')) headers['content-type'] = 'application/x-www-form-urlencoded';
    return tfBytesFromString(tfUrlEncodeForm(settings.form), 'utf-8');
  }
  if (settings.json !== undefined) {
    if (!tfHasHeader(headers, 'content-type')) headers['content-type'] = 'application/json';
    return tfBytesFromString(JSON.stringify(settings.json), 'utf-8');
  }
  const body = settings.body;
  if (body === undefined || body === null) return new Uint8Array(0);
  if (typeof body === 'string') return tfBytesFromString(body, 'utf-8');
  return tfToBytes(body);
};

const tfHeaderValue = (headers, name) => {
  const wanted = name.toLowerCase();
  const keys = Object.keys(headers || {});
  for (let i = 0; i < keys.length; i += 1) {
    if (keys[i].toLowerCase() === wanted) return headers[keys[i]];
  }
  return '';
};

/* 把 Rust 源代理的信封还原成洛雪 request 的回调响应。 */
const tfBuildResponse = (envelope) => {
  const raw = tfDecodeBase64(envelope.bodyBase64 || '');
  const text = tfStringFromBytes(raw, 'utf-8');
  const contentType = tfHeaderValue(envelope.headers, 'content-type');
  let body = text;
  if (/json/i.test(contentType) || /^\s*[\[{]/.test(text)) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      body = text;
    }
  }
  const headers = envelope.headers || {};
  // 浏览器读不到 set-cookie，源代理把它单独放在 cookies 字段里；
  // 这里按 Node/LX 的语义（数组）补回响应头，供登录类脚本自取自用。
  if (Array.isArray(envelope.cookies) && envelope.cookies.length > 0) {
    headers['set-cookie'] = envelope.cookies;
  }
  return {
    statusCode: envelope.status,
    statusMessage: envelope.statusText,
    headers,
    body,
    raw: new TFBuffer(raw),
  };
};

const tfSettle = (callId, error, envelope) => {
  const entry = tfPending[callId];
  if (!entry) return;
  delete tfPending[callId];
  if (error) {
    const failure = new Error(String(error));
    if (entry.callback) entry.callback(failure, null);
    entry.reject(failure);
    return;
  }
  const response = tfBuildResponse(envelope || {});
  if (entry.callback) entry.callback(null, response);
  entry.resolve(response);
};

const tfRequest = (url, options, callback) => {
  const settings = options || {};
  const headers = tfNormalizeHeaders(settings.headers);
  const payload = {
    url: String(url),
    method: String(settings.method || 'GET').toUpperCase(),
    headers,
    bodyBase64: tfEncodeBase64(tfBuildRequestBody(settings, headers)),
  };
  if (typeof settings.timeout === 'number' && settings.timeout > 0) payload.timeoutMs = settings.timeout;
  if (settings.binary === true) payload.binary = true;

  tfCallSeq += 1;
  const callId = 'lx-call-' + tfCallSeq;
  const promise = new Promise((resolve, reject) => {
    tfPending[callId] = { callback: typeof callback === 'function' ? callback : null, resolve, reject };
  });
  // 脚本多数只传回调；这里吞掉无人处理的拒绝，避免噪音。
  promise.catch(() => {});
  tfPost({ kind: 'request', callId, payload });
  return promise;
};

const tfHandleLoad = (data) => {
  try {
    lx.currentScriptInfo = Object.assign({ rawScript: data.code || '' }, data.meta || {});
    const url = URL.createObjectURL(new Blob([data.code], { type: 'text/javascript' }));
    try {
      importScripts(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    tfPost({ kind: 'loaded' });
  } catch (error) {
    tfPost({ kind: 'load-error', message: tfDescribe(error) });
  }
};

const tfHandleInvoke = (data) => {
  const handler = (tfHandlers[data.event] || [])[0];
  if (typeof handler !== 'function') {
    tfPost({ kind: 'invoke-error', callId: data.callId, message: '脚本未注册 ' + data.event + ' 处理器' });
    return;
  }
  Promise.resolve()
    .then(() => handler(data.payload))
    .then(
      (result) => tfPost({ kind: 'invoke-result', callId: data.callId, result: tfSafeResult(result) }),
      (error) => tfPost({ kind: 'invoke-error', callId: data.callId, message: tfDescribe(error) }),
    );
};

/* ---------- lx 全局 ---------- */

const lx = {
  EVENT_NAMES: { request: 'request', inited: 'inited', updateAlert: 'updateAlert' },
  env: 'desktop',
  version: tfRuntimeConfig.appVersion || '0.0.0',
  currentScriptInfo: { rawScript: '' },
  on: (eventName, handler) => {
    if (typeof eventName !== 'string' || typeof handler !== 'function') return;
    if (!tfHandlers[eventName]) tfHandlers[eventName] = [];
    tfHandlers[eventName].push(handler);
  },
  send: (eventName, data) => {
    tfPost({ kind: 'send', event: String(eventName), data: tfSafeResult(data) });
  },
  request: tfRequest,
  utils: { buffer: tfBufferUtils, crypto: tfCryptoUtils },
};

globalThis.lx = lx;
// 少数脚本按浏览器环境探测；Worker 里没有 window，这里补上以免整段初始化条件失效。
globalThis.window = globalThis;
// document.currentScript 保持为空（打包器有回退分支），但把脚本原文兜底出去，
// 供「currentScriptInfo 缺失时读 script 标签」的老脚本使用。
globalThis.document = {
  currentScript: null,
  getElementsByTagName: () => [{ innerText: lx.currentScriptInfo.rawScript || '', src: '' }],
};

/* ---------- 错误与日志回流 ---------- */

addEventListener('error', (event) => {
  tfPost({ kind: 'error', message: tfDescribe(event && event.message ? event.message : event) });
});

addEventListener('unhandledrejection', (event) => {
  tfPost({ kind: 'error', message: 'unhandledrejection: ' + tfDescribe(event ? event.reason : undefined) });
});

['log', 'info', 'warn', 'error'].forEach((level) => {
  const original = console[level];
  console[level] = function () {
    const args = Array.prototype.slice.call(arguments).map(tfDescribe);
    tfPost({ kind: 'console', level: level, message: args.join(' ') });
    try {
      original.apply(console, arguments);
    } catch (error) {
      /* Worker 控制台不可用时静默 */
    }
  };
});

addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.kind === 'load') tfHandleLoad(data);
  else if (data.kind === 'invoke') tfHandleInvoke(data);
  else if (data.kind === 'reply') tfSettle(data.callId, data.error, data.envelope);
  else if (data.kind === 'ping') tfPost({ kind: 'pong' });
});

tfPost({ kind: 'ready', version: lx.version });
`;
