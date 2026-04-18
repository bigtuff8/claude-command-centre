import { Router, Request, Response } from 'express';
import { getPortfolioState, refreshPortfolioCache } from '../portfolio/cache';

export function createPortfolioRouter(): Router {
  const router = Router();

  router.get('/projects', handleGetProjects);
  router.get('/projects/:id', handleGetProjectById);
  router.get('/gates', handleGetGates);
  router.get('/risks', handleGetRisks);
  router.get('/activity', handleGetActivity);
  router.get('/audit', handleGetAudit);
  router.get('/health', handleGetHealth);
  router.post('/sync', handleSync);
  router.post('/risks/:id/accept', handleAcceptRisk);
  router.post('/risks/:id/mitigate', handleMitigateRisk);

  return router;
}

function handleGetProjects(_req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    res.json(state.portfolioProjects);
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching projects: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetProjectById(req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    const project = state.portfolioProjects.find(
      (p) => p.portfolioProjectId === req.params.id
    );
    if (!project) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }
    res.json(project);
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching project ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetGates(_req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    const gatedProjects = state.portfolioProjects.filter(
      (p) => p.portfolioProjectGateType !== null
    );
    res.json(gatedProjects);
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching gates: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetRisks(_req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    res.json(state.portfolioRisks);
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching risks: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetActivity(req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const capped = Math.max(1, Math.min(limit, 200));
    res.json(state.portfolioActivity.slice(0, capped));
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching activity: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetAudit(_req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    res.json(state.portfolioAudit);
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching audit: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleGetHealth(_req: Request, res: Response): void {
  try {
    const state = getPortfolioState();
    res.json({
      score: state.portfolioHealthScore,
      lastSync: state.portfolioLastSyncTime,
    });
  } catch (err: any) {
    console.log(`[Portfolio] Error fetching health: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleSync(_req: Request, res: Response): void {
  try {
    console.log('[Portfolio] Manual sync triggered');
    const state = refreshPortfolioCache();
    res.json(state);
  } catch (err: any) {
    console.log(`[Portfolio] Error during manual sync: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleAcceptRisk(req: Request, res: Response): void {
  try {
    const riskId = req.params.id;
    console.log(`[Portfolio] Risk accept requested for: ${riskId} (write-back is Phase 2)`);
    res.json({ ok: true, riskId, action: 'accept', message: 'Risk acceptance recorded — write-back to risk register is Phase 2' });
  } catch (err: any) {
    console.log(`[Portfolio] Error accepting risk ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}

function handleMitigateRisk(req: Request, res: Response): void {
  try {
    const riskId = req.params.id;
    console.log(`[Portfolio] Risk mitigation requested for: ${riskId} (write-back is Phase 2)`);
    res.json({ ok: true, riskId, action: 'mitigate', message: 'Risk mitigation recorded — write-back to risk register is Phase 2' });
  } catch (err: any) {
    console.log(`[Portfolio] Error mitigating risk ${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
}
