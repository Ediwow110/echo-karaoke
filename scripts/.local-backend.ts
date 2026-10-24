// Local-only: POS keeps 3001 and vercel dev defaults to 3000. This launcher
// serves the app on 5180 and the API on 3002 instead.
process.env.BETTER_AUTH_URL ??= 'http://localhost:5180';
process.env.ALLOWED_ORIGINS ??= 'http://localhost:5180,http://127.0.0.1:5180';

import { createServer } from 'node:http';
const { default: router } = await import('../api/router.ts');

const PORT = 3002;

const server = createServer(async (req, res) => {
  try {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks);
    const url = new URL(req.url ?? '', 'http://localhost:' + PORT);
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

server.listen(PORT, '127.0.0.1', () => {
  console.log('Local backend API listening on http://127.0.0.1:' + PORT);
});
