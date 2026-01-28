
import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";
import type { Request } from "express";
import { sessionMiddleware } from "./auth_system";
import { storage } from "./storage";

let wssInstance: WebSocketServer | null = null;

interface ExtendedWebSocket extends WebSocket {
  identityId?: number;
  isAlive: boolean;
}

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({ noServer: true });
  wssInstance = wss;

  server.on("upgrade", async (request, socket, head) => {
    if (request.url !== "/ws") return;

    // Check for JWT Token in Header or Protocol
    // Note: Browser WebSocket API doesn't allow custom headers easily, but some clients do.
    // We can also check Sec-WebSocket-Protocol.
    let identityId: number | null = null;

    // 1. Try Authorization Header
    const authHeader = request.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const { verifyToken } = await import('./jwt');
      const payload = verifyToken(token);
      if (payload) identityId = payload.identityId;
    }

    if (identityId) {
      // Authenticated via JWT
      wss.handleUpgrade(request, socket, head, (ws) => {
        (ws as any).identityId = identityId; // Attach identityId manually since no session
        wss.emit("connection", ws, request);
      });
      return;
    }

    // 2. Fallback to Session Cookie
    // @ts-ignore
    sessionMiddleware(request as Request, {} as any, () => {
      // @ts-ignore
      console.log("WS Upgrade: Session:", request.session);
      // @ts-ignore
      if (!request.session || !request.session.passport || !request.session.passport.user) {
        console.log("WS Upgrade: Unauthorized");
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    });
  });

  wss.on("connection", async (ws: ExtendedWebSocket, req: any) => {
    // Prefer manually attached identityId (from JWT) or fallback to session
    const identityId = ws.identityId || (req.session && req.session.passport ? req.session.passport.user : null);

    if (!identityId) {
      ws.close();
      return;
    }

    ws.identityId = identityId;
    ws.isAlive = true;

    console.log(`WS Connected: Identity ${identityId}`);

    // Update online status
    await storage.updateIdentityStatus(identityId, true);

    ws.on("pong", () => {
      ws.isAlive = true;
    });

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "typing": {
            // Determine recipients (everyone else in conversation)
            // This is expensive if we query DB every keystroke. 
            // Optimization: Client sends list of recipients? Or we cache?
            // For now, let's trust client to send conversationId, but we need to know who is in it.
            // Reverting to broadcast to all participants fetched from DB is safest but slow.
            // Alternative: Client sends 'recipientIds' if known? No, security risk.

            // Let's implement robust participant fetch
            const participants = await storage.getParticipants(message.conversationId);
            const recipientIds = participants
              .map(p => p.identityId)
              .filter(id => id !== identityId);

            notifyList(recipientIds, {
              type: "typing",
              conversationId: message.conversationId,
              identityId: identityId,
              isTyping: message.isTyping
            });
            break;
          }

          case "call_request": {
            const { targetIdentityId, callType } = message;
            notifyList([targetIdentityId], {
              type: "call_incoming",
              callerIdentityId: identityId,
              callType
            });
            break;
          }

          case "call_accepted": {
            const { targetIdentityId } = message;
            notifyList([targetIdentityId], {
              type: "call_accepted",
              accepterIdentityId: identityId
            });
            break;
          }

          case "call_ended": {
            const { targetIdentityId } = message;
            notifyList([targetIdentityId], {
              type: "call_ended",
              enderIdentityId: identityId
            });
            break;
          }

          case "call_signal": {
            const { targetIdentityId, signal } = message;
            notifyList([targetIdentityId], {
              type: "call_signal",
              senderIdentityId: identityId,
              signal
            });
            break;
          }
        }

      } catch (err) {
        console.error("WS Message Error", err);
      }
    });

    ws.on("close", async () => {
      console.log(`WS Disconnected: Identity ${identityId}`);
      await storage.updateIdentityStatus(identityId, false);
    });
  });

  // Heartbeat interval
  const interval = setInterval(() => {
    wss.clients.forEach((ws: any) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on("close", () => {
    clearInterval(interval);
  });

  return wss;
}

export function notifyList(identityIds: number[], payload: any) {
  if (!wssInstance) return;

  const payloadStr = JSON.stringify(payload);

  wssInstance.clients.forEach((client: any) => {
    if (client.readyState === WebSocket.OPEN && client.identityId && identityIds.includes(client.identityId)) {
      client.send(payloadStr);
    }
  });
}

