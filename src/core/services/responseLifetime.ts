/** 令请求信号和计时器覆盖正文读取，直到 EOF、失败或取消时才释放。 */
export const bindResponseLifetime = (
  response: Response,
  linked: { signal: AbortSignal; cleanup: () => void },
): Response => {
  if (!response.body) {
    linked.cleanup();
    return response;
  }
  const reader = response.body.getReader();
  let finished = false;
  let abortBody: () => void;
  const finish = () => {
    if (finished) return;
    finished = true;
    linked.signal.removeEventListener('abort', abortBody);
    linked.cleanup();
  };
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      abortBody = () => {
        if (finished) return;
        finish();
        const reason = linked.signal.reason ?? new DOMException('请求已取消', 'AbortError');
        controller.error(reason);
        void reader.cancel(reason).catch(() => {}).finally(() => reader.releaseLock());
      };
      linked.signal.addEventListener('abort', abortBody, { once: true });
      if (linked.signal.aborted) abortBody();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (finished) return;
        if (result.done) {
          finish();
          reader.releaseLock();
          controller.close();
        } else {
          controller.enqueue(result.value);
        }
      } catch (error) {
        if (finished) return;
        finish();
        reader.releaseLock();
        controller.error(error);
      }
    },
    cancel(reason) {
      finish();
      return reader.cancel(reason).finally(() => reader.releaseLock());
    },
  });
  return new Response(body, {
    status: response.status, statusText: response.statusText, headers: response.headers,
  });
};
