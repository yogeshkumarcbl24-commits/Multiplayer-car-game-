#!/usr/bin/env node
/**
 * Never-Ending Card Drive -- local multiplayer race server.
 *
 * Serves the game's static files AND relays player state over
 * WebSockets. Players join one of several independent "rooms" by
 * code -- each room has its own player list and race, so more than
 * one group can use the same server at once without seeing each
 * other. Note: a room code only solves *who plays with whom*; it
 * does not by itself make this server reachable from other
 * networks -- everyone still needs to be able to open the URL this
 * prints (same WiFi today; see the project README for other options).
 *
 * Run:  node server/server.js   (from the card-drive/ folder)
 * Then open the "Network:" URL it prints on every player's device.
 */
'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var os = require('os');
var WebSocket = require('ws');

var ROOT = path.join(__dirname, '..');
var PORT = process.env.PORT || 8080;

var MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8'
};

var server = http.createServer(function (req, res) {
  var urlPath = decodeURIComponent(req.url.split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  var filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath.indexOf(ROOT) !== 0) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found: ' + urlPath);
      return;
    }
    var ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

var wss = new WebSocket.Server({ server: server });

var COUNTDOWN_MS = 3000;
var MIN_DURATION_MS = 30 * 1000;
var MAX_DURATION_MS = 15 * 60 * 1000;
var DEFAULT_DURATION_MS = 2 * 60 * 1000;

// The finish line sits at BASE_FINISH_DISTANCE world units for the default
// (2 minute) race. Scaled linearly with the chosen duration so a 5 minute
// race's finish line is actually ~2.5x farther out than a 2 minute one --
// otherwise every duration reaches the same fixed line and the race just
// ends early once someone crosses it, regardless of the time picked.
var BASE_FINISH_DISTANCE = 1250;

// Room codes avoid ambiguous characters (0/O, 1/I) since people read these off a screen.
var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
var rooms = new Map(); // code -> room

function generateRoomCode() {
  var code;
  do {
    code = '';
    for (var i = 0; i < 4; i++) code += CODE_ALPHABET[(Math.random() * CODE_ALPHABET.length) | 0];
  } while (rooms.has(code));
  return code;
}

function createRoom(code) {
  return {
    code: code,
    players: new Map(),
    nextId: 1,
    hostId: null, // whoever created the room -- only this player may pick the duration and start the race
    race: { state: 'lobby', seed: null, startAt: null, endsAt: null, finishDistance: BASE_FINISH_DISTANCE },
    raceTimeoutHandle: null
  };
}

function rosterPayload(room) {
  return {
    type: 'roster',
    hostId: room.hostId,
    race: room.race,
    players: Array.from(room.players.values()).map(function (p) {
      return {
        id: p.id, name: p.name, color: p.color,
        distance: p.distance, laneOffset: p.laneOffset,
        finished: p.finished, finishTime: p.finishTime
      };
    })
  };
}

function broadcastToRoom(room, msg, exceptId) {
  var data = JSON.stringify(msg);
  room.players.forEach(function (p, id) {
    if (id === exceptId) return;
    if (p.ws.readyState === WebSocket.OPEN) p.ws.send(data);
  });
}

function concludeRace(room) {
  if (room.race.state === 'finished') return;
  room.race.state = 'finished';
  broadcastToRoom(room, rosterPayload(room));
}

function makePlayer(id, ws, msg) {
  return {
    id: id, ws: ws,
    name: String((msg && msg.name) || ('Racer ' + id)).slice(0, 18) || ('Racer ' + id),
    color: /^#[0-9a-fA-F]{6}$/.test((msg && msg.color) || '') ? msg.color : '#2fe6ff',
    distance: 0, laneOffset: 0, speed: 0, finished: false, finishTime: null
  };
}

wss.on('connection', function (ws) {
  var room = null;
  var myId = null;

  function myPlayer() {
    return room ? room.players.get(myId) : null;
  }

  ws.on('message', function (raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.type === 'createRoom') {
      if (room) return;
      var code = generateRoomCode();
      room = createRoom(code);
      rooms.set(code, room);
      myId = room.nextId++;
      room.hostId = myId;
      room.players.set(myId, makePlayer(myId, ws, msg));
      ws.send(JSON.stringify({ type: 'roomCreated', code: code, id: myId }));
      broadcastToRoom(room, rosterPayload(room));
      return;
    }

    if (msg.type === 'joinRoom') {
      if (room) return;
      var joinCode = String(msg.code || '').toUpperCase().trim();
      var target = rooms.get(joinCode);
      if (!target) {
        ws.send(JSON.stringify({ type: 'roomNotFound', code: joinCode }));
        return;
      }
      room = target;
      myId = room.nextId++;
      room.players.set(myId, makePlayer(myId, ws, msg));
      ws.send(JSON.stringify({ type: 'roomJoined', code: room.code, id: myId }));
      broadcastToRoom(room, rosterPayload(room));
      return;
    }

    if (!room) return; // everything else requires having joined a room first
    var player = myPlayer();
    if (!player) return;

    if (msg.type === 'join') {
      player.name = String(msg.name || player.name).slice(0, 18) || player.name;
      player.color = /^#[0-9a-fA-F]{6}$/.test(msg.color || '') ? msg.color : player.color;
      broadcastToRoom(room, rosterPayload(room));

    } else if (msg.type === 'state') {
      player.distance = Number(msg.distance) || 0;
      player.laneOffset = Number(msg.laneOffset) || 0;
      player.speed = Number(msg.speed) || 0;
      broadcastToRoom(room, {
        type: 'state', id: myId,
        distance: player.distance, laneOffset: player.laneOffset, speed: player.speed
      }, myId);

    } else if (msg.type === 'startRace') {
      if (myId !== room.hostId) return; // only the room's creator picks the length and starts the race
      if (room.race.state === 'lobby' || room.race.state === 'finished') {
        if (room.raceTimeoutHandle) { clearTimeout(room.raceTimeoutHandle); room.raceTimeoutHandle = null; }
        var duration = Math.min(MAX_DURATION_MS, Math.max(MIN_DURATION_MS, Number(msg.duration) || DEFAULT_DURATION_MS));
        room.race.state = 'countdown';
        room.race.seed = Math.floor(Math.random() * 1e9);
        room.race.startAt = Date.now() + COUNTDOWN_MS;
        room.race.endsAt = room.race.startAt + duration;
        room.race.finishDistance = Math.round(BASE_FINISH_DISTANCE * (duration / DEFAULT_DURATION_MS));
        room.players.forEach(function (p) {
          p.finished = false; p.finishTime = null; p.distance = 0;
        });
        broadcastToRoom(room, rosterPayload(room));
        broadcastToRoom(room, {
          type: 'raceStart', seed: room.race.seed, startAt: room.race.startAt,
          endsAt: room.race.endsAt, finishDistance: room.race.finishDistance
        });
        (function (thisRoom, thisDuration) {
          setTimeout(function () {
            if (thisRoom.race.state === 'countdown') thisRoom.race.state = 'racing';
            thisRoom.raceTimeoutHandle = setTimeout(function () { concludeRace(thisRoom); }, thisDuration);
          }, COUNTDOWN_MS);
        })(room, duration);
      }

    } else if (msg.type === 'finish') {
      if (!player.finished) {
        player.finished = true;
        player.finishTime = Number(msg.time) || 0;
        broadcastToRoom(room, rosterPayload(room));
        var allDone = room.players.size > 0 && Array.from(room.players.values()).every(function (p) { return p.finished; });
        if (allDone) {
          if (room.raceTimeoutHandle) { clearTimeout(room.raceTimeoutHandle); room.raceTimeoutHandle = null; }
          concludeRace(room);
        }
      }

    } else if (msg.type === 'bump' || msg.type === 'shot') {
      var targetId = Number(msg.targetId);
      var targetPlayer = room.players.get(targetId);
      if (targetPlayer && targetPlayer.ws.readyState === WebSocket.OPEN) {
        targetPlayer.ws.send(JSON.stringify({ type: msg.type, targetId: targetId, fromId: myId }));
      }

    } else if (msg.type === 'exploded') {
      broadcastToRoom(room, { type: 'exploded', id: myId }, myId);
    }
  });

  ws.on('close', function () {
    if (!room) return;
    room.players.delete(myId);
    broadcastToRoom(room, { type: 'leave', id: myId });
    if (room.players.size === 0) {
      if (room.raceTimeoutHandle) clearTimeout(room.raceTimeoutHandle);
      rooms.delete(room.code);
    } else if (room.hostId === myId) {
      // host left -- hand hosting to whoever's been in the room longest,
      // so the remaining players aren't stuck with nobody able to start
      room.hostId = Math.min.apply(null, Array.from(room.players.keys()));
      broadcastToRoom(room, rosterPayload(room));
    }
  });
});

server.listen(PORT, function () {
  console.log('');
  console.log('  Never-Ending Card Drive -- multiplayer server running');
  console.log('  ------------------------------------------------------');
  console.log('  On this machine:  http://localhost:' + PORT);

  var nets = os.networkInterfaces();
  var found = false;
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (net) {
      if (net.family === 'IPv4' && !net.internal) {
        found = true;
        console.log('  Same WiFi:        http://' + net.address + ':' + PORT + '   <-- share this');
      }
    });
  });
  if (!found) console.log('  (No LAN network address detected -- other devices may not be able to reach this.)');
  console.log('');
});
