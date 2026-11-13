/**
 * WebRTC (RTCPeerConnection + RTCDataChannel) マルチプレイ管理クラス
 * 最大4人（ホスト1名 + ゲスト最大3名）のルーム作成・URL招待参加・入力/状態同期を担当
 * シグナリングは BroadcastChannel と公開 MQTT-over-WSS ブローカーを併用し、専用サーバー不要で動作する
 */
class MultiplayerManager {
  constructor(callbacks = {}) {
    this.callbacks = callbacks;
    this.localPeerId = 'p' + MultiplayerManager.randomId(10);
    this.localNickname = '';
    this.localReady = false;

    this.mode = 'solo'; // 'solo' | 'host' | 'guest'
    this.roomCode = null;
    this.isInGame = false;
    this.connectionStatus = 'idle'; // 'idle' | 'hosting' | 'connecting' | 'connected' | 'full' | 'disconnected' | 'error'
    this.statusDetail = '';

    this.players = [this.makeLocalPlayerEntry(0, true)];
    this.assignedSlot = 0;

    // Host: peerId -> PeerEntry
    this.peers = new Map();
    // Host: latest inputs keyed by slot (1..3)
    this.remoteInputs = new Map();
    this.connEpochCounter = 1;

    // Guest: connection to Host
    this.hostPeer = null;
    this.hostPeerId = null;
    this.joinSessionToken = MultiplayerManager.randomId(8);
    this.joinRetryTimer = null;
    this.joinTimeoutTimer = null;
    this.joinNotFoundDeadline = 0;
    this.hostAliveTimer = null;

    // Host migration & RTT monitoring
    this.migrationOrder = [];
    this.lastMigrationOrderStr = '';
    this.migrating = false;
    this.migrationTimers = [];
    this.migratingGraceUntil = 0;
    this.migratingExpectedSlots = new Map();
    this.migratingCleanupTimers = [];
    this.pingCounter = 1;
    this.rttMeasureTimer = null;

    // Signaling transports
    this.bc = null;
    this.mqttClients = [];
    this.seenSigIds = new Set();
    this.sigQueue = [];

    window.addEventListener('beforeunload', () => this.shutdown(true));
    window.addEventListener('pagehide', () => this.shutdown(true));
  }

  static randomId(len = 8) {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
    let out = '';
    for (let i = 0; i < len; i++) {
      out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
  }

  static generateRoomCode() {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  static getMaxHpForCount(count) {
    const table = GAME_CONFIG.MULTIPLAYER.HP_BY_PLAYER_COUNT;
    const clamped = Math.max(1, Math.min(GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS, count || 1));
    return table[clamped] || GAME_CONFIG.PADDLE.MAX_HP;
  }

  static buildInviteUrl(roomCode) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('room', roomCode);
      return url.toString();
    } catch (_) {
      const base = String(window.location.href).split('?')[0].split('#')[0];
      return `${base}?room=${encodeURIComponent(roomCode)}`;
    }
  }

  makeLocalPlayerEntry(slot, isHost) {
    return {
      peerId: this.localPeerId,
      slot,
      nickname: this.localNickname,
      ready: !!this.localReady,
      isHost: !!isHost,
      isLocal: true
    };
  }

  isHostOrSolo() {
    return this.mode === 'solo' || this.mode === 'host';
  }

  isMultiplayerRoom() {
    return this.mode === 'host' || this.mode === 'guest';
  }

  getPlayerCount() {
    if (this.mode === 'solo') return 1;
    return Math.max(1, Math.min(GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS, this.players.length));
  }

  getInviteUrl() {
    if (!this.roomCode) return '';
    return MultiplayerManager.buildInviteUrl(this.roomCode);
  }

  setLocalNickname(name) {
    this.localNickname = String(name || '').trim().slice(0, 12);
    const localPlayer = this.players.find((p) => p.isLocal || p.peerId === this.localPeerId);
    if (localPlayer) {
      localPlayer.nickname = this.localNickname;
    }

    if (this.mode === 'host') {
      this.rebuildHostPlayersList();
      this.broadcastCtrl({ type: 'room_state', players: this.serializePlayers() });
      this.notifyRoomChange();
    } else if (this.mode === 'guest') {
      this.sendToHostCtrl({ type: 'set_name', nickname: this.localNickname });
      this.notifyRoomChange();
    }
  }

