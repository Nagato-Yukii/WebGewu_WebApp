import * as fs from 'fs';
import { spawn } from 'child_process';
import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

export interface LocalTinkerSessionStartResult {
  started: boolean;
  pid: number | null;
  scriptPath: string;
  runId: string;
  logFile: string;
  trainerWorkingDirectory: string;
  playDelaySeconds: number;
  sceneTarget: 'WebTinkerRL';
  trainerPort: number;
  state: 'idle' | 'bootstrapping' | 'ready' | 'error';
  ready: boolean;
  lastError: string;
  startedAt: number;
  updatedAt: number;
}

export class LocalTinkerSessionService {
  private readonly isWindows: boolean;
  private readonly repoRoot: string;
  private readonly shellExecutable: string;
  private readonly scriptPath: string;
  private readonly runId: string;
  private readonly logFile: string;
  private readonly routeLogFile: string;
  private readonly trainerWorkingDirectory: string;
  private readonly configPath: string;
  private readonly playDelaySeconds: number;
  private readonly trainerPort: number;
  private readonly readinessTimeoutMs: number;
  private activeBootstrap: LocalTinkerSessionStartResult | null = null;
  private activeBootstrapExpiresAt = 0;
  private readinessPollTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.isWindows = os.platform() === 'win32';
    this.repoRoot = process.env.TINKER_REPO_ROOT || this.resolveRepoRoot();

    if (this.isWindows) {
      this.shellExecutable = process.env.TINKER_POWERSHELL_PATH || path.join(
        process.env.SystemRoot || 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe',
      );
      this.scriptPath = process.env.TINKER_LOCAL_SESSION_SCRIPT || path.join(this.repoRoot, 'start-webtinker-local-editor.ps1');
      this.trainerWorkingDirectory = path.join(this.repoRoot, 'gewu', 'Assets', 'WebRL_workspace');
      this.logFile = path.join(this.repoRoot, 'gewu', 'Temp', 'webtinker-local-bootstrap.log');
      this.routeLogFile = path.join(this.repoRoot, 'gewu', 'Temp', 'webtinker-local-route.log');
    } else {
      const condaEnvPath = process.env.TINKER_CONDA_ENV_PATH || '/home/suzumiyaharuhi/anaconda3/envs/gewu';
      this.shellExecutable = process.env.TINKER_PYTHON_PATH || path.join(condaEnvPath, 'bin', 'python');
      this.scriptPath = '';
      const unityProjectRoot = process.env.TINKER_UNITY_PROJECT_ROOT || '/home/suzumiyaharuhi/WebGewu';
      this.trainerWorkingDirectory = path.join(unityProjectRoot, 'Assets', 'WebRL_workspace');
      this.logFile = path.join(unityProjectRoot, 'Temp', 'webtinker-local-bootstrap.log');
      this.routeLogFile = path.join(unityProjectRoot, 'Temp', 'webtinker-local-route.log');
    }

