import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createAppServer } from "../src/server.js";

async function startTestServer(options = {}) {
  const tmpDb = path.join(os.tmpdir(), `be_card_g_test_${Date.now()}_${Math.random().toString(36).slice(2)}.json`);
  const server = createAppServer({
    dbPath: tmpDb,
    matchmakingTimeoutMs: options.matchmakingTimeoutMs ?? 150,
    roomAutoBotTimeoutMs: options.roomAutoBotTimeoutMs ?? 150
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  return {
    server,
    baseUrl,
    close: async () => {
      server.matchmakingService.shutdown();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

test("1. Google Auth Login, Profile & Offline-Online Sync", async () => {
  const { baseUrl, close } = await startTestServer();
  try {
    const authRes = await fetch(`${baseUrl}/api/v1/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        googleId: "10987654321",
        email: "phapsu@gmail.com",
        displayName: "Lam Long Pháp Sư",
        platform: "android",
        offlineProfile: {
          gold: 4500,
          diamonds: 600,
          ownedCounts: { c018_hoa: 2 }
        }
      })
    });
    const authData = await authRes.json();
    assert.equal(authData.ok, true);
    assert.ok(authData.token);
    assert.equal(authData.user.email, "phapsu@gmail.com");
    assert.equal(authData.user.gold, 4500);
    assert.equal(authData.user.diamonds, 600);
    assert.equal(authData.user.ownedCounts.c018_hoa, 2);
  } finally {
    await close();
  }
});

test("2. Matchmaking: After timeout (10s in prod) with no other players, auto-fills remaining seats with Bots", async () => {
  const { baseUrl, close } = await startTestServer({ matchmakingTimeoutMs: 120 });
  try {
    const enqRes = await fetch(`${baseUrl}/api/v1/matchmaking/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid: "player_solo_1",
        displayName: "Solo Commander",
        mode: 4
      })
    });
    const enqData = await enqRes.json();
    assert.equal(enqData.ok, true);
    assert.equal(enqData.room.status, "waiting");
    assert.equal(enqData.room.humanCount, 1);

    // Wait for timeout to elapse
    await new Promise((r) => setTimeout(r, 180));

    const stRes = await fetch(`${baseUrl}/api/v1/matchmaking/status?roomId=${enqData.room.roomId}`);
    const stData = await stRes.json();
    assert.equal(stData.ok, true);
    assert.equal(stData.room.status, "playing");
    assert.equal(stData.room.maxPlayers, 4);
    assert.equal(stData.room.humanCount, 1);
    assert.equal(stData.room.botCount, 3);
    assert.equal(stData.room.filledWithBots, true);
    assert.equal(stData.room.players.length, 4);
  } finally {
    await close();
  }
});

test("3. Matchmaking: When 2 players join a 2P match before timeout, starts immediately without Bots", async () => {
  const { baseUrl, close } = await startTestServer({ matchmakingTimeoutMs: 5000 });
  try {
    const p1Res = await fetch(`${baseUrl}/api/v1/matchmaking/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "p1", displayName: "Player 1", mode: 2 })
    });
    const p1Data = await p1Res.json();
    assert.equal(p1Data.room.status, "waiting");

    const p2Res = await fetch(`${baseUrl}/api/v1/matchmaking/enqueue`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "p2", displayName: "Player 2", mode: 2 })
    });
    const p2Data = await p2Res.json();
    assert.equal(p2Data.room.roomId, p1Data.room.roomId);
    assert.equal(p2Data.room.status, "playing");
    assert.equal(p2Data.room.humanCount, 2);
    assert.equal(p2Data.room.botCount, 0);
    assert.equal(p2Data.room.filledWithBots, false);
  } finally {
    await close();
  }
});

test("4. Custom Room: Create room, 1 friend joins (2/4 players), start fills remaining 2 slots with Bots", async () => {
  const { baseUrl, close } = await startTestServer({ roomAutoBotTimeoutMs: 5000 });
  try {
    const createRes = await fetch(`${baseUrl}/api/v1/rooms/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "host_1", displayName: "Chủ Phòng", mode: 4 })
    });
    const createData = await createRes.json();
    assert.equal(createData.ok, true);
    const roomCode = createData.room.roomCode;

    const joinRes = await fetch(`${baseUrl}/api/v1/rooms/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: "friend_2", displayName: "Bạn Cùng Phòng", roomCode })
    });
    const joinData = await joinRes.json();
    assert.equal(joinData.room.humanCount, 2);
    assert.equal(joinData.room.status, "waiting");

    const startRes = await fetch(`${baseUrl}/api/v1/rooms/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roomId: createData.room.roomId })
    });
    const startData = await startRes.json();
    assert.equal(startData.room.status, "playing");
    assert.equal(startData.room.humanCount, 2);
    assert.equal(startData.room.botCount, 2);
    assert.equal(startData.room.filledWithBots, true);
    assert.equal(startData.room.players.length, 4);
  } finally {
    await close();
  }
});
