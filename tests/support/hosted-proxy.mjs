import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';

// CI-only TLS termination, matching a cloud proxy in front of the HTTP container.
https.createServer({ key: readFileSync('.local/ci-tls/key.pem'), cert: readFileSync('.local/ci-tls/cert.pem') }, (req, res) => {
  const upstream = http.request({ hostname: '127.0.0.1', port: 10000, method: req.method, path: req.url, headers: req.headers }, response => {
    res.writeHead(response.statusCode ?? 502, response.headers); response.pipe(res);
  });
  upstream.on('error', () => { res.writeHead(502); res.end(); });
  req.pipe(upstream);
}).listen(3443, '127.0.0.1');
