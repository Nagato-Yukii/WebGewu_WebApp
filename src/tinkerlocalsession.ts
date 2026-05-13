import * as express from 'express';
import { LocalTinkerSessionService } from './application/session/localtinkersessionservice';

const router = express.Router();
const service = new LocalTinkerSessionService();

router.post('/start', (req, res) => {
  try {
    const forceRestart = !!req.body?.forceRestart;
    res.json(service.start(forceRestart));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({
      started: false,
      error: message,
    });
  }
});

router.get('/status', (_req, res) => {
  res.json(service.getStatus());
});

export default router;
