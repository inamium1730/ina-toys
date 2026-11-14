/**
 * バイナリ通信プロトコル (ArrayBuffer / DataView)
 * 座標・速度は Float64 ではなく Int16 (0.1px単位) / Uint16 / Uint32 / Uint8 に量子化して極小化する
 */
class _BinWriter {
  constructor(initialSize = 256) {
    this.buf = new ArrayBuffer(initialSize);
    this.u8a = new Uint8Array(this.buf);
    this.dv = new DataView(this.buf);
    this.pos = 0;
  }

  ensure(extra) {
    if (this.pos + extra <= this.u8a.length) return;
    let nextLen = this.u8a.length * 2;
    while (nextLen < this.pos + extra) nextLen *= 2;
    const nextBuf = new ArrayBuffer(nextLen);
    const nextU8 = new Uint8Array(nextBuf);
    nextU8.set(this.u8a.subarray(0, this.pos));
    this.buf = nextBuf;
    this.u8a = nextU8;
    this.dv = new DataView(nextBuf);
  }

  u8(v) {
    this.ensure(1);
    this.dv.setUint8(this.pos++, (v || 0) & 0xff);
  }

  i16(v) {
    this.ensure(2);
    const clamped = Math.max(-32767, Math.min(32767, Math.round(v || 0)));
    this.dv.setInt16(this.pos, clamped, true);
    this.pos += 2;
  }

  u16(v) {
    this.ensure(2);
    const clamped = Math.max(0, Math.min(65535, Math.round(v || 0)));
    this.dv.setUint16(this.pos, clamped, true);
    this.pos += 2;
  }

  u32(v) {
    this.ensure(4);
    this.dv.setUint32(this.pos, (Math.round(v || 0) >>> 0), true);
    this.pos += 4;
  }

  c10(v) {
    this.i16((v || 0) * 10);
  }

  u10(v) {
    this.u16((v || 0) * 10);
  }

  ang16(rad) {
    const r = rad || 0;
    const norm = Math.atan2(Math.sin(r), Math.cos(r));
    this.i16(norm * 10000);
  }

  ms16(sec) {
    this.u16((sec || 0) * 1000);
  }

  ms32(sec) {
    this.u32((sec || 0) * 1000);
  }

  tagStr(table, val) {
    if (val === null || val === undefined) {
      this.u8(0xfe);
      return;
    }
    const str = String(val);
    const idx = table.indexOf(str);
    if (idx >= 0 && idx < 0xfe) {
      this.u8(idx);
      return;
    }
    this.u8(0xff);
    const bytes = NetProto._enc.encode(str);
    const len = Math.min(250, bytes.length);
    this.u8(len);
    this.ensure(len);
    this.u8a.set(bytes.subarray(0, len), this.pos);
    this.pos += len;
  }

  bytes(arr) {
    this.ensure(arr.length);
    this.u8a.set(arr, this.pos);
    this.pos += arr.length;
  }

  finish() {
    return this.buf.slice(0, this.pos);
  }
}

class _BinReader {
  constructor(dv) {
    this.dv = dv;
    this.u8a = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
    this.pos = 0;
  }

  u8() {
    if (this.pos + 1 > this.dv.byteLength) return 0;
    return this.dv.getUint8(this.pos++);
  }

