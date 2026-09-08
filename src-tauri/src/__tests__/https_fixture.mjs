// 只监听回环地址。随附私钥仅属于测试证书，不用于任何正式服务。
import { createServer } from 'node:https';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = process.argv[2];
const replies = JSON.parse(readFileSync(join(directory, 'replies.json'), 'utf8'));
const server = createServer({
  cert: readFileSync(new URL('./https-cert.pem', import.meta.url)),
  key: readFileSync(new URL('./https-test-key.pem', import.meta.url)),
}, async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  const url = new URL(request.url, `https://${request.headers.host}`);
  const index = replies.findIndex(reply => reply.host === url.hostname && reply.path === url.pathname);
  const reply = index < 0 ? { status: 500, body: 'Unexpected test request' } : replies.splice(index, 1)[0];
  appendFileSync(join(directory, 'calls.jsonl'), `${JSON.stringify({ host: url.hostname, path: url.pathname, method: request.method, query: Object.fromEntries(url.searchParams), headers: request.headers, body, unexpected: index < 0 })}\n`);
  if (reply.disconnect) { request.socket.destroy(); return; }
  response.writeHead(reply.status ?? 200, {
    'content-type': 'application/json',
    'content-length': reply.length ?? Buffer.byteLength(reply.body),
    connection: 'close',
  });
  response.flushHeaders();
  response.end(reply.body);
});
server.listen(0, '127.0.0.1', () => process.stdout.write(`${server.address().port}\n`));
