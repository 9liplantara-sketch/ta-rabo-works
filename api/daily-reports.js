import { requireSession, enrichUserFromDb } from '../lib/auth.js';
import { withCors, readJsonBody } from '../lib/http.js';
import {
  canViewReport,
  createDailyReport,
  findDailyReportById,
  listDailyReports,
  mapReportRow,
  parseListParams,
  updateDailyReport,
} from '../lib/daily-reports.js';

export default withCors(async (req, res) => {
  const session = await requireSession(req);
  const user = await enrichUserFromDb(session);

  if (req.method === 'GET') {
    const reportId = String(req.query?.id || '').trim();

    if (reportId) {
      const row = await findDailyReportById(reportId);
      if (!row) {
        res.status(404).json({ error: 'Report not found' });
        return;
      }
      if (!canViewReport(user, row)) {
        res.status(403).json({ error: 'Forbidden', code: 'forbidden' });
        return;
      }
      res.status(200).json({ report: mapReportRow(row) });
      return;
    }

    const params = parseListParams(req.query);
    const result = await listDailyReports(user, params);
    res.status(200).json({
      reports: result.reports,
      view: params.view,
      limit: result.limit,
      offset: result.offset,
      has_more: result.has_more,
    });
    return;
  }

  if (req.method === 'POST') {
    const body = readJsonBody(req);
    const report = await createDailyReport(user, body);
    res.status(201).json({ report });
    return;
  }

  if (req.method === 'PATCH') {
    const body = readJsonBody(req);
    const reportId = String(req.query?.id || body.id || '').trim();
    if (!reportId) {
      res.status(400).json({ error: 'id は必須です' });
      return;
    }
    const report = await updateDailyReport(user, reportId, body);
    res.status(200).json({ report });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
});