  setLocalReady(ready) {
    this.localReady = !!ready;
    const localPlayer = this.players.find((p) => p.isLocal || p.peerId === this.localPeerId);
    if (localPlayer) {
      localPlayer.ready = this.localReady;
    }
    if (this.mode === 'host') {
      this.rebuildHostPlayersList();
      this.broadcastCtrl({
        type: 'room_state',
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
    } else if (this.mode === 'guest') {
      this.sendToHostCtrl({ type: 'set_ready', ready: this.localReady });
      this.notifyRoomChange();
    }
  }

  hostRoom() {
    if (this.mode === 'host' && this.roomCode) {
      return this.getInviteUrl();
    }

    this.shutdown(false);
    this.mode = 'host';
    this.isInGame = false;
    this.localReady = false;
    this.roomCode = MultiplayerManager.generateRoomCode();
    this.assignedSlot = 0;
    this.connectionStatus = 'hosting';
    this.statusDetail = '';
    this.players = [this.makeLocalPlayerEntry(0, true)];

    this.openSignaling(this.roomCode);
    this.startHostTimers();

    this.notifyRoomChange();
    return this.getInviteUrl();
  }

  startHostTimers() {
    if (this.hostAliveTimer) clearInterval(this.hostAliveTimer);
    if (this.rttMeasureTimer) clearInterval(this.rttMeasureTimer);

    this.hostAliveTimer = setInterval(() => {
      if (this.mode === 'host' && !this.isInGame && this.getOpenGuestCount() < GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS - 1) {
        this.sendSignal('host_alive', null, {});
      }
    }, 3000);

    this.rttMeasureTimer = setInterval(() => {
      if (this.mode === 'host') {
        this.measurePeerRtts();
      }
    }, 2000);
  }

  setInGame(inGame) {
    this.isInGame = !!inGame;
    if (this.mode === 'host' && this.isInGame) {
      for (const [peerId, peer] of Array.from(this.peers.entries())) {
        if (!peer.connected && (!peer.ctrlDc || peer.ctrlDc.readyState !== 'open')) {
          this.sendSignal('game_in_progress', peerId, {});
          this.peers.delete(peerId);
          this.closePeerResources(peer);
        }
      }
    }
  }

  areAllGuestsReady() {
    if (this.mode !== 'host') return true;
    const guests = this.players.filter((p) => !p.isHost);
    return guests.every((p) => !!p.ready);
  }

  areAllPlayersReady() {
    return this.players.length > 0 && this.players.every((p) => !!p.ready);
  }

  resetAllReady() {
    this.localReady = false;
    if (this.mode === 'host') {
      for (const peer of this.peers.values()) {
        peer.ready = false;
      }
      this.rebuildHostPlayersList();
      this.broadcastCtrl({
        type: 'room_state',
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
    } else if (this.mode === 'guest') {
      const localPlayer = this.players.find((p) => p.isLocal || p.peerId === this.localPeerId);
      if (localPlayer) localPlayer.ready = false;
      this.notifyRoomChange();
    }
  }

  resetGuestsReady() {
    this.resetAllReady();
  }

  joinRoom(code) {
    const cleanCode = String(code || '').trim().toUpperCase();
    if (!cleanCode) return;

    this.shutdown(false);
    this.mode = 'guest';
    this.roomCode = cleanCode;
    this.connectionStatus = 'connecting';
    this.statusDetail = '';
    this.localReady = false;
    this.isInGame = false;
    this.joinSessionToken = MultiplayerManager.randomId(8);
    this.players = [
      this.makeLocalPlayerEntry(0, false)
    ];

    this.openSignaling(cleanCode);
    this.sendJoinRequest();

    this.joinRetryTimer = setInterval(() => {
      if (this.mode !== 'guest' || this.connectionStatus === 'connected' || this.connectionStatus === 'full') {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
        return;
      }
      if (!this.hostPeer || !this.hostPeer.hasOffer) {
        this.sendJoinRequest();
      }
    }, 800);

    // 招待リンク接続時にルームが見つからない場合は速やかにソロモードへ切り替える
    this.clearJoinNotFoundTimeout();
    this.scheduleNotFoundFallback(2500);

    this.notifyRoomChange();
  }

  clearJoinNotFoundTimeout() {
    if (this.joinTimeoutTimer) {
      clearTimeout(this.joinTimeoutTimer);
      this.joinTimeoutTimer = null;
    }
    this.joinNotFoundDeadline = 0;
  }

  scheduleNotFoundFallback(delayMs) {
    const newDeadline = Date.now() + delayMs;
    if (
      this.joinTimeoutTimer &&
      this.joinNotFoundDeadline > 0 &&
      newDeadline >= this.joinNotFoundDeadline
    ) {
      return;
    }
    this.clearJoinNotFoundTimeout();
    this.joinNotFoundDeadline = newDeadline;
    this.joinTimeoutTimer = setTimeout(() => {
      this.joinTimeoutTimer = null;
      this.joinNotFoundDeadline = 0;
      if (this.mode === 'guest' && this.connectionStatus === 'connecting' && (!this.hostPeer || !this.hostPeer.hasOffer)) {
        this.handleRoomNotFound();
      }
    }, Math.max(0, newDeadline - Date.now()));
  }

  leaveRoom() {
    this.shutdown(true);
    this.mode = 'solo';
    this.isInGame = false;
    this.roomCode = null;
    this.connectionStatus = 'idle';
    this.statusDetail = '';
    this.localReady = false;
    this.assignedSlot = 0;
    this.players = [this.makeLocalPlayerEntry(0, true)];
    this.notifyRoomChange();
  }

  clearMigrationTimers() {
    while (this.migrationTimers.length > 0) {
      clearTimeout(this.migrationTimers.pop());
    }
    while (this.migratingCleanupTimers.length > 0) {
      clearTimeout(this.migratingCleanupTimers.pop());
    }
    this.migrating = false;
  }

  closeHostPeerOnly() {
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    this.clearJoinNotFoundTimeout();
    if (this.hostPeer) {
      this.closePeerResources(this.hostPeer);
      this.hostPeer = null;
    }
  }

  shutdown(sendBye = false) {
    if (sendBye && this.roomCode) {
      if (this.mode === 'guest') {
        this.sendToHostCtrl({ type: 'bye', peerId: this.localPeerId });
        this.sendSignal('bye', null, {});
      } else if (this.mode === 'host') {
        const order = this.computeMigrationOrder();
        if (order.length > 0) {
          const migPayload = {
            newHostPeerId: order[0],
            migrationOrder: order,
            oldHostSlot: this.assignedSlot
          };
          this.broadcastCtrl({ type: 'host_migrate', ...migPayload });
          this.sendSignal('host_migrate', null, migPayload);
        } else {
          this.broadcastCtrl({ type: 'host_closed' });
          this.sendSignal('bye', null, {});
        }
      }
    }

    this.clearMigrationTimers();
    this.migratingExpectedSlots.clear();
    this.migratingGraceUntil = 0;

    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    this.clearJoinNotFoundTimeout();
    if (this.hostAliveTimer) {
      clearInterval(this.hostAliveTimer);
      this.hostAliveTimer = null;
    }
    if (this.rttMeasureTimer) {
      clearInterval(this.rttMeasureTimer);
      this.rttMeasureTimer = null;
    }

    for (const peer of this.peers.values()) {
      this.closePeerResources(peer);
    }
    this.peers.clear();
    this.remoteInputs.clear();

    if (this.hostPeer) {
      this.closePeerResources(this.hostPeer);
      this.hostPeer = null;
    }
    this.hostPeerId = null;

    this.closeSignaling();
  }

  closePeerResources(peer) {
    if (!peer) return;
    if (peer.pingTimer) clearInterval(peer.pingTimer);
    if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
    try { if (peer.ctrlDc) peer.ctrlDc.close(); } catch (_) {}
    try { if (peer.syncDc) peer.syncDc.close(); } catch (_) {}
    try { if (peer.pc) peer.pc.close(); } catch (_) {}
  }

  getOpenGuestCount() {
    let count = 0;
    for (const peer of this.peers.values()) {
      if (peer.connected || (peer.ctrlDc && peer.ctrlDc.readyState === 'open')) {
        count += 1;
      }
    }
    return count;
  }

  // ============================================================================
  // シグナリング (BroadcastChannel + 冗長 Public MQTT-over-WSS)
  // ============================================================================
  openSignaling(roomCode) {
    this.closeSignaling();
    this.seenSigIds.clear();

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(`paddles_sig_${roomCode}`);
        this.bc.onmessage = (ev) => {
          if (ev && ev.data) {
            this.handleSignalEnvelope(ev.data);
          }
        };
      } catch (_) {
        this.bc = null;
      }
    }

    const topic = `paddles-game/v1/room/${roomCode}`;
    const brokers = [
      'wss://broker.emqx.io:8084/mqtt',
      'wss://broker.hivemq.com:8884/mqtt'
    ];

    for (const url of brokers) {
      const client = this.createMqttClient(url, topic);
      this.mqttClients.push(client);
    }
  }

  closeSignaling() {
    if (this.bc) {
      try { this.bc.close(); } catch (_) {}
      this.bc = null;
    }
    for (const c of this.mqttClients) {
      c.closedByApp = true;
      if (c.keepaliveTimer) clearInterval(c.keepaliveTimer);
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      if (c.ws) {
        try {
          if (c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(new Uint8Array([0xe0, 0x00])); // MQTT DISCONNECT
          }
          c.ws.close();
        } catch (_) {}
      }
    }
    this.mqttClients = [];
    this.sigQueue = [];
  }

  createMqttClient(url, topic) {
    const state = {
      url,
      topic,
      ws: null,
      ready: false,
      closedByApp: false,
      rxBuf: new Uint8Array(0),
      keepaliveTimer: null,
      reconnectTimer: null,
      packetId: 1
    };

    const connect = () => {
      if (state.closedByApp || typeof WebSocket === 'undefined') return;
      let ws;
      try {
        ws = new WebSocket(url, ['mqtt']);
      } catch (_) {
        scheduleReconnect();
        return;
      }
      ws.binaryType = 'arraybuffer';
      state.ws = ws;
      state.ready = false;
      state.rxBuf = new Uint8Array(0);

      ws.onopen = () => {
        if (state.closedByApp) {
          ws.close();
          return;
        }
        const cid = `pdl_${this.localPeerId}_${MultiplayerManager.randomId(4)}`.slice(0, 23);
        ws.send(MqttLite.encodeConnect(cid, 55));
        state.keepaliveTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ
          }
        }, 25000);
      };

      ws.onmessage = async (ev) => {
        if (state.closedByApp) return;
        let chunk;
        if (ev.data instanceof ArrayBuffer) {
          chunk = new Uint8Array(ev.data);
        } else if (ev.data instanceof Blob) {
          chunk = new Uint8Array(await ev.data.arrayBuffer());
        } else {
          return;
        }

        const merged = new Uint8Array(state.rxBuf.length + chunk.length);
        merged.set(state.rxBuf, 0);
        merged.set(chunk, state.rxBuf.length);
        const { packets, rest } = MqttLite.decodePackets(merged);
        state.rxBuf = rest;

        for (const pkt of packets) {
          if (pkt.type === 2) {
            // CONNACK -> SUBSCRIBE
            ws.send(MqttLite.encodeSubscribe(state.packetId++, topic));
          } else if (pkt.type === 9) {
            // SUBACK
            state.ready = true;
            this.flushSigQueueToClient(state);
            if (this.mode === 'host') {
              if (Date.now() <= this.migratingGraceUntil) {
                this.sendSignal('host_migrate_announce', null, { inGame: this.isInGame });
              }
              if (!this.isInGame) {
                this.sendSignal('host_alive', null, {});
              }
            } else if (this.mode === 'guest' && this.connectionStatus === 'connecting') {
              this.sendJoinRequest();
              if (!this.hostPeer || !this.hostPeer.hasOffer) {
                this.scheduleNotFoundFallback(1200);
              }
            }
          } else if (pkt.type === 3 && pkt.payload) {
            try {
              const env = JSON.parse(pkt.payload);
              this.handleSignalEnvelope(env);
            } catch (_) {}
          }
        }
      };

      const onDrop = () => {
        state.ready = false;
        if (state.keepaliveTimer) {
          clearInterval(state.keepaliveTimer);
          state.keepaliveTimer = null;
        }
        if (!state.closedByApp) {
          scheduleReconnect();
        }
      };

      ws.onclose = onDrop;
      ws.onerror = () => {
        try { ws.close(); } catch (_) {}
      };
    };

