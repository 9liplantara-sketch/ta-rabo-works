import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors } from '../lib/http.js';
import { canWriteKnowledgeRecord } from '../lib/knowledge-access.js';
import { listKnowledgeSources } from '../lib/knowledge-sources.js';

export default withCors(async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

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
});
