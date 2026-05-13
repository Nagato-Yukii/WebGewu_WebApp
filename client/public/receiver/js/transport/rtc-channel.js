export class RtcChannelClient {
  constructor() {
    this.channel = null;
    this.messageListener = null;
    this.openListener = null;
    this.handlers = new Map();
    this.pendingOutbound = [];
  }

  bind(channel) {
    if (this.channel === channel) {
      return;
    }

    this.unbind();
    this.channel = channel;
    if (!this.channel) {
      return;
    }

    this.messageListener = (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      this.dispatch(event.data);
    };

    this.openListener = () => {
      this.flush();
    };

    this.channel.addEventListener("message", this.messageListener);
    this.channel.addEventListener("open", this.openListener);
    this.flush();
  }

  unbind() {
    if (this.channel && this.messageListener) {
      this.channel.removeEventListener("message", this.messageListener);
    }

    if (this.channel && this.openListener) {
      this.channel.removeEventListener("open", this.openListener);
    }

    this.channel = null;
    this.messageListener = null;
    this.openListener = null;
  }

  isOpen() {
    return !!this.channel && this.channel.readyState === "open";
  }

  send(envelope) {
    if (!this.isOpen()) {
      if (envelope) {
        this.pendingOutbound.push(envelope);
      }
      return true;
    }

    this.channel.send(JSON.stringify(envelope));
    return true;
  }

  flush() {
    if (!this.isOpen() || this.pendingOutbound.length === 0) {
      return;
    }

    const pending = this.pendingOutbound.splice(0, this.pendingOutbound.length);
    pending.forEach((envelope) => {
      this.channel.send(JSON.stringify(envelope));
    });
  }

  on(type, handler) {
    this.handlers.set(type, handler);
  }

  dispatch(raw) {
    let envelope = null;
    try {
      envelope = JSON.parse(raw);
    } catch {
      return;
    }

    if (!envelope || !envelope.type) {
      return;
    }

    const handler = this.handlers.get(envelope.type);
    if (handler) {
      handler(envelope);
    }
  }
}
