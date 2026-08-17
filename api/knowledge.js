/**
 * Phase K1 knowledge API — single Vercel Function (Hobby 12-function limit)
 *
 * Rewrites (vercel.json):
 *   /api/knowledge-sources → /api/knowledge?resource=sources
 *   /api/knowledge-records  → /api/knowledge?resource=records
 */
import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import { canWriteKnowledgeRecord, canViewKnowledgeRecord } from '../lib/knowledge-access.js';
import {
  createKnowledgeRecord,
  updateKnowledgeRecord,
  deleteKnowledgeRecord,
  findKnowledgeRecordById,
  isKnowledgeRecordsTableReady,
} from '../lib/knowledge-records.js';
import { listKnowledgeSources, mapKnowledgeRecordToSource } from '../lib/knowledge-sources.js';

function resolveKnowledgeResource(req) {
  const fromQuery = String(req.query?.resource || '').trim();
  if (fromQuery === 'sources' || fromQuery === 'records') return fromQuery;
  const url = String(req.url || '');
  if (url.includes('knowledge-records')) return 'records';
  if (url.includes('knowledge-sources')) return 'sources';
  return 'sources';
}

async function handleKnowledgeSources(req, res, user) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const result = await listKnowledgeSources(user, req.query || {});
    res.status(200).json({
      sources: result.sources,
      limit: result.limit,
      offset: result.offset,
      has_more: result.has_more,
      knowledge_records_ready: result.knowledge_records_ready,
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message || 'Failed to list knowledge sources' });
  }
}

async function handleKnowledgeRecords(req, res, user) {
  const recordId = String(req.query?.id || '').trim();

  const tableReady = await isKnowledgeRecordsTableReady();
  if (!tableReady) {
    res.status(503).json({
      error: 'knowledge_records テーブルが未適用です。db/migrations/2026-08-knowledge-records.sql を Neon に適用してください。',
    });
    return;
  }

  if (req.method === 'GET') {
    if (!recordId) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }
    try {
      const record = await findKnowledgeRecordById(recordId);
      if (!record) {
        res.status(404).json({ error: 'Record not found' });
        return;
      }
      if (!canViewKnowledgeRecord(user, record)) {
        res.status(403).json({ error: 'Forbidden' });
        return;
      }
      res.status(200).json({ record, source: mapKnowledgeRecordToSource(record) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to get record' });
    }
    return;
  }

  if (!canWriteKnowledgeRecord(user)) {
    res.status(403).json({ error: 'Forbidden: admin only' });
    return;
  }

  if (req.method === 'POST') {
    try {
      const body = readJsonBody(req);
      const record = await createKnowledgeRecord(user, body);
      res.status(201).json({ record, source: mapKnowledgeRecordToSource(record) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to create record' });
    }
    return;
  }

  if (req.method === 'PATCH') {
    const body = readJsonBody(req);
    const id = recordId || String(body.id || '').trim();
    if (!id) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }
    try {
      const record = await updateKnowledgeRecord(user, id, body);
      res.status(200).json({ record, source: mapKnowledgeRecordToSource(record) });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to update record' });
    }
    return;
  }

  if (req.method === 'DELETE') {
    if (!recordId) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }
    try {
      await deleteKnowledgeRecord(user, recordId);
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message || 'Failed to delete record' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
}

export default withCors(async (req, res) => {
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);
  const resource = resolveKnowledgeResource(req);
  if (resource === 'records') {
    await handleKnowledgeRecords(req, res, user);
    return;
  }
  await handleKnowledgeSources(req, res, user);
});
