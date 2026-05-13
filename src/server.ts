import * as express from 'express';
import * as path from 'path';
import * as fs from 'fs';
import * as morgan from 'morgan';
import tinkerLocalSession from './tinkerlocalsession';
import { log, LogLevel } from './log';
import Options from './class/options';

const cors = require('cors');

export const createServer = (config: Options): express.Application => {
  const app: express.Application = express();
  const noStoreStaticHeaders = (res: express.Response) => {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
  };

  if (config.logging != 'none') {
    app.use(morgan(config.logging));
  }

  app.use(cors({ origin: '*' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.get('/config', (_req, res) => res.json({ useWebSocket: true, startupMode: config.mode, logging: config.logging }));
  app.use('/api/tinker/local-session', tinkerLocalSession);
  app.use(express.static(path.join(__dirname, '../client/public'), { setHeaders: noStoreStaticHeaders }));
  app.use('/module', express.static(path.join(__dirname, '../client/src'), { setHeaders: noStoreStaticHeaders }));
  app.get('/', (_req, res) => {
    const indexPagePath: string = path.join(__dirname, '../client/public/index.html');
    fs.access(indexPagePath, (err) => {
      if (err) {
        log(LogLevel.warn, `Can't find file ${indexPagePath}`);
        res.status(404).send(`Can't find file ${indexPagePath}`);
      } else {
        noStoreStaticHeaders(res);
        res.sendFile(indexPagePath);
      }
    });
  });

  return app;
};