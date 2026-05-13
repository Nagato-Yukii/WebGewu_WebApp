function createEnvelopeId() {
  const cryptoObject = typeof globalThis !== "undefined" ? globalThis.crypto : null;
  if (cryptoObject && typeof cryptoObject.randomUUID === "function") {
    return cryptoObject.randomUUID();
  }

  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 12);
  return `env-${timestamp}-${randomSuffix}`;
}

export function createEnvelope(type, payload) {
  return {
    v: 1,
    id: createEnvelopeId(),
    type: type,
    source: "web",
    ts: Date.now(),
    payload: payload,
  };
}
