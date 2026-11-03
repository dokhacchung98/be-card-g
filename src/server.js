import http from "node:http";
import { URL } from "node:url";
import { CONFIG } from "./config.js";
import { DataStore } from "./store/dataStore.js";
import { FirebaseService } from "./services/firebaseService.js";
import { MatchmakingService } from "./services/matchmakingService.js";

export function createAppServer(customOptions = {}) {
  const store = customOptions.store || new DataStore(customOptions.dbPath);
  const firebaseService = new FirebaseService(store);
  const matchmakingService = new MatchmakingService(store, {
    matchmakingTimeoutMs: customOptions.matchmakingTimeoutMs ?? CONFIG.matchmakingTimeoutMs,
    roomAutoBotTimeoutMs: customOptions.roomAutoBotTimeoutMs ?? CONFIG.roomAutoBotTimeoutMs
  });

  function sendJson(res, statusCode, payload) {
    const body = JSON.stringify(payload);
    res.writeHead(statusCode, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Player-Uid"
    });
    res.end(body);
  }

  async function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let raw = "";
      req.on("data", (chunk) => {
        raw += chunk;
        if (raw.length > 1024 * 1024) {
          reject(new Error("Payload too large"));
        }
      });
      req.on("end", () => {
        if (!raw.trim()) return resolve({});
        try {
          resolve(JSON.parse(raw));
        } catch (_err) {
          reject(new Error("Invalid JSON body"));
        }
      });
      req.on("error", reject);
    });
  }

  function resolveAuthenticatedUser(req, body = {}) {
    const authHeader = req.headers["authorization"] || "";
    if (authHeader) {
      const verified = firebaseService.verifySessionToken(authHeader);
      if (verified && verified.uid) {
        const u = store.getUser(verified.uid);
        if (u) return u;
      }
    }
    const uidHeader = req.headers["x-player-uid"] || body.uid;
    if (uidHeader) {
      const existing = store.getUser(String(uidHeader));
      if (existing) return existing;
      return store.upsertGoogleUser({
        uid: String(uidHeader),
        displayName: body.displayName || "Đại Pháp Sư",
        email: body.email || ""
      });
    }
    return null;
  }

  const requestHandler = async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Player-Uid"
      });
      return res.end();
    }

    const parsedUrl = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const rwPath = parsedUrl.searchParams.get("__pathname");
    const pathname = rwPath
      ? (rwPath.startsWith("/") ? rwPath : `/${rwPath}`).replace(/\/+$/, "") || "/"
      : parsedUrl.pathname.replace(/\/+$/, "") || "/";

    try {
      // -----------------------------------------------------------------------
      // 1. Health & Firebase Status Check
      // -----------------------------------------------------------------------
      if (
        req.method === "GET" &&
        (pathname === "/" || pathname === "/api" || pathname === "/health" || pathname === "/api/v1/health")
      ) {
        return sendJson(res, 200, {
          ok: true,
          service: "be-card-g (Arcana Five Backend)",
          mode: "online_and_offline_hybrid",
          matchmakingTimeoutMs: matchmakingService.matchmakingTimeoutMs,
          firebase: {
            projectId: CONFIG.firebase.projectId,
            androidAppId: CONFIG.firebase.androidAppId,
            iosAppId: CONFIG.firebase.iosAppId,
            webAppId: CONFIG.firebase.webAppId,
            services: CONFIG.firebase.services
          },
          openRoomsCount: matchmakingService.listOpenRooms().length,
          totalUsers: Object.keys(store.state.users).length
        });
      }

      // -----------------------------------------------------------------------
      // 2. Google Login & Firebase Auth Account Management
      // -----------------------------------------------------------------------
      if (req.method === "POST" && pathname === "/api/v1/auth/google") {
        const body = await readJsonBody(req);
        const verified = await firebaseService.verifyGoogleLogin(body);
        const user = store.upsertGoogleUser(verified);

        // Merge any offline progress passed during Google Sign-In
        if (body.offlineProfile && typeof body.offlineProfile === "object") {
          store.syncUserProfile(user.uid, body.offlineProfile);
        }

        const sessionToken = firebaseService.signSessionToken(user);

        store.recordAnalyticsEvent({
          name: "login_google",
          uid: user.uid,
          platform: verified.platform,
          verifiedVia: verified.verifiedVia
        });

        return sendJson(res, 200, {
          ok: true,
          verifiedVia: verified.verifiedVia,
          token: sessionToken,
          user,
          firebaseProject: CONFIG.firebase.projectId
        });
      }

      // -----------------------------------------------------------------------
      // 3. Player Profile & Offline <-> Online Cloud Sync
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/v1/profile") {
        const user = resolveAuthenticatedUser(req, { uid: parsedUrl.searchParams.get("uid") });
        if (!user) {
          return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        }
        return sendJson(res, 200, { ok: true, user });
      }

      if ((req.method === "POST" || req.method === "PUT") && pathname === "/api/v1/profile/sync") {
        const body = await readJsonBody(req);
        const user = resolveAuthenticatedUser(req, body);
        if (!user) {
          return sendJson(res, 401, { ok: false, error: "Unauthorized" });
        }
        const updated = store.syncUserProfile(user.uid, body);
        return sendJson(res, 200, { ok: true, user: updated });
      }

      // -----------------------------------------------------------------------
      // 4. Quick Matchmaking (10s Wait -> Auto Bot Fallback if no other players)
      // -----------------------------------------------------------------------
      if (req.method === "POST" && pathname === "/api/v1/matchmaking/enqueue") {
        const body = await readJsonBody(req);
        const user =
          resolveAuthenticatedUser(req, body) ||
          store.upsertGoogleUser({
            uid: body.uid || `guest_${Date.now()}`,
            displayName: body.displayName || "Pháp Sư Lam Long"
          });

        const room = matchmakingService.enqueueMatchmaking(user, {
          mode: body.mode || 4,
          loadoutDeck: body.loadoutDeck,
          timeoutMs: body.timeoutMs
        });

        store.recordAnalyticsEvent({
          name: "matchmaking_enqueue",
          uid: user.uid,
          roomId: room.roomId,
          mode: room.maxPlayers,
          status: room.status
        });

        return sendJson(res, 200, { ok: true, room });
      }

      if (req.method === "GET" && pathname === "/api/v1/matchmaking/status") {
        const roomId = parsedUrl.searchParams.get("roomId");
        const uid = parsedUrl.searchParams.get("uid");
        const room = roomId
          ? matchmakingService.getRoomStatus(roomId)
          : matchmakingService.getPlayerActiveRoom(uid);

        if (!room) {
          return sendJson(res, 404, { ok: false, error: "No active matchmaking room found." });
        }
        return sendJson(res, 200, { ok: true, room });
      }

      if (req.method === "POST" && pathname === "/api/v1/matchmaking/cancel") {
        const body = await readJsonBody(req);
        const user = resolveAuthenticatedUser(req, body);
        const uid = user?.uid || body.uid;
        const left = matchmakingService.leaveCurrentRoom(uid);
        return sendJson(res, 200, { ok: true, cancelled: left });
      }

      // -----------------------------------------------------------------------
      // 5. Custom Rooms (Create Room / Join Room / Auto Bot Fill if missing players)
      // -----------------------------------------------------------------------
      if (req.method === "GET" && pathname === "/api/v1/rooms") {
        return sendJson(res, 200, {
          ok: true,
          rooms: matchmakingService.listOpenRooms()
        });
      }

      if (req.method === "POST" && pathname === "/api/v1/rooms/create") {
        const body = await readJsonBody(req);
        const user =
          resolveAuthenticatedUser(req, body) ||
          store.upsertGoogleUser({
            uid: body.uid || `guest_${Date.now()}`,
            displayName: body.displayName || "Pháp Sư Chủ Phòng"
          });

        const room = matchmakingService.createCustomRoom(user, {
          mode: body.mode || 4,
          loadoutDeck: body.loadoutDeck,
          isPrivate: body.isPrivate,
          autoStartTimeoutMs: body.autoStartTimeoutMs
        });

        store.recordAnalyticsEvent({
          name: "room_created",
          uid: user.uid,
          roomId: room.roomId,
          roomCode: room.roomCode,
          mode: room.maxPlayers
        });

        return sendJson(res, 200, { ok: true, room });
      }

      if (req.method === "POST" && pathname === "/api/v1/rooms/join") {
        const body = await readJsonBody(req);
        const user =
          resolveAuthenticatedUser(req, body) ||
          store.upsertGoogleUser({
            uid: body.uid || `guest_${Date.now()}`,
            displayName: body.displayName || "Pháp Sư Khách"
          });

        const room = matchmakingService.joinRoom(user, {
          roomCode: body.roomCode,
          roomId: body.roomId,
          loadoutDeck: body.loadoutDeck
        });

        return sendJson(res, 200, { ok: true, room });
      }

      if (req.method === "POST" && pathname === "/api/v1/rooms/start") {
        const body = await readJsonBody(req);
        const room = matchmakingService.startRoomWithBotsIfNeeded(
          body.roomId,
          "host_started_filled_with_bots"
        );
        return sendJson(res, 200, { ok: true, room });
      }

      // -----------------------------------------------------------------------
      // 6. Firebase Analytics & Crashlytics Telemetry Endpoints
      // -----------------------------------------------------------------------
      if (req.method === "POST" && pathname === "/api/v1/telemetry/analytics") {
        const body = await readJsonBody(req);
        const evt = store.recordAnalyticsEvent({
          name: body.name || "custom_event",
          uid: body.uid || "anonymous",
          params: body.params || {},
          platform: body.platform || "mobile"
        });
        return sendJson(res, 200, { ok: true, event: evt });
      }

      if (req.method === "POST" && pathname === "/api/v1/telemetry/crash") {
        const body = await readJsonBody(req);
        const report = store.recordCrashReport({
          uid: body.uid || "anonymous",
          message: body.message || "Unhandled client exception",
          stackTrace: body.stackTrace || "",
          platform: body.platform || "mobile",
          appVersion: body.appVersion || "1.0.0"
        });
        return sendJson(res, 200, { ok: true, report });
      }

      return sendJson(res, 404, { ok: false, error: `Route not found: ${req.method} ${pathname}` });
    } catch (err) {
      return sendJson(res, 400, {
        ok: false,
        error: err.message || "Internal server error"
      });
    }
  };

  const server = http.createServer(requestHandler);
  server.requestHandler = requestHandler;
  server.matchmakingService = matchmakingService;
  server.store = store;
  return server;
}

const isMainModule =
  typeof process !== "undefined" &&
  !process.env.VERCEL &&
  process.argv?.[1] &&
  import.meta.url === `file://${process.argv[1]}`;

const defaultServer = createAppServer();

if (isMainModule) {
  defaultServer.listen(CONFIG.port, CONFIG.host, () => {
    console.log(
      `[be-card-g] Arcana Five Backend listening on http://${CONFIG.host}:${CONFIG.port} (Firebase: ${CONFIG.firebase.projectId}, Matchmaking Bot Timeout: ${CONFIG.matchmakingTimeoutMs}ms)`
    );
  });
}

export default defaultServer.requestHandler;