    const scheduleReconnect = () => {
      if (state.closedByApp || state.reconnectTimer) return;
      state.reconnectTimer = setTimeout(() => {
        state.reconnectTimer = null;
        connect();
      }, 3000);
    };

    connect();
    return state;
  }

  flushSigQueueToClient(client) {
    if (!client.ready || !client.ws || client.ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    this.sigQueue = this.sigQueue.filter((item) => now - item.ts < 8000);
    for (const item of this.sigQueue) {
      try {
        client.ws.send(MqttLite.encodePublish(client.topic, item.json));
      } catch (_) {}
    }
  }

  sendSignal(type, to, payload) {
    if (!this.roomCode) return;
    const env = {
      id: `${this.localPeerId}_${Date.now()}_${MultiplayerManager.randomId(5)}`,
      room: this.roomCode,
      from: this.localPeerId,
      to: to || null,
      type,
      payload: payload || {},
      ts: Date.now()
    };
    this.seenSigIds.add(env.id);

    if (this.bc) {
      try {
        this.bc.postMessage(env);
      } catch (_) {}
    }

    const json = JSON.stringify(env);
    let sentAtLeastOnce = false;
    for (const client of this.mqttClients) {
      if (client.ready && client.ws && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(MqttLite.encodePublish(client.topic, json));
          sentAtLeastOnce = true;
        } catch (_) {}
      }
    }
    if (!sentAtLeastOnce && this.mqttClients.length > 0) {
      this.sigQueue.push({ json, ts: Date.now() });
      if (this.sigQueue.length > 30) {
        this.sigQueue.shift();
      }
    }
  }

  sendJoinRequest(isMigration = false) {
    if (this.mode !== 'guest') return;
    this.sendSignal('join_req', null, {
      nickname: this.localNickname,
      ready: this.localReady,
      sessionToken: this.joinSessionToken,
      isMigration: !!isMigration || !!this.reconnectingFromMigration,
      prevSlot: this.assignedSlot
    });
  }

  handleSignalEnvelope(env) {
    if (!env || !env.id || env.room !== this.roomCode) return;
    if (env.from === this.localPeerId) return;
    if (env.to && env.to !== this.localPeerId) return;
    if (this.seenSigIds.has(env.id)) return;

    this.seenSigIds.add(env.id);
    if (this.seenSigIds.size > 600) {
      const iter = this.seenSigIds.values();
      for (let i = 0; i < 200; i++) {
        this.seenSigIds.delete(iter.next().value);
      }
    }

    if (this.mode === 'host') {
      this.handleHostSignal(env);
    } else if (this.mode === 'guest') {
      this.handleGuestSignal(env);
    }
  }

  // ============================================================================
  // ホスト側 WebRTC 接続処理
  // ============================================================================
  handleHostSignal(env) {
    const { from, type, payload } = env;

    if (type === 'join_req') {
      const canJoinAsMigratingPeer =
        payload.isMigration &&
        Date.now() <= this.migratingGraceUntil &&
        this.migratingExpectedSlots.has(from);

      if (this.isInGame && !canJoinAsMigratingPeer) {
        this.sendSignal('game_in_progress', from, {});
        return;
      }

      const existing = this.peers.get(from);
      if (existing) {
        const pcState = existing.pc ? existing.pc.connectionState : 'closed';
        const isAlive = existing.sessionToken === payload.sessionToken && pcState !== 'failed' && pcState !== 'closed';
        if (isAlive) {
          if (existing.ctrlDc && existing.ctrlDc.readyState === 'open') {
            this.sendToPeerCtrl(existing, {
              type: 'room_state',
              players: this.serializePlayers(),
              mo: this.migrationOrder
            });
          }
          return;
        }
        this.removePeer(from);
      }

      if (this.peers.size >= GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS - 1) {
        this.sendSignal('room_full', from, {});
        return;
      }

      this.createOfferForGuest(from, payload);
    } else if (type === 'webrtc_answer') {
      const peer = this.peers.get(from);
      if (!peer || payload.connEpoch !== peer.connEpoch) return;
      peer.pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
        .then(() => {
          peer.remoteDescSet = true;
          this.flushIceQueue(peer);
        })
        .catch(() => {});
    } else if (type === 'ice_cand') {
      const peer = this.peers.get(from);
      if (!peer || payload.connEpoch !== peer.connEpoch || !payload.candidate) return;
      if (peer.remoteDescSet) {
        peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
      } else {
        peer.pendingIce.push(payload.candidate);
      }
    } else if (type === 'bye') {
      if (this.peers.has(from)) {
        this.removePeer(from);
      }
    }
  }

  getNextFreeSlot(preferredSlot = null) {
    const usedSlots = new Set([this.assignedSlot]);
    for (const peer of this.peers.values()) {
      usedSlots.add(peer.slot);
    }
    if (
      typeof preferredSlot === 'number' &&
      preferredSlot >= 0 &&
      preferredSlot < GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS &&
      !usedSlots.has(preferredSlot)
    ) {
      return preferredSlot;
    }
    for (let s = 0; s < GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS; s++) {
      if (!usedSlots.has(s)) return s;
    }
    return 1;
  }

  measurePeerRtts() {
    if (this.mode !== 'host') return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    for (const peer of this.peers.values()) {
      if (!peer.connected) continue;
      const dc = (peer.syncDc && peer.syncDc.readyState === 'open') ? peer.syncDc : peer.ctrlDc;
      if (!dc || dc.readyState !== 'open') continue;
      const seq = this.pingCounter++;
      peer.pendingPings.set(seq, now);
      if (peer.pendingPings.size > 12) {
        const oldestKey = peer.pendingPings.keys().next().value;
        peer.pendingPings.delete(oldestKey);
      }
      try {
        dc.send(JSON.stringify({ type: 'ping', seq }));
      } catch (_) {}
    }
  }

  handlePeerPong(peer, seq) {
    if (!peer || !peer.pendingPings) return;
    const sentAt = peer.pendingPings.get(seq);
    if (sentAt === undefined) return;
    peer.pendingPings.delete(seq);
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const rttSample = Math.max(0, now - sentAt);
    peer.rttMs = peer.hasRttSample ? (peer.rttMs * 0.6 + rttSample * 0.4) : rttSample;
    peer.hasRttSample = true;

    const prevOrderStr = this.lastMigrationOrderStr;
    this.updateMigrationOrder();
    if (this.lastMigrationOrderStr !== prevOrderStr) {
      this.broadcastCtrl({
        type: 'room_state',
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
    }
  }

  computeMigrationOrder() {
    const connected = Array.from(this.peers.values()).filter((p) => p.connected);
    if (connected.length === 0) return [];
    let bestRtt = Infinity;
    for (const p of connected) {
      const r = p.hasRttSample ? p.rttMs : 150;
      if (r < bestRtt) bestRtt = r;
    }
    const sorted = connected.slice().sort((a, b) => {
      const ar = a.hasRttSample ? a.rttMs : 150;
      const br = b.hasRttSample ? b.rttMs : 150;
      const aTop = ar <= bestRtt + 25;
      const bTop = br <= bestRtt + 25;
      if (aTop !== bTop) return aTop ? -1 : 1;
      if (aTop && bTop) return a.electionRand - b.electionRand;
      return ar - br;
    });
    return sorted.map((p) => p.peerId);
  }

  updateMigrationOrder() {
    this.migrationOrder = this.computeMigrationOrder();
    this.lastMigrationOrderStr = this.migrationOrder.join(',');
  }

  createOfferForGuest(guestPeerId, joinPayload) {
    const pc = new RTCPeerConnection(MultiplayerManager.RTC_CONFIG);
    const connEpoch = this.connEpochCounter++;
    const expectedMigrating = joinPayload.isMigration ? this.migratingExpectedSlots.get(guestPeerId) : null;
    const slot = this.getNextFreeSlot(expectedMigrating ? expectedMigrating.slot : joinPayload.prevSlot);

    const peer = {
      peerId: guestPeerId,
      slot,
      sessionToken: joinPayload.sessionToken || '',
      connEpoch,
      nickname: String(joinPayload.nickname || '').trim().slice(0, 12),
      ready: this.isInGame ? false : !!joinPayload.ready,
      rttMs: 150,
      hasRttSample: false,
      electionRand: Math.random(),
      pendingPings: new Map(),
      pc,
      ctrlDc: null,
      syncDc: null,
      connected: false,
      remoteDescSet: false,
      pendingIce: [],
      lastInputSeq: -1,
      pingTimer: null
    };

    this.peers.set(guestPeerId, peer);

    const ctrlDc = pc.createDataChannel('ctrl', { ordered: true });
    const syncDc = pc.createDataChannel('sync', { ordered: false, maxRetransmits: 0 });
    peer.ctrlDc = ctrlDc;
    peer.syncDc = syncDc;

    ctrlDc.onopen = () => {
      const allowedMigrating = Date.now() <= this.migratingGraceUntil && this.migratingExpectedSlots.has(guestPeerId);
      if (this.isInGame && !allowedMigrating) {
        this.sendToPeerCtrl(peer, { type: 'game_in_progress' });
        setTimeout(() => this.removePeer(guestPeerId), 80);
        return;
      }
      if (allowedMigrating) {
        this.migratingExpectedSlots.delete(guestPeerId);
      }
      peer.connected = true;
      this.rebuildHostPlayersList();
      this.sendToPeerCtrl(peer, {
        type: 'welcome',
        assignedSlot: peer.slot,
        inGame: this.isInGame,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.broadcastCtrl({
        type: 'room_state',
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
      setTimeout(() => this.measurePeerRtts(), 250);
      if (this.callbacks.onPeerJoined) {
        this.callbacks.onPeerJoined(peer);
      }
    };

    ctrlDc.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.type === 'pong') {
        this.handlePeerPong(peer, msg.seq);
        return;
      }
      this.handleHostCtrlMessage(peer, msg);
    };

    ctrlDc.onclose = () => {
      if (this.peers.get(guestPeerId) === peer) {
        this.removePeer(guestPeerId);
      }
    };

    syncDc.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.type === 'pong') {
        this.handlePeerPong(peer, msg.seq);
        return;
      }
      if (msg && msg.type === 'input') {
        const seq = msg.seq || 0;
        if (seq >= peer.lastInputSeq || peer.lastInputSeq - seq > 500) {
          peer.lastInputSeq = seq;
          this.remoteInputs.set(peer.slot, {
            left: !!msg.left,
            right: !!msg.right,
            pointerX: typeof msg.pointerX === 'number' ? msg.pointerX : null
          });
        }
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal('ice_cand', guestPeerId, {
          connEpoch,
          candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (peer.disconnectTimer) {
          clearTimeout(peer.disconnectTimer);
          peer.disconnectTimer = null;
        }
      } else if (pc.connectionState === 'disconnected') {
        if (!peer.disconnectTimer) {
          peer.disconnectTimer = setTimeout(() => {
            if (this.peers.get(guestPeerId) === peer && pc.connectionState !== 'connected') {
              this.removePeer(guestPeerId);
            }
          }, 4500);
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.peers.get(guestPeerId) === peer) {
          this.removePeer(guestPeerId);
        }
      }
    };

    pc.createOffer()
      .then((offer) => pc.setLocalDescription(offer))
      .then(() => {
        this.sendSignal('webrtc_offer', guestPeerId, {
          connEpoch,
          sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription
        });
      })
      .catch(() => {
        if (this.peers.get(guestPeerId) === peer) {
          this.removePeer(guestPeerId);
        }
      });
  }

  handleHostCtrlMessage(peer, msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'hello') {
      peer.nickname = String(msg.nickname || '').trim().slice(0, 12);
      peer.ready = this.isInGame ? false : !!msg.ready;
      this.rebuildHostPlayersList();
      this.broadcastCtrl({ type: 'room_state', players: this.serializePlayers(), mo: this.migrationOrder });
      this.notifyRoomChange();
    } else if (msg.type === 'set_name') {
      peer.nickname = String(msg.nickname || '').trim().slice(0, 12);
      this.rebuildHostPlayersList();
      this.broadcastCtrl({ type: 'room_state', players: this.serializePlayers(), mo: this.migrationOrder });
      this.notifyRoomChange();
    } else if (msg.type === 'set_ready') {
      peer.ready = !!msg.ready;
      this.rebuildHostPlayersList();
      this.broadcastCtrl({ type: 'room_state', players: this.serializePlayers(), mo: this.migrationOrder });
      this.notifyRoomChange();
    } else if (msg.type === 'bye') {
      this.removePeer(peer.peerId);
    }
  }

  removePeer(guestPeerId) {
    const peer = this.peers.get(guestPeerId);
    if (!peer) return;
    this.peers.delete(guestPeerId);
    this.remoteInputs.delete(peer.slot);
    this.closePeerResources(peer);

    if (this.mode === 'host') {
      this.rebuildHostPlayersList();
      this.broadcastCtrl({ type: 'room_state', players: this.serializePlayers(), mo: this.migrationOrder });
      this.notifyRoomChange();
      if (this.callbacks.onPeerLeft) {
        this.callbacks.onPeerLeft(peer.slot);
      }
    }
  }

  rebuildHostPlayersList() {
    const connectedPeers = Array.from(this.peers.values()).filter((p) => p.connected);
    const list = [this.makeLocalPlayerEntry(this.assignedSlot, true)];
    for (const peer of connectedPeers) {
      list.push({
        peerId: peer.peerId,
        slot: peer.slot,
        nickname: peer.nickname,
        ready: peer.ready,
        isHost: false,
        isLocal: false
      });
    }
    list.sort((a, b) => a.slot - b.slot);
    this.players = list;
    this.updateMigrationOrder();
  }

  serializePlayers() {
    return this.players.map((p) => ({
      peerId: p.peerId,
      slot: p.slot,
      nickname: p.nickname,
      ready: p.ready,
      isHost: p.isHost
    }));
  }

  // ============================================================================
  // ゲスト側 WebRTC 接続処理 & ホスト移行
  // ============================================================================
  handleGuestSignal(env) {
    const { from, type, payload } = env;

    if (type === 'host_alive') {
      if (this.connectionStatus === 'connecting' && (!this.hostPeer || !this.hostPeer.hasOffer)) {
        this.sendJoinRequest();
      }
    } else if (type === 'host_migrate') {
      if (from === this.hostPeerId) {
        this.beginGuestHostMigration(payload.newHostPeerId, payload.migrationOrder);
      }
    } else if (type === 'host_migrate_announce') {
      if (from !== this.localPeerId && (this.migrating || (this.connectionStatus === 'connecting' && this.reconnectingFromMigration))) {
        this.onDiscoveredNewHost(from);
      }
    } else if (type === 'room_full') {
      this.connectionStatus = 'full';
      this.statusDetail = 'FULL';
      if (this.joinRetryTimer) {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
      }
      this.notifyRoomChange();
    } else if (type === 'game_in_progress') {
      this.handleGameInProgressReject();
    } else if (type === 'webrtc_offer') {
      if (this.hostPeer && this.hostPeer.connEpoch === payload.connEpoch && this.hostPeer.hostPeerId === from) {
        return;
      }
      this.acceptOfferFromHost(from, payload);
    } else if (type === 'ice_cand') {
      if (!this.hostPeer || this.hostPeer.hostPeerId !== from || payload.connEpoch !== this.hostPeer.connEpoch) return;
      if (!payload.candidate) return;
      if (this.hostPeer.remoteDescSet) {
        this.hostPeer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
      } else {
        this.hostPeer.pendingIce.push(payload.candidate);
      }
    } else if (type === 'bye' && from === this.hostPeerId) {
      this.handleHostDisconnect();
    }
  }

  acceptOfferFromHost(hostPeerId, payload) {
    this.clearJoinNotFoundTimeout();
    if (this.hostPeer) {
      this.closePeerResources(this.hostPeer);
    }

    const pc = new RTCPeerConnection(MultiplayerManager.RTC_CONFIG);
    this.hostPeerId = hostPeerId;

    const hostPeer = {
      hostPeerId,
      connEpoch: payload.connEpoch,
      hasOffer: true,
      pc,
      ctrlDc: null,
      syncDc: null,
      remoteDescSet: false,
      pendingIce: []
    };
    this.hostPeer = hostPeer;

    const maybeCloseSignalingAfterOpen = () => {
      if (
        hostPeer.ctrlDc && hostPeer.ctrlDc.readyState === 'open' &&
        hostPeer.syncDc && hostPeer.syncDc.readyState === 'open'
      ) {
        setTimeout(() => {
          if (this.mode === 'guest' && this.connectionStatus === 'connected') {
            this.closeSignaling();
          }
        }, 1200);
      }
    };

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      if (dc.label === 'ctrl') {
        hostPeer.ctrlDc = dc;
        dc.onopen = () => {
          this.connectionStatus = 'connected';
          this.statusDetail = '';
          this.reconnectingFromMigration = false;
          this.migrating = false;
          if (this.joinRetryTimer) {
            clearInterval(this.joinRetryTimer);
            this.joinRetryTimer = null;
          }
          this.clearJoinNotFoundTimeout();
          this.sendToHostCtrl({
            type: 'hello',
            nickname: this.localNickname,
            ready: this.localReady
          });
          this.notifyRoomChange();
          maybeCloseSignalingAfterOpen();
        };
        dc.onmessage = (msgEv) => {
          let msg;
          try { msg = JSON.parse(msgEv.data); } catch (_) { return; }
          if (msg && msg.type === 'ping') {
            this.sendToHostCtrl({ type: 'pong', seq: msg.seq });
            return;
          }
          this.handleGuestCtrlMessage(msg);
        };
        dc.onclose = () => {
          if (this.mode === 'guest' && this.hostPeer === hostPeer) {
            this.handleHostDisconnect();
          }
        };
      } else if (dc.label === 'sync') {
        hostPeer.syncDc = dc;
        dc.onopen = () => maybeCloseSignalingAfterOpen();
        dc.onmessage = (msgEv) => {
          let msg;
          try { msg = JSON.parse(msgEv.data); } catch (_) { return; }
          if (msg && msg.type === 'ping') {
            try { dc.send(JSON.stringify({ type: 'pong', seq: msg.seq })); } catch (_) {}
            return;
          }
          if (msg && msg.type === 'snap' && this.callbacks.onSnapshot) {
            this.callbacks.onSnapshot(msg);
          }
        };
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.sendSignal('ice_cand', hostPeerId, {
          connEpoch: payload.connEpoch,
          candidate: ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'connected') {
        if (hostPeer.disconnectTimer) {
          clearTimeout(hostPeer.disconnectTimer);
          hostPeer.disconnectTimer = null;
        }
      } else if (pc.connectionState === 'disconnected') {
        if (!hostPeer.disconnectTimer) {
          hostPeer.disconnectTimer = setTimeout(() => {
            if (this.mode === 'guest' && this.hostPeer === hostPeer && pc.connectionState !== 'connected') {
              this.handleHostDisconnect();
            }
          }, 4500);
        }
      } else if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        if (this.mode === 'guest' && this.hostPeer === hostPeer) {
          this.handleHostDisconnect();
        }
      }
    };

    pc.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      .then(() => {
        hostPeer.remoteDescSet = true;
        this.flushIceQueue(hostPeer);
        return pc.createAnswer();
      })
      .then((answer) => pc.setLocalDescription(answer))
      .then(() => {
        this.sendSignal('webrtc_answer', hostPeerId, {
          connEpoch: payload.connEpoch,
          sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription
        });
      })
      .catch(() => {});
  }

  flushIceQueue(peerObj) {
    if (!peerObj || !peerObj.pc || !peerObj.remoteDescSet) return;
    while (peerObj.pendingIce.length > 0) {
      const c = peerObj.pendingIce.shift();
      peerObj.pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
    }
  }

  handleGuestCtrlMessage(msg) {
    if (!msg || !msg.type) return;
    if (msg.type === 'welcome') {
      this.assignedSlot = msg.assignedSlot;
      if (msg.inGame !== undefined) {
        this.isInGame = !!msg.inGame;
      }
      if (Array.isArray(msg.mo)) {
        this.migrationOrder = msg.mo;
      }
      this.applySerializedPlayers(msg.players || []);
      this.notifyRoomChange();
    } else if (msg.type === 'room_state') {
      if (Array.isArray(msg.mo)) {
        this.migrationOrder = msg.mo;
      }
      this.applySerializedPlayers(msg.players || []);
      this.notifyRoomChange();
    } else if (msg.type === 'host_migrate') {
      this.beginGuestHostMigration(msg.newHostPeerId, msg.migrationOrder);
    } else if (msg.type === 'host_closed') {
      this.handleHostDisconnect();
    } else if (msg.type === 'game_in_progress') {
      this.handleGameInProgressReject();
    } else if (this.callbacks.onCtrlEvent) {
      this.callbacks.onCtrlEvent(msg);
    }
  }

  applySerializedPlayers(list) {
    this.players = list.map((p) => ({
      ...p,
      isLocal: p.peerId === this.localPeerId || p.slot === this.assignedSlot
    }));
  }

  resetGuestToSolo(statusDetail = '') {
    if (this.mode !== 'guest') return;
    this.shutdown(false);
    this.mode = 'solo';
    this.isInGame = false;
    this.roomCode = null;
    this.connectionStatus = 'idle';
    this.statusDetail = statusDetail;
    this.localReady = false;
    this.assignedSlot = 0;
    this.players = [this.makeLocalPlayerEntry(0, true)];
    try {
      if (window.history && window.history.replaceState) {
        const url = new URL(window.location.href);
        url.searchParams.delete('room');
        window.history.replaceState(null, '', url.toString());
      }
    } catch (_) {}
    this.notifyRoomChange();
  }

  handleGameInProgressReject() {
    if (this.mode !== 'guest') return;
    this.resetGuestToSolo('IN_GAME');
    if (this.callbacks.onGameInProgressReject) {
      this.callbacks.onGameInProgressReject();
    }
  }

  handleRoomNotFound() {
    if (this.mode !== 'guest') return;
    this.resetGuestToSolo('NOT_FOUND');
    if (this.callbacks.onRoomNotFound) {
      this.callbacks.onRoomNotFound();
    }
  }

  handleHostDisconnect() {
    if (this.mode !== 'guest' || this.migrating) return;
    const oldHostEntry = this.players.find((p) => p.isHost || p.peerId === this.hostPeerId);
    const oldHostId = oldHostEntry ? oldHostEntry.peerId : this.hostPeerId;
    const surviving = this.players.filter((p) => !p.isHost && p.peerId !== oldHostId);
    const hasBeenWelcomed = surviving.some((p) => p.peerId === this.localPeerId);

    if (!hasBeenWelcomed || !this.roomCode) {
      this.finalizeHostGoneDisconnect();
      return;
    }

    const baseOrder = (this.migrationOrder && this.migrationOrder.length > 0)
      ? this.migrationOrder.filter((id) => id !== oldHostId)
      : surviving.map((p) => p.peerId);
    this.beginGuestHostMigration(baseOrder[0] || this.localPeerId, baseOrder);
  }

  beginGuestHostMigration(preferredHostPeerId, candidateOrder) {
    if (this.mode !== 'guest' || this.migrating || !this.roomCode) return;

    const oldHostEntry = this.players.find((p) => p.isHost || p.peerId === this.hostPeerId);
    const oldHostSlot = oldHostEntry ? oldHostEntry.slot : 0;
    const oldHostId = oldHostEntry ? oldHostEntry.peerId : this.hostPeerId;
    const survivingPlayers = this.players.filter((p) => !p.isHost && p.peerId !== oldHostId);

    if (!survivingPlayers.some((p) => p.peerId === this.localPeerId)) {
      this.finalizeHostGoneDisconnect();
      return;
    }

    this.migrating = true;
    this.closeHostPeerOnly();
    this.connectionStatus = 'migrating';
    this.statusDetail = 'MIGRATING';
    this.players = survivingPlayers;

    if (this.mqttClients.length === 0 && !this.bc) {
      this.openSignaling(this.roomCode);
    }

    let ordered = Array.isArray(candidateOrder) && candidateOrder.length > 0
      ? candidateOrder.filter((id) => id !== oldHostId && survivingPlayers.some((p) => p.peerId === id))
      : survivingPlayers.map((p) => p.peerId);

    for (const sp of survivingPlayers) {
      if (!ordered.includes(sp.peerId)) ordered.push(sp.peerId);
    }
    if (preferredHostPeerId && ordered.includes(preferredHostPeerId)) {
      ordered = [preferredHostPeerId, ...ordered.filter((id) => id !== preferredHostPeerId)];
    }

    const myRank = ordered.indexOf(this.localPeerId);
    if (myRank === -1) {
      this.finalizeHostGoneDisconnect();
      return;
    }

    if (myRank === 0) {
      this.promoteToHost(oldHostSlot, survivingPlayers);
      return;
    }

    const promoTimer = setTimeout(() => {
      if (!this.migrating || this.mode !== 'guest') return;
      this.promoteToHost(oldHostSlot, survivingPlayers);
    }, myRank * 2400);
    this.migrationTimers.push(promoTimer);

    const failTimer = setTimeout(() => {
      if (this.migrating && this.mode === 'guest') {
        this.finalizeHostGoneDisconnect();
      }
    }, ordered.length * 2400 + 6000);
    this.migrationTimers.push(failTimer);

    this.notifyRoomChange();
  }

  onDiscoveredNewHost(newHostPeerId) {
    if (this.mode !== 'guest') return;
    this.clearMigrationTimers();
    this.hostPeerId = newHostPeerId;
    this.reconnectingFromMigration = true;
    this.connectionStatus = 'connecting';
    this.statusDetail = '';
    this.sendJoinRequest(true);

    if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
    this.joinRetryTimer = setInterval(() => {
      if (this.mode !== 'guest' || this.connectionStatus === 'connected' || this.connectionStatus === 'full') {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
        return;
      }
      if (!this.hostPeer || !this.hostPeer.hasOffer) {
        this.sendJoinRequest(true);
      }
    }, 1000);

    this.notifyRoomChange();
  }

  promoteToHost(oldHostSlot, survivingPlayers) {
    this.clearMigrationTimers();
    this.closeHostPeerOnly();
    this.hostPeerId = null;
    this.reconnectingFromMigration = false;

    this.mode = 'host';
    this.connectionStatus = 'hosting';
    this.statusDetail = '';
    this.peers.clear();
    this.remoteInputs.clear();
    this.migratingExpectedSlots.clear();
    this.migratingGraceUntil = Date.now() + 12000;

    if (this.isInGame) {
      this.localReady = false;
    }

    const expectedMissing = [];
    for (const sp of survivingPlayers) {
      if (sp.peerId !== this.localPeerId) {
        this.migratingExpectedSlots.set(sp.peerId, {
          peerId: sp.peerId,
          slot: sp.slot,
          nickname: sp.nickname,
          ready: this.isInGame ? false : !!sp.ready
        });
        expectedMissing.push(sp);
      }
    }

    this.rebuildHostPlayersList();
    if (this.mqttClients.length === 0 && !this.bc) {
      this.openSignaling(this.roomCode);
    }
    this.startHostTimers();

    const announce = () => {
      if (this.mode !== 'host') return;
      this.sendSignal('host_migrate_announce', null, { inGame: this.isInGame });
    };
    announce();
    this.migratingCleanupTimers.push(setTimeout(announce, 350));
    this.migratingCleanupTimers.push(setTimeout(announce, 900));
    this.migratingCleanupTimers.push(setTimeout(announce, 1600));

    // 再接続できなかった残留メンバーのクリーンアップ
    if (expectedMissing.length > 0) {
      const cleanupTimer = setTimeout(() => {
        if (this.mode !== 'host') return;
        for (const [peerId, info] of Array.from(this.migratingExpectedSlots.entries())) {
          this.migratingExpectedSlots.delete(peerId);
          if (this.callbacks.onPeerLeft) {
            this.callbacks.onPeerLeft(info.slot);
          }
        }
      }, 7500);
      this.migratingCleanupTimers.push(cleanupTimer);
    }

    if (this.callbacks.onBecomeHost) {
      this.callbacks.onBecomeHost({
        oldHostSlot,
        expectedMissing
      });
    }
    this.notifyRoomChange();
  }

  finalizeHostGoneDisconnect() {
    if (this.mode !== 'guest') return;
    this.shutdown(false);
    this.mode = 'solo';
    this.isInGame = false;
    this.connectionStatus = 'disconnected';
    this.statusDetail = 'HOST LEFT';
    this.localReady = false;
    this.assignedSlot = 0;
    this.players = [this.makeLocalPlayerEntry(0, true)];
    this.notifyRoomChange();
    if (this.callbacks.onHostDisconnected) {
      this.callbacks.onHostDisconnected();
    }
  }

  // ============================================================================
  // DataChannel 送受信ヘルパー
  // ============================================================================
  sendToPeerCtrl(peer, msg) {
    if (!peer || !peer.ctrlDc || peer.ctrlDc.readyState !== 'open') return;
    try {
      peer.ctrlDc.send(JSON.stringify(msg));
    } catch (_) {}
  }

  broadcastCtrl(msg) {
    if (this.mode !== 'host') return;
    const json = JSON.stringify(msg);
    for (const peer of this.peers.values()) {
      if (peer.ctrlDc && peer.ctrlDc.readyState === 'open') {
        try { peer.ctrlDc.send(json); } catch (_) {}
      }
    }
  }

  broadcastSync(msg) {
    if (this.mode !== 'host') return;
    const json = JSON.stringify(msg);
    for (const peer of this.peers.values()) {
      if (peer.syncDc && peer.syncDc.readyState === 'open') {
        try { peer.syncDc.send(json); } catch (_) {}
      } else if (peer.ctrlDc && peer.ctrlDc.readyState === 'open') {
        try { peer.ctrlDc.send(json); } catch (_) {}
      }
    }
  }

  sendToHostCtrl(msg) {
    if (this.mode !== 'guest' || !this.hostPeer || !this.hostPeer.ctrlDc) return;
    if (this.hostPeer.ctrlDc.readyState !== 'open') return;
    try {
      this.hostPeer.ctrlDc.send(JSON.stringify(msg));
    } catch (_) {}
  }

  sendToHostInput(seq, inputState) {
    if (this.mode !== 'guest' || !this.hostPeer) return;
    const msg = {
      type: 'input',
      seq,
      left: !!inputState.left,
      right: !!inputState.right,
      pointerX: typeof inputState.pointerX === 'number' ? Math.round(inputState.pointerX * 10) / 10 : null
    };
    const dc = (this.hostPeer.syncDc && this.hostPeer.syncDc.readyState === 'open')
      ? this.hostPeer.syncDc
      : this.hostPeer.ctrlDc;
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(JSON.stringify(msg));
    } catch (_) {}
  }

  notifyRoomChange() {
    if (this.callbacks.onRoomChange) {
      this.callbacks.onRoomChange({
        mode: this.mode,
        roomCode: this.roomCode,
        status: this.connectionStatus,
        detail: this.statusDetail,
        players: this.players,
        assignedSlot: this.assignedSlot
      });
    }
  }
}

MultiplayerManager.RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' }
  ]
};

