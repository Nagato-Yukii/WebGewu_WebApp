import { createEnvelope } from "../protocol/envelope.js";

export class SceneController {
  constructor(rtcClient) {
    this.rtcClient = rtcClient;
    this.pendingSceneRequest = null;
  }

  requestSceneLoad(scene, options = {}) {
    this.pendingSceneRequest = {
      scene: scene,
      mode: options.mode || "additive",
      forceReload: !!options.forceReload,
    };

    this.flush();
  }

  flush() {
    if (!this.pendingSceneRequest) {
      return;
    }

    const sentEnvelope = this.rtcClient.send(
      createEnvelope("scene.load", this.pendingSceneRequest),
    );

    if (sentEnvelope) {
      this.pendingSceneRequest = null;
    }
  }

  clearPending() {
    this.pendingSceneRequest = null;
  }

  returnToMenu() {
    this.requestSceneLoad("GlobalManager", {
      mode: "additive",
      forceReload: false,
    });
  }
}
