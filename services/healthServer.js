const http = require('http');

const mongoose = require('mongoose');

const metrics = require('../utils/metrics');
const User = require('../models/User');

function readBearerToken(authHeader) {
  const s = String(authHeader || '').trim();
  const m = s.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : '';
}

function isAuthorized(req) {
  const required = String(process.env.HEALTH_TOKEN || '').trim();
  if (!required) return true;

  const headerToken = String(req.headers['x-api-key'] || req.headers['x-health-token'] || '').trim();
  const bearer = readBearerToken(req.headers.authorization);
  const provided = headerToken || bearer;
  return provided && provided === required;
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload));
}

/**
 * Minimal health/metrics server (optional).
 * - GET /health -> ok
 * - GET /metrics -> JSON counters
 * - GET /stats -> bot status + users count (requires HEALTH_TOKEN if set)
 */
function startHealthServer({ port }) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (!isAuthorized(req)) {
      sendJson(res, 401, { ok: false, error: 'unauthorized' });
      return;
    }

    if (url.pathname === '/health') {
      sendJson(res, 200, {
        ok: true,
        uptimeSec: Math.floor(process.uptime()),
        dbReadyState: mongoose.connection.readyState
      });
      return;
    }

    if (url.pathname === '/metrics') {
      sendJson(res, 200, metrics.snapshot());
      return;
    }

    if (url.pathname === '/stats') {
      (async () => {
        const userFilter = { telegramId: { $exists: true, $ne: null } };
        const [totalUsers, blockedUsers, inQuizUsers] = await Promise.all([
          User.countDocuments(userFilter),
          User.countDocuments({ ...userFilter, isBlocked: true }),
          User.countDocuments({ ...userFilter, step: 'in_quiz' })
        ]);

        return {
          ok: true,
          uptimeSec: Math.floor(process.uptime()),
          dbReadyState: mongoose.connection.readyState,
          users: {
            total: totalUsers,
            blocked: blockedUsers,
            inQuiz: inQuizUsers
          },
          metrics: metrics.snapshot()
        };
      })()
        .then((payload) => sendJson(res, 200, payload))
        .catch((err) => sendJson(res, 500, { ok: false, error: err?.message || String(err) }));
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
