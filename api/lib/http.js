import { applyCors, handleOptions } from './cors.js';

export function withCors(handler) {
  return async (req, res) => {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      handleOptions(req, res);
      return;
    }
    try {
      await handler(req, res);
    } catch (err) {
      console.error(err);
      const status = err.status || 500;
      res.status(status).json({
        error: err.message || 'Internal Server Error',
      });
    }
  };
}

export function readJsonBody(req) {
  if (!req.body) return {};
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }
  return req.body;
}
