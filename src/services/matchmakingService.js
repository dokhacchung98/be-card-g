import crypto from "node:crypto";
import { CONFIG } from "../config.js";
import { createBotPlayer, generateBotLoadoutDeck } from "./botService.js";

/**
 * Manages:
 * 1. Quick Matchmaking with 10-second timeout -> auto-fills missing seats with AI Bots.
 * 2. Custom Rooms (Create / Join by Code / Start) -> auto-fills missing seats with AI Bots if < maxPlayers.
 */
export class MatchmakingService {
  constructor(dataStore, options = {}) {
    this.store = dataStore;
    this.matchmakingTimeoutMs = Number(options.matchmakingTimeoutMs ?? CONFIG.matchmakingTimeoutMs ?? 10000);
    this.roomAutoBotTimeoutMs = Number(options.roomAutoBotTimeoutMs ?? CONFIG.roomAutoBotTimeoutMs ?? 10000);
    this.rooms = new Map(); // roomId -> Room object
    this.codeToRoomId = new Map(); // roomCode -> roomId
    this.playerToRoomId = new Map(); // uid -> roomId
    this.timers = new Map(); // roomId -> Timeout handle
  }

  _normalizeMode(mode) {
    const m = Number(mode || 4);
    if (m === 2 || m === 3 || m === 4) return m;
    return 4;
  }

  _generateRoomCode() {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    for (let attempt = 0; attempt < 20; attempt++) {
      let code = "";
      for (let i = 0; i < 6; i++) {
        code += chars[Math.floor(Math.random() * chars.length)];
      }
      if (!this.codeToRoomId.has(code)) return code;
    }
    return crypto.randomBytes(3).toString("hex").toUpperCase();
  }

  _buildPlayerEntry(user, seatIndex, loadoutDeck) {
    const validDeck =
      Array.isArray(loadoutDeck) && loadoutDeck.length >= 5
        ? loadoutDeck.slice(0, 15).map(String)
        : Array.isArray(user?.loadoutDeck) && user.loadoutDeck.length >= 5
        ? user.loadoutDeck.slice(0, 15)
        : generateBotLoadoutDeck(seatIndex);

    const avatars = [
      "res://assets/ui_hud/avatars/commander_p1_blue.png",
      "res://assets/ui_hud/avatars/commander_p2_red.png",
      "res://assets/ui_hud/avatars/commander_p3_green.png",
      "res://assets/ui_hud/avatars/commander_p4_amber.png"
    ];

    return {
      uid: user.uid,
      displayName: user.displayName || "Đại Pháp Sư",
      email: user.email || "",
      avatar: user.photoUrl || avatars[seatIndex % avatars.length],
      elo: Number(user.elo || 1200),
      seatIndex,
      isBot: false,
      isReady: true,
      loadoutDeck: validDeck,
      joinedAt: new Date().toISOString()
    };
  }