    this.configPath = path.join(this.trainerWorkingDirectory, 'config.yaml');
    this.runId = process.env.TINKER_LOCAL_RUN_ID || 'webtinkerrl';
    this.playDelaySeconds = 10;
    this.trainerPort = Number(process.env.TINKER_TRAINER_PORT || 5004);
    this.readinessTimeoutMs = Number(process.env.TINKER_TRAINER_READY_TIMEOUT_MS || 60000);
  }

  start(forceRestart = false): LocalTinkerSessionStartResult {
    fs.mkdirSync(path.dirname(this.routeLogFile), { recursive: true });
    this.ensurePaths();

    if (!forceRestart &&
      this.activeBootstrap !== null &&
      (this.activeBootstrap.state === 'bootstrapping' || this.activeBootstrap.state === 'ready') &&
      Date.now() < this.activeBootstrapExpiresAt) {
      this.appendRouteLog(
        `Reusing active bootstrap. pid=${this.activeBootstrap.pid ?? 'null'} state=${this.activeBootstrap.state} expiresAt=${new Date(this.activeBootstrapExpiresAt).toISOString()}`,
      );
      return this.activeBootstrap;
    }

    this.appendRouteLog(`Launching bootstrap. platform=${os.platform()} executable=${this.shellExecutable}`);

    const now = Date.now();
    const result: LocalTinkerSessionStartResult = {
      started: true,
      pid: null,
      scriptPath: this.isWindows ? this.scriptPath : this.shellExecutable,
      runId: this.runId,
      logFile: this.logFile,
      trainerWorkingDirectory: this.trainerWorkingDirectory,
      playDelaySeconds: this.playDelaySeconds,
      sceneTarget: 'WebTinkerRL',
      trainerPort: this.trainerPort,
      state: 'bootstrapping',
      ready: false,
      lastError: '',
      startedAt: now,
      updatedAt: now,
    };

    this.activeBootstrap = result;
    this.activeBootstrapExpiresAt = now + this.readinessTimeoutMs;

    const child = this.isWindows
      ? spawn(this.shellExecutable, [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          this.scriptPath,
          '-RunId',
          this.runId,
          '-PlayDelaySeconds',
          String(this.playDelaySeconds),
          '-LogFile',
          this.logFile,
        ], {
          cwd: this.repoRoot,
          detached: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
        })
      : spawn(this.shellExecutable, [
          '-m',
          'mlagents.trainers.learn',
          this.configPath,
          `--run-id=${this.runId}`,
          '--force',
        ], {
          cwd: this.trainerWorkingDirectory,
          detached: false,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, PYTHONNOUSERSITE: '1' },
        });

    child.once('spawn', () => {
      if (this.activeBootstrap !== null) {
        this.activeBootstrap.pid = child.pid || null;
        this.activeBootstrap.updatedAt = Date.now();
      }
      this.appendRouteLog(`Bootstrap process spawned. pid=${child.pid || 'unknown'}`);
    });

    child.once('error', (error) => {
      this.markBootstrapError(error.message);
      this.appendRouteLog(`Bootstrap process error: ${error.message}`);
    });

    child.once('exit', (code, signal) => {
      this.appendRouteLog(`Bootstrap process exited. code=${code === null ? 'null' : code} signal=${signal === null ? 'null' : signal}`);
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      this.appendRouteLog(`Bootstrap stdout: ${chunk.toString().trim()}`);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      this.appendRouteLog(`Bootstrap stderr: ${chunk.toString().trim()}`);
    });

    this.beginReadinessPolling();

    return result;
  }

  getStatus(): LocalTinkerSessionStartResult {
    if (this.activeBootstrap !== null) {
      return this.activeBootstrap;
    }

    const now = Date.now();
    return {
      started: false,
      pid: null,
      scriptPath: this.scriptPath,
      runId: this.runId,
      logFile: this.logFile,
      trainerWorkingDirectory: this.trainerWorkingDirectory,
      playDelaySeconds: this.playDelaySeconds,
      sceneTarget: 'WebTinkerRL',
      trainerPort: this.trainerPort,
      state: 'idle',
      ready: false,
      lastError: '',
      startedAt: now,
      updatedAt: now,
    };
  }

  private ensurePaths() {
    if (this.isWindows) {
      if (!fs.existsSync(this.scriptPath)) {
        throw new Error(`Local bootstrap script was not found: ${this.scriptPath}`);
      }

      if (!fs.existsSync(this.shellExecutable)) {
        throw new Error(`Powershell executable was not found: ${this.shellExecutable}`);
      }
    } else {
      if (!fs.existsSync(this.shellExecutable)) {
        throw new Error(
          `Python executable was not found: ${this.shellExecutable}. ` +
          `Please verify the conda env 'gewu' is installed at the expected path.`,
        );
      }

      if (!fs.existsSync(this.configPath)) {
        throw new Error(`Trainer config was not found: ${this.configPath}`);
      }
    }

    if (!fs.existsSync(this.trainerWorkingDirectory)) {
      throw new Error(`Trainer working directory was not found: ${this.trainerWorkingDirectory}`);
    }
  }

  private beginReadinessPolling() {
    if (this.readinessPollTimer !== null) {
      clearInterval(this.readinessPollTimer);
      this.readinessPollTimer = null;
    }

    this.readinessPollTimer = setInterval(() => {
      void this.pollTrainerReadiness();
    }, 750);
  }

  private async pollTrainerReadiness() {
    if (this.activeBootstrap === null) {
      this.stopReadinessPolling();
      return;
    }

    if (this.activeBootstrap.state !== 'bootstrapping') {
      this.stopReadinessPolling();
      return;
    }

    if (Date.now() >= this.activeBootstrap.startedAt + this.readinessTimeoutMs) {
      this.markBootstrapError(
        `Trainer port ${this.trainerPort} did not become ready within ${Math.floor(this.readinessTimeoutMs / 1000)} seconds.`,
      );
      return;
    }

    const isReady = await this.isTrainerPortOpen(this.trainerPort);
    if (!isReady || this.activeBootstrap === null || this.activeBootstrap.state !== 'bootstrapping') {
      return;
    }

    this.activeBootstrap.ready = true;
    this.activeBootstrap.state = 'ready';
    this.activeBootstrap.updatedAt = Date.now();
    this.activeBootstrap.lastError = '';
    this.activeBootstrapExpiresAt = Date.now() + (5 * 60 * 1000);
    this.appendRouteLog(`Trainer readiness confirmed on port ${this.trainerPort}.`);
    this.stopReadinessPolling();
  }

  private markBootstrapError(message: string) {
    if (this.activeBootstrap !== null) {
      this.activeBootstrap.state = 'error';
      this.activeBootstrap.ready = false;
      this.activeBootstrap.lastError = message;
      this.activeBootstrap.updatedAt = Date.now();
    }

    this.appendRouteLog(`Bootstrap marked as error: ${message}`);
    this.stopReadinessPolling();
  }

  private stopReadinessPolling() {
    if (this.readinessPollTimer !== null) {
      clearInterval(this.readinessPollTimer);
      this.readinessPollTimer = null;
    }
  }

  private isTrainerPortOpen(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = new net.Socket();
      let settled = false;

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }

        settled = true;
        socket.destroy();
        resolve(value);
      };

      socket.setTimeout(300);
      socket.once('connect', () => finish(true));
      socket.once('timeout', () => finish(false));
      socket.once('error', () => finish(false));

      try {
        socket.connect(port, '127.0.0.1');
      } catch {
        finish(false);
      }
    });
  }

  private resolveRepoRoot(): string {
    const candidates = [
      path.resolve(__dirname, '../../../..'),
      path.resolve(__dirname, '../../..'),
      process.cwd(),
    ];

    for (const candidate of candidates) {
      if (this.looksLikeRepoRoot(candidate)) {
        return candidate;
      }
    }

    return path.resolve(__dirname, '../../../..');
  }

  private looksLikeRepoRoot(candidate: string): boolean {
    if (this.isWindows) {
      return fs.existsSync(path.join(candidate, 'start-webtinker-local-editor.ps1')) &&
        fs.existsSync(path.join(candidate, 'WebApp')) &&
        fs.existsSync(path.join(candidate, 'gewu'));
    }

    return fs.existsSync(path.join(candidate, 'Assets', 'WebRL_workspace', 'config.yaml'));
  }

  private appendRouteLog(message: string) {
    const timestamp = new Date().toISOString();
    fs.appendFileSync(this.routeLogFile, `[${timestamp}] ${message}\n`);
  }
}
