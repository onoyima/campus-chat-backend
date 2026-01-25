
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

  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") return;

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
    const userId = req.session.passport.user;
    const identityId = userId;
    
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
        
        // Example: Typing indicators
        if (message.type === "typing") {
            // Need to fetch participants to broadcast correctly
            const participants = await storage.getParticipants(message.conversationId);
            const recipientIds = participants
                .map(p => p.identityId)
                .filter(id => id !== identityId); // Don't send back to self

            notifyList(recipientIds, {
                type: "typing",
                conversationId: message.conversationId,
                identityId: ws.identityId,
                isTyping: message.isTyping
            });
        }
        
        // WebRTC Signaling
        if (message.type === "call_signal") {
            const { targetIdentityId, signal } = message;
            // Forward signal directly to target
            notifyList([targetIdentityId], {
                type: "call_signal",
                senderIdentityId: ws.identityId,
                signal
            });
        }
        
        // Call Request (Initiate)
        if (message.type === "call_request") {
             const { targetIdentityId, callType } = message;
             notifyList([targetIdentityId], {
                 type: "call_incoming",
                 callerIdentityId: ws.identityId,
                 callType
             });
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