  i16() {
    if (this.pos + 2 > this.dv.byteLength) return 0;
    const v = this.dv.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u16() {
    if (this.pos + 2 > this.dv.byteLength) return 0;
    const v = this.dv.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  u32() {
    if (this.pos + 4 > this.dv.byteLength) return 0;
    const v = this.dv.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  c10() {
    return this.i16() / 10;
  }

  u10() {
    return this.u16() / 10;
  }

  ang16() {
    return this.i16() / 10000;
  }

  ms16() {
    return this.u16() / 1000;
  }

  ms32() {
    return this.u32() / 1000;
  }

  tagStr(table) {
    const code = this.u8();
    if (code === 0xfe) return null;
    if (code === 0xff) {
      const len = this.u8();
      const end = Math.min(this.u8a.length, this.pos + len);
      const s = NetProto._dec.decode(this.u8a.subarray(this.pos, end));
      this.pos = end;
      return s;
    }
    return code < table.length ? table[code] : '';
  }

  readBytes(len) {
    const end = Math.min(this.u8a.length, this.pos + len);
    const out = this.u8a.slice(this.pos, end);
    this.pos = end;
    return out;
  }
}

class NetProto {
  static isBinary(data) {
    return data != null && typeof data !== 'string' && typeof data.byteLength === 'number';
  }

  static toView(data) {
    if (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(data)) {
      return new DataView(data.buffer, data.byteOffset, data.byteLength);
    }
    return new DataView(data);
  }

  static peekType(data) {
    if (!NetProto.isBinary(data) || data.byteLength < 1) return -1;
    return NetProto.toView(data).getUint8(0);
  }

  static encodeInput(seq, left, right, pointerX, clientX) {
    const w = new _BinWriter(8);
    const hasPtr = typeof pointerX === 'number' && !Number.isNaN(pointerX);
    const hasClientX = typeof clientX === 'number' && !Number.isNaN(clientX);
    w.u8(NetProto.PT_INPUT);
    w.u16(seq & 0xffff);
    w.u8((left ? 1 : 0) | (right ? 2 : 0) | (hasPtr ? 4 : 0) | (hasClientX ? 8 : 0));
    w.c10(hasPtr ? pointerX : 0);
    if (hasClientX) {
      w.c10(clientX);
    }
    return w.finish();
  }

  static decodeInput(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const seq = r.u16();
    const flags = r.u8();
    const ptr = r.c10();
    const hasClientX = (flags & 8) !== 0 && r.pos + 2 <= r.u8a.length;
    const clientX = hasClientX ? r.c10() : null;
    return {
      type: 'input',
      seq,
      left: (flags & 1) !== 0,
      right: (flags & 2) !== 0,
      pointerX: (flags & 4) !== 0 ? ptr : null,
      x: clientX
    };
  }

  static encodePing(seq, hostTimeMs, bestRttMs = null) {
    const w = new _BinWriter(12);
    w.u8(NetProto.PT_PING);
    w.u16(seq & 0xffff);
    w.u32(hostTimeMs);
    w.u16(bestRttMs !== null && bestRttMs !== undefined ? Math.min(65534, bestRttMs * 10) : 65535);
    return w.finish();
  }

  static decodePing(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const seq = r.u16();
    const hostTimeMs = r.u32();
    const rttRaw = r.u16();
    return {
      type: 'ping',
      seq,
      hostTimeMs,
      bestRttMs: rttRaw === 65535 ? null : rttRaw / 10
    };
  }

  static encodePong(seq, echoHostTimeMs, selfStats = null) {
    const w = new _BinWriter(14);
    w.u8(NetProto.PT_PONG);
    w.u16(seq & 0xffff);
    w.u32(echoHostTimeMs || 0);
    if (selfStats && selfStats.hasSample) {
      w.u16(Math.min(65534, Math.max(0, selfStats.rttMs * 10)));
      w.u16(Math.min(65534, Math.max(0, (selfStats.jitterMs || 0) * 10)));
      w.u8(Math.round(Math.max(0, Math.min(1, selfStats.lossRate || 0)) * 255));
    } else {
      w.u16(65535);
      w.u16(0);
      w.u8(0);
    }
    return w.finish();
  }

  static decodePong(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const seq = r.u16();
    const echoHostTimeMs = r.u32();
    const rttRaw = r.u16();
    const jitRaw = r.u16();
    const lossU8 = r.u8();
    return {
      type: 'pong',
      seq,
      echoHostTimeMs,
      selfHasSample: rttRaw !== 65535,
      selfRttMs: rttRaw === 65535 ? null : rttRaw / 10,
      selfJitterMs: jitRaw / 10,
      selfLossRate: lossU8 / 255
    };
  }

  static encodeClockSync(serverTimeMs, rttMs) {
    const w = new _BinWriter(8);
    w.u8(NetProto.PT_CLOCK_SYNC);
    w.u32(serverTimeMs);
    w.u16(Math.min(65534, Math.max(0, (rttMs || 0) * 10)));
    return w.finish();
  }

  static decodeClockSync(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const serverTimeMs = r.u32();
    const rttMs = r.u16() / 10;
    return { type: 'clock_sync', serverTimeMs, rttMs };
  }

  static encodeMetrics(selfStats) {
    const w = new _BinWriter(8);
    w.u8(NetProto.PT_METRICS);
    if (selfStats && selfStats.hasSample) {
      w.u16(Math.min(65534, Math.max(0, selfStats.rttMs * 10)));
      w.u16(Math.min(65534, Math.max(0, (selfStats.jitterMs || 0) * 10)));
      w.u8(Math.round(Math.max(0, Math.min(1, selfStats.lossRate || 0)) * 255));
    } else {
      w.u16(65535);
      w.u16(0);
      w.u8(0);
    }
    return w.finish();
  }

  static decodeMetrics(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const rttRaw = r.u16();
    const jitRaw = r.u16();
    const lossU8 = r.u8();
    return {
      type: 'metrics',
      hasSample: rttRaw !== 65535,
      rttMs: rttRaw === 65535 ? null : rttRaw / 10,
      jitterMs: jitRaw / 10,
      lossRate: lossU8 / 255
    };
  }

  static encodeSnap(s) {
    const w = new _BinWriter(160);
    w.u8(NetProto.PT_SNAP);
    w.u32(s.t);
    w.u32(s.serverTimeMs || 0);
    w.tagStr(NetProto.GAME_STATES, s.st);
    w.u16(s.si || 0);
    w.u16(s.sn || 1);
    w.u32(s.sc || 0);
    w.u16(s.lv || 0);
    w.u16(Math.round((s.wm || 1) * 100));

    const flags =
      (s.w ? 1 : 0) |
      (s.pp ? 2 : 0) |
      (s.tr ? 4 : 0) |
      (s.bo ? 8 : 0) |
      (s.sk && s.sk.length > 0 ? 16 : 0);
    w.u8(flags);

    const ps = s.ps || [];
    w.u8(ps.length);
    for (const p of ps) {
      w.u8(p[0]);               // slot
      w.c10(p[1]);              // x
      w.u16(p[2] * 100);        // hp * 100
      w.u16(p[3] * 10);         // maxHp * 10
      w.c10(p[4]);              // currentWidth
      w.ms32(p[5]);             // effectClock
      w.ms16(p[6]);             // cyan
      w.ms16(p[7]);             // yellow
      w.ms16(p[8]);             // green
      w.u8(p[9] || 0);          // contestedItemsCount
      w.ms16(p[10]);            // timeSinceLastDamage
      w.ms16(p[11]);            // invincibleTimer
      w.u16((p[12] || 0) & 0xffff); // ackSeq
      w.ms16(p[13]);            // respawnTimer
      w.u8(p[14] || 0);         // respawnPenalty
    }

    if (s.pp) {
      w.c10(s.pp[0]);
      w.c10(s.pp[1]);
      w.u16(s.pp[2]);
    }

    if (s.tr) {
      w.tagStr(NetProto.TRANS_PHASES, s.tr[0]);
      w.ms16(s.tr[1] || 0);
    }

    if (s.bo) {
      const bo = s.bo;
      const bossKind = bo[0] === 'snake' ? 1 : (bo[0] === 'cloud' ? 2 : 0);
      w.u8(bossKind);
      if (bossKind === 1) {
        w.tagStr(NetProto.BOSS_PHASES, bo[1]);
        w.ms16(bo[2]);
        w.u16((bo[3] !== undefined ? bo[3] : 1) * 1000);
        w.u16(bo[4]);
        w.u16(bo[5]);
        w.u8(bo[6] ? 1 : 0);
        w.ms16(bo[7]);
        w.u16((bo[8] || 0) * 1000);
        w.c10(bo[9]);
        w.c10(bo[10]);
        w.c10(bo[11]);
        w.c10(bo[12]);
        const segs = bo[13] || [];
        w.u8(segs.length);
        for (let i = 0; i < segs.length; i++) {
          const pt = segs[i] || [0, -300];
          w.c10(pt[0]);
          w.c10(pt[1]);
        }
      } else if (bossKind === 2) {
        w.tagStr(NetProto.BOSS_PHASES, bo[1]);
        w.ms16(bo[2]);
        w.u16((bo[3] !== undefined ? bo[3] : 1) * 1000);
        w.u16(bo[4]);
        w.u16(bo[5]);
        w.u16(Math.round((bo[6] || 0) * 1000));
        w.u16(Math.round((bo[7] || 0) * 100));
        const bolts = bo[8] || [];
        w.u8(bolts.length);
        for (let i = 0; i < bolts.length; i++) {
          const bt = bolts[i] || [0, 0];
          w.c10(bt[0]);
          w.u16(bt[1] || 0);
        }
      } else {
        w.tagStr(NetProto.BOSS_PHASES, bo[0]);
        w.ms16(bo[1]);
        w.u16((bo[2] !== undefined ? bo[2] : 1) * 1000);
        w.c10(bo[3]);
        w.c10(bo[4]);
        w.ang16(bo[5]);
        w.u16(bo[6]);
        w.u16(bo[7]);
        w.u16(bo[8]);
        w.u16(bo[9]);
        w.u8(bo[10] ? 1 : 0);
        w.ms16(bo[11]);
        const lc = bo[12] || [];
        for (let i = 0; i < 3; i++) {
          const c = lc[i] || [0, 0, 0];
          w.c10(c[0]);
          w.c10(c[1]);
          w.u10(c[2]);
        }
        w.u16(bo[13]);
        w.u16(bo[14]);
        w.u8(bo[15] ? 1 : 0);
        w.ms16(bo[16]);
        const rc = bo[17] || [];
        for (let i = 0; i < 3; i++) {
          const c = rc[i] || [0, 0, 0];
          w.c10(c[0]);
          w.c10(c[1]);
          w.u10(c[2]);
        }
      }
    }

    if (s.sk && s.sk.length > 0) {
      w.u8(s.sk.length);
      for (const sk of s.sk) {
        w.tagStr(NetProto.SKILL_KEYS, sk[0]);
        w.u8(sk[1] ? 1 : 0);
        w.ms32(sk[2] || 0);
        w.ms32(sk[3] || 0);
        w.u8(sk[4] || 0);
        w.u8(sk[5] || 0);
      }
    }

    return w.finish();
  }

  static decodeSnap(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const t = r.u32();
    const serverTimeMs = r.u32();
    const st = r.tagStr(NetProto.GAME_STATES);
    const si = r.u16();
    const sn = r.u16();
    const sc = r.u32();
    const lv = r.u16();
    const wm = r.u16() / 100;
    const flags = r.u8();

    const pCount = r.u8();
    const ps = new Array(pCount);
    for (let i = 0; i < pCount; i++) {
      const slot = r.u8();
      const x = r.c10();
      const hp = r.u16() / 100;
      const maxHp = r.u16() / 10;
      const cw = r.c10();
      const effClock = r.ms32();
      const cyan = r.ms16();
      const yellow = r.ms16();
      const green = r.ms16();
      const contested = r.u8();
      const sinceDmg = r.ms16();
      const invinc = r.ms16();
      const ackSeq = r.u16();
      const respawnTimer = r.ms16();
      const respawnPenalty = r.u8();
      ps[i] = [slot, x, hp, maxHp, cw, effClock, cyan, yellow, green, null, contested, sinceDmg, invinc, ackSeq, respawnTimer, respawnPenalty];
    }

    let pp = null;
    if (flags & 2) {
      pp = [r.c10(), r.c10(), r.u16()];
    }

    let tr = null;
    if (flags & 4) {
      tr = [r.tagStr(NetProto.TRANS_PHASES), r.ms16()];
    }

    let bo = null;
    if (flags & 8) {
      const bossKind = r.u8();
      if (bossKind === 1) {
        const phase = r.tagStr(NetProto.BOSS_PHASES);
        const phaseTimer = r.ms16();
        const introProgress = r.u16() / 1000;
        const hp = r.u16();
        const maxHp = r.u16();
        const blinking = r.u8();
        const blinkTimer = r.ms16();
        const tongueProgress = r.u16() / 1000;
        const tongueStartX = r.c10();
        const tongueStartY = r.c10();
        const tongueTipX = r.c10();
        const tongueTipY = r.c10();
        const segCount = r.u8();
        const segs = new Array(segCount);
        for (let i = 0; i < segCount; i++) {
          segs[i] = [r.c10(), r.c10()];
        }
        bo = [
          'snake', phase, phaseTimer, introProgress,
          hp, maxHp, blinking, blinkTimer,
          tongueProgress, tongueStartX, tongueStartY, tongueTipX, tongueTipY,
          segs
        ];
      } else if (bossKind === 2) {
        const phase = r.tagStr(NetProto.BOSS_PHASES);
        const phaseTimer = r.ms16();
        const introProgress = r.u16() / 1000;
        const hp = r.u16();
        const maxHp = r.u16();
        const fogLevel = r.u16() / 1000;
        const trembleAmp = r.u16() / 100;
        const boltCount = r.u8();
        const bolts = new Array(boltCount);
        for (let i = 0; i < boltCount; i++) {
          bolts[i] = [r.c10(), r.u16()];
        }
        bo = [
          'cloud', phase, phaseTimer, introProgress,
          hp, maxHp, fogLevel, trembleAmp, bolts
        ];
      } else {
        const phase = r.tagStr(NetProto.BOSS_PHASES);
        const phaseTimer = r.ms16();
        const introProgress = r.u16() / 1000;
        const bodyOffsetY = r.c10();
        const headThrustOffsetY = r.c10();
        const headAngle = r.ang16();
        const headHp = r.u16();
        const headMaxHp = r.u16();
        const lHp = r.u16();
        const lMaxHp = r.u16();
        const lBlink = r.u8();
        const lBlinkTimer = r.ms16();
        const lCircles = [];
        for (let i = 0; i < 3; i++) lCircles.push([r.c10(), r.c10(), r.u10()]);
        const rHp = r.u16();
        const rMaxHp = r.u16();
        const rBlink = r.u8();
        const rBlinkTimer = r.ms16();
        const rCircles = [];
        for (let i = 0; i < 3; i++) rCircles.push([r.c10(), r.c10(), r.u10()]);
        bo = [
          phase, phaseTimer, introProgress, bodyOffsetY, headThrustOffsetY, headAngle,
          headHp, headMaxHp,
          lHp, lMaxHp, lBlink, lBlinkTimer, lCircles,
          rHp, rMaxHp, rBlink, rBlinkTimer, rCircles
        ];
      }
    }

    let sk = null;
    if (flags & 16) {
      const skCount = r.u8();
      sk = [];
      for (let i = 0; i < skCount; i++) {
        sk.push([
          r.tagStr(NetProto.SKILL_KEYS) || 'swing',
          !!r.u8(),
          r.ms32(),
          r.ms32(),
          r.u8(),
          r.u8()
        ]);
      }
    }

    return {
      type: 'snap',
      t,
      serverTimeMs,
      st,
      si,
      sn,
      sc,
      lv,
      wm,
      w: (flags & 1) ? 1 : 0,
      ps,
      pp,
      tr,
      bo,
      sk
    };
  }

  static encodeBallEvt(evt) {
    const w = new _BinWriter(32);
    w.u8(NetProto.PT_BALL_EVT);
    w.u8(evt.op); // 0:spawn, 1:bounce, 2:remove, 3:effect
    w.u32(evt.serverTimeMs || 0);
    w.u32(evt.id || 0);
    if (evt.op === 0 || evt.op === 1) {
      w.c10(evt.x);
      w.c10(evt.y);
      w.c10(evt.vx);
      w.c10(evt.vy);
      w.u10(evt.radius || 7.2);
      w.ms32(evt.effectClock || 0);
      w.ms16(evt.cyan || 0);
      w.ms16(evt.yellow || 0);
      w.ms16(evt.green || 0);
      w.u8(evt.source || 0);
      w.i16(evt.sourceSlot !== undefined && evt.sourceSlot !== null ? evt.sourceSlot : -1);
    } else if (evt.op === 3) {
      w.ms32(evt.effectClock || 0);
      w.ms16(evt.cyan || 0);
      w.ms16(evt.yellow || 0);
      w.ms16(evt.green || 0);
    }
    return w.finish();
  }

  static decodeBallEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const id = r.u32();
    const evt = { type: 'ball_evt', op, serverTimeMs, id };
    if (op === 0 || op === 1) {
      evt.x = r.c10();
      evt.y = r.c10();
      evt.vx = r.c10();
      evt.vy = r.c10();
      evt.radius = r.u10();
      evt.effectClock = r.ms32();
      evt.cyan = r.ms16();
      evt.yellow = r.ms16();
      evt.green = r.ms16();
      evt.source = r.u8();
      const sSlot = r.i16();
      evt.sourceSlot = sSlot >= 0 ? sSlot : null;
    } else if (op === 3) {
      evt.effectClock = r.ms32();
      evt.cyan = r.ms16();
      evt.yellow = r.ms16();
      evt.green = r.ms16();
    }
    return evt;
  }

  static encodeBulletEvt(evt) {
    const w = new _BinWriter(128);
    w.u8(NetProto.PT_BULLET_EVT);
    w.u8(evt.op); // 0:spawn_batch, 1:remove_batch, 2:clear_all
    w.u32(evt.serverTimeMs || 0);
    if (evt.op === 0) {
      const list = evt.bullets || [];
      w.u8(Math.min(255, list.length));
      for (let i = 0; i < Math.min(255, list.length); i++) {
        const b = list[i];
        const angle = b.angle !== undefined ? b.angle : Math.atan2(b.vy || 0, b.vx || 0);
        const speed = b.speed !== undefined ? b.speed : Math.hypot(b.vx || 0, b.vy || 0);
        w.u32(b.id || 0);
        w.c10(b.x);
        w.c10(b.y);
        w.ang16(angle);
        w.u10(speed);
        w.u8(b.damage || 1);
        const hasCustomExplode = Boolean(b.explodeCount && b.explodeCount !== 8);
        const flags = (b.shape === 'spade' ? 1 : 0)
          | ((b.explodeCount === 8) ? 2 : 0)
          | (b.homingMode === 'decel' ? 4 : 0)
          | (hasCustomExplode ? 8 : 0);
        w.u8(flags);
        if (flags & 1) {
          w.u10(b.explodeY || 0);
        }
        if (flags & 4) {
          w.ms16(b.decelDuration || 0.4);
          w.ms16(b.waitTarget || 1.0);
        }
        if (flags & 8) {
          w.u8(Math.min(255, Math.max(1, b.explodeCount)));
        }
      }
    } else if (evt.op === 1) {
      const ids = evt.ids || [];
      w.u8(Math.min(255, ids.length));
      for (let i = 0; i < Math.min(255, ids.length); i++) {
        w.u32(ids[i]);
      }
    } else if (evt.op === 3) {
      w.u32(evt.id || 0);
      w.c10(evt.x);
      w.c10(evt.y);
      w.ang16(evt.angle || 0);
      w.u10(evt.accel || 520);
      w.u10(evt.maxSpeed || 540);
    }
    return w.finish();
  }

  static decodeBulletEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const evt = { type: 'bullet_evt', op, serverTimeMs };
    if (op === 0) {
      const count = r.u8();
      const bullets = new Array(count);
      for (let i = 0; i < count; i++) {
        const id = r.u32();
        const x = r.c10();
        const y = r.c10();
        const angle = r.ang16();
        const speed = r.u10();
        const damage = r.u8();
        const flags = r.pos < r.dv.byteLength ? r.u8() : 0;
        const shape = (flags & 1) ? 'spade' : undefined;
        const explodeY = (flags & 1) && r.pos + 2 <= r.dv.byteLength ? r.u10() : undefined;
        let explodeCount = (flags & 2) ? 8 : undefined;
        const isDecel = Boolean(flags & 4);
        const decelDuration = isDecel && r.pos + 2 <= r.dv.byteLength ? r.ms16() : undefined;
        const waitTarget = isDecel && r.pos + 2 <= r.dv.byteLength ? r.ms16() : undefined;
        if ((flags & 8) && r.pos < r.dv.byteLength) {
          explodeCount = r.u8();
        }
        const vx = Math.cos(angle) * speed;
        const vy = Math.sin(angle) * speed;
        bullets[i] = {
          id,
          x,
          y,
          angle,
          speed,
          vx,
          vy,
          damage,
          shape,
          explodeY,
          explodeCount,
          homingMode: isDecel ? 'decel' : undefined,
          initVx: isDecel ? vx : undefined,
          initVy: isDecel ? vy : undefined,
          decelDuration,
          waitTarget,
          homingTimer: isDecel ? 0 : undefined,
          waitAfterStop: isDecel ? 0 : undefined
        };
      }
      evt.bullets = bullets;
    } else if (op === 1) {
      const count = r.u8();
      const ids = new Array(count);
      for (let i = 0; i < count; i++) ids[i] = r.u32();
      evt.ids = ids;
    } else if (op === 3) {
      evt.id = r.u32();
      evt.x = r.c10();
      evt.y = r.c10();
      evt.angle = r.ang16();
      evt.accel = r.u10();
      evt.maxSpeed = r.u10();
    }
    return evt;
  }

  static encodeEnemyEvt(evt) {
    const w = new _BinWriter(40);
    w.u8(NetProto.PT_ENEMY_EVT);
    w.u8(evt.op); // 0:spawn, 1:first_shot, 2:damage, 3:remove, 4:clear_all
    w.u32(evt.serverTimeMs || 0);
    if (evt.op === 0) {
      w.u32(evt.id || 0);
      w.tagStr(NetProto.ENEMY_NAMES, evt.name);
      w.c10(evt.x);
      w.c10(evt.y);
      w.c10(evt.vx);
      w.c10(evt.vy);
      w.ang16(evt.rotation || 0);
      w.u16(evt.health || 1);
      w.u16(evt.maxHealth || 1);
      w.u10(evt.currentRadius || 10);
      w.tagStr(NetProto.BULLET_TYPES, evt.bullet_type);
      w.ms16(evt.fire_rate || 0);
      w.u8(evt.localAutoFire ? 1 : 0);
      w.ms16(evt.fireTimer !== undefined ? evt.fireTimer : (evt.shootTimer || 0));
    } else if (evt.op === 1) {
      w.u32(evt.enemyId || 0);
      w.u16(evt.shotSeq || 0);
      w.c10(evt.x);
      w.c10(evt.y);
      w.ang16(evt.rotation || 0);
      w.c10(evt.vx);
      w.c10(evt.vy);
    } else if (evt.op === 2) {
      w.u32(evt.enemyId || 0);
      w.u16(evt.health || 0);
      w.c10(evt.x);
      w.c10(evt.y);
    } else if (evt.op === 3) {
      w.u32(evt.enemyId || 0);
      w.u8(evt.reason || 0);
    } else if (evt.op === 5) {
      w.u32(evt.enemyId || 0);
      w.u8(evt.subOp || 0);
      w.c10(evt.x);
      w.c10(evt.y);
      w.c10(evt.vx || 0);
      w.c10(evt.vy || 0);
      w.ang16(evt.angle || 0);
      w.ms16(evt.timer || 0);
      w.u8(evt.phaseCode || 0);
      w.i16(evt.targetSlot !== undefined && evt.targetSlot !== null ? evt.targetSlot : -1);
    }
    return w.finish();
  }

  static decodeEnemyEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const evt = { type: 'enemy_evt', op, serverTimeMs };
    if (op === 0) {
      evt.id = r.u32();
      evt.name = r.tagStr(NetProto.ENEMY_NAMES);
      evt.x = r.c10();
      evt.y = r.c10();
      evt.vx = r.c10();
      evt.vy = r.c10();
      evt.rotation = r.ang16();
      evt.health = r.u16();
      evt.maxHealth = r.u16();
      evt.currentRadius = r.u10();
      evt.bullet_type = r.tagStr(NetProto.BULLET_TYPES);
      evt.fire_rate = r.ms16();
      evt.localAutoFire = r.u8() !== 0;
      evt.fireTimer = r.ms16();
    } else if (op === 1) {
      evt.enemyId = r.u32();
      evt.shotSeq = r.u16();
      evt.x = r.c10();
      evt.y = r.c10();
      evt.rotation = r.ang16();
      evt.vx = r.c10();
      evt.vy = r.c10();
    } else if (op === 2) {
      evt.enemyId = r.u32();
      evt.health = r.u16();
      evt.x = r.c10();
      evt.y = r.c10();
    } else if (op === 3) {
      evt.enemyId = r.u32();
      evt.reason = r.u8();
    } else if (op === 5) {
      evt.enemyId = r.u32();
      evt.subOp = r.u8();
      evt.x = r.c10();
      evt.y = r.c10();
      evt.vx = r.c10();
      evt.vy = r.c10();
      evt.angle = r.ang16();
      evt.timer = r.ms16();
      evt.phaseCode = r.u8();
      const s = r.i16();
      evt.targetSlot = s >= 0 ? s : null;
    }
    return evt;
  }

