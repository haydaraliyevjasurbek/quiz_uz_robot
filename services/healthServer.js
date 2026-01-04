const http = require('http');

const metrics = require('../utils/metrics');

/**
 * Minimal health/metrics server (optional).
 * - GET /health -> ok
 * - GET /metrics -> JSON counters
 */
function startHealthServer({ port }) {
  const server = http.createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, uptimeSec: Math.floor(process.uptime()) }));
      return;
    }

    if (req.url === '/metrics') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(metrics.snapshot()));
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });

  server.listen(port);
  return server;
}

module.exports = {
  startHealthServer
};
