import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const root = resolve(process.argv[2] ?? '.');
const port = Number(process.env.PORT ?? 5173);
const types = { '.html':'text/html', '.js':'text/javascript', '.json':'application/json', '.css':'text/css', '.svg':'image/svg+xml', '.ttf':'font/ttf', '.png':'image/png' };
createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    const path = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (path !== root && !path.startsWith(root+sep)) { res.writeHead(403).end(); return; }
    const data = await readFile(path);
    res.writeHead(200, { 'content-type': `${types[extname(path)] ?? 'application/octet-stream'}; charset=utf-8`, 'cache-control':'no-store' });
    res.end(data);
  } catch { res.writeHead(404).end(); }
}).listen(port,'0.0.0.0',() => console.log(`Local: http://localhost:${port}`));
