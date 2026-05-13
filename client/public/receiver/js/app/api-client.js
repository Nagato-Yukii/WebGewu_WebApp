export class ApiClient {
  async startWebTinker(options = {}) {
    const response = await fetch("/api/tinker/local-session/start", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        forceRestart: !!options.forceRestart,
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        payload && payload.error
          ? payload.error
          : `Local session bootstrap failed (${response.status})`
      );
    }

    return payload;
  }

  async getWebTinkerStatus() {
    const response = await fetch("/api/tinker/local-session/status", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(
        payload && payload.error
          ? payload.error
          : `Local session status failed (${response.status})`
      );
    }

    return payload;
  }
}
