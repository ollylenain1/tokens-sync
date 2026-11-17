import http from 'node:http';
import { readFile } from 'node:fs/promises';
const port = Number(process.argv.find((arg) => arg.startsWith('--port='))?.split('=')[1] ?? 4174);
http
  .createServer(async (req, res) => {
    if (new URL(req.url, 'http://127.0.0.1').pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    try {
      res
        .writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' })
        .end(await readFile('dist/ui.html'));
    } catch {
      res.writeHead(503).end('Run npm run build first.');
    }
  })
  .listen(port, '127.0.0.1', () =>
    console.log(`Plugin UI preview: http://127.0.0.1:${port}/?demo=1 (demo data only)`),
  );
