process.env.BETTER_AUTH_URL ??= 'http://localhost:5173';
process.env.ALLOWED_ORIGINS ??= 'http://localhost:5173,http://127.0.0.1:5173';

import { createServer } from 'node:http';
const { default: router } = await import('../api/router.ts');

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '', 'http://localhost:3001');
    const request = new Request(url.toString(), {
      method: req.method,
      headers: req.headers as unknown as Record<string, string>,
      body: req.method === 'GET' || req.method === 'HEAD' ? null : body,
      duplex: 'half',
    });
    const result = await router.fetch(request);
    res.statusCode = result.status;
    result.headers.forEach((value, key) => {
      if (key !== 'set-cookie') res.setHeader(key, value);
    });
    const cookies = result.headers.getSetCookie();
    if (cookies.length > 0) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await result.arrayBuffer()));
  } catch (err: any) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain');
    res.end(err.message);
  }
});

server.listen(3001, '127.0.0.1', () => {
  console.log('Backend API server listening on http://127.0.0.1:3001');
});
