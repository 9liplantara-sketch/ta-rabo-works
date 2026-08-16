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
import { mapKnowledgeRecordToSource } from '../lib/knowledge-sources.js';

export default withCors(async (req, res) => {
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

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
});