  static encodeItemEvt(evt) {
    const w = new _BinWriter(24);
    w.u8(NetProto.PT_ITEM_EVT);
    w.u8(evt.op); // 0:spawn, 1:remove, 2:clear_all
    w.u32(evt.serverTimeMs || 0);
    if (evt.op === 0) {
      w.u32(evt.id || 0);
      w.tagStr(NetProto.ITEM_TYPES, evt.itemType);
      w.c10(evt.x);
      w.c10(evt.y);
      w.ang16(evt.angle || 0);
      w.tagStr(NetProto.COLORS, evt.color);
    } else if (evt.op === 1) {
      w.u32(evt.id || 0);
    }
    return w.finish();
  }

  static decodeItemEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const evt = { type: 'item_evt', op, serverTimeMs };
    if (op === 0) {
      evt.id = r.u32();
      evt.itemType = r.tagStr(NetProto.ITEM_TYPES);
      evt.x = r.c10();
      evt.y = r.c10();
      evt.angle = r.ang16();
      evt.color = r.tagStr(NetProto.COLORS);
    } else if (op === 1) {
      evt.id = r.u32();
    }
    return evt;
  }

  static encodeDropEvt(evt) {
    const w = new _BinWriter(20);
    w.u8(NetProto.PT_DROP_EVT);
    w.u8(evt.op); // 0:spawn, 1:remove, 2:clear_all
    w.u32(evt.serverTimeMs || 0);
    if (evt.op === 0) {
      w.u32(evt.id || 0);
      w.c10(evt.x);
      w.c10(evt.y);
      w.u10(evt.w || 32);
    } else if (evt.op === 1) {
      w.u32(evt.id || 0);
    }
    return w.finish();
  }

  static decodeDropEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const evt = { type: 'drop_evt', op, serverTimeMs };
    if (op === 0) {
      evt.id = r.u32();
      evt.x = r.c10();
      evt.y = r.c10();
      evt.w = r.u10();
    } else if (op === 1) {
      evt.id = r.u32();
    }
    return evt;
  }

  static encodeBlockEvt(evt) {
    const w = new _BinWriter(64);
    w.u8(NetProto.PT_BLOCK_EVT);
    w.u8(evt.op); // 0:destroy, 1:pop_start, 2:sync_mask
    w.u32(evt.serverTimeMs || 0);
    if (evt.op === 0) {
      w.u16(evt.blockId || 0);
    } else if (evt.op === 1) {
      w.u16((evt.startScale || 0) * 1000);
      const ids = evt.ids || [];
      w.u16(ids.length);
      for (const id of ids) w.u16(id);
    } else if (evt.op === 2) {
      const aliveBits = evt.aliveBits || [];
      const total = aliveBits.length;
      const byteLen = Math.ceil(total / 8);
      w.u16(total);
      const packed = new Uint8Array(byteLen);
      for (let i = 0; i < total; i++) {
        if (aliveBits[i]) packed[i >> 3] |= (1 << (i & 7));
      }
      w.bytes(packed);
    }
    return w.finish();
  }

  static decodeBlockEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const op = r.u8();
    const serverTimeMs = r.u32();
    const evt = { type: 'block_evt', op, serverTimeMs };
    if (op === 0) {
      evt.blockId = r.u16();
    } else if (op === 1) {
      evt.startScale = r.u16() / 1000;
      const count = r.u16();
      const ids = new Array(count);
      for (let i = 0; i < count; i++) ids[i] = r.u16();
      evt.ids = ids;
    } else if (op === 2) {
      const total = r.u16();
      const byteLen = Math.ceil(total / 8);
      const packed = r.readBytes(byteLen);
      const aliveBits = new Array(total);
      for (let i = 0; i < total; i++) {
        aliveBits[i] = (i >> 3) < packed.length ? ((packed[i >> 3] & (1 << (i & 7))) !== 0) : false;
      }
      evt.aliveBits = aliveBits;
    }
    return evt;
  }

  static encodeFxEvt(fxType, payload = {}) {
    const w = new _BinWriter(48);
    w.u8(NetProto.PT_FX_EVT);
    w.tagStr(NetProto.FX_TYPES, fxType);
    if (fxType === 'fx_pulse') {
      w.tagStr(NetProto.TARGET_KINDS, payload.targetKind);
      const hasTId = payload.targetId !== undefined && payload.targetId !== null;
      w.u8(hasTId ? 1 : 0);
      if (hasTId) w.u32(payload.targetId);
      w.tagStr(NetProto.PULSE_KINDS, payload.kind);
      w.tagStr(NetProto.SUB_TYPES, payload.subType);
      w.c10(payload.x);
      w.c10(payload.y);
      w.u10(payload.w);
      w.u10(payload.h);
      w.u10(payload.radius);
      w.ang16(payload.angle);
      w.tagStr(NetProto.COLORS, payload.color);
      w.ms16(payload.duration);
      w.u16((payload.maxScale || 1) * 100);
    } else if (fxType === 'fx_particles') {
      w.c10(payload.x);
      w.c10(payload.y);
      w.tagStr(NetProto.COLORS, payload.color);
      w.u16(payload.count || 0);
      w.u10(payload.speedMin);
      w.u10(payload.speedMax);
    } else if (fxType === 'fx_regen') {
      w.c10(payload.x);
      w.c10(payload.y);
      w.u10(payload.w);
      w.u10(payload.h);
    } else if (fxType === 'fx_shatter') {
      w.c10(payload.x);
      w.c10(payload.y);
      w.u10(payload.w);
      w.u10(payload.h);
      w.c10(payload.originPaddleX);
      w.i16(payload.slot !== undefined && payload.slot !== null ? payload.slot : -1);
    } else if (fxType === 'paddle_hit') {
      w.u8(payload.slot || 0);
    }
    return w.finish();
  }

  static decodeFxEvt(data) {
    const r = new _BinReader(NetProto.toView(data));
    r.u8();
    const type = r.tagStr(NetProto.FX_TYPES);
    if (type === 'fx_pulse') {
      const targetKind = r.tagStr(NetProto.TARGET_KINDS);
      const hasTId = r.u8() !== 0;
      const targetId = hasTId ? r.u32() : null;
      return {
        type,
        targetKind,
        targetId,
        kind: r.tagStr(NetProto.PULSE_KINDS),
        subType: r.tagStr(NetProto.SUB_TYPES),
        x: r.c10(),
        y: r.c10(),
        w: r.u10(),
        h: r.u10(),
        radius: r.u10(),
        angle: r.ang16(),
        color: r.tagStr(NetProto.COLORS),
        duration: r.ms16(),
        maxScale: r.u16() / 100
      };
    }
    if (type === 'fx_particles') {
      return {
        type,
        x: r.c10(),
        y: r.c10(),
        color: r.tagStr(NetProto.COLORS),
        count: r.u16(),
        speedMin: r.u10(),
        speedMax: r.u10()
      };
    }
    if (type === 'fx_regen') {
      return {
        type,
        x: r.c10(),
        y: r.c10(),
        w: r.u10(),
        h: r.u10()
      };
    }
    if (type === 'fx_shatter') {
      const x = r.c10();
      const y = r.c10();
      const w = r.u10();
      const h = r.u10();
      const originPaddleX = r.c10();
      const s = r.i16();
      return {
        type,
        x,
        y,
        w,
        h,
        originPaddleX,
        slot: s >= 0 ? s : null
      };
    }
    if (type === 'paddle_hit') {
      return { type, slot: r.u8() };
    }
    return { type };
  }

  static decode(data) {
    const pt = NetProto.peekType(data);
    switch (pt) {
      case NetProto.PT_INPUT: return NetProto.decodeInput(data);
      case NetProto.PT_PING: return NetProto.decodePing(data);
      case NetProto.PT_PONG: return NetProto.decodePong(data);
      case NetProto.PT_CLOCK_SYNC: return NetProto.decodeClockSync(data);
      case NetProto.PT_METRICS: return NetProto.decodeMetrics(data);
      case NetProto.PT_SNAP: return NetProto.decodeSnap(data);
      case NetProto.PT_BALL_EVT: return NetProto.decodeBallEvt(data);
      case NetProto.PT_BULLET_EVT: return NetProto.decodeBulletEvt(data);
      case NetProto.PT_ENEMY_EVT: return NetProto.decodeEnemyEvt(data);
      case NetProto.PT_ITEM_EVT: return NetProto.decodeItemEvt(data);
      case NetProto.PT_DROP_EVT: return NetProto.decodeDropEvt(data);
      case NetProto.PT_BLOCK_EVT: return NetProto.decodeBlockEvt(data);
      case NetProto.PT_FX_EVT: return NetProto.decodeFxEvt(data);
      default: return null;
    }
  }
}

