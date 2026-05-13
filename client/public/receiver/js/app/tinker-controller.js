import { createEnvelope } from "../protocol/envelope.js";

export class TinkerController {
  constructor(apiClient, rtcClient, sceneController, store) {
    this.apiClient = apiClient;
    this.rtcClient = rtcClient;
    this.sceneController = sceneController;
    this.store = store;
    this.startPromise = null;
    this.activeSequence = 0;
  }

  async start(options = {}) {
    if (!options.forceRestart && this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal(options);
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  async startInternal(options = {}) {
    this.cancelPending();
    const sequenceId = ++this.activeSequence;
    this.store.patch({
      trainer: {
        state: "bootstrapping",
        error: "",
      },
    });

    const result = await this.apiClient.startWebTinker({
      forceRestart: !!options.forceRestart,
    });
    const delayMs = (result.playDelaySeconds || 10) * 1000;

    this.store.patch({
      trainer: {
        state: result.state || "bootstrapping",
        pid: result.pid || null,
        runId: result.runId || "webtinkerrl",
        scriptPath: result.scriptPath || "",
        logFile: result.logFile || "",
        trainerWorkingDirectory: result.trainerWorkingDirectory || "",
        delayMs: delayMs,
        trainerPort: Number(result.trainerPort) || 5004,
        error: result.lastError || "",
      },
    });

    const readyStatus = await this.waitForTrainerReady(sequenceId);
    if (!readyStatus) {
      return result;
    }

    this.rtcClient.send(createEnvelope("training.set_flag", {
      enabled: true,
      source: "external",
    }));

    this.sceneController.requestSceneLoad(readyStatus.sceneTarget || result.sceneTarget || "WebTinkerRL", {
      mode: "additive",
      forceReload: true,
    });

    this.store.patch({
      trainer: {
        state: "scene_loading",
        error: "",
      },
      ui: {
        activePanel: "webtinker",
      },
    });

    return result;
  }

  stop() {
    this.cancelPending();

    this.rtcClient.send(createEnvelope("training.set_flag", {
      enabled: false,
      source: "external",
    }));

    this.sceneController.returnToMenu();

    this.store.patch({
      trainer: {
        state: "idle",
      },
    });
  }

  cancelPending() {
    this.activeSequence += 1;
  }

  async waitForTrainerReady(sequenceId) {
    const timeoutMs = 60000;
    const startedAt = Date.now();

    while (sequenceId === this.activeSequence) {
      const status = await this.apiClient.getWebTinkerStatus();
      if (sequenceId !== this.activeSequence) {
        return null;
      }

      this.store.patch({
        trainer: {
          state: status.state || "bootstrapping",
          pid: status.pid || null,
          runId: status.runId || "webtinkerrl",
          scriptPath: status.scriptPath || "",
          logFile: status.logFile || "",
          trainerWorkingDirectory: status.trainerWorkingDirectory || "",
          delayMs: ((status.playDelaySeconds || 10) * 1000),
          trainerPort: Number(status.trainerPort) || 5004,
          error: status.lastError || "",
        },
      });

      if (status.state === "ready" || status.ready) {
        return status;
      }

      if (status.state === "error") {
        throw new Error(status.lastError || "Local trainer bootstrap failed.");
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error("Local trainer bootstrap timed out while waiting for trainer readiness.");
      }

      await this.sleep(750);
    }

    return null;
  }

  sleep(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }
}