  /**
   * Quick Matchmaking:
   * - Joins an open waiting matchmaking room for the same mode (2P/3P/4P) if available.
   * - Otherwise creates a new matchmaking room and starts a 10-second timer.
   * - If the room fills with real players before 10s, starts immediately.
   * - If 10s elapses and the room is still missing players, fills all remaining seats with Bots and starts!
   */
  enqueueMatchmaking(user, { mode = 4, loadoutDeck = null, timeoutMs = null } = {}) {
    const maxPlayers = this._normalizeMode(mode);
    const waitMs = Number(timeoutMs ?? this.matchmakingTimeoutMs);

    // Leave previous waiting room if any
    this.leaveCurrentRoom(user.uid);

    // 1. Find an existing open matchmaking room with the same mode
    let targetRoom = null;
    for (const room of this.rooms.values()) {
      if (
        room.type === "matchmaking" &&
        room.status === "waiting" &&
        room.maxPlayers === maxPlayers &&
        room.players.length < room.maxPlayers &&
        !room.players.some((p) => p.uid === user.uid)
      ) {
        targetRoom = room;
        break;
      }
    }

    if (targetRoom) {
      const seatIdx = targetRoom.players.length;
      const pEntry = this._buildPlayerEntry(user, seatIdx, loadoutDeck);
      targetRoom.players.push(pEntry);
      targetRoom.updatedAt = new Date().toISOString();
      this.playerToRoomId.set(user.uid, targetRoom.roomId);

      // Check if room is now full of human players
      if (targetRoom.players.length >= targetRoom.maxPlayers) {
        this._finalizeAndStartRoom(targetRoom.roomId, "matched_all_humans");
      }
      return this.serializeRoom(targetRoom);
    }

    // 2. No ready matchmaking room found -> create a new matchmaking room with a 10s timer
    const roomId = `mm_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const roomCode = this._generateRoomCode();
    const nowMs = Date.now();
    const pEntry = this._buildPlayerEntry(user, 0, loadoutDeck);

    const newRoom = {
      roomId,
      roomCode,
      type: "matchmaking",
      status: "waiting",
      maxPlayers,
      hostUid: user.uid,
      players: [pEntry],
      humanCount: 1,
      botCount: 0,
      filledWithBots: false,
      startReason: null,
      sharedDeckSize: maxPlayers * 25,
      timeoutMs: waitMs,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + waitMs,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      startedAt: null
    };

    this.rooms.set(roomId, newRoom);
    this.codeToRoomId.set(roomCode, roomId);
    this.playerToRoomId.set(user.uid, roomId);

    this._scheduleBotFallbackTimer(roomId, waitMs, "timeout_10s_filled_with_bots");
    return this.serializeRoom(newRoom);
  }

  /**
   * Creates a Custom Room (or Public Room) where friends/other players can join.
   * If missing players after timeout (default 10s) or when host starts, remaining slots are filled with Bots!
   */
  createCustomRoom(user, { mode = 4, loadoutDeck = null, isPrivate = false, autoStartTimeoutMs = null } = {}) {
    const maxPlayers = this._normalizeMode(mode);
    const waitMs = Number(autoStartTimeoutMs ?? this.roomAutoBotTimeoutMs);

    this.leaveCurrentRoom(user.uid);

    const roomId = `room_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
    const roomCode = this._generateRoomCode();
    const nowMs = Date.now();
    const pEntry = this._buildPlayerEntry(user, 0, loadoutDeck);

    const room = {
      roomId,
      roomCode,
      type: "custom_room",
      isPrivate: Boolean(isPrivate),
      status: "waiting",
      maxPlayers,
      hostUid: user.uid,
      players: [pEntry],
      humanCount: 1,
      botCount: 0,
      filledWithBots: false,
      startReason: null,
      sharedDeckSize: maxPlayers * 25,
      timeoutMs: waitMs,
      createdAtMs: nowMs,
      expiresAtMs: nowMs + waitMs,
      createdAt: new Date(nowMs).toISOString(),
      updatedAt: new Date(nowMs).toISOString(),
      startedAt: null
    };

    this.rooms.set(roomId, room);
    this.codeToRoomId.set(roomCode, roomId);
    this.playerToRoomId.set(user.uid, roomId);

    if (waitMs > 0) {
      this._scheduleBotFallbackTimer(roomId, waitMs, "room_timeout_filled_with_bots");
    }

    return this.serializeRoom(room);
  }

  /**
   * Joins a waiting room by roomCode or roomId.
   */
  joinRoom(user, { roomCode = "", roomId = "", loadoutDeck = null } = {}) {
    const resolvedId = roomId || this.codeToRoomId.get(String(roomCode).trim().toUpperCase());
    if (!resolvedId || !this.rooms.has(resolvedId)) {
      throw new Error("Không tìm thấy phòng hoặc mã phòng không tồn tại.");
    }

    const room = this.rooms.get(resolvedId);
    if (room.status !== "waiting") {
      throw new Error("Phòng đấu này đã bắt đầu hoặc đã kết thúc.");
    }

    // Check if user is already in the room
    const existingIdx = room.players.findIndex((p) => p.uid === user.uid);
    if (existingIdx >= 0) {
      return this.serializeRoom(room);
    }

    if (room.players.length >= room.maxPlayers) {
      throw new Error("Phòng đấu đã đủ người chơi.");
    }

    this.leaveCurrentRoom(user.uid);

    const seatIdx = room.players.length;
    const pEntry = this._buildPlayerEntry(user, seatIdx, loadoutDeck);
    room.players.push(pEntry);
    room.humanCount = room.players.filter((p) => !p.isBot).length;
    room.updatedAt = new Date().toISOString();
    this.playerToRoomId.set(user.uid, room.roomId);

    if (room.players.length >= room.maxPlayers) {
      this._finalizeAndStartRoom(room.roomId, "room_full_all_humans");
    }

    return this.serializeRoom(room);
  }

  /**
   * Starts a room immediately (filling any missing player seats with AI Bots).
   */
  startRoomWithBotsIfNeeded(roomId, reason = "manual_start_with_bots") {
    const room = this.rooms.get(roomId);
    if (!room) {
      throw new Error("Không tìm thấy phòng đấu.");
    }
    if (room.status === "waiting") {
      this._finalizeAndStartRoom(roomId, reason);
    }
    return this.serializeRoom(room);
  }