/**
 * 軽量 MQTT 3.1.1 (WebSocketバイナリフレーム用) エンコーダ・デコーダ
 */
class MqttLite {
  static encodeStr(str) {
    const utf8 = new TextEncoder().encode(str);
    const out = new Uint8Array(2 + utf8.length);
    out[0] = (utf8.length >> 8) & 0xff;
    out[1] = utf8.length & 0xff;
    out.set(utf8, 2);
    return out;
  }

  static encodeVarLen(len) {
    const bytes = [];
    do {
      let d = len % 128;
      len = Math.floor(len / 128);
      if (len > 0) d |= 0x80;
      bytes.push(d);
    } while (len > 0);
    return new Uint8Array(bytes);
  }

  static buildPacket(headerByte, body) {
    const vl = MqttLite.encodeVarLen(body.length);
    const pkt = new Uint8Array(1 + vl.length + body.length);
    pkt[0] = headerByte;
    pkt.set(vl, 1);
    pkt.set(body, 1 + vl.length);
    return pkt;
  }

  static encodeConnect(clientId, keepAliveSec = 60) {
    const cid = MqttLite.encodeStr(clientId);
    const body = new Uint8Array(10 + cid.length);
    body.set([
      0x00, 0x04, 0x4d, 0x51, 0x54, 0x54, // "MQTT"
      0x04, // protocol level 3.1.1
      0x02, // clean session
      (keepAliveSec >> 8) & 0xff,
      keepAliveSec & 0xff
    ], 0);
    body.set(cid, 10);
    return MqttLite.buildPacket(0x10, body);
  }