NetProto._enc = new TextEncoder();
NetProto._dec = new TextDecoder();

NetProto.PT_INPUT = 0x01;
NetProto.PT_PING = 0x02;
NetProto.PT_PONG = 0x03;
NetProto.PT_CLOCK_SYNC = 0x04;
NetProto.PT_METRICS = 0x05;
NetProto.PT_SNAP = 0x10;
NetProto.PT_BALL_EVT = 0x20;
NetProto.PT_BULLET_EVT = 0x21;
NetProto.PT_ENEMY_EVT = 0x22;
NetProto.PT_ITEM_EVT = 0x23;
NetProto.PT_DROP_EVT = 0x24;
NetProto.PT_BLOCK_EVT = 0x25;
NetProto.PT_FX_EVT = 0x26;

NetProto.GAME_STATES = ['menu', 'playing', 'gameover', 'paused', 'victory'];
NetProto.TRANS_PHASES = ['killing_enemies', 'skill_unlock', 'waiting_before_blocks', 'spawning_blocks', 'boss_siren', 'boss_intro', 'boss_defeat'];
NetProto.BOSS_PHASES = [
  'cooldown', 'aim', 'charging', 'punch_strike', 'punch_retract',
  'tongue_strike', 'tongue_retract', 'retract', 'hidden_wait',
  'dive_peek', 'dive_strike', 'slither_telegraph', 'slither', 'reenter',
  'summon', 'spread_pull', 'spread_thrust', 'spread_recover',
  'rain_attack', 'lightning_telegraph', 'lightning_strike', 'fog_cast',
  'intro', 'defeated'
];
NetProto.SKILL_KEYS = typeof SKILLS !== 'undefined' ? Object.keys(SKILLS) : ['swing', 'crack'];
NetProto.ENEMY_NAMES = [
  'triangle', 'square', 'diamond', 'pentagon', 'hexagon', 'club', 'spade', 'quadiamond', 'pickaxe',
  'arrow', 'sparkle', 'wide_arrow', 'scissors'
];
NetProto.BULLET_TYPES = [
  'none', 'single', 'spread', 'aimed', 'self_destruction', '3round', 'explode', 'connect',
  'laser', 'aimed_laser', 'aimed_3round'
];
NetProto.ITEM_TYPES = ['cyan_star', 'yellow_star', 'green_star', 'blue_circle', 'pink_heart', 'purple_square'];
NetProto.FX_TYPES = ['fx_pulse', 'fx_particles', 'fx_regen', 'fx_shatter', 'paddle_hit'];
NetProto.TARGET_KINDS = ['none', 'paddle', 'ball', 'enemy', 'item', 'purple', 'boss_head', 'boss_circle'];
NetProto.PULSE_KINDS = ['circle', 'paddle', 'block', 'enemy', 'item', 'purple_paddle', 'boss_head', 'boss_circle', 'rect', 'polygon', 'crack'];
NetProto.SUB_TYPES = [
  'cyan', 'yellow', 'green', 'white', 'red', 'damage', 'heal', 'pickup',
  'triangle', 'square', 'diamond', 'pentagon', 'hexagon', 'club', 'spade', 'quadiamond', 'pickaxe',
  'arrow', 'sparkle', 'wide_arrow', 'scissors',
  'cyan_star', 'yellow_star', 'green_star', 'blue_circle', 'pink_heart', 'purple_square'
];
NetProto.COLORS = [
  '#00ffff', '#ffff00', '#00ff00', '#ffffff', '#ff3b3b', '#ff5555', '#aa44ff',
  '#ffd82b', '#d8d8d8', '#a8a8a8',
  'rgba(255, 255, 255, 0.9)', 'rgba(0, 255, 255, 0.85)', 'rgba(255, 255, 0, 0.85)', 'rgba(0, 255, 0, 0.85)'
];

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
    this.roomOwnerPeerId = null;

    // 共通ルームクロック & 自身のネットワーク品質統計
    this.roomEpochPerfMs = MultiplayerManager.nowPerf();
    this.clockOffsetMs = 0;
    this.guestMinRttMs = Infinity;
    this.selfNetStats = this.createEmptySelfNetStats();
    this._testNetOverride = null;

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
    this.joinDeadlineAt = 0;
    this.hostAliveTimer = null;
    this.lastMetricsSentAt = 0;

    // Host migration & RTT monitoring & Lobby auto-election
    this.migrationOrder = [];
    this.lastMigrationOrderStr = '';
    this.migrating = false;
    this.migrationTimers = [];
    this.migratingGraceUntil = 0;
    this.migratingExpectedSlots = new Map();
    this.migratingCleanupTimers = [];
    this.pingCounter = 1;
    this.rttMeasureTimer = null;
    this.rttTimerInGame = false;
    this.lastLobbyHandoffAt = 0;
    this.lobbyHandoffInProgress = false;
    this.lobbyHandoffTimer = null;
    this.handoffSilent = false;

    // Signaling transports
    this.bc = null;
    this.mqttClients = [];
    this.seenSigIds = new Set();
    this.sigQueue = [];

    window.addEventListener('beforeunload', () => this.shutdown(true));
    window.addEventListener('pagehide', () => this.shutdown(true));
  }

  static nowPerf() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  createEmptySelfNetStats() {
    return {
      hasSample: false,
      sampleCount: 0,
      rttMs: 120,
      jitterMs: 0,
      lastRttMs: null,
      pingSent: 0,
      pingLost: 0,
      lossRate: 0
    };
  }

  resetSelfNetStats() {
    this.selfNetStats = this.createEmptySelfNetStats();
  }

  getSelfNetStats() {
    if (this._testNetOverride) return this._testNetOverride;
    return this.selfNetStats;
  }

  isRoomOwner() {
    if (this.mode === 'solo') return true;
    if (!this.roomOwnerPeerId) return this.mode === 'host';
    return this.roomOwnerPeerId === this.localPeerId;
  }

  getServerTimeMs() {
    if (this.mode === 'guest') {
      return Math.max(0, Math.round(MultiplayerManager.nowPerf() + this.clockOffsetMs)) >>> 0;
    }
    return Math.max(0, Math.round(MultiplayerManager.nowPerf() - this.roomEpochPerfMs)) >>> 0;
  }

  updateGuestClockSample(serverTimeMs, rttMs = null) {
    if (this.mode !== 'guest' || serverTimeMs === undefined || serverTimeMs === null) return;
    const hasKnownRtt = Number.isFinite(this.guestMinRttMs) && this.guestMinRttMs !== Infinity;
    // RTT計測済みのときは片道遅延が0扱いのスナップショットで時計オフセットを過去方向へ引き戻さない
    if ((rttMs === null || rttMs === undefined) && hasKnownRtt) {
      return;
    }
    const now = MultiplayerManager.nowPerf();
    const oneWay = rttMs !== null && rttMs !== undefined ? Math.max(0, Math.min(400, rttMs * 0.5)) : 0;
    const targetOffset = (serverTimeMs + oneWay) - now;
    if (!hasKnownRtt) {
      this.clockOffsetMs = targetOffset;
      if (rttMs !== null && rttMs !== undefined) this.guestMinRttMs = rttMs;
      return;
    }
    const alpha = (rttMs <= this.guestMinRttMs * 1.15 + 4) ? 0.35 : 0.06;
    if (rttMs <= this.guestMinRttMs * 1.15 + 4) {
      this.guestMinRttMs = this.guestMinRttMs * 0.8 + rttMs * 0.2;
    }
    this.clockOffsetMs = this.clockOffsetMs * (1 - alpha) + targetOffset * alpha;
  }

  getDelaySec(packetServerTimeMs) {
    if (packetServerTimeMs === undefined || packetServerTimeMs === null) return 0;
    const nowSrv = this.getServerTimeMs();
    const diffMs = (nowSrv - (packetServerTimeMs >>> 0)) | 0;
    if (diffMs <= 0) return 0;
    return Math.min(0.4, diffMs / 1000);
  }

  static computeStabilityScore(stats) {
    if (!stats) return 9999;
    const rtt = stats.rttMs !== undefined && stats.rttMs !== null ? stats.rttMs : 150;
    const jit = stats.jitterMs || 0;
    const loss = stats.lossRate || 0;
    return rtt + jit * 0.75 + loss * 1200;
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

  static getPaddleWidthScaleForCount(count) {
    const table = GAME_CONFIG.MULTIPLAYER.WIDTH_SCALE_BY_PLAYER_COUNT;
    const clamped = Math.max(1, Math.min(GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS, count || 1));
    return (table && table[clamped]) || 1.0;
  }

  static getMaxPaddleWidthForCount(count) {
    const baseWidth = GAME_CONFIG.PADDLE.MAX_HP * GAME_CONFIG.PADDLE.WIDTH_PER_HP;
    return baseWidth * MultiplayerManager.getPaddleWidthScaleForCount(count);
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
    this.roomOwnerPeerId = this.localPeerId;
    this.roomEpochPerfMs = MultiplayerManager.nowPerf();
    this.lastLobbyHandoffAt = 0;
    this.lobbyHandoffInProgress = false;
    this.handoffSilent = false;
    this.resetSelfNetStats();
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

    this.rttTimerInGame = !!this.isInGame;
    const intervalMs = this.isInGame ? 1200 : 350;
    this.rttMeasureTimer = setInterval(() => {
      if (this.mode === 'host') {
        this.measurePeerRtts();
      }
    }, intervalMs);
  }

  setInGame(inGame) {
    this.isInGame = !!inGame;
    if (this.mode === 'host') {
      if (this.rttTimerInGame !== this.isInGame) {
        this.startHostTimers();
      }
      if (this.isInGame) {
        for (const [peerId, peer] of Array.from(this.peers.entries())) {
          if (!peer.connected && (!peer.ctrlDc || peer.ctrlDc.readyState !== 'open')) {
            this.sendSignal('game_in_progress', peerId, {});
            this.peers.delete(peerId);
            this.closePeerResources(peer);
          }
        }
      }
    } else if (this.mode === 'guest') {
      if (this.isInGame && this.connectionStatus === 'connected' && !this.migrating && !this.lobbyHandoffInProgress) {
        setTimeout(() => {
          if (this.mode === 'guest' && this.isInGame && this.connectionStatus === 'connected' && !this.migrating) {
            this.closeSignaling();
          }
        }, 600);
      } else if (!this.isInGame && this.roomCode && this.mqttClients.length === 0 && !this.bc) {
        this.openSignaling(this.roomCode);
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
    this.roomOwnerPeerId = null;
    this.clockOffsetMs = 0;
    this.guestMinRttMs = Infinity;
    this.lastLobbyHandoffAt = 0;
    this.lobbyHandoffInProgress = false;
    this.handoffSilent = false;
    this.resetSelfNetStats();
    this.joinSessionToken = MultiplayerManager.randomId(8);
    this.joinDeadlineAt = Date.now() + MultiplayerManager.JOIN_NOT_FOUND_TIMEOUT_MS;
    this.players = [
      this.makeLocalPlayerEntry(0, false)
    ];

    this.openSignaling(cleanCode);
    this.sendJoinRequest();

    this.startJoinRetryLoop(800, false);

    // 招待リンク接続時はシグナリング確立やホスト応答の遅延を考慮して十分な待機時間(20秒)を確保する
    this.clearJoinNotFoundTimeout();
    this.scheduleNotFoundFallback(MultiplayerManager.JOIN_NOT_FOUND_TIMEOUT_MS);

    this.notifyRoomChange();
  }

  startJoinRetryLoop(intervalMs = 800, isMigration = false) {
    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    this.joinRetryTimer = setInterval(() => {
      if (this.mode !== 'guest' || this.connectionStatus === 'connected' || this.connectionStatus === 'full') {
        clearInterval(this.joinRetryTimer);
        this.joinRetryTimer = null;
        return;
      }
      if (!this.hostPeer || !this.hostPeer.hasOffer) {
        this.sendJoinRequest(isMigration);
      }
    }, intervalMs);
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
    this.lobbyHandoffInProgress = false;
    this.handoffSilent = false;
    if (this.lobbyHandoffTimer) {
      clearTimeout(this.lobbyHandoffTimer);
      this.lobbyHandoffTimer = null;
    }

    if (this.joinRetryTimer) {
      clearInterval(this.joinRetryTimer);
      this.joinRetryTimer = null;
    }
    this.clearJoinNotFoundTimeout();
    this.joinDeadlineAt = 0;
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
    if (peer.disconnectTimer) {
      clearTimeout(peer.disconnectTimer);
      peer.disconnectTimer = null;
    }
    for (const dc of [peer.ctrlDc, peer.syncDc]) {
      if (!dc) continue;
      dc.onopen = null;
      dc.onmessage = null;
      dc.onclose = null;
      dc.onerror = null;
      try { dc.close(); } catch (_) {}
    }
    if (peer.pc) {
      peer.pc.onconnectionstatechange = null;
      peer.pc.onicecandidate = null;
      peer.pc.ondatachannel = null;
      try { peer.pc.close(); } catch (_) {}
    }
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
      if (c.probeTimer) clearInterval(c.probeTimer);
      if (c.reconnectTimer) clearTimeout(c.reconnectTimer);
      if (Array.isArray(c.pendingBrokerPings)) {
        for (const p of c.pendingBrokerPings) {
          if (p.timer) clearTimeout(p.timer);
        }
        c.pendingBrokerPings = [];
      }
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

  recomputeSelfNetStatsFromBrokers() {
    let chosen = null;
    let chosenScore = Infinity;
    for (const c of this.mqttClients) {
      if (c.closedByApp || !c.brokerStats) continue;
      const st = c.brokerStats;
      if (!st.hasSample && st.pingLost < 2) continue;
      const sc = MultiplayerManager.computeStabilityScore(st);
      if (sc < chosenScore) {
        chosenScore = sc;
        chosen = st;
      }
    }
    if (!chosen) return;
    this.selfNetStats = {
      hasSample: chosen.hasSample || chosen.pingLost >= 2,
      sampleCount: chosen.sampleCount,
      rttMs: chosen.rttMs,
      jitterMs: chosen.jitterMs,
      lastRttMs: chosen.lastRttMs,
      pingSent: chosen.pingSent,
      pingLost: chosen.pingLost,
      lossRate: chosen.lossRate
    };

    if (this.mode === 'guest' && !this.isInGame && this.connectionStatus === 'connected') {
      const now = Date.now();
      if (now - this.lastMetricsSentAt >= 280) {
        this.lastMetricsSentAt = now;
        this.sendMetricsToHost();
      }
    } else if (this.mode === 'host' && !this.isInGame) {
      this.evaluateLobbyBestHost();
    }
  }

  recordSelfBrokerRtt(clientState, rttMs) {
    const s = clientState.brokerStats;
    const prev = s.lastRttMs;
    if (prev !== null) {
      const jitSample = Math.abs(rttMs - prev);
      s.jitterMs = s.sampleCount > 1 ? (s.jitterMs * 0.65 + jitSample * 0.35) : jitSample;
    }
    s.lastRttMs = rttMs;
    s.sampleCount += 1;
    s.rttMs = s.hasSample ? (s.rttMs * 0.6 + rttMs * 0.4) : rttMs;
    s.hasSample = true;
    s.lossRate = s.pingSent > 0 ? Math.min(1, s.pingLost / s.pingSent) : 0;
    this.recomputeSelfNetStatsFromBrokers();
  }

  recordSelfBrokerLoss(clientState) {
    const s = clientState.brokerStats;
    s.pingLost += 1;
    s.lossRate = s.pingSent > 0 ? Math.min(1, s.pingLost / s.pingSent) : 0;
    this.recomputeSelfNetStatsFromBrokers();
  }

  sendMetricsToHost() {
    if (this.mode !== 'guest' || !this.hostPeer) return;
    const dc = (this.hostPeer.syncDc && this.hostPeer.syncDc.readyState === 'open')
      ? this.hostPeer.syncDc
      : this.hostPeer.ctrlDc;
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(NetProto.encodeMetrics(this.getSelfNetStats()));
    } catch (_) {}
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
      probeTimer: null,
      reconnectTimer: null,
      pendingBrokerPings: [],
      brokerStats: this.createEmptySelfNetStats(),
      packetId: 1
    };

    const sendBrokerProbePing = () => {
      if (state.closedByApp || !state.ready || this.isInGame) return;
      const ws = state.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (state.pendingBrokerPings.length >= 6) return;
      const sentAt = MultiplayerManager.nowPerf();
      state.brokerStats.pingSent += 1;
      const entry = { sentAt, timer: null };
      entry.timer = setTimeout(() => {
        const idx = state.pendingBrokerPings.indexOf(entry);
        if (idx !== -1) {
          state.pendingBrokerPings.splice(idx, 1);
          if (!state.closedByApp && !this.isInGame) {
            this.recordSelfBrokerLoss(state);
          }
        }
      }, 1600);
      state.pendingBrokerPings.push(entry);
      try {
        ws.send(new Uint8Array([0xc0, 0x00])); // MQTT PINGREQ
      } catch (_) {}
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
            ws.send(new Uint8Array([0xc0, 0x00])); // PINGREQ keepalive
          }
        }, 25000);
      };

      ws.onmessage = async (ev) => {
        if (state.closedByApp) return;
        let chunk;
        if (ev.data && typeof ev.data !== 'string' && typeof ev.data.byteLength === 'number') {
          chunk = (typeof ArrayBuffer !== 'undefined' && ArrayBuffer.isView && ArrayBuffer.isView(ev.data))
            ? new Uint8Array(ev.data.buffer, ev.data.byteOffset, ev.data.byteLength)
            : new Uint8Array(ev.data);
        } else if (typeof Blob !== 'undefined' && ev.data instanceof Blob) {
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
            if (!this.isInGame) {
              setTimeout(sendBrokerProbePing, 120);
              if (!state.probeTimer) {
                state.probeTimer = setInterval(sendBrokerProbePing, 450);
              }
            }
            if (this.mode === 'host') {
              if (Date.now() <= this.migratingGraceUntil) {
                this.sendSignal('host_migrate_announce', null, {
                  inGame: this.isInGame,
                  ownerPeerId: this.roomOwnerPeerId
                });
              }
              if (!this.isInGame) {
                this.sendSignal('host_alive', null, {});
              }
            } else if (this.mode === 'guest' && this.connectionStatus === 'connecting') {
              this.sendJoinRequest(this.reconnectingFromMigration);
            }
          } else if (pkt.type === 13) {
            // PINGRESP -> ロビー回線RTTサンプル記録
            if (state.pendingBrokerPings.length > 0) {
              const p = state.pendingBrokerPings.shift();
              if (p.timer) clearTimeout(p.timer);
              const rtt = Math.max(0, MultiplayerManager.nowPerf() - p.sentAt);
              this.recordSelfBrokerRtt(state, rtt);
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
        if (state.probeTimer) {
          clearInterval(state.probeTimer);
          state.probeTimer = null;
        }
        while (state.pendingBrokerPings.length > 0) {
          const p = state.pendingBrokerPings.shift();
          if (p.timer) clearTimeout(p.timer);
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
    this.sigQueue = this.sigQueue.filter((item) => now - item.ts < MultiplayerManager.JOIN_NOT_FOUND_TIMEOUT_MS);
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
      const existing = this.peers.get(from);
      const existingPcState = existing && existing.pc ? existing.pc.connectionState : 'closed';
      const existingAlive = !!(
        existing &&
        existing.sessionToken === payload.sessionToken &&
        existingPcState !== 'failed' &&
        existingPcState !== 'closed'
      );
      if (existingAlive) {
        if (existing.ctrlDc && existing.ctrlDc.readyState === 'open') {
          this.sendToPeerCtrl(existing, {
            type: 'room_state',
            players: this.serializePlayers(),
            mo: this.migrationOrder
          });
        } else if (!existing.connected && existing.lastOfferSdp && Date.now() - (existing.lastOfferSentAt || 0) >= 800) {
          // ゲストがリトライを送ってきた＝初回Offer未着の可能性があるためOffer・ICEを再送
          existing.lastOfferSentAt = Date.now();
          this.sendSignal('webrtc_offer', from, {
            connEpoch: existing.connEpoch,
            sdp: existing.lastOfferSdp
          });
          if (Array.isArray(existing.localIceCandidates)) {
            for (const cand of existing.localIceCandidates) {
              this.sendSignal('ice_cand', from, {
                connEpoch: existing.connEpoch,
                candidate: cand
              });
            }
          }
        }
        return;
      }

      const canJoinAsMigratingPeer =
        payload.isMigration &&
        Date.now() <= this.migratingGraceUntil &&
        this.migratingExpectedSlots.has(from);

      if (this.isInGame && !canJoinAsMigratingPeer) {
        this.sendSignal('game_in_progress', from, {});
        return;
      }

      if (existing) {
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
    if (Date.now() <= this.migratingGraceUntil) {
      for (const info of this.migratingExpectedSlots.values()) {
        if (info.slot !== preferredSlot) {
          usedSlots.add(info.slot);
        }
      }
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
    const now = MultiplayerManager.nowPerf();
    let anyTimeout = false;
    for (const peer of this.peers.values()) {
      if (!peer.connected) continue;
      for (const [oldSeq, oldTs] of Array.from(peer.pendingPings.entries())) {
        if (now - oldTs > 750) {
          peer.pendingPings.delete(oldSeq);
          peer.pingLost += 1;
          peer.lossRate = peer.pingSent > 0 ? Math.min(1, peer.pingLost / peer.pingSent) : 0;
          anyTimeout = true;
        }
      }
      const dc = (peer.syncDc && peer.syncDc.readyState === 'open') ? peer.syncDc : peer.ctrlDc;
      if (!dc || dc.readyState !== 'open') continue;
      const seq = (this.pingCounter++) & 0xffff;
      peer.pendingPings.set(seq, now);
      peer.pingSent += 1;
      if (peer.pendingPings.size > 12) {
        const oldestKey = peer.pendingPings.keys().next().value;
        peer.pendingPings.delete(oldestKey);
      }
      try {
        dc.send(NetProto.encodePing(seq, this.getServerTimeMs(), peer.hasRttSample ? peer.rttMs : null));
      } catch (_) {}
    }
    if (anyTimeout && !this.isInGame) {
      this.evaluateLobbyBestHost();
    }
  }

  handlePeerPong(peer, msg) {
    if (!peer || !peer.pendingPings) return;
    const seq = typeof msg === 'object' && msg !== null ? msg.seq : msg;
    const sentAt = peer.pendingPings.get(seq);
    if (sentAt !== undefined) {
      peer.pendingPings.delete(seq);
      const now = MultiplayerManager.nowPerf();
      const rttSample = Math.max(0, now - sentAt);
      if (peer.lastRttSample !== null) {
        const jitSample = Math.abs(rttSample - peer.lastRttSample);
        peer.jitterMs = peer.hasRttSample ? (peer.jitterMs * 0.65 + jitSample * 0.35) : jitSample;
      }
      peer.lastRttSample = rttSample;
      peer.rttMs = peer.hasRttSample ? (peer.rttMs * 0.6 + rttSample * 0.4) : rttSample;
      peer.minRttMs = Math.min(peer.minRttMs, rttSample);
      peer.hasRttSample = true;
      peer.lossRate = peer.pingSent > 0 ? Math.min(1, peer.pingLost / peer.pingSent) : 0;
    }

    if (typeof msg === 'object' && msg !== null && msg.selfHasSample) {
      peer.selfNetStats = {
        hasSample: true,
        sampleCount: Math.max(1, (peer.selfNetStats ? peer.selfNetStats.sampleCount : 0) + 1),
        rttMs: msg.selfRttMs,
        jitterMs: msg.selfJitterMs || 0,
        lossRate: msg.selfLossRate || 0
      };
    }

    const dc = (peer.syncDc && peer.syncDc.readyState === 'open') ? peer.syncDc : peer.ctrlDc;
    if (dc && dc.readyState === 'open') {
      try {
        dc.send(NetProto.encodeClockSync(this.getServerTimeMs(), peer.rttMs));
      } catch (_) {}
    }

    const prevOrderStr = this.lastMigrationOrderStr;
    this.updateMigrationOrder();
    if (this.lastMigrationOrderStr !== prevOrderStr) {
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
    }

    if (!this.isInGame) {
      this.evaluateLobbyBestHost();
    }
  }

  handlePeerMetrics(peer, msg) {
    if (!peer || !msg || !msg.hasSample) return;
    peer.selfNetStats = {
      hasSample: true,
      sampleCount: Math.max(1, (peer.selfNetStats ? peer.selfNetStats.sampleCount : 0) + 1),
      rttMs: msg.rttMs,
      jitterMs: msg.jitterMs || 0,
      lossRate: msg.lossRate || 0
    };
    if (!this.isInGame) {
      this.evaluateLobbyBestHost();
    }
  }

  evaluateLobbyBestHost() {
    if (this.mode !== 'host' || this.isInGame || this.migrating || this.lobbyHandoffInProgress) return;
    if (Date.now() - this.lastLobbyHandoffAt < 10000) return;

    const allPeers = Array.from(this.peers.values());
    // 誰かがまさに接続確立途中(!connected)のときはホスト交代を発動せず、全員の接続完了を待つ
    if (allPeers.some((p) => !p.connected)) return;
    const connected = allPeers;
    if (connected.length === 0) return;

    const hostSelf = this.getSelfNetStats();
    const hostReady = hostSelf && hostSelf.hasSample && (hostSelf.sampleCount >= 3 || hostSelf.pingLost >= 2);
    if (!hostReady) return;

    const hostScore = MultiplayerManager.computeStabilityScore(hostSelf);
    let bestPeer = null;
    let bestScore = Infinity;

    for (const peer of connected) {
      if (!peer.selfNetStats || !peer.selfNetStats.hasSample) continue;
      if ((peer.selfNetStats.sampleCount || 0) < 3) continue;
      // 相手の独立ブローカー計測値 + 相手とのP2P損失の重みで安定性を比較する
      const score = MultiplayerManager.computeStabilityScore(peer.selfNetStats) + (peer.lossRate || 0) * 300;
      if (score < bestScore) {
        bestScore = score;
        bestPeer = peer;
      }
    }

    if (!bestPeer) return;
    // ヒステリシスを持たせ、同程度回線でのフラッピングを防止しつつ明確な低遅延・安定ホストへ切り替える
    if (bestScore + 45 < hostScore && bestScore < hostScore * 0.65) {
      this.initiateLobbyHostHandoff(bestPeer);
    }
  }

  initiateLobbyHostHandoff(newHostPeer) {
    if (this.mode !== 'host' || this.isInGame || this.lobbyHandoffInProgress || !newHostPeer) return;
    this.lobbyHandoffInProgress = true;
    this.lastLobbyHandoffAt = Date.now();

    const ownerPeerId = this.roomOwnerPeerId || this.localPeerId;
    const roster = this.serializePlayers().map((p) => ({
      ...p,
      isHost: p.peerId === newHostPeer.peerId
    }));
    const survOrder = this.computeMigrationOrder().filter((id) => id !== newHostPeer.peerId);
    const payload = {
      type: 'lobby_handoff',
      oldHostPeerId: this.localPeerId,
      newHostPeerId: newHostPeer.peerId,
      ownerPeerId,
      serverTimeMs: this.getServerTimeMs(),
      players: roster,
      mo: survOrder
    };

    this.broadcastCtrl(payload);
    this.sendSignal('lobby_handoff', null, payload);

    this.lobbyHandoffTimer = setTimeout(() => {
      this.lobbyHandoffTimer = null;
      if (this.mode === 'host' && !this.isInGame) {
        this.demoteToGuestForLobbyHandoff(newHostPeer.peerId, ownerPeerId, roster, survOrder);
      }
    }, 180);
  }

  computeMigrationOrder() {
    const connected = Array.from(this.peers.values()).filter((p) => p.connected);
    if (connected.length === 0) return [];
    const peerScore = (p) => {
      const p2pRtt = p.hasRttSample ? p.rttMs : 150;
      const p2pJit = p.jitterMs || 0;
      const p2pLoss = p.lossRate || 0;
      const base = p2pRtt + p2pJit * 0.75 + p2pLoss * 1200;
      if (p.selfNetStats && p.selfNetStats.hasSample) {
        return base * 0.55 + MultiplayerManager.computeStabilityScore(p.selfNetStats) * 0.45;
      }
      return base;
    };
    let bestScore = Infinity;
    for (const p of connected) {
      const s = peerScore(p);
      if (s < bestScore) bestScore = s;
    }
    const sorted = connected.slice().sort((a, b) => {
      const sa = peerScore(a);
      const sb = peerScore(b);
      const aTop = sa <= bestScore + 25;
      const bTop = sb <= bestScore + 25;
      if (aTop !== bTop) return aTop ? -1 : 1;
      if (aTop && bTop) return a.electionRand - b.electionRand;
      return sa - sb;
    });
    return sorted.map((p) => p.peerId);
  }

  updateMigrationOrder() {
    this.migrationOrder = this.computeMigrationOrder();
    this.lastMigrationOrderStr = this.migrationOrder.join(',');
  }

  handleHostBinaryInput(peer, msg) {
    if (!peer || !msg) return;
    const seq = msg.seq & 0xffff;
    const diff = ((seq - peer.lastInputSeq) << 16) >> 16;
    if (peer.lastInputSeq < 0 || diff > 0) {
      peer.lastInputSeq = seq;
      const hasX = typeof msg.x === 'number' && Number.isFinite(msg.x);
      this.remoteInputs.set(peer.slot, {
        seq,
        left: !!msg.left,
        right: !!msg.right,
        pointerX: typeof msg.pointerX === 'number' ? msg.pointerX : null,
        x: hasX ? msg.x : null,
        hasClientX: hasX,
        receivedAtMs: MultiplayerManager.nowPerf()
      });
    }
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
      minRttMs: Infinity,
      jitterMs: 0,
      lastRttSample: null,
      pingSent: 0,
      pingLost: 0,
      lossRate: 0,
      hasRttSample: false,
      selfNetStats: null,
      electionRand: Math.random(),
      pendingPings: new Map(),
      pc,
      ctrlDc: null,
      syncDc: null,
      connected: false,
      remoteDescSet: false,
      pendingIce: [],
      localIceCandidates: [],
      lastOfferSdp: null,
      lastOfferSentAt: 0,
      lastInputSeq: -1,
      pingTimer: null
    };

    this.peers.set(guestPeerId, peer);

    const ctrlDc = pc.createDataChannel('ctrl', { ordered: true });
    ctrlDc.binaryType = 'arraybuffer';
    const syncDc = pc.createDataChannel('sync', { ordered: false, maxRetransmits: 0 });
    syncDc.binaryType = 'arraybuffer';
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
        const exp = this.migratingExpectedSlots.get(guestPeerId);
        if (exp && !this.isInGame && exp.ready && !peer.ready && joinPayload.ready === undefined) {
          peer.ready = true;
        }
        this.migratingExpectedSlots.delete(guestPeerId);
      }
      peer.connected = true;
      this.rebuildHostPlayersList();
      this.sendToPeerCtrl(peer, {
        type: 'welcome',
        assignedSlot: peer.slot,
        inGame: this.isInGame,
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        serverTimeMs: this.getServerTimeMs(),
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
      setTimeout(() => this.measurePeerRtts(), 120);
      if (this.callbacks.onPeerJoined) {
        this.callbacks.onPeerJoined(peer);
      }
    };

    ctrlDc.onmessage = (ev) => {
      if (NetProto.isBinary(ev.data)) {
        const msg = NetProto.decode(ev.data);
        if (!msg) return;
        if (msg.type === 'pong') {
          this.handlePeerPong(peer, msg);
        } else if (msg.type === 'metrics') {
          this.handlePeerMetrics(peer, msg);
        } else if (msg.type === 'input') {
          this.handleHostBinaryInput(peer, msg);
        }
        return;
      }
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.type === 'pong') {
        this.handlePeerPong(peer, msg);
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
      if (NetProto.isBinary(ev.data)) {
        const msg = NetProto.decode(ev.data);
        if (!msg) return;
        if (msg.type === 'input') {
          this.handleHostBinaryInput(peer, msg);
        } else if (msg.type === 'pong') {
          this.handlePeerPong(peer, msg);
        } else if (msg.type === 'metrics') {
          this.handlePeerMetrics(peer, msg);
        }
        return;
      }
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (msg && msg.type === 'pong') {
        this.handlePeerPong(peer, msg);
        return;
      }
      if (msg && msg.type === 'input') {
        this.handleHostBinaryInput(peer, msg);
      }
    };

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        const cand = ev.candidate.toJSON ? ev.candidate.toJSON() : ev.candidate;
        peer.localIceCandidates.push(cand);
        this.sendSignal('ice_cand', guestPeerId, {
          connEpoch,
          candidate: cand
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
          }, MultiplayerManager.PEER_DISCONNECT_GRACE_MS);
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
        const sdpObj = pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription;
        peer.lastOfferSdp = sdpObj;
        peer.lastOfferSentAt = Date.now();
        this.sendSignal('webrtc_offer', guestPeerId, {
          connEpoch,
          sdp: sdpObj
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
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
    } else if (msg.type === 'set_name') {
      peer.nickname = String(msg.nickname || '').trim().slice(0, 12);
      this.rebuildHostPlayersList();
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
    } else if (msg.type === 'set_ready') {
      peer.ready = !!msg.ready;
      this.rebuildHostPlayersList();
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
    } else if (msg.type === 'owner_start_game') {
      if (this.roomOwnerPeerId && peer.peerId === this.roomOwnerPeerId && !this.isInGame) {
        if (this.callbacks.onOwnerStartRequest) {
          this.callbacks.onOwnerStartRequest(msg);
        }
      }
    } else if (msg.type === 'use_skill') {
      if (this.isInGame && this.callbacks.onUseSkillRequest) {
        this.callbacks.onUseSkillRequest(peer, msg.skillKey);
      }
    } else if (msg.type === 'bye') {
      this.removePeer(peer.peerId);
    }
  }

  removePeer(guestPeerId) {
    const peer = this.peers.get(guestPeerId);
    if (!peer) return;
    const wasConnected = !!peer.connected;
    this.peers.delete(guestPeerId);
    this.remoteInputs.delete(peer.slot);
    this.closePeerResources(peer);

    if (this.mode === 'host' && wasConnected) {
      this.rebuildHostPlayersList();
      this.broadcastCtrl({
        type: 'room_state',
        ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
        players: this.serializePlayers(),
        mo: this.migrationOrder
      });
      this.notifyRoomChange();
      if (this.callbacks.onPeerLeft) {
        this.callbacks.onPeerLeft(peer.slot);
      }
    }
  }

  rebuildHostPlayersList() {
    const connectedPeers = Array.from(this.peers.values()).filter((p) => p.connected);
    const seenIds = new Set([this.localPeerId]);
    const list = [this.makeLocalPlayerEntry(this.assignedSlot, true)];
    for (const peer of connectedPeers) {
      seenIds.add(peer.peerId);
      list.push({
        peerId: peer.peerId,
        slot: peer.slot,
        nickname: peer.nickname,
        ready: peer.ready,
        isHost: false,
        isLocal: false
      });
    }
    if (Date.now() <= this.migratingGraceUntil) {
      for (const info of this.migratingExpectedSlots.values()) {
        if (!seenIds.has(info.peerId)) {
          seenIds.add(info.peerId);
          list.push({
            peerId: info.peerId,
            slot: info.slot,
            nickname: info.nickname,
            ready: this.isInGame ? false : !!info.ready,
            isHost: false,
            isLocal: false
          });
        }
      }
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
        this.sendJoinRequest(this.reconnectingFromMigration);
      }
    } else if (type === 'lobby_handoff') {
      if (!this.isInGame && (from === this.hostPeerId || this.migrating || this.lobbyHandoffInProgress)) {
        this.handleLobbyHandoffMessage(payload);
      }
    } else if (type === 'host_migrate') {
      if (from === this.hostPeerId) {
        this.beginGuestHostMigration(payload.newHostPeerId, payload.migrationOrder);
      }
    } else if (type === 'host_migrate_announce') {
      const alreadyTrackingHost = this.hostPeerId === from && (
        this.reconnectingFromMigration ||
        this.lobbyHandoffInProgress ||
        this.connectionStatus === 'connected' ||
        (this.hostPeer && this.hostPeer.hasOffer)
      );
      if (
        from !== this.localPeerId &&
        !alreadyTrackingHost &&
        (this.migrating || (this.connectionStatus === 'connecting' && (this.reconnectingFromMigration || this.lobbyHandoffInProgress)))
      ) {
        this.onDiscoveredNewHost(from);
      }
    } else if (type === 'room_full') {
      this.handleRoomFullReject();
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
        peerAddIce(this.hostPeer, payload.candidate);
      } else {
        this.hostPeer.pendingIce.push(payload.candidate);
      }
    } else if (type === 'bye' && from === this.hostPeerId) {
      this.handleHostDisconnect();
    }

    function peerAddIce(hp, cand) {
      hp.pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
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
      // ロビー中はブローカーRTT計測と無停止自動ホスト切替のためシグナリングを維持し、
      // ゲーム開始後にのみシグナリングを閉じる
      if (!this.isInGame) return;
      if (
        hostPeer.ctrlDc && hostPeer.ctrlDc.readyState === 'open' &&
        hostPeer.syncDc && hostPeer.syncDc.readyState === 'open'
      ) {
        setTimeout(() => {
          if (this.mode === 'guest' && this.isInGame && this.connectionStatus === 'connected' && !this.migrating) {
            this.closeSignaling();
          }
        }, 1200);
      }
    };

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.binaryType = 'arraybuffer';
      if (dc.label === 'ctrl') {
        hostPeer.ctrlDc = dc;
        dc.onopen = () => {
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
          if (!this.isInGame && this.selfNetStats.hasSample) {
            this.sendMetricsToHost();
          }
          this.notifyRoomChange();
          maybeCloseSignalingAfterOpen();
        };
        dc.onmessage = (msgEv) => {
          if (NetProto.isBinary(msgEv.data)) {
            const pt = NetProto.peekType(msgEv.data);
            if (pt === NetProto.PT_PING) {
              const p = NetProto.decodePing(msgEv.data);
              this.updateGuestClockSample(p.hostTimeMs, p.bestRttMs);
              try {
                dc.send(NetProto.encodePong(p.seq, p.hostTimeMs, this.getSelfNetStats()));
              } catch (_) {}
              return;
            }
            if (pt === NetProto.PT_CLOCK_SYNC) {
              const cs = NetProto.decodeClockSync(msgEv.data);
              this.updateGuestClockSample(cs.serverTimeMs, cs.rttMs);
              return;
            }
            const decoded = NetProto.decode(msgEv.data);
            if (!decoded) return;
            if (pt === NetProto.PT_FX_EVT) {
              if (this.callbacks.onCtrlEvent) this.callbacks.onCtrlEvent(decoded);
            } else if (pt === NetProto.PT_SNAP) {
              this.updateGuestClockSample(decoded.serverTimeMs, null);
              if (this.callbacks.onSnapshot) this.callbacks.onSnapshot(decoded);
            } else if (this.callbacks.onGameEvent) {
              this.callbacks.onGameEvent(decoded);
            }
            return;
          }
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
        dc.onopen = () => {
          if (!this.isInGame && this.selfNetStats.hasSample) {
            this.sendMetricsToHost();
          }
          maybeCloseSignalingAfterOpen();
        };
        dc.onmessage = (msgEv) => {
          if (NetProto.isBinary(msgEv.data)) {
            const pt = NetProto.peekType(msgEv.data);
            if (pt === NetProto.PT_PING) {
              const p = NetProto.decodePing(msgEv.data);
              this.updateGuestClockSample(p.hostTimeMs, p.bestRttMs);
              try {
                dc.send(NetProto.encodePong(p.seq, p.hostTimeMs, this.getSelfNetStats()));
              } catch (_) {}
              return;
            }
            if (pt === NetProto.PT_CLOCK_SYNC) {
              const cs = NetProto.decodeClockSync(msgEv.data);
              this.updateGuestClockSample(cs.serverTimeMs, cs.rttMs);
              return;
            }
            if (pt === NetProto.PT_SNAP) {
              const snap = NetProto.decodeSnap(msgEv.data);
              this.updateGuestClockSample(snap.serverTimeMs, null);
              if (this.callbacks.onSnapshot) {
                this.callbacks.onSnapshot(snap);
              }
            }
            return;
          }
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
          }, MultiplayerManager.PEER_DISCONNECT_GRACE_MS);
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
      this.connectionStatus = 'connected';
      this.statusDetail = '';
      this.reconnectingFromMigration = false;
      this.migrating = false;
      this.lobbyHandoffInProgress = false;
      this.handoffSilent = false;
      this.joinDeadlineAt = 0;
      this.assignedSlot = msg.assignedSlot;
      if (msg.inGame !== undefined) {
        this.isInGame = !!msg.inGame;
      }
      if (msg.ownerPeerId) {
        this.roomOwnerPeerId = msg.ownerPeerId;
      }
      if (msg.serverTimeMs !== undefined) {
        this.updateGuestClockSample(msg.serverTimeMs, null);
      }
      if (Array.isArray(msg.mo)) {
        this.migrationOrder = msg.mo;
      }
      this.applySerializedPlayers(msg.players || []);
      this.notifyRoomChange();
    } else if (msg.type === 'room_state') {
      if (msg.ownerPeerId) {
        this.roomOwnerPeerId = msg.ownerPeerId;
      }
      if (Array.isArray(msg.mo)) {
        this.migrationOrder = msg.mo;
      }
      this.applySerializedPlayers(msg.players || []);
      this.notifyRoomChange();
    } else if (msg.type === 'lobby_handoff') {
      if (!this.isInGame) {
        this.handleLobbyHandoffMessage(msg);
      }
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

  handleLobbyHandoffMessage(msg) {
    if (!msg || !msg.newHostPeerId || this.isInGame) return;
    if (this.mode === 'host') return;
    if (msg.ownerPeerId) {
      this.roomOwnerPeerId = msg.ownerPeerId;
    }
    if (msg.serverTimeMs !== undefined) {
      this.updateGuestClockSample(msg.serverTimeMs, null);
    }
    if (msg.newHostPeerId === this.localPeerId) {
      this.promoteFromLobbyHandoff(msg);
      return;
    }
    if (this.lobbyHandoffInProgress && this.hostPeerId === msg.newHostPeerId) {
      return;
    }
    this.handleGuestLobbyHandoff(msg);
  }

  demoteToGuestForLobbyHandoff(newHostPeerId, ownerPeerId, roster, survOrder) {
    if (this.mode !== 'host' || this.isInGame) return;
    const currentServerMs = this.getServerTimeMs();
    this.clockOffsetMs = currentServerMs - MultiplayerManager.nowPerf();
    this.guestMinRttMs = Infinity;

    this.clearMigrationTimers();
    this.clearJoinNotFoundTimeout();
    this.joinDeadlineAt = 0;

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
    this.migratingExpectedSlots.clear();
    this.migratingGraceUntil = 0;

    this.mode = 'guest';
    this.hostPeerId = newHostPeerId;
    this.roomOwnerPeerId = ownerPeerId;
    this.migrating = false;
    this.lobbyHandoffInProgress = true;
    this.handoffSilent = true;
    this.reconnectingFromMigration = true;
    this.connectionStatus = 'connecting';
    this.statusDetail = '';
    this.joinSessionToken = MultiplayerManager.randomId(8);
    if (Array.isArray(survOrder)) {
      this.migrationOrder = survOrder;
    }
    this.applySerializedPlayers(roster);

    if (this.mqttClients.length === 0 && !this.bc && this.roomCode) {
      this.openSignaling(this.roomCode);
    }

    if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
    setTimeout(() => {
      if (this.mode === 'guest' && this.lobbyHandoffInProgress && (!this.hostPeer || !this.hostPeer.hasOffer)) {
        this.sendJoinRequest(true);
      }
    }, 45);
    this.startJoinRetryLoop(350, true);

    this.notifyRoomChange();
  }

  handleGuestLobbyHandoff(msg) {
    if (this.mode !== 'guest' || this.isInGame) return;
    this.clearMigrationTimers();
    this.closeHostPeerOnly();
    this.joinDeadlineAt = 0;
    this.joinSessionToken = MultiplayerManager.randomId(8);
    this.hostPeerId = msg.newHostPeerId;
    this.lobbyHandoffInProgress = true;
    this.handoffSilent = true;
    this.reconnectingFromMigration = true;
    this.connectionStatus = 'connecting';
    this.statusDetail = '';
    if (Array.isArray(msg.mo)) {
      this.migrationOrder = msg.mo;
    }
    if (Array.isArray(msg.players)) {
      this.applySerializedPlayers(msg.players);
    }
    if (this.mqttClients.length === 0 && !this.bc && this.roomCode) {
      this.openSignaling(this.roomCode);
    }
    if (this.joinRetryTimer) clearInterval(this.joinRetryTimer);
    setTimeout(() => {
      if (this.mode === 'guest' && this.lobbyHandoffInProgress && (!this.hostPeer || !this.hostPeer.hasOffer)) {
        this.sendJoinRequest(true);
      }
    }, 45);
    this.startJoinRetryLoop(350, true);

    this.notifyRoomChange();
  }

  promoteFromLobbyHandoff(msg) {
    if (this.isInGame) return;
    const approxNowMs = Math.max(msg.serverTimeMs || 0, this.getServerTimeMs());
    this.roomEpochPerfMs = MultiplayerManager.nowPerf() - approxNowMs;

    this.clearMigrationTimers();
    this.closeHostPeerOnly();
    this.hostPeerId = null;
    this.reconnectingFromMigration = false;
    this.lobbyHandoffInProgress = false;
    this.handoffSilent = false;
    this.lastLobbyHandoffAt = Date.now();

    if (msg.ownerPeerId) {
      this.roomOwnerPeerId = msg.ownerPeerId;
    }

    this.mode = 'host';
    this.connectionStatus = 'hosting';
    this.statusDetail = '';
    this.peers.clear();
    this.remoteInputs.clear();
    this.migratingExpectedSlots.clear();
    this.migratingGraceUntil = Date.now() + 18000;

    const roster = Array.isArray(msg.players) ? msg.players : this.players;
    for (const sp of roster) {
      if (sp.peerId !== this.localPeerId) {
        this.migratingExpectedSlots.set(sp.peerId, {
          peerId: sp.peerId,
          slot: sp.slot,
          nickname: sp.nickname,
          ready: !!sp.ready
        });
      }
    }

    this.rebuildHostPlayersList();
    if (this.mqttClients.length === 0 && !this.bc && this.roomCode) {
      this.openSignaling(this.roomCode);
    }
    this.startHostTimers();

    const announce = () => {
      if (this.mode !== 'host') return;
      this.sendSignal('host_migrate_announce', null, {
        lobbyHandoff: true,
        inGame: false,
        ownerPeerId: this.roomOwnerPeerId
      });
    };
    announce();
    this.migratingCleanupTimers.push(setTimeout(announce, 220));
    this.migratingCleanupTimers.push(setTimeout(announce, 600));

    const cleanupTimer = setTimeout(() => {
      if (this.mode !== 'host') return;
      if (this.migratingExpectedSlots.size > 0) {
        for (const [peerId, info] of Array.from(this.migratingExpectedSlots.entries())) {
          this.migratingExpectedSlots.delete(peerId);
          if (this.callbacks.onPeerLeft) {
            this.callbacks.onPeerLeft(info.slot);
          }
        }
        this.rebuildHostPlayersList();
        this.broadcastCtrl({
          type: 'room_state',
          ownerPeerId: this.roomOwnerPeerId || this.localPeerId,
          players: this.serializePlayers(),
          mo: this.migrationOrder
        });
        this.notifyRoomChange();
      }
    }, 16000);
    this.migratingCleanupTimers.push(cleanupTimer);

    this.notifyRoomChange();
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
    if (this.mode !== 'guest' || this.isInGame || this.connectionStatus === 'connected') return;
    this.resetGuestToSolo('IN_GAME');
    if (this.callbacks.onGameInProgressReject) {
      this.callbacks.onGameInProgressReject();
    }
  }

  handleRoomFullReject() {
    if (this.mode !== 'guest') return;
    this.resetGuestToSolo('FULL');
    if (this.callbacks.onRoomFull) {
      this.callbacks.onRoomFull();
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
    if (this.mode !== 'guest' || this.migrating || this.lobbyHandoffInProgress) return;
    const oldHostEntry = this.players.find((p) => p.isHost || p.peerId === this.hostPeerId);
    const oldHostId = oldHostEntry ? oldHostEntry.peerId : this.hostPeerId;
    const surviving = this.players.filter((p) => !p.isHost && p.peerId !== oldHostId);
    const hasBeenWelcomed = !!oldHostEntry && surviving.some((p) => p.peerId === this.localPeerId);

    if (!hasBeenWelcomed || !this.roomCode) {
      // ロビー参加途中のWebRTC失敗・ホスト交代入れ違いは全体タイムアウト内なら即切断せず再試行する
      if (!this.isInGame && this.roomCode && this.joinDeadlineAt > Date.now()) {
        const remaining = this.joinDeadlineAt - Date.now();
        this.closeHostPeerOnly();
        this.hostPeerId = null;
        this.connectionStatus = 'connecting';
        this.statusDetail = '';
        this.joinSessionToken = MultiplayerManager.randomId(8);
        this.sendJoinRequest(false);
        this.startJoinRetryLoop(800, false);
        this.scheduleNotFoundFallback(remaining);
        this.notifyRoomChange();
        return;
      }
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
      if (this.isInGame) {
        this.promoteToHost(oldHostSlot, survivingPlayers);
        return;
      }
      // ロビー中は直後のlobby_handoffや他アナウンスとのレースを避けるためごく短時間待機してから昇格する
      const lobbyPromoTimer = setTimeout(() => {
        if (!this.migrating || this.mode !== 'guest') return;
        this.promoteToHost(oldHostSlot, survivingPlayers);
      }, 300);
      this.migrationTimers.push(lobbyPromoTimer);
    } else {
      const promoTimer = setTimeout(() => {
        if (!this.migrating || this.mode !== 'guest') return;
        this.promoteToHost(oldHostSlot, survivingPlayers);
      }, myRank * 2400 + (!this.isInGame ? 300 : 0));
      this.migrationTimers.push(promoTimer);
    }

    const failTimer = setTimeout(() => {
      if (this.migrating && this.mode === 'guest') {
        this.finalizeHostGoneDisconnect();
      }
    }, ordered.length * 2400 + 8000);
    this.migrationTimers.push(failTimer);

    this.notifyRoomChange();
  }

  onDiscoveredNewHost(newHostPeerId) {
    if (this.mode !== 'guest') return;
    if (
      this.hostPeerId === newHostPeerId &&
      (this.reconnectingFromMigration ||
        this.lobbyHandoffInProgress ||
        this.connectionStatus === 'connected' ||
        (this.hostPeer && this.hostPeer.hasOffer))
    ) {
      return;
    }
    this.clearMigrationTimers();
    this.closeHostPeerOnly();
    this.joinDeadlineAt = 0;
    this.hostPeerId = newHostPeerId;
    this.reconnectingFromMigration = true;
    this.lobbyHandoffInProgress = false;
    this.connectionStatus = 'connecting';
    this.statusDetail = '';
    this.joinSessionToken = MultiplayerManager.randomId(8);
    this.sendJoinRequest(true);

    this.startJoinRetryLoop(450, true);

    this.notifyRoomChange();
  }

  promoteToHost(oldHostSlot, survivingPlayers) {
    const approxServerMs = Math.max(0, this.getServerTimeMs());
    this.roomEpochPerfMs = MultiplayerManager.nowPerf() - approxServerMs;
    if (!this.roomOwnerPeerId || !survivingPlayers.some((p) => p.peerId === this.roomOwnerPeerId)) {
      this.roomOwnerPeerId = this.localPeerId;
    }

    this.clearMigrationTimers();
    this.closeHostPeerOnly();
    this.hostPeerId = null;
    this.reconnectingFromMigration = false;
    this.lobbyHandoffInProgress = false;
    this.handoffSilent = false;

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
      peer.ctrlDc.send(NetProto.isBinary(msg) ? msg : JSON.stringify(msg));
    } catch (_) {}
  }

  broadcastCtrl(msg) {
    if (this.mode !== 'host') return;
    const payload = NetProto.isBinary(msg) ? msg : JSON.stringify(msg);
    for (const peer of this.peers.values()) {
      if (peer.ctrlDc && peer.ctrlDc.readyState === 'open') {
        try { peer.ctrlDc.send(payload); } catch (_) {}
      }
    }
  }

  sendGameEvent(buf, targetPeer = null) {
    if (this.mode !== 'host' || !buf) return;
    if (targetPeer) {
      if (targetPeer.ctrlDc && targetPeer.ctrlDc.readyState === 'open') {
        try { targetPeer.ctrlDc.send(buf); } catch (_) {}
      }
      return;
    }
    for (const peer of this.peers.values()) {
      if (peer.ctrlDc && peer.ctrlDc.readyState === 'open') {
        try { peer.ctrlDc.send(buf); } catch (_) {}
      }
    }
  }

  broadcastSync(msg) {
    if (this.mode !== 'host') return;
    const payload = NetProto.isBinary(msg) ? msg : JSON.stringify(msg);
    for (const peer of this.peers.values()) {
      if (peer.syncDc && peer.syncDc.readyState === 'open') {
        try { peer.syncDc.send(payload); } catch (_) {}
      } else if (peer.ctrlDc && peer.ctrlDc.readyState === 'open') {
        try { peer.ctrlDc.send(payload); } catch (_) {}
      }
    }
  }

  sendToHostCtrl(msg) {
    if (this.mode !== 'guest' || !this.hostPeer || !this.hostPeer.ctrlDc) return;
    if (this.hostPeer.ctrlDc.readyState !== 'open') return;
    try {
      this.hostPeer.ctrlDc.send(NetProto.isBinary(msg) ? msg : JSON.stringify(msg));
    } catch (_) {}
  }

  sendToHostInput(seq, inputState, clientX = null) {
    if (this.mode !== 'guest' || !this.hostPeer) return;
    const resolvedX = typeof clientX === 'number'
      ? clientX
      : (inputState && typeof inputState.x === 'number' ? inputState.x : null);
    const pkt = NetProto.encodeInput(seq & 0xffff, !!inputState.left, !!inputState.right, inputState.pointerX, resolvedX);
    const dc = (this.hostPeer.syncDc && this.hostPeer.syncDc.readyState === 'open')
      ? this.hostPeer.syncDc
      : this.hostPeer.ctrlDc;
    if (!dc || dc.readyState !== 'open') return;
    try {
      dc.send(pkt);
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
        assignedSlot: this.assignedSlot,
        isOwner: this.isRoomOwner(),
        handoffSilent: !!this.handoffSilent
      });
    }
  }
}

MultiplayerManager.JOIN_NOT_FOUND_TIMEOUT_MS = 20000;
MultiplayerManager.PEER_DISCONNECT_GRACE_MS = 12000;

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