  getRoomStatus(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // Also check if timer expired on poll
    if (room.status === "waiting" && Date.now() >= room.expiresAtMs) {
      this._finalizeAndStartRoom(room.roomId, "timeout_10s_filled_with_bots");
    }
    return this.serializeRoom(room);
  }

  getPlayerActiveRoom(uid) {
    const roomId = this.playerToRoomId.get(uid);
    if (!roomId) return null;
    return this.getRoomStatus(roomId);
  }

  leaveCurrentRoom(uid) {
    const roomId = this.playerToRoomId.get(uid);
    if (!roomId) return false;
    this.playerToRoomId.delete(uid);

    const room = this.rooms.get(roomId);
    if (!room || room.status !== "waiting") return false;

    room.players = room.players.filter((p) => p.uid !== uid);
    room.players.forEach((p, idx) => {
      p.seatIndex = idx;
    });
    room.humanCount = room.players.filter((p) => !p.isBot).length;

    if (room.players.length === 0) {
      this._clearRoomTimer(roomId);
      this.codeToRoomId.delete(room.roomCode);
      this.rooms.delete(roomId);
    } else if (room.hostUid === uid) {
      room.hostUid = room.players[0].uid;
    }
    return true;
  }

  _scheduleBotFallbackTimer(roomId, waitMs, reason) {
    this._clearRoomTimer(roomId);
    const timer = setTimeout(() => {
      this._finalizeAndStartRoom(roomId, reason);
    }, waitMs);
    if (typeof timer.unref === "function") {
      timer.unref();
    }
    this.timers.set(roomId, timer);
  }

  _clearRoomTimer(roomId) {
    const t = this.timers.get(roomId);
    if (t) {
      clearTimeout(t);
      this.timers.delete(roomId);
    }
  }

  /**
   * Transitions a waiting room to 'playing'.
   * If fewer human players than maxPlayers (e.g. after 10s timeout or host start),
   * automatically fills all remaining empty corners with AI Bots!
   */
  _finalizeAndStartRoom(roomId, reason) {
    this._clearRoomTimer(roomId);
    const room = this.rooms.get(roomId);
    if (!room || room.status !== "waiting") return;

    const currentPlayers = room.players.length;
    const missingSlots = Math.max(0, room.maxPlayers - currentPlayers);

    let botSlotOrder = 0;
    for (let seat = currentPlayers; seat < room.maxPlayers; seat++) {
      const botPlayer = createBotPlayer(seat, botSlotOrder++);
      room.players.push(botPlayer);
    }

    room.humanCount = room.players.filter((p) => !p.isBot).length;
    room.botCount = room.players.filter((p) => p.isBot).length;
    room.filledWithBots = room.botCount > 0;
    room.status = "playing";
    room.startReason = reason;
    room.startedAt = new Date().toISOString();
    room.updatedAt = room.startedAt;
    room.matchSeed = Math.floor(Math.random() * 900000000) + 100000000;

    if (this.store) {
      this.store.recordMatch({
        roomId: room.roomId,
        roomCode: room.roomCode,
        type: room.type,
        maxPlayers: room.maxPlayers,
        humanCount: room.humanCount,
        botCount: room.botCount,
        filledWithBots: room.filledWithBots,
        startReason: room.startReason,
        players: room.players.map((p) => ({
          uid: p.uid,
          displayName: p.displayName,
          seatIndex: p.seatIndex,
          isBot: p.isBot
        }))
      });
    }
  }

  serializeRoom(room) {
    const now = Date.now();
    const remainingWaitMs = room.status === "waiting" ? Math.max(0, room.expiresAtMs - now) : 0;
    return {
      roomId: room.roomId,
      roomCode: room.roomCode,
      type: room.type,
      status: room.status,
      maxPlayers: room.maxPlayers,
      humanCount: room.players.filter((p) => !p.isBot).length,
      botCount: room.players.filter((p) => p.isBot).length,
      filledWithBots: room.filledWithBots,
      startReason: room.startReason,
      sharedDeckSize: room.sharedDeckSize,
      matchSeed: room.matchSeed || null,
      hostUid: room.hostUid,
      timeoutMs: room.timeoutMs,
      remainingWaitMs,
      remainingWaitSec: Number((remainingWaitMs / 1000).toFixed(1)),
      players: room.players,
      createdAt: room.createdAt,
      startedAt: room.startedAt
    };
  }

  listOpenRooms() {
    const list = [];
    for (const room of this.rooms.values()) {
      if (room.status === "waiting" && !room.isPrivate) {
        list.push(this.serializeRoom(room));
      }
    }
    return list;
  }

  shutdown() {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}