  static encodeSubscribe(packetId, topic) {
    const t = MqttLite.encodeStr(topic);
    const body = new Uint8Array(2 + t.length + 1);
    body[0] = (packetId >> 8) & 0xff;
    body[1] = packetId & 0xff;
    body.set(t, 2);
    body[2 + t.length] = 0x00; // QoS 0
    return MqttLite.buildPacket(0x82, body);
  }

  static encodePublish(topic, payloadStr) {
    const t = MqttLite.encodeStr(topic);
    const p = new TextEncoder().encode(payloadStr);
    const body = new Uint8Array(t.length + p.length);
    body.set(t, 0);
    body.set(p, t.length);
    return MqttLite.buildPacket(0x30, body);
  }

  static decodePackets(buf) {
    const packets = [];
    let offset = 0;

    while (offset < buf.length) {
      if (offset + 2 > buf.length) break;
      const header = buf[offset];
      let pos = offset + 1;
      let mult = 1;
      let remLen = 0;
      let lenDone = false;

      while (pos < buf.length) {
        const b = buf[pos++];
        remLen += (b & 0x7f) * mult;
        mult *= 128;
        if ((b & 0x80) === 0) {
          lenDone = true;
          break;
        }
        if (mult > 128 * 128 * 128) break;
      }

      if (!lenDone || pos + remLen > buf.length) {
        break;
      }

      const body = buf.subarray(pos, pos + remLen);
      const type = header >> 4;
      if (type === 3 && body.length >= 2) {
        const tLen = (body[0] << 8) | body[1];
        let payloadStart = 2 + tLen;
        if ((header & 0x06) !== 0) {
          payloadStart += 2; // QoS > 0 includes 2-byte packet identifier
        }
        if (payloadStart <= body.length) {
          const payload = new TextDecoder().decode(body.subarray(payloadStart));
          packets.push({ type, payload });
        }
      } else {
        packets.push({ type });
      }

      offset = pos + remLen;
    }

    return {
      packets,
      rest: offset < buf.length ? buf.subarray(offset) : new Uint8Array(0)
    };
  }
}
