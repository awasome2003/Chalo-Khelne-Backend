"use strict";
/**
 * Phase 1 — Test 3: a Club A user cannot join Club B's PRIVATE socket room.
 *
 * Stands up a real Socket.io server with the production socketHandler, an
 * in-memory MongoDB, and real socket.io-client connections. Public tournament
 * rooms stay open (spectators); private ones are gated by tenant ownership.
 */
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { Server } = require("socket.io");
const { io: ioClient } = require("socket.io-client");
const { startTestApp, stopTestApp, clearDatabase } = require("./setup");
const setupSocket = require("../../socket/socketHandler");
const Tournament = require("../../src/modules/tournaments/models/Tournament");

let server;
let io;
let port;

const clubA = new mongoose.Types.ObjectId(); // a ClubAdmin user id
const clubB = new mongoose.Types.ObjectId(); // a different ClubAdmin user id
const privateT = new mongoose.Types.ObjectId();
const publicT = new mongoose.Types.ObjectId();

function token(userId, role) {
  return jwt.sign({ id: userId, role, email: `${userId}@t.local` }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });
}

function connect(tok) {
  return new Promise((resolve, reject) => {
    const c = ioClient(`http://127.0.0.1:${port}`, {
      auth: { token: tok },
      transports: ["websocket"],
      forceNew: true,
    });
    c.on("connect", () => resolve(c));
    c.on("connect_error", reject);
  });
}

// Resolve once we know whether the join was allowed: either a 'join:denied'
// arrives, or after a grace period we inspect the server-side room membership.
function joinResult(client, event, payload, room) {
  return new Promise((resolve) => {
    let settled = false;
    client.once("join:denied", (d) => {
      if (settled) return;
      settled = true;
      resolve({ allowed: false, denied: d });
    });
    client.emit(event, payload);
    setTimeout(() => {
      if (settled) return;
      settled = true;
      const members = io.sockets.adapter.rooms.get(room);
      resolve({ allowed: !!(members && members.has(client.id)) });
    }, 250);
  });
}

beforeAll(async () => {
  await startTestApp(); // connects mongoose to in-memory Mongo + sets JWT_SECRET
  server = http.createServer();
  io = new Server(server);
  setupSocket(io);
  await new Promise((res) => server.listen(0, res));
  port = server.address().port;
});

afterAll(async () => {
  io.close();
  await new Promise((res) => server.close(res));
  await stopTestApp();
});

beforeEach(async () => {
  await clearDatabase();
  await Tournament.collection.insertMany([
    { _id: privateT, isPrivate: true, clubId: clubB, managerId: [] },
    { _id: publicT, isPrivate: false, clubId: clubB, managerId: [] },
  ]);
});

test("Test 3 — Club A user is DENIED Club B's private tournament room", async () => {
  const a = await connect(token(clubA, "ClubAdmin"));
  const res = await joinResult(a, "join:tournament", { tournamentId: privateT }, `tournament_${privateT}`);
  a.close();
  expect(res.allowed).toBe(false);
});

test("Club B owner IS allowed into its own private room (positive control)", async () => {
  const b = await connect(token(clubB, "ClubAdmin"));
  const res = await joinResult(b, "join:tournament", { tournamentId: privateT }, `tournament_${privateT}`);
  b.close();
  expect(res.allowed).toBe(true);
});

test("Any authenticated user may join a PUBLIC tournament room (spectator)", async () => {
  const a = await connect(token(clubA, "ClubAdmin"));
  const res = await joinResult(a, "join:tournament", { tournamentId: publicT }, `tournament_${publicT}`);
  a.close();
  expect(res.allowed).toBe(true);
});
