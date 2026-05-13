type SessionSocket = WebSocket;
type ConnectionPair = [SessionSocket | null, SessionSocket | null];

interface OfferPayload {
  sdp: string;
  datetime: number;
  polite: boolean;
}

interface AnswerPayload {
  sdp: string;
  datetime: number;
}

interface CandidatePayload {
  candidate: string;
  sdpMLineIndex: number | null;
  sdpMid: string | null;
  datetime: number;
}

let isPrivate = false;

const clients: Map<SessionSocket, Set<string>> = new Map<SessionSocket, Set<string>>();
const connectionPair: Map<string, ConnectionPair> = new Map<string, ConnectionPair>();

function getOrCreateConnectionIds(session: SessionSocket): Set<string> {
  let connectionIds = clients.get(session);
  if (!connectionIds) {
    connectionIds = new Set<string>();
    clients.set(session, connectionIds);
  }
  return connectionIds;
}

function createOfferPayload(sdp: string, polite: boolean): OfferPayload {
  return {
    sdp,
    datetime: Date.now(),
    polite,
  };
}

function createAnswerPayload(sdp: string): AnswerPayload {
  return {
    sdp,
    datetime: Date.now(),
  };
}

function createCandidatePayload(message: any): CandidatePayload {
  return {
    candidate: message.candidate,
    sdpMLineIndex: message.sdpMLineIndex,
    sdpMid: message.sdpMid,
    datetime: Date.now(),
  };
}

function getPeerSocket(pair: ConnectionPair, source: SessionSocket): SessionSocket | null {
  return pair[0] === source ? pair[1] : pair[0];
}

function reset(mode: string): void {
  isPrivate = mode === 'private';
}

function add(ws: SessionSocket): void {
  clients.set(ws, new Set<string>());
}

function remove(ws: SessionSocket): void {
  const connectionIds = clients.get(ws);
  if (!connectionIds) {
    return;
  }

  connectionIds.forEach((connectionId) => {
    const pair = connectionPair.get(connectionId);
    if (pair) {
      const otherSessionWs = getPeerSocket(pair, ws);
      if (otherSessionWs) {
        otherSessionWs.send(JSON.stringify({ type: 'disconnect', connectionId }));
      }
    }
    connectionPair.delete(connectionId);
  });

  clients.delete(ws);
}

function onConnect(ws: SessionSocket, connectionId: string): void {
  let polite = true;
  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId) as ConnectionPair;

      if (pair[0] !== null && pair[1] !== null) {
        ws.send(JSON.stringify({ type: 'error', message: `${connectionId}: This connection id is already used.` }));
        return;
      }

      if (pair[0] !== null) {
        connectionPair.set(connectionId, [pair[0], ws]);
      }
    } else {
      connectionPair.set(connectionId, [ws, null]);
      polite = false;
    }
  }

  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  ws.send(JSON.stringify({ type: 'connect', connectionId, polite }));
}

function onDisconnect(ws: SessionSocket, connectionId: string): void {
  const connectionIds = clients.get(ws);
  if (connectionIds) {
    connectionIds.delete(connectionId);
  }

  if (connectionPair.has(connectionId)) {
    const pair = connectionPair.get(connectionId) as ConnectionPair;
    const otherSessionWs = getPeerSocket(pair, ws);
    if (otherSessionWs) {
      otherSessionWs.send(JSON.stringify({ type: 'disconnect', connectionId }));
    }
  }

  connectionPair.delete(connectionId);
  ws.send(JSON.stringify({ type: 'disconnect', connectionId }));
}

function onOffer(ws: SessionSocket, message: any): void {
  const connectionId = message.connectionId as string;
  const offer = createOfferPayload(message.sdp, false);

  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId) as ConnectionPair;
      const otherSessionWs = getPeerSocket(pair, ws);
      if (otherSessionWs) {
        offer.polite = true;
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: '', type: 'offer', data: offer }));
      }
    }
    return;
  }

  connectionPair.set(connectionId, [ws, null]);
  clients.forEach((_value, otherSessionWs) => {
    if (otherSessionWs === ws) {
      return;
    }
    otherSessionWs.send(JSON.stringify({ from: connectionId, to: '', type: 'offer', data: offer }));
  });
}

function onAnswer(ws: SessionSocket, message: any): void {
  const connectionId = message.connectionId as string;
  const connectionIds = getOrCreateConnectionIds(ws);
  connectionIds.add(connectionId);
  const answer = createAnswerPayload(message.sdp);

  if (!connectionPair.has(connectionId)) {
    return;
  }

  const pair = connectionPair.get(connectionId) as ConnectionPair;
  const otherSessionWs = getPeerSocket(pair, ws);

  if (!isPrivate) {
    connectionPair.set(connectionId, [otherSessionWs, ws]);
  }

  if (otherSessionWs) {
    otherSessionWs.send(JSON.stringify({ from: connectionId, to: '', type: 'answer', data: answer }));
  }
}

function onCandidate(ws: SessionSocket, message: any): void {
  const connectionId = message.connectionId as string;
  const candidate = createCandidatePayload(message);

  if (isPrivate) {
    if (connectionPair.has(connectionId)) {
      const pair = connectionPair.get(connectionId) as ConnectionPair;
      const otherSessionWs = getPeerSocket(pair, ws);
      if (otherSessionWs) {
        otherSessionWs.send(JSON.stringify({ from: connectionId, to: '', type: 'candidate', data: candidate }));
      }
    }
    return;
  }

  clients.forEach((_value, otherSessionWs) => {
    if (otherSessionWs === ws) {
      return;
    }
    otherSessionWs.send(JSON.stringify({ from: connectionId, to: '', type: 'candidate', data: candidate }));
  });
}

export { reset, add, remove, onConnect, onDisconnect, onOffer, onAnswer, onCandidate };