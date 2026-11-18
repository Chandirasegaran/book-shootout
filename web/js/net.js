// WebSocket client for room-code games, with automatic reconnect + rejoin.
export class Net {
  constructor(onMsg, onStatus) {
    this.onMsg = onMsg;
    this.onStatus = onStatus;
    this.ws = null;
    this.queue = [];
    this.session = null; // { code, token } once seated
    this.closedByUser = false;
    this.retry = 0;
  }

  connect() {
    this.closedByUser = false;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.onStatus("open");
      if (this.session) ws.send(JSON.stringify({ t: "rejoin", ...this.session }));
      for (const m of this.queue.splice(0)) ws.send(m);
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.t === "welcome") this.session = { code: msg.code, token: msg.token };
      this.onMsg(msg);
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closedByUser) return;
      this.onStatus("lost");
      const delay = Math.min(500 * 2 ** this.retry++, 5000);
      setTimeout(() => !this.closedByUser && this.connect(), delay);
    };
  }

  send(obj) {
    const m = JSON.stringify(obj);
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(m);
    else {
      this.queue.push(m);
      if (!this.ws || this.ws.readyState > 1) this.connect();
    }
  }

  close() {
    this.closedByUser = true;
    this.session = null;
    try { this.ws?.send(JSON.stringify({ t: "leave" })); } catch {}
    this.ws?.close();
    this.ws = null;
  }
}
