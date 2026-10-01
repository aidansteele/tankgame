import http from 'node:http';
import { readFile } from 'node:fs/promises';
const files = { '/': ['index.html', 'text/html'], '/style.css': ['style.css', 'text/css'], '/game.js': ['game.js', 'text/javascript'], '/physics.js': ['physics.js', 'text/javascript'], '/multiplayer.js': ['multiplayer.js', 'text/javascript'], '/vendor/peerjs.min.js': ['vendor/peerjs.min.js', 'text/javascript'], '/social-preview.png': ['social-preview.png', 'image/png'] };
const port = Number(process.env.PORT || 3000);
http.createServer(async (req, res) => {
  const file = files[new URL(req.url, 'http://localhost').pathname];
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try { res.setHeader('Content-Type', file[1]); res.end(await readFile(new URL(file[0], import.meta.url))); }
  catch { res.writeHead(500); res.end('Unable to load file'); }
}).listen(port, '0.0.0.0', () => console.log(`Afterburn: http://localhost:${port}`));
