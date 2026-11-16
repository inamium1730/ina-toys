/**
 * ボスエネミークラス (Bigfoot / ビッグフット)
 * - 顔: 上から覗く1つの大きな下向き三角形
 * - 腕: 左右それぞれ3つの円が重なった腕（上から覗くように配置）
 * - 両腕を先に破壊しないと顔にはダメージが入らない
 * - 行動ループ:
 *   1. 腕がある場合、片腕ずつ順番にパンチ (aim -> charging 1.0秒赤白点滅・位置固定 -> punch 4ダメージ・高速突進中のみ判定 -> クールダウン)
 *   2. 召喚フェーズ (身体全体を上下に揺らし画面も揺れ、しばらくするとステージのenemiesからランダムに2〜4体召喚 -> クールダウン)
 *   3. 10way半円拡散弾×3回 (顔を上に引いてから下に突き出し、先端から15個の弾を半円状に発射×3回 -> クールダウン)
 */
function getBossHpScaleForCount(playerCount = 1) {
  const { MULTIPLAYER } = GAME_CONFIG;
  const maxPlayers = (MULTIPLAYER && MULTIPLAYER.MAX_PLAYERS) || 4;
  const clamped = Math.max(1, Math.min(maxPlayers, Math.round(playerCount || 1)));
  const table = MULTIPLAYER && MULTIPLAYER.BOSS_HP_SCALE_BY_PLAYER_COUNT;
  return (table && table[clamped]) || 1.0;
}

class BigfootBoss {
  constructor(stageData, playerCount = 1) {
    const { WIDTH } = GAME_CONFIG;
    this.netKind = 'boss';
    this.id = 'bigfoot';
    this.name = 'bigfoot';
    this.stageEnemies = Array.isArray(stageData && stageData.enemies)
      ? stageData.enemies.slice()
      : ['triangle', 'pentagon', 'diamond', 'hexagon'];
    this.spawnLimit = (stageData && typeof stageData.spawn_limit === 'number') ? stageData.spawn_limit : 10;

    const hpScale = getBossHpScaleForCount(playerCount);
    this.armMaxHp = Math.round(15 * hpScale);
    this.headMaxHp = Math.round(10 * hpScale);

    this.pivotX = WIDTH / 2;
    this.basePivotY = -45;
    this.headLength = 225;
    this.headHalfBase = 126;
    this.headTopLocalY = -35;

    this.introProgress = 1;
    this.introOffsetY = 0;
    this.bodyOffsetY = 0;
    this.headThrustOffsetY = 0;
    this.headAngle = 0;

    this.head = {
      netKind: 'boss_head',
      id: 'H',
      x: WIDTH / 2,
      y: 180,
      w: this.headHalfBase,
      h: 260,
      angle: 0,
      hp: this.headMaxHp,
      maxHp: this.headMaxHp,
      hitCooldown: 0
    };

    this.leftArm = this.createArm('left', [
      { x: 180, y: 44, r: 56 },
      { x: 140, y: 114, r: 50 },
      { x: 165, y: 176, r: 42 }
    ]);

    this.rightArm = this.createArm('right', [
      { x: 600, y: 44, r: 56 },
      { x: 640, y: 114, r: 50 },
      { x: 615, y: 176, r: 42 }
    ]);

    this.attackCooldown = 5.0;
    this.armlessAttackCooldown = 10.0;
    this.aimDuration = 3.0;

    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = 1.0;
    this.nextAction = 'start_cycle';

    this.punchQueue = [];
    this.activeArmSide = null;
    this.aimTargetX = WIDTH / 2;
    this.lockedTargetX = WIDTH / 2;
    this.punchStartCircles = null;
    this.punchPeakCircles = null;
    this.punchStrikeActive = false;
    this.punchHitSlots = new Set();

    this.summonTriggered = false;
    this.pendingSummons = [];
    this.barrageShotsRemaining = 0;
    this.lastBarrageAngleOffset = 0;

    this.defeatDuration = 5.0;
    this.defeatStartBodyY = 0;
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.headShakeX = 0;
    this.headShakeY = 0;

    this.updateGeometry();
  }

  createArm(side, baseDefs) {
    const prefix = side === 'left' ? 'L' : 'R';
    return {
      side,
      hp: this.armMaxHp,
      maxHp: this.armMaxHp,
      hitCooldown: 0,
      blinking: false,
      blinkTimer: 0,
      baseCircles: baseDefs.map((c) => ({ x: c.x, y: c.y, r: c.r })),
      circles: baseDefs.map((c, idx) => ({
        netKind: 'boss_circle',
        id: `${prefix}${idx}`,
        x: c.x,
        y: c.y,
        r: c.r,
        radius: c.r
      }))
    };
  }

  setIntroProgress(progress) {
    const u = ColorUtils.clamp(progress, 0, 1);
    this.introProgress = u;
    const eased = 1 - Math.pow(1 - u, 3);
    this.introOffsetY = -(1 - eased) * 235;
    this.updateGeometry();
  }

  areArmsAlive() {
    return this.leftArm.hp > 0 || this.rightArm.hp > 0;
  }

  getPostAttackCooldown() {
    return this.areArmsAlive() ? this.attackCooldown : this.armlessAttackCooldown;
  }

  isDefeated() {
    return this.head.hp <= 0;
  }

  isDefeating() {
    return this.isDefeated() && this.phase === 'defeated' && this.phaseTimer < (this.defeatDuration || 5.0);
  }

  startDefeatAnimation() {
    if (this.phase === 'defeated') return;
    this.phase = 'defeated';
    this.phaseTimer = 0;
    this.defeatStartBodyY = this.bodyOffsetY || 0;
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.headShakeX = 0;
    this.headShakeY = 0;
    this.activeArmSide = null;
    this.punchStrikeActive = false;
    this.leftArm.blinking = false;
    this.rightArm.blinking = false;
    this.pendingSummons = [];
  }

  updateDefeatVibration() {
    const duration = this.defeatDuration || 5.0;
    if (this.phase !== 'defeated' || this.phaseTimer >= duration) {
      this.headShakeX = 0;
      this.headShakeY = 0;
      return;
    }
    const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
    const t = this.defeatVibClock || this.phaseTimer || 0;
    const amp = 8.5 * (1 - 0.18 * u);
    this.headShakeX = (Math.sin(t * 78) * 0.65 + Math.sin(t * 131 + 1.1) * 0.35) * amp;
    this.headShakeY = (Math.cos(t * 91 + 0.7) * 0.65 + Math.cos(t * 149) * 0.35) * (amp * 0.75);
  }

  getArm(side) {
    return side === 'left' ? this.leftArm : (side === 'right' ? this.rightArm : null);
  }

  getCircleById(targetId) {
    for (const arm of [this.leftArm, this.rightArm]) {
      const found = arm.circles.find((c) => c.id === targetId);
      if (found) return found;
    }
    return null;
  }

  hitsCircle(cx, cy, r) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    if (this.areArmsAlive()) {
      for (const arm of [this.leftArm, this.rightArm]) {
        if (arm.hp <= 0) continue;
        for (const c of arm.circles) {
          if (Math.hypot(cx - c.x, cy - c.y) <= r + c.r) {
            return true;
          }
        }
      }
      return false;
    }
    const verts = this.getHeadVertices();
    return Boolean(this.checkCircleTriangleCollision(cx, cy, r, verts[0], verts[1], verts[2]));
  }

  getHeadVertices() {
    const pivotX = this.pivotX + (this.headShakeX || 0);
    const pivotY = this.basePivotY + this.introOffsetY + this.bodyOffsetY + this.headThrustOffsetY + (this.headShakeY || 0);
    const cosA = Math.cos(this.headAngle);
    const sinA = Math.sin(this.headAngle);

    const toWorld = (lx, ly) => ({
      x: pivotX + lx * cosA + ly * sinA,
      y: pivotY - lx * sinA + ly * cosA
    });

    const topLeft = toWorld(-this.headHalfBase, this.headTopLocalY);
    const topRight = toWorld(this.headHalfBase, this.headTopLocalY);
    const bottomTip = toWorld(0, this.headLength);
    return [topLeft, topRight, bottomTip];
  }

  computeAimedArmCircles(arm, targetX, targetY, aimBlend = 1, coilOffset = 0) {
    const b0 = arm.baseCircles[0];
    const b1 = arm.baseCircles[1];
    const b2 = arm.baseCircles[2];
    const offsetY = this.introOffsetY + this.bodyOffsetY;

    const s0 = { x: b0.x, y: b0.y + offsetY, r: b0.r };
    const rest1 = { x: b1.x, y: b1.y + offsetY, r: b1.r };
    const rest2 = { x: b2.x, y: b2.y + offsetY, r: b2.r };

    const dx = targetX - s0.x;
    const dy = targetY - s0.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    // 外側への肘の張り出し法線（左腕は左外側、右腕は右外側）
    const outSign = arm.side === 'left' ? 1 : -1;
    const nx = -uy * outSign;
    const ny = ux * outSign;

    const chainLen = Math.max(48, 134 + coilOffset);
    const aimed2 = {
      x: s0.x + ux * chainLen,
      y: s0.y + uy * chainLen,
      r: b2.r
    };
    const aimed1 = {
      x: s0.x + ux * (chainLen * 0.52) + nx * 28,
      y: s0.y + uy * (chainLen * 0.52) + ny * 28,
      r: b1.r
    };
    const aimed0 = {
      x: s0.x + ux * (coilOffset * 0.35),
      y: s0.y + uy * (coilOffset * 0.35),
      r: b0.r
    };

    const lerp = (a, b, t) => a + (b - a) * t;
    return [
      { x: lerp(s0.x, aimed0.x, aimBlend), y: lerp(s0.y, aimed0.y, aimBlend), r: b0.r },
      { x: lerp(rest1.x, aimed1.x, aimBlend), y: lerp(rest1.y, aimed1.y, aimBlend), r: b1.r },
      { x: lerp(rest2.x, aimed2.x, aimBlend), y: lerp(rest2.y, aimed2.y, aimBlend), r: b2.r }
    ];
  }

  computeExtendedPunchCircles(arm, targetX, targetY) {
    const b0 = arm.baseCircles[0];
    const b1 = arm.baseCircles[1];
    const b2 = arm.baseCircles[2];
    const offsetY = this.introOffsetY + this.bodyOffsetY;

    const s0 = { x: b0.x, y: b0.y + offsetY };
    const dx = targetX - s0.x;
    const dy = targetY - s0.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;

    const outSign = arm.side === 'left' ? 1 : -1;
    const nx = -uy * outSign;
    const ny = ux * outSign;

    const c0 = {
      x: s0.x + ux * 36,
      y: s0.y + uy * 36,
      r: b0.r
    };
    const c2 = {
      x: targetX,
      y: targetY,
      r: b2.r
    };
    const c1 = {
      x: (c0.x + c2.x) * 0.5 + nx * 10,
      y: (c0.y + c2.y) * 0.5 + ny * 10,
      r: b1.r
    };
    return [c0, c1, c2];
  }

  applyArmCircles(arm, computed) {
    for (let i = 0; i < 3; i++) {
      arm.circles[i].x = computed[i].x;
      arm.circles[i].y = computed[i].y;
      arm.circles[i].r = computed[i].r;
      arm.circles[i].radius = computed[i].r;
    }
  }

  resetArmToBase(arm) {
    const offsetY = this.introOffsetY + this.bodyOffsetY;
    for (let i = 0; i < 3; i++) {
      arm.circles[i].x = arm.baseCircles[i].x;
      arm.circles[i].y = arm.baseCircles[i].y + offsetY;
      arm.circles[i].r = arm.baseCircles[i].r;
      arm.circles[i].radius = arm.baseCircles[i].r;
    }
  }

  updateGeometry() {
    const { PADDLE } = GAME_CONFIG;
    this.resetArmToBase(this.leftArm);
    this.resetArmToBase(this.rightArm);

    const activeArm = this.getArm(this.activeArmSide);
    if (activeArm && activeArm.hp > 0) {
      if (this.phase === 'aim') {
        const u = ColorUtils.clamp(this.phaseTimer / 0.75, 0, 1);
        const eased = 1 - Math.pow(1 - u, 3);
        const circles = this.computeAimedArmCircles(activeArm, this.aimTargetX, PADDLE.Y, eased, 0);
        this.applyArmCircles(activeArm, circles);
      } else if (this.phase === 'charging') {
        const u = ColorUtils.clamp(this.phaseTimer / 1.0, 0, 1);
        const eased = 1 - Math.pow(1 - u, 3);
        const circles = this.computeAimedArmCircles(activeArm, this.lockedTargetX, PADDLE.Y, 1, -22 * eased);
        this.applyArmCircles(activeArm, circles);
      } else if (this.phase === 'punch_strike') {
        const u = ColorUtils.clamp(this.phaseTimer / 0.17, 0, 1);
        const strikeT = u * (2 - u);
        const startC = this.punchStartCircles || this.computeAimedArmCircles(activeArm, this.lockedTargetX, PADDLE.Y, 1, -22);
        const endC = this.punchPeakCircles || this.computeExtendedPunchCircles(activeArm, this.lockedTargetX, PADDLE.Y);
        const current = [0, 1, 2].map((i) => ({
          x: startC[i].x + (endC[i].x - startC[i].x) * strikeT,
          y: startC[i].y + (endC[i].y - startC[i].y) * strikeT,
          r: endC[i].r
        }));
        this.applyArmCircles(activeArm, current);
      } else if (this.phase === 'punch_retract') {
        const u = ColorUtils.clamp(this.phaseTimer / 0.46, 0, 1);
        const retractT = 1 - Math.pow(1 - u, 3);
        const startC = this.punchPeakCircles || this.computeExtendedPunchCircles(activeArm, this.lockedTargetX, PADDLE.Y);
        const offsetY = this.introOffsetY + this.bodyOffsetY;
        const current = [0, 1, 2].map((i) => ({
          x: startC[i].x + (activeArm.baseCircles[i].x - startC[i].x) * retractT,
          y: startC[i].y + (activeArm.baseCircles[i].y + offsetY - startC[i].y) * retractT,
          r: activeArm.baseCircles[i].r
        }));
        this.applyArmCircles(activeArm, current);
      }
    }

    const verts = this.getHeadVertices();
    const tip = verts[2];
    this.head.x = tip.x;
    this.head.y = tip.y;
    this.head.angle = this.headAngle;
  }

  pickTargetPaddleX(paddleList, referenceX) {
    const { WIDTH } = GAME_CONFIG;
    const alive = paddleList.filter((p) => p && p.hp > 0);
    if (alive.length === 0) return WIDTH / 2;
    let best = alive[0];
    let bestDist = Math.abs(best.x - referenceX);
    for (let i = 1; i < alive.length; i++) {
      const d = Math.abs(alive[i].x - referenceX);
      if (d < bestDist) {
        bestDist = d;
        best = alive[i];
      }
    }
    return best.x;
  }

  enterCooldown(duration, nextAction) {
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = duration;
    this.nextAction = nextAction;
    this.punchStrikeActive = false;
    this.leftArm.blinking = false;
    this.rightArm.blinking = false;
  }

  startNextPunchOrSummon() {
    while (this.punchQueue.length > 0) {
      const nextSide = this.punchQueue.shift();
      const arm = this.getArm(nextSide);
      if (arm && arm.hp > 0) {
        this.activeArmSide = nextSide;
        this.phase = 'aim';
        this.phaseTimer = 0;
        this.punchStrikeActive = false;
        return;
      }
    }
    this.activeArmSide = null;
    this.startSummonPhase();
  }

  startCycle() {
    this.punchQueue = [];
    if (this.leftArm.hp > 0) this.punchQueue.push('left');
    if (this.rightArm.hp > 0) this.punchQueue.push('right');

    if (this.punchQueue.length > 0) {
      this.startNextPunchOrSummon();
    } else {
      this.startSummonPhase();
    }
  }

  startSummonPhase() {
    this.activeArmSide = null;
    this.phase = 'summon';
    this.phaseTimer = 0;
    this.summonTriggered = false;
    this.punchStrikeActive = false;
  }

  startSpreadBarragePhase() {
    this.activeArmSide = null;
    this.barrageShotsRemaining = 3;
    this.phase = 'spread_pull';
    this.phaseTimer = 0;
    this.punchStrikeActive = false;
  }

  spawnSummonedEnemies(enemies) {
    const { WIDTH } = GAME_CONFIG;
    if (!this.stageEnemies || this.stageEnemies.length === 0) return;

    const count = 2 + Math.floor(Math.random() * 3); // 2〜4体
    const margin = 64;
    const usableW = WIDTH - margin * 2;
    const sliceW = usableW / count;

    // 出現位置の順序をシャッフルし、降りてくるタイミングに揺らぎを持たせる
    const sliceIndices = Array.from({ length: count }, (_, idx) => idx);
    for (let i = sliceIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sliceIndices[i], sliceIndices[j]] = [sliceIndices[j], sliceIndices[i]];
    }

    let delay = 0;
    for (let i = 0; i < count; i++) {
      const slotIdx = sliceIndices[i];
      const spawnX = margin + sliceW * slotIdx + (0.2 + Math.random() * 0.6) * sliceW;
      const typeName = this.stageEnemies[Math.floor(Math.random() * this.stageEnemies.length)];
      if (i > 0) {
        delay += 0.35 + Math.random() * 0.65;
      }
      if (delay <= 0) {
        this.spawnSingleSummonedEnemy(typeName, spawnX, enemies);
      } else {
        this.pendingSummons.push({ typeName, spawnX, delay });
      }
    }
  }

  spawnSingleSummonedEnemy(typeName, spawnX, enemies) {
    if (enemies.length >= this.spawnLimit) return;
    const def = ENEMIES[typeName];
    if (!def) return;
    // 通常スポーンと同じく画面外の上から降りてくる
    enemies.push(new Enemy(def, spawnX));
  }

  fireSpreadBarrage(enemyBullets, effectsManager, onBarrageSpawn) {
    const { COLORS } = GAME_CONFIG;
    const verts = this.getHeadVertices();
    const tip = verts[2];
    const bulletCount = 8;
    const speed = 190;
    const damage = 2;

    // 発射ごとに前回と異なる角度オフセットへ変化させる
    const dir = this.lastBarrageAngleOffset >= 0 ? -1 : 1;
    const angleOffset = dir * (0.09 + Math.random() * 0.11);
    this.lastBarrageAngleOffset = angleOffset;

    const minAngle = 0.26 + angleOffset;
    const maxAngle = Math.PI - 0.26 + angleOffset;

    const spawned = [];
    for (let i = 0; i < bulletCount; i++) {
      const a = minAngle + (i / (bulletCount - 1)) * (maxAngle - minAngle);
      const bullet = {
        x: tip.x,
        y: tip.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        angle: a,
        speed,
        damage,
        timer: 0
      };
      enemyBullets.push(bullet);
      spawned.push(bullet);
    }

    if (onBarrageSpawn && spawned.length > 0) {
      onBarrageSpawn(spawned);
    }

    if (effectsManager) {
      effectsManager.spawnCircleParticles(tip.x, tip.y, COLORS.white, 8, 40, 130);
    }
  }

  update(dt, context) {
    const { PADDLE, COLORS } = GAME_CONFIG;
    const {
      paddles = [],
      enemies = [],
      enemyBullets = [],
      effectsManager,
      onDamagePaddle,
      onScreenShake,
      onBarrageSpawn
    } = context || {};

    if (this.head.hitCooldown > 0) {
      this.head.hitCooldown = Math.max(0, this.head.hitCooldown - dt);
    }
    if (this.leftArm.hitCooldown > 0) {
      this.leftArm.hitCooldown = Math.max(0, this.leftArm.hitCooldown - dt);
    }
    if (this.rightArm.hitCooldown > 0) {
      this.rightArm.hitCooldown = Math.max(0, this.rightArm.hitCooldown - dt);
    }

    if (this.isDefeated()) {
      this.pendingSummons = [];
      if (this.phase !== 'defeated') {
        this.startDefeatAnimation();
      }
      const duration = this.defeatDuration || 5.0;
      this.phaseTimer += dt;
      this.defeatVibClock += dt;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      // 5秒かけて徐々に画面の上へ引っ込む
      const retractEase = 0.35 * u + 0.65 * (u * u * (3 - 2 * u));
      this.bodyOffsetY = this.defeatStartBodyY + (-265 - this.defeatStartBodyY) * retractEase;
      this.headThrustOffsetY *= Math.pow(0.005, dt);
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 10);
      this.updateDefeatVibration();

      if (onScreenShake && this.phaseTimer < duration) {
        onScreenShake(0.08, 2.0 * (1 - 0.45 * u));
      }

      // 円形のパルスアニメーションで煙を表現
      if (effectsManager && this.phaseTimer < duration) {
        this.defeatSmokeTimer -= dt;
        const smokeColors = ['#ffffff', '#d8d8d8', '#a8a8a8'];
        while (this.defeatSmokeTimer <= 0) {
          this.defeatSmokeTimer += 0.065;
          const verts = this.getHeadVertices();
          const e = Math.random();
          let sx;
          let sy;
          if (e < 0.38) {
            const p = Math.random();
            sx = verts[0].x + (verts[2].x - verts[0].x) * p;
            sy = verts[0].y + (verts[2].y - verts[0].y) * p;
          } else if (e < 0.76) {
            const p = Math.random();
            sx = verts[1].x + (verts[2].x - verts[1].x) * p;
            sy = verts[1].y + (verts[2].y - verts[1].y) * p;
          } else {
            const w1 = Math.random();
            const w2 = Math.random() * (1 - w1);
            const w0 = 1 - w1 - w2;
            sx = verts[0].x * w0 + verts[1].x * w1 + verts[2].x * w2;
            sy = verts[0].y * w0 + verts[1].y * w1 + verts[2].y * w2;
          }
          sx += (Math.random() * 2 - 1) * 26;
          sy = Math.max(-12, sy + (Math.random() * 2 - 1) * 18);
          if (sy <= GAME_CONFIG.HEIGHT && verts[2].y > -65) {
            effectsManager.spawnPulse({
              kind: 'circle',
              x: sx,
              y: sy,
              radius: 14 + Math.random() * 22,
              color: smokeColors[Math.floor(Math.random() * smokeColors.length)],
              duration: 0.65 + Math.random() * 0.45,
              maxScale: 2.2 + Math.random() * 1.1
            });
          }
        }
      }

      this.updateGeometry();
      return;
    }

    if (this.introProgress < 1) {
      this.updateGeometry();
      return;
    }

    // 召喚予約された敵を揺らぎのあるタイミングで画面外の上から順次出現させる
    for (let i = this.pendingSummons.length - 1; i >= 0; i--) {
      const pending = this.pendingSummons[i];
      pending.delay -= dt;
      if (pending.delay <= 0) {
        this.spawnSingleSummonedEnemy(pending.typeName, pending.spawnX, enemies);
        this.pendingSummons.splice(i, 1);
      }
    }

    // 攻撃中の腕がボールで破壊された場合は即座にその腕の攻撃を中断して次へ移る
    if (this.activeArmSide) {
      const activeArm = this.getArm(this.activeArmSide);
      if (!activeArm || activeArm.hp <= 0) {
        this.activeArmSide = null;
        this.punchStrikeActive = false;
        this.leftArm.blinking = false;
        this.rightArm.blinking = false;
        this.enterCooldown(this.getPostAttackCooldown(), 'next_punch_or_summon');
      }
    }

    this.phaseTimer += dt;

    if (this.phase === 'cooldown') {
      this.bodyOffsetY *= Math.pow(0.001, dt);
      this.headThrustOffsetY *= Math.pow(0.001, dt);
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 10);

      if (this.phaseTimer >= this.cooldownDuration) {
        if (this.nextAction === 'start_cycle') {
          this.startCycle();
        } else if (this.nextAction === 'next_punch_or_summon') {
          this.startNextPunchOrSummon();
        } else if (this.nextAction === 'summon') {
          this.startSummonPhase();
        } else if (this.nextAction === 'spread_barrage') {
          this.startSpreadBarragePhase();
        } else {
          this.startCycle();
        }
      }
    } else if (this.phase === 'aim') {
      const activeArm = this.getArm(this.activeArmSide);
      const refX = activeArm ? activeArm.baseCircles[2].x : this.pivotX;
      this.aimTargetX = this.pickTargetPaddleX(paddles, refX);

      const dx = this.aimTargetX - this.pivotX;
      const dy = PADDLE.Y - this.basePivotY;
      const targetAngle = ColorUtils.clamp(Math.atan2(dx, dy) * 0.85, -0.42, 0.42);
      this.headAngle += (targetAngle - this.headAngle) * Math.min(1, dt * 9);

      if (this.phaseTimer >= this.aimDuration) {
        // chargingフェーズ開始時点でプレイヤーの位置をロック
        this.lockedTargetX = this.aimTargetX;
        this.phase = 'charging';
        this.phaseTimer = 0;
        if (activeArm) {
          activeArm.blinking = true;
          activeArm.blinkTimer = 0;
        }
      }
    } else if (this.phase === 'charging') {
      // 1秒間: 攻撃しようとしている腕が self_destruction と同じ 0.5秒サイクルで赤白点滅し、エイムは固定
      const activeArm = this.getArm(this.activeArmSide);
      if (activeArm) {
        activeArm.blinking = true;
        activeArm.blinkTimer = this.phaseTimer;
      }

      if (this.phaseTimer >= 1.0) {
        if (activeArm) {
          activeArm.blinking = false;
          this.punchStartCircles = this.computeAimedArmCircles(activeArm, this.lockedTargetX, PADDLE.Y, 1, -22);
          this.punchPeakCircles = this.computeExtendedPunchCircles(activeArm, this.lockedTargetX, PADDLE.Y);
        }
        this.phase = 'punch_strike';
        this.phaseTimer = 0;
        this.punchStrikeActive = true;
        this.punchHitSlots.clear();
      }
    } else if (this.phase === 'punch_strike') {
      // 高速で固定位置に向かって殴る瞬間のみダメージ判定 (4ダメージ)
      this.punchStrikeActive = true;
      this.updateGeometry();

      const activeArm = this.getArm(this.activeArmSide);
      if (activeArm && onDamagePaddle) {
        for (const p of paddles) {
          if (!p || p.hp <= 0 || p.invincibleTimer > 0 || this.punchHitSlots.has(p.slot)) continue;
          const pLeft = p.x - p.currentWidth / 2;
          const pRight = p.x + p.currentWidth / 2;
          const pTop = p.y - p.height / 2;
          const pBottom = p.y + p.height / 2;

          for (const c of activeArm.circles) {
            const closestX = ColorUtils.clamp(c.x, pLeft, pRight);
            const closestY = ColorUtils.clamp(c.y, pTop, pBottom);
            const dx = c.x - closestX;
            const dy = c.y - closestY;
            if (dx * dx + dy * dy <= c.r * c.r) {
              this.punchHitSlots.add(p.slot);
              onDamagePaddle(p, 4);
              if (effectsManager) {
                effectsManager.spawnCircleParticles(closestX, closestY, COLORS.red, 10, 45, 165);
              }
              break;
            }
          }
        }
      }

      if (this.phaseTimer >= 0.17) {
        // 到達後は速度が止まり戻るためダメージ判定を即座に終了
        this.punchStrikeActive = false;
        this.phase = 'punch_retract';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'punch_retract') {
      this.punchStrikeActive = false;
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 8);

      if (this.phaseTimer >= 0.46) {
        this.activeArmSide = null;
        this.enterCooldown(this.getPostAttackCooldown(), 'next_punch_or_summon');
      }
    } else if (this.phase === 'summon') {
      // 身体全体を上下に揺らし、画面も揺れ、しばらくすると敵を2〜4体召喚
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 10);
      const env = Math.sin(ColorUtils.clamp(this.phaseTimer / 1.25, 0, 1) * Math.PI);
      this.bodyOffsetY = Math.sin(this.phaseTimer * 42) * 14 * env;

      if (onScreenShake) {
        onScreenShake(0.08, 4.2);
      }

      if (!this.summonTriggered && this.phaseTimer >= 0.82) {
        this.summonTriggered = true;
        this.spawnSummonedEnemies(enemies);
      }

      if (this.phaseTimer >= 1.25) {
        this.bodyOffsetY = 0;
        this.enterCooldown(this.getPostAttackCooldown(), 'spread_barrage');
      }
    } else if (this.phase === 'spread_pull') {
      // 顔を上に引く
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 12);
      const u = ColorUtils.clamp(this.phaseTimer / 0.36, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.headThrustOffsetY = -36 * eased;

      if (this.phaseTimer >= 0.36) {
        this.phase = 'spread_thrust';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'spread_thrust') {
      // 顔を下に突き出し、突き出したタイミングで先端から15個の半円拡散弾を発射
      const u = ColorUtils.clamp(this.phaseTimer / 0.15, 0, 1);
      const eased = u * u;
      this.headThrustOffsetY = -36 + (34 - -36) * eased;

      if (this.phaseTimer >= 0.15) {
        this.headThrustOffsetY = 34;
        this.updateGeometry();
        this.fireSpreadBarrage(enemyBullets, effectsManager, onBarrageSpawn);
        this.barrageShotsRemaining -= 1;
        this.phase = 'spread_recover';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'spread_recover') {
      const u = ColorUtils.clamp(this.phaseTimer / 0.34, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.headThrustOffsetY = 34 * (1 - eased);

      if (this.phaseTimer >= 0.34) {
        this.headThrustOffsetY = 0;
        if (this.barrageShotsRemaining > 0) {
          this.phase = 'spread_pull';
          this.phaseTimer = 0;
        } else {
          this.enterCooldown(this.getPostAttackCooldown(), 'start_cycle');
        }
      }
    }

    this.updateGeometry();
  }

  applyArmDamage(arm, hitX, hitY, pulseColor, effectsManager, onScore, onSpawnItem, cooldown = 0.08) {
    if (arm.hp <= 0 || arm.hitCooldown > 0) return false;
    const { COLORS } = GAME_CONFIG;
    arm.hitCooldown = cooldown;
    arm.hp = Math.max(0, arm.hp - 1);

    for (const armCircle of arm.circles) {
      effectsManager.spawnPulse({
        kind: 'circle',
        target: armCircle,
        x: armCircle.x,
        y: armCircle.y,
        radius: armCircle.r,
        color: pulseColor,
        duration: arm.hp > 0 ? 0.42 : 0.5,
        maxScale: arm.hp > 0 ? 1.55 : 2.15
      });
    }

    if (arm.hp <= 0) {
      arm.blinking = false;
      for (const armCircle of arm.circles) {
        effectsManager.spawnCircleParticles(armCircle.x, armCircle.y, COLORS.white, 9, 45, 175);
      }
      if (onScore) onScore(450);
      if (onSpawnItem) onSpawnItem(hitX, Math.max(40, hitY), 0.55);
    } else if (onScore) {
      onScore(80);
    }
    return true;
  }

  applyHeadDamage(pulseColor, effectsManager, onScore, cooldown = 0.08) {
    if (this.areArmsAlive() || this.head.hp <= 0 || this.head.hitCooldown > 0) return false;
    const { COLORS } = GAME_CONFIG;
    this.head.hitCooldown = cooldown;
    this.head.hp = Math.max(0, this.head.hp - 1);

    effectsManager.spawnPulse({
      kind: 'boss_head',
      target: this.head,
      x: this.head.x,
      y: this.head.y,
      w: this.head.w,
      h: this.head.h,
      angle: this.headAngle,
      color: pulseColor,
      duration: this.head.hp > 0 ? 0.44 : 0.55,
      maxScale: this.head.hp > 0 ? 1.48 : 2.1
    });

    if (this.head.hp <= 0) {
      this.startDefeatAnimation();
      effectsManager.spawnCircleParticles(this.head.x, Math.max(60, this.head.y - 60), COLORS.white, 22, 60, 220);
      if (onScore) onScore(1500);
    } else if (onScore) {
      onScore(100);
    }
    return true;
  }

  handleSwingCircleCollision(cx, cy, cr, effectsManager, onScore, onSpawnItem) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS } = GAME_CONFIG;
    for (const arm of [this.leftArm, this.rightArm]) {
      if (arm.hp <= 0 || arm.hitCooldown > 0) continue;
      for (const c of arm.circles) {
        if (Math.hypot(cx - c.x, cy - c.y) <= cr + c.r) {
          return this.applyArmDamage(arm, c.x, c.y, COLORS.white, effectsManager, onScore, onSpawnItem, 0.22);
        }
      }
    }
    if (!this.areArmsAlive() && this.head.hitCooldown <= 0) {
      const verts = this.getHeadVertices();
      if (this.checkCircleTriangleCollision(cx, cy, cr, verts[0], verts[1], verts[2])) {
        return this.applyHeadDamage(COLORS.white, effectsManager, onScore, 0.22);
      }
    }
    return false;
  }

  canTakeCrackDamage() {
    if (this.isDefeated() || this.introProgress < 1) return false;
    return this.areArmsAlive() || this.head.hp > 1;
  }

  applyCrackDamage(effectsManager, onScore, onSpawnItem) {
    if (!this.canTakeCrackDamage()) return null;
    const { COLORS } = GAME_CONFIG;
    const aliveArms = [this.leftArm, this.rightArm].filter((arm) => arm && arm.hp > 0);
    if (aliveArms.length > 0) {
      const pickedArm = aliveArms[Math.floor(Math.random() * aliveArms.length)];
      const hitCircle = pickedArm.circles[Math.floor(Math.random() * pickedArm.circles.length)] || pickedArm.circles[0];
      pickedArm.hitCooldown = 0;
      const applied = this.applyArmDamage(
        pickedArm,
        hitCircle.x,
        hitCircle.y,
        COLORS.white,
        effectsManager,
        onScore,
        onSpawnItem,
        0
      );
      return applied ? { x: hitCircle.x, y: hitCircle.y } : null;
    }
    if (this.head.hp > 1) {
      this.head.hitCooldown = 0;
      const applied = this.applyHeadDamage(COLORS.white, effectsManager, onScore, 0);
      return applied ? { x: this.head.x, y: this.head.y } : null;
    }
    return null;
  }

  /**
   * ボールとの衝突およびダメージ処理
   * - 両腕が残っている間は、顔に当たっても反射するのみでダメージは入らない
   * - ダメージが入った場合はパルスアニメーションを発生させてわかりやすく表現する
   */
  handleBallCollision(ball, effectsManager, onScore, onSpawnItem) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS, BALL } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;
    const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

    // 1. 左右の腕（各3つの円）との衝突判定
    for (const arm of [this.leftArm, this.rightArm]) {
      if (arm.hp <= 0) continue;
      for (const c of arm.circles) {
        const dx = ball.x - c.x;
        const dy = ball.y - c.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= ball.radius + c.r) {
          const nx = dx / (dist || 1);
          const ny = dy / (dist || 1);
          this.reflectBall(ball, c.x + nx * (c.r + ball.radius + 2), c.y + ny * (c.r + ball.radius + 2), nx, ny, BALL);
          this.applyArmDamage(arm, c.x, c.y, pulseColor, effectsManager, onScore, onSpawnItem, 0.08);
          return true;
        }
      }
    }

    // 2. 顔（三角形）との衝突判定
    const verts = this.getHeadVertices();
    const hit = this.checkCircleTriangleCollision(ball.x, ball.y, ball.radius, verts[0], verts[1], verts[2]);
    if (hit) {
      this.reflectBall(
        ball,
        hit.closestX + hit.nx * (ball.radius + 2),
        hit.closestY + hit.ny * (ball.radius + 2),
        hit.nx,
        hit.ny,
        BALL
      );

      // 両腕を先に破壊しないと顔にはダメージが入らない
      this.applyHeadDamage(pulseColor, effectsManager, onScore, 0.08);
      return true;
    }

    return false;
  }

  reflectBall(ball, newX, newY, nx, ny, BALL) {
    ball.spawningFromCenter = false;
    const prevVy = ball.vy;
    const speed = Math.hypot(ball.vx, ball.vy) || BALL.BASE_SPEED;
    ball.vx = nx * speed;
    ball.vy = ny * speed;
    if (ball.effects.yellow <= 0) {
      ball.clampVerticalAngle(speed);
    } else if (ball.effects.green > 0 && prevVy < 0 && ball.vy > 0) {
      ball.vy /= BALL.GREEN_SPEED_MULTIPLIER;
    }
    ball.x = ColorUtils.clamp(newX, ball.radius, GAME_CONFIG.WIDTH - ball.radius);
    ball.y = Math.max(ball.radius, newY);
  }

  checkCircleTriangleCollision(cx, cy, r, p0, p1, p2) {
    const edges = [
      [p0, p1],
      [p1, p2],
      [p2, p0]
    ];

    let bestDistSq = Infinity;
    let closestX = cx;
    let closestY = cy;
    let edgeNx = 0;
    let edgeNy = 1;

    const centroidX = (p0.x + p1.x + p2.x) / 3;
    const centroidY = (p0.y + p1.y + p2.y) / 3;

    for (const [a, b] of edges) {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lenSq = abx * abx + aby * aby || 1;
      const t = ColorUtils.clamp(((cx - a.x) * abx + (cy - a.y) * aby) / lenSq, 0, 1);
      const qx = a.x + abx * t;
      const qy = a.y + aby * t;
      const dx = cx - qx;
      const dy = cy - qy;
      const dSq = dx * dx + dy * dy;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        closestX = qx;
        closestY = qy;
        const len = Math.sqrt(lenSq) || 1;
        let nx = -aby / len;
        let ny = abx / len;
        if (nx * (a.x - centroidX) + ny * (a.y - centroidY) < 0) {
          nx = -nx;
          ny = -ny;
        }
        edgeNx = nx;
        edgeNy = ny;
      }
    }

    const inside = this.isPointInTriangle(cx, cy, p0, p1, p2);
    if (!inside && bestDistSq > r * r) {
      return null;
    }

    const dist = Math.sqrt(bestDistSq);
    let nx = edgeNx;
    let ny = edgeNy;
    if (!inside && dist > 0.001) {
      nx = (cx - closestX) / dist;
      ny = (cy - closestY) / dist;
    }

    return { closestX, closestY, nx, ny };
  }

  isPointInTriangle(px, py, p0, p1, p2) {
    const d1 = (px - p1.x) * (p0.y - p1.y) - (p0.x - p1.x) * (py - p1.y);
    const d2 = (px - p2.x) * (p1.y - p2.y) - (p1.x - p2.x) * (py - p2.y);
    const d3 = (px - p0.x) * (p2.y - p0.y) - (p2.x - p0.x) * (py - p0.y);
    const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
    const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
    return !(hasNeg && hasPos);
  }

  render(ctx) {
    if (this.isDefeated() && !this.isDefeating()) return;
    const { COLORS, ENEMY } = GAME_CONFIG;

    // 1. 顔（1つの下向き三角形）を描画
    const verts = this.getHeadVertices();
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = COLORS.white;
    ctx.lineWidth = 2.8;
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    ctx.lineTo(verts[1].x, verts[1].y);
    ctx.lineTo(verts[2].x, verts[2].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // 2. 左右の腕（それぞれ3つの円、奥→手前の順で黒塗り＋白枠描画）
    for (const arm of [this.leftArm, this.rightArm]) {
      if (arm.hp <= 0) continue;

      let strokeColor = COLORS.white;
      if (arm.blinking) {
        const phase = (arm.blinkTimer || 0) % ENEMY.BLINK_CYCLE;
        strokeColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
      }

      ctx.save();
      ctx.fillStyle = '#000000';
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2.8;
      for (const c of arm.circles) {
        ctx.beginPath();
        ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  serialize() {
    const r1 = (v) => Math.round(v * 10) / 10;
    const r2 = (v) => Math.round(v * 100) / 100;
    return [
      this.phase,
      r2(this.phaseTimer),
      r2(this.introProgress),
      r1(this.bodyOffsetY),
      r1(this.headThrustOffsetY),
      r2(this.headAngle),
      this.head.hp,
      this.head.maxHp,
      this.leftArm.hp,
      this.leftArm.maxHp,
      this.leftArm.blinking ? 1 : 0,
      r2(this.leftArm.blinkTimer || 0),
      this.leftArm.circles.map((c) => [r1(c.x), r1(c.y), r1(c.r)]),
      this.rightArm.hp,
      this.rightArm.maxHp,
      this.rightArm.blinking ? 1 : 0,
      r2(this.rightArm.blinkTimer || 0),
      this.rightArm.circles.map((c) => [r1(c.x), r1(c.y), r1(c.r)])
    ];
  }

  applySnapshotStateImmediate(fields) {
    this.introProgress = fields.introProgress;
    this.introOffsetY = -(1 - (1 - Math.pow(1 - ColorUtils.clamp(this.introProgress, 0, 1), 3))) * 235;
    this.bodyOffsetY = fields.bodyOffsetY;
    this.headThrustOffsetY = fields.headThrustOffsetY;
    this.headAngle = fields.headAngle;

    const verts = this.getHeadVertices();
    this.head.x = verts[2].x;
    this.head.y = verts[2].y;
    this.head.angle = this.headAngle;

    for (let i = 0; i < 3; i++) {
      const lc = fields.leftCircles[i];
      if (lc) {
        this.leftArm.circles[i].x = lc[0];
        this.leftArm.circles[i].y = lc[1];
        this.leftArm.circles[i].r = lc[2];
        this.leftArm.circles[i].radius = lc[2];
      }
      const rc = fields.rightCircles[i];
      if (rc) {
        this.rightArm.circles[i].x = rc[0];
        this.rightArm.circles[i].y = rc[1];
        this.rightArm.circles[i].r = rc[2];
        this.rightArm.circles[i].radius = rc[2];
      }
    }
  }

  captureInterpState() {
    return {
      introProgress: this.introProgress,
      bodyOffsetY: this.bodyOffsetY,
      headThrustOffsetY: this.headThrustOffsetY,
      headAngle: this.headAngle,
      leftCircles: this.leftArm.circles.map((c) => [c.x, c.y, c.r]),
      rightCircles: this.rightArm.circles.map((c) => [c.x, c.y, c.r])
    };
  }

  /**
   * ゲスト側クライアント補間更新（60fpsでボス本体・頭・両腕と点滅を滑らかに進行させる）
   */
  updateClient(dt) {
    if (this._hasSnapInterp && this._interpFrom && this._interpTo) {
      this._interpElapsed += dt;
      const alpha = this._interpDuration > 0 ? Math.min(1, this._interpElapsed / this._interpDuration) : 1;
      const lerp = (a, b) => a + (b - a) * alpha;
      const from = this._interpFrom;
      const to = this._interpTo;
      const angleDiff = Math.atan2(Math.sin(to.headAngle - from.headAngle), Math.cos(to.headAngle - from.headAngle));

      const leftCircles = [0, 1, 2].map((i) => [
        lerp(from.leftCircles[i][0], to.leftCircles[i][0]),
        lerp(from.leftCircles[i][1], to.leftCircles[i][1]),
        lerp(from.leftCircles[i][2], to.leftCircles[i][2])
      ]);
      const rightCircles = [0, 1, 2].map((i) => [
        lerp(from.rightCircles[i][0], to.rightCircles[i][0]),
        lerp(from.rightCircles[i][1], to.rightCircles[i][1]),
        lerp(from.rightCircles[i][2], to.rightCircles[i][2])
      ]);

      this.applySnapshotStateImmediate({
        introProgress: lerp(from.introProgress, to.introProgress),
        bodyOffsetY: lerp(from.bodyOffsetY, to.bodyOffsetY),
        headThrustOffsetY: lerp(from.headThrustOffsetY, to.headThrustOffsetY),
        headAngle: from.headAngle + angleDiff * alpha,
        leftCircles,
        rightCircles
      });
    }

    for (const arm of [this.leftArm, this.rightArm]) {
      if (arm.blinking) {
        arm.blinkTimer = (arm.blinkTimer || 0) + dt;
      }
    }

    if (this.phase === 'defeated' || this.isDefeated()) {
      this.phase = 'defeated';
      this.defeatVibClock = (this.defeatVibClock || 0) + dt;
      this.updateDefeatVibration();
      this.updateGeometry();
    } else {
      this.headShakeX = 0;
      this.headShakeY = 0;
    }
  }

  applySnapshot(data, interpDuration = null) {
    if (!Array.isArray(data)) return;
    const [
      phase,
      phaseTimer,
      introProgress,
      bodyOffsetY,
      headThrustOffsetY,
      headAngle,
      headHp,
      headMaxHp,
      leftHp,
      leftMaxHp,
      leftBlink,
      leftBlinkTimer,
      leftCircles,
      rightHp,
      rightMaxHp,
      rightBlink,
      rightBlinkTimer,
      rightCircles
    ] = data;

    this.phase = phase || 'cooldown';
    this.phaseTimer = phaseTimer || 0;
    this.head.hp = headHp;
    this.head.maxHp = headMaxHp;

    const wasLeftBlink = this.leftArm.blinking;
    this.leftArm.hp = leftHp;
    this.leftArm.maxHp = leftMaxHp;
    this.leftArm.blinking = !!leftBlink;
    if (!this.leftArm.blinking || !wasLeftBlink || interpDuration === null) {
      this.leftArm.blinkTimer = leftBlinkTimer || 0;
    }

    const wasRightBlink = this.rightArm.blinking;
    this.rightArm.hp = rightHp;
    this.rightArm.maxHp = rightMaxHp;
    this.rightArm.blinking = !!rightBlink;
    if (!this.rightArm.blinking || !wasRightBlink || interpDuration === null) {
      this.rightArm.blinkTimer = rightBlinkTimer || 0;
    }

    const targetState = {
      introProgress: introProgress !== undefined ? introProgress : 1,
      bodyOffsetY: bodyOffsetY || 0,
      headThrustOffsetY: headThrustOffsetY || 0,
      headAngle: headAngle || 0,
      leftCircles: [0, 1, 2].map((i) => (Array.isArray(leftCircles) && leftCircles[i]) ? leftCircles[i] : [this.leftArm.circles[i].x, this.leftArm.circles[i].y, this.leftArm.circles[i].r]),
      rightCircles: [0, 1, 2].map((i) => (Array.isArray(rightCircles) && rightCircles[i]) ? rightCircles[i] : [this.rightArm.circles[i].x, this.rightArm.circles[i].y, this.rightArm.circles[i].r])
    };

    if (!this._hasSnapInterp || !(interpDuration > 0)) {
      this._hasSnapInterp = true;
      this.applySnapshotStateImmediate(targetState);
      this._interpFrom = this.captureInterpState();
      this._interpTo = this.captureInterpState();
      this._interpElapsed = 1;
      this._interpDuration = interpDuration || 0.042;
      return;
    }

    this._interpFrom = this.captureInterpState();
    this._interpTo = targetState;
    this._interpElapsed = 0;
    this._interpDuration = interpDuration;
  }
}

/**
 * ステージ20 ボスエネミークラス (Snake / スネーク)
 * - 15個の円（頭から尻尾に向けて徐々に小さくなる）で構成された長いヘビ
 * - 通常時は画面上から3.5個分の円を覗かせてぶらぶら揺れている
 * - 行動ループ (各攻撃後10秒クールダウン):
 *   1. ランダムなプレイヤーのパドルをじっと見つめて舌を出して攻撃（4ダメージ）
 *   2. 顔を引っ込め3秒後、ランダムで:
 *      a. ランダムなプレイヤーの位置に上から1秒間顔を出し、真下へ急降下（4ダメージ）
 *      b. 右・下・左のどちらかからサイン波状にクネクネ進行（身体2ダメージ・頭部4ダメージ）
 *   3. 顔を後ろに引いて突き出しつつ、3方向へランダム順で8方向拡散スペード弾(explode)を計3回発射
 *   4. 画面を揺らしてステージの敵を2〜4体召喚
 */
class SnakeBoss {
  constructor(stageData, playerCount = 1) {
    const { WIDTH } = GAME_CONFIG;
    this.netKind = 'boss';
    this.id = 'snake';
    this.name = 'snake';
    this.stageEnemies = Array.isArray(stageData && stageData.enemies)
      ? stageData.enemies.slice()
      : ['pickaxe', 'quadiamond', 'club', 'spade'];
    this.spawnLimit = (stageData && typeof stageData.spawn_limit === 'number') ? stageData.spawn_limit : 5;

    const hpScale = getBossHpScaleForCount(playerCount);
    this.maxHp = Math.round(35 * hpScale);
    this.hp = this.maxHp;
    this.hitCooldown = 0;

    this.segmentCount = 30;
    this.segments = [];
    this.segDists = [0];
    this.cumDists = [0];
    const headRadius = 52;
    const tailRadius = headRadius * 0.7;
    for (let i = 0; i < this.segmentCount; i++) {
      const r = Math.round((headRadius - (i / (this.segmentCount - 1)) * (headRadius - tailRadius)) * 10) / 10;
      this.segments.push({
        netKind: 'boss_circle',
        id: `S${i}`,
        x: WIDTH / 2,
        y: -300,
        r,
        radius: r
      });
      if (i > 0) {
        const d = (this.segments[i - 1].r + r) * 0.56;
        this.segDists.push(d);
        this.cumDists.push(this.cumDists[i - 1] + d);
      }
    }
    this.bodyLength = this.cumDists[this.segmentCount - 1];
    this.head = this.segments[0];

    this.pivotX = WIDTH / 2;
    this.restHeadY = 175; // seg[0..2]とseg[3]の約半分(計3.5個)が画面内に収まる高さ
    this.introProgress = 1;
    this.introOffsetY = 0;
    this.bodyOffsetY = 0;
    this.headThrustOffsetY = 0;
    this.headAngle = 0;
    this.currentSwayAmp = 0.08;
    this.idleClock = 0;

    this.attackCooldown = 5;
    this.aimDuration = 3.0;
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = 1.0;
    this.nextAction = 'start_cycle';

    this.targetSlot = null;
    this.aimTargetX = WIDTH / 2;
    this.lockedTargetX = WIDTH / 2;
    this.blinking = false;
    this.blinkTimer = 0;

    // 舌攻撃状態
    this.tongueProgress = 0;
    this.tongueStartX = WIDTH / 2;
    this.tongueStartY = this.restHeadY;
    this.tongueTipX = WIDTH / 2;
    this.tongueTipY = this.restHeadY;
    this.tongueStrikeActive = false;

    // 2a (急降下) / 2b (サイン波進行) 用
    this.diveX = WIDTH / 2;
    this.diveBulletPairIdx = 0;
    this.afterimages = [];
    this.afterimageTimer = 0;
    this.slitherDir = 'left';
    this.slitherLUT = null;
    this.slitherArcPos = 0;
    this.slitherSpeed = 520;
    this.attackHitSlots = new Set();

    // 3 (3方向ランダム順 explode弾) / 4 (召喚) 用
    this.barrageAngles = [];
    this.activeBarrageAngle = Math.PI / 2;
    this.summonTriggered = false;
    this.pendingSummons = [];

    // 撃破演出用 (Bigfootと同様5秒振動 + 煙パルス + 上昇退場)
    this.defeatDuration = 5.0;
    this.defeatStartSegments = null;
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.headShakeX = 0;
    this.headShakeY = 0;

    this.updateHangingGeometry(0, 0.08);
  }

  setIntroProgress(progress) {
    const u = ColorUtils.clamp(progress, 0, 1);
    this.introProgress = u;
    const eased = 1 - Math.pow(1 - u, 3);
    this.introOffsetY = -(1 - eased) * 260;
    this.updateHangingGeometry(0, 0.08);
  }

  isDefeated() {
    return this.hp <= 0;
  }

  isDefeating() {
    return this.isDefeated() && this.phase === 'defeated' && this.phaseTimer < (this.defeatDuration || 5.0);
  }

  getCircleById(targetId) {
    return this.segments.find((s) => s.id === targetId) || null;
  }

  hitsCircle(cx, cy, r) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    for (const seg of this.segments) {
      if (seg.y + seg.r <= 0 || seg.y - seg.r >= GAME_CONFIG.HEIGHT) continue;
      if (Math.hypot(cx - seg.x, cy - seg.y) <= r + seg.r) {
        return true;
      }
    }
    return false;
  }

  startDefeatAnimation() {
    if (this.phase === 'defeated') return;
    this.phase = 'defeated';
    this.phaseTimer = 0;
    this.defeatStartSegments = this.segments.map((s) => ({ x: s.x, y: s.y }));
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.headShakeX = 0;
    this.headShakeY = 0;
    this.blinking = false;
    this.tongueStrikeActive = false;
    this.tongueProgress = 0;
    this.pendingSummons = [];
  }

  updateDefeatVibration() {
    const duration = this.defeatDuration || 5.0;
    if (this.phase !== 'defeated' || this.phaseTimer >= duration) {
      this.headShakeX = 0;
      this.headShakeY = 0;
      return;
    }
    const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
    const t = this.defeatVibClock || this.phaseTimer || 0;
    const amp = 8.5 * (1 - 0.18 * u);
    this.headShakeX = (Math.sin(t * 78) * 0.65 + Math.sin(t * 131 + 1.1) * 0.35) * amp;
    this.headShakeY = (Math.cos(t * 91 + 0.7) * 0.65 + Math.cos(t * 149) * 0.35) * (amp * 0.75);
  }

  /**
   * 上から3.5個分の円が垂れ下がって揺れる基本姿勢を計算する
   */
  updateHangingGeometry(aimAngle = 0, swayAmp = 0.08, extraHeadY = 0) {
    const { WIDTH } = GAME_CONFIG;
    const anchorY = this.restHeadY - this.cumDists[4] + this.introOffsetY + this.bodyOffsetY + this.headThrustOffsetY + extraHeadY;
    const anchorX = WIDTH / 2;

    // 画面上外の胴体部分(4..14)は真っすぐ上方へ配置
    for (let i = 4; i < this.segmentCount; i++) {
      this.segments[i].x = anchorX;
      this.segments[i].y = anchorY - (this.cumDists[i] - this.cumDists[4]);
    }

    // 画面内へ垂れ下がる首〜頭(3..0)をジョイント角度と揺らぎで連結配置
    const bendWeights = [1.0, 0.78, 0.52, 0.25];
    const swayWeights = [1.0, 0.85, 0.6, 0.35];
    for (let i = 3; i >= 0; i--) {
      const prev = this.segments[i + 1];
      const sway = swayAmp > 0 ? Math.sin(this.idleClock * 2.2 - i * 0.55) * swayAmp * swayWeights[i] : 0;
      const segAngle = aimAngle * bendWeights[i] + sway;
      const dist = this.segDists[i + 1];
      this.segments[i].x = prev.x + Math.sin(segAngle) * dist;
      this.segments[i].y = prev.y + Math.cos(segAngle) * dist;
    }
  }

  placeVerticalStack(x, headY) {
    for (let i = 0; i < this.segmentCount; i++) {
      this.segments[i].x = x;
      this.segments[i].y = headY - this.cumDists[i];
    }
  }

  pickRandomAlivePaddle(paddles) {
    const alive = paddles.filter((p) => p && p.hp > 0);
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  resolveTrackedPaddleX(paddles) {
    const { WIDTH } = GAME_CONFIG;
    if (this.targetSlot !== null && this.targetSlot !== undefined) {
      const matched = paddles.find((p) => p && p.slot === this.targetSlot && p.hp > 0);
      if (matched) return matched.x;
    }
    const fallback = this.pickRandomAlivePaddle(paddles);
    if (fallback) {
      this.targetSlot = fallback.slot;
      return fallback.x;
    }
    return WIDTH / 2;
  }

  enterCooldown(duration, nextAction) {
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = duration;
    this.nextAction = nextAction;
    this.blinking = false;
    this.tongueStrikeActive = false;
    this.tongueProgress = 0;
  }

  startTongueCycle(paddles) {
    const picked = this.pickRandomAlivePaddle(paddles);
    this.targetSlot = picked ? picked.slot : null;
    this.aimTargetX = picked ? picked.x : GAME_CONFIG.WIDTH / 2;
    this.phase = 'aim';
    this.phaseTimer = 0;
    this.blinking = false;
    this.tongueStrikeActive = false;
    this.tongueProgress = 0;
  }

  startRetractPhase() {
    this.phase = 'retract';
    this.phaseTimer = 0;
    this.blinking = false;
    this.tongueStrikeActive = false;
    this.tongueProgress = 0;
  }

  startSpreadBarragePhase() {
    // 左・中央・右の3方向をランダムな順番へシャッフル
    const dirs = [Math.PI / 2 + 0.5, Math.PI / 2, Math.PI / 2 - 0.5];
    for (let i = dirs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [dirs[i], dirs[j]] = [dirs[j], dirs[i]];
    }
    this.barrageAngles = dirs;
    this.activeBarrageAngle = this.barrageAngles.shift();
    this.phase = 'spread_pull';
    this.phaseTimer = 0;
    this.blinking = false;
    this.tongueProgress = 0;
  }

  startSummonPhase() {
    this.phase = 'summon';
    this.phaseTimer = 0;
    this.summonTriggered = false;
    this.blinking = false;
    this.tongueProgress = 0;
  }

  /**
   * 2b用: 右・左のどちらかから大きくサイン波に沿って進行するルックアップテーブルを生成
   * 波長(660px)と振幅(160px)を大きく取り、フルサイズパドル(144px)が波の隙間に収まれるようにする
   */
  initSlitherPath() {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    const dirs = ['right', 'left'];
    this.slitherDir = dirs[Math.floor(Math.random() * dirs.length)];

    const samples = 280;
    const pts = [];
    const wavePhase = Math.random() * Math.PI * 2;
    let totalArc = 0;

    const startX = this.slitherDir === 'left' ? -60 : WIDTH + 60;
    const endX = this.slitherDir === 'left' ? WIDTH + 60 : -60;
    const sign = this.slitherDir === 'left' ? 1 : -1;
    const baseY = PADDLE.Y - 20;
    const amp = 160;
    const freq = (Math.PI * 2) / 660;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const x = startX + (endX - startX) * t;
      const dxTravel = (x - startX) * sign;
      const y = baseY + Math.sin(dxTravel * freq + wavePhase) * amp;
      if (i > 0) {
        totalArc += Math.hypot(x - pts[i - 1].x, y - pts[i - 1].y);
      }
      pts.push({ x, y, s: totalArc });
    }
    this.slitherEntryTangent = { dx: sign, dy: 0 };
    this.slitherExitTangent = { dx: sign, dy: 0 };

    this.slitherLUT = pts;
    this.slitherTotalArc = totalArc;
    this.slitherArcPos = 0;
  }

  sampleSlitherPoint(s) {
    const pts = this.slitherLUT;
    if (!pts || pts.length === 0) return { x: GAME_CONFIG.WIDTH / 2, y: -300 };
    if (s <= 0) {
      const p0 = pts[0];
      return {
        x: p0.x + this.slitherEntryTangent.dx * s,
        y: p0.y + this.slitherEntryTangent.dy * s
      };
    }
    if (s >= this.slitherTotalArc) {
      const pLast = pts[pts.length - 1];
      const over = s - this.slitherTotalArc;
      return {
        x: pLast.x + this.slitherExitTangent.dx * over,
        y: pLast.y + this.slitherExitTangent.dy * over
      };
    }
    // 単調増加配列なので二分探索で補間
    let lo = 0;
    let hi = pts.length - 1;
    while (lo + 1 < hi) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].s <= s) lo = mid;
      else hi = mid;
    }
    const a = pts[lo];
    const b = pts[hi];
    const span = Math.max(0.0001, b.s - a.s);
    const t = (s - a.s) / span;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t
    };
  }

  updateSlitherSegments(headS) {
    for (let i = 0; i < this.segmentCount; i++) {
      const pt = this.sampleSlitherPoint(headS - this.cumDists[i]);
      this.segments[i].x = pt.x;
      this.segments[i].y = pt.y;
    }
  }

  computeTongueTargetGeometry(targetX, extensionRatio, pullOffset = 0, aimAngle = this.headAngle, swayAmp = this.currentSwayAmp) {
    const { PADDLE } = GAME_CONFIG;
    this.updateHangingGeometry(aimAngle, swayAmp, pullOffset);
    const head = this.segments[0];
    const dx = targetX - head.x;
    const dy = PADDLE.Y - head.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    const startX = head.x + ux * (head.r * 0.72);
    const startY = head.y + uy * (head.r * 0.72);
    const fullEndX = targetX + ux * 12;
    const fullEndY = PADDLE.Y + uy * 12;
    this.tongueStartX = startX;
    this.tongueStartY = startY;
    this.tongueTipX = startX + (fullEndX - startX) * extensionRatio;
    this.tongueTipY = startY + (fullEndY - startY) * extensionRatio;
    this.tongueProgress = extensionRatio;
  }

  damagePaddlesAlongSegmentList(paddles, circles, damage, onDamagePaddle, effectsManager) {
    const { COLORS } = GAME_CONFIG;
    if (!onDamagePaddle) return;
    for (const p of paddles) {
      if (!p || p.hp <= 0 || p.invincibleTimer > 0 || this.attackHitSlots.has(p.slot)) continue;
      const pLeft = p.x - p.currentWidth / 2;
      const pRight = p.x + p.currentWidth / 2;
      const pTop = p.y - p.height / 2;
      const pBottom = p.y + p.height / 2;
      for (const c of circles) {
        const closestX = ColorUtils.clamp(c.x, pLeft, pRight);
        const closestY = ColorUtils.clamp(c.y, pTop, pBottom);
        const dx = c.x - closestX;
        const dy = c.y - closestY;
        if (dx * dx + dy * dy <= c.r * c.r) {
          this.attackHitSlots.add(p.slot);
          onDamagePaddle(p, damage);
          if (effectsManager) {
            effectsManager.spawnCircleParticles(closestX, closestY, COLORS.red, 10, 45, 165);
          }
          break;
        }
      }
    }
  }

  spawnSummonedEnemies(enemies) {
    const { WIDTH } = GAME_CONFIG;
    if (!this.stageEnemies || this.stageEnemies.length === 0) return;

    const count = 2 + Math.floor(Math.random() * 3); // 2〜4体
    const margin = 64;
    const usableW = WIDTH - margin * 2;
    const sliceW = usableW / count;
    const sliceIndices = Array.from({ length: count }, (_, idx) => idx);
    for (let i = sliceIndices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [sliceIndices[i], sliceIndices[j]] = [sliceIndices[j], sliceIndices[i]];
    }

    let delay = 0;
    for (let i = 0; i < count; i++) {
      const slotIdx = sliceIndices[i];
      const spawnX = margin + sliceW * slotIdx + (0.2 + Math.random() * 0.6) * sliceW;
      const typeName = this.stageEnemies[Math.floor(Math.random() * this.stageEnemies.length)];
      if (i > 0) {
        delay += 0.35 + Math.random() * 0.65;
      }
      if (delay <= 0) {
        this.spawnSingleSummonedEnemy(typeName, spawnX, enemies);
      } else {
        this.pendingSummons.push({ typeName, spawnX, delay });
      }
    }
  }

  spawnSingleSummonedEnemy(typeName, spawnX, enemies) {
    if (enemies.length >= this.spawnLimit) return;
    const def = ENEMIES[typeName];
    if (!def) return;
    enemies.push(new Enemy(def, spawnX));
  }

  fireSpadeExplodeShot(angle, enemyBullets, effectsManager, onBarrageSpawn) {
    const { COLORS } = GAME_CONFIG;
    const head = this.segments[0];
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const spawnX = head.x + ux * (head.r * 0.78);
    const spawnY = head.y + uy * (head.r * 0.78);
    const speed = 215;
    const explodeY = 485;

    const bullet = {
      x: spawnX,
      y: spawnY,
      vx: ux * speed,
      vy: uy * speed,
      angle,
      speed,
      damage: 2,
      timer: 0,
      shape: 'spade',
      explodeY,
      explodeCount: 12
    };
    enemyBullets.push(bullet);

    if (onBarrageSpawn) {
      onBarrageSpawn([bullet]);
    }
    if (effectsManager) {
      effectsManager.spawnCircleParticles(spawnX, spawnY, COLORS.white, 8, 40, 130);
    }
  }

  scatterDiveBullets(enemyBullets, onBarrageSpawn, spawnY = null) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    const head = this.segments[0];
    const safeMaxY = PADDLE.Y - 20;
    const y = Math.min(spawnY !== null ? spawnY : head.y, safeMaxY);
    if (y < 0 || y > safeMaxY) return;

    const decelDuration = 0.4;
    const waitAfterDecel = 0.6; // decelDuration(0.4s) + wait(0.6s) = 出現からちょうど1.0s後に加速開始
    const spawned = [];
    for (const side of [-1, 1]) {
      const spawnX = ColorUtils.clamp(head.x + side * (head.r * 0.65), 24, WIDTH - 24);
      const maxTravel = side < 0 ? Math.max(0, spawnX - 20) : Math.max(0, WIDTH - 20 - spawnX);
      const initVx = side * Math.min(300, maxTravel / (decelDuration * 0.5));
      const initVy = 0;
      const speed = Math.abs(initVx);
      const b = {
        x: spawnX,
        y,
        vx: initVx,
        vy: initVy,
        angle: Math.atan2(initVy, initVx),
        speed,
        damage: 2,
        timer: 0,
        homingMode: 'decel',
        initVx,
        initVy,
        homingTimer: 0,
        decelDuration,
        waitAfterStop: 0,
        waitTarget: waitAfterDecel,
        accel: 520,
        maxSpeed: 540
      };
      enemyBullets.push(b);
      spawned.push(b);
    }
    if (onBarrageSpawn && spawned.length > 0) {
      onBarrageSpawn(spawned);
    }
  }

  updateAfterimages(dt) {
    const { HEIGHT } = GAME_CONFIG;
    if (this.phase === 'dive_strike') {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.02) {
        this.afterimageTimer = 0;
        const segs = [];
        for (let i = 0; i < this.segmentCount; i++) {
          const s = this.segments[i];
          if (s.y + s.r < -20 || s.y - s.r > HEIGHT + 20) continue;
          segs.push({ x: s.x, y: s.y, r: s.r });
        }
        if (segs.length > 0) {
          this.afterimages.push({ segs, alpha: 0.55 });
        }
      }
    }
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.4;
      if (this.afterimages[i].alpha <= 0) {
        this.afterimages.splice(i, 1);
      }
    }
  }

  update(dt, context) {
    const { PADDLE, HEIGHT } = GAME_CONFIG;
    const {
      paddles = [],
      enemies = [],
      enemyBullets = [],
      effectsManager,
      onDamagePaddle,
      onScreenShake,
      onBarrageSpawn
    } = context || {};

    this.idleClock += dt;
    this.updateAfterimages(dt);
    if (this.hitCooldown > 0) {
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    }

    if (this.isDefeated()) {
      this.pendingSummons = [];
      if (this.phase !== 'defeated') {
        this.startDefeatAnimation();
      }
      const duration = this.defeatDuration || 5.0;
      this.phaseTimer += dt;
      this.defeatVibClock += dt;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      const retractEase = 0.35 * u + 0.65 * (u * u * (3 - 2 * u));
      this.updateDefeatVibration();

      const startList = this.defeatStartSegments || this.segments;
      for (let i = 0; i < this.segmentCount; i++) {
        const base = startList[i] || this.segments[i];
        const targetY = -120 - this.cumDists[i];
        this.segments[i].x = base.x + this.headShakeX;
        this.segments[i].y = base.y + (targetY - base.y) * retractEase + this.headShakeY;
      }

      if (onScreenShake && this.phaseTimer < duration) {
        onScreenShake(0.08, 2.0 * (1 - 0.45 * u));
      }

      if (effectsManager && this.phaseTimer < duration) {
        this.defeatSmokeTimer -= dt;
        const smokeColors = ['#ffffff', '#d8d8d8', '#a8a8a8'];
        const visibleSegs = this.segments.filter((s) => s.y + s.r > -10 && s.y - s.r < HEIGHT);
        while (this.defeatSmokeTimer <= 0) {
          this.defeatSmokeTimer += 0.065;
          if (visibleSegs.length > 0) {
            const pick = visibleSegs[Math.floor(Math.random() * visibleSegs.length)];
            const a = Math.random() * Math.PI * 2;
            const d = Math.random() * pick.r * 0.85;
            const sx = pick.x + Math.cos(a) * d;
            const sy = Math.max(-12, pick.y + Math.sin(a) * d);
            effectsManager.spawnPulse({
              kind: 'circle',
              x: sx,
              y: sy,
              radius: 14 + Math.random() * 20,
              color: smokeColors[Math.floor(Math.random() * smokeColors.length)],
              duration: 0.65 + Math.random() * 0.45,
              maxScale: 2.2 + Math.random() * 1.1
            });
          }
        }
      }
      return;
    }

    if (this.introProgress < 1) {
      this.updateHangingGeometry(0, 0.08);
      return;
    }

    // 召喚予約された敵を揺らぎのあるタイミングで出現
    for (let i = this.pendingSummons.length - 1; i >= 0; i--) {
      const pending = this.pendingSummons[i];
      pending.delay -= dt;
      if (pending.delay <= 0) {
        this.spawnSingleSummonedEnemy(pending.typeName, pending.spawnX, enemies);
        this.pendingSummons.splice(i, 1);
      }
    }

    this.phaseTimer += dt;

    if (this.phase === 'cooldown') {
      this.bodyOffsetY *= Math.pow(0.001, dt);
      this.headThrustOffsetY *= Math.pow(0.001, dt);
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 6);
      this.currentSwayAmp += (0.08 - this.currentSwayAmp) * Math.min(1, dt * 4.5);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= this.cooldownDuration) {
        if (this.nextAction === 'start_cycle') {
          this.startTongueCycle(paddles);
        } else if (this.nextAction === 'retract_phase') {
          this.startRetractPhase();
        } else if (this.nextAction === 'spread_barrage') {
          this.startSpreadBarragePhase();
        } else if (this.nextAction === 'summon') {
          this.startSummonPhase();
        } else {
          this.startTongueCycle(paddles);
        }
      }
    } else if (this.phase === 'aim') {
      this.aimTargetX = this.resolveTrackedPaddleX(paddles);
      const targetAngle = ColorUtils.clamp(
        Math.atan2(this.aimTargetX - this.pivotX, PADDLE.Y - this.restHeadY) * 0.85,
        -0.45,
        0.45
      );
      this.headAngle += (targetAngle - this.headAngle) * Math.min(1, dt * 9);
      this.currentSwayAmp += (0.02 - this.currentSwayAmp) * Math.min(1, dt * 6);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= this.aimDuration) {
        this.lockedTargetX = this.aimTargetX;
        this.phase = 'charging';
        this.phaseTimer = 0;
        this.blinking = true;
        this.blinkTimer = 0;
      }
    } else if (this.phase === 'charging') {
      this.blinking = true;
      this.blinkTimer = this.phaseTimer;
      const u = ColorUtils.clamp(this.phaseTimer / 1.0, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      const targetAngle = ColorUtils.clamp(
        Math.atan2(this.lockedTargetX - this.pivotX, PADDLE.Y - this.restHeadY) * 0.85,
        -0.45,
        0.45
      );
      this.headAngle += (targetAngle - this.headAngle) * Math.min(1, dt * 12);
      this.currentSwayAmp += (0 - this.currentSwayAmp) * Math.min(1, dt * 10);
      // 少し首を引いて舌の先端を覗かせる
      this.computeTongueTargetGeometry(this.lockedTargetX, 0.06 * eased, -20 * eased, this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 1.0) {
        this.blinking = false;
        this.phase = 'tongue_strike';
        this.phaseTimer = 0;
        this.tongueStrikeActive = true;
        this.attackHitSlots = new Set();
      }
    } else if (this.phase === 'tongue_strike') {
      this.tongueStrikeActive = true;
      const u = ColorUtils.clamp(this.phaseTimer / 0.17, 0, 1);
      const strikeT = u * (2 - u);
      const targetAngle = ColorUtils.clamp(
        Math.atan2(this.lockedTargetX - this.pivotX, PADDLE.Y - this.restHeadY) * 0.85,
        -0.45,
        0.45
      );
      this.headAngle += (targetAngle - this.headAngle) * Math.min(1, dt * 14);
      this.currentSwayAmp += (0 - this.currentSwayAmp) * Math.min(1, dt * 12);
      this.computeTongueTargetGeometry(
        this.lockedTargetX,
        Math.max(0.06, strikeT),
        -20 * (1 - strikeT),
        this.headAngle,
        this.currentSwayAmp
      );

      // 舌線分に沿った円群でダメージ判定 (4ダメージ)
      const samples = 6;
      const tongueCircles = [];
      for (let i = 1; i <= samples; i++) {
        const s = i / samples;
        tongueCircles.push({
          x: this.tongueStartX + (this.tongueTipX - this.tongueStartX) * s,
          y: this.tongueStartY + (this.tongueTipY - this.tongueStartY) * s,
          r: 12
        });
      }
      this.damagePaddlesAlongSegmentList(paddles, tongueCircles, 4, onDamagePaddle, effectsManager);

      if (this.phaseTimer >= 0.17) {
        this.tongueStrikeActive = false;
        this.phase = 'tongue_retract';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'tongue_retract') {
      this.tongueStrikeActive = false;
      const tongueU = ColorUtils.clamp(this.phaseTimer / 0.42, 0, 1);
      const retractT = 1 - Math.pow(1 - tongueU, 3);
      // 舌を引っ込めつつ滑らかに角度と揺れを基本姿勢へ戻し、cooldown遷移時のカクつきをなくす
      const angleRate = this.phaseTimer < 0.22 ? 1.5 : 5.5;
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * angleRate);
      this.currentSwayAmp += (0.04 - this.currentSwayAmp) * Math.min(1, dt * 4.5);
      this.computeTongueTargetGeometry(
        this.lockedTargetX,
        Math.max(0, 1 - retractT),
        0,
        this.headAngle,
        this.currentSwayAmp
      );

      if (this.phaseTimer >= 0.56) {
        this.tongueProgress = 0;
        this.enterCooldown(this.attackCooldown, 'retract_phase');
      }
    } else if (this.phase === 'retract') {
      const u = ColorUtils.clamp(this.phaseTimer / 0.55, 0, 1);
      const eased = u * u * (3 - 2 * u);
      this.bodyOffsetY = -260 * eased;
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 6);
      this.currentSwayAmp += (0.02 - this.currentSwayAmp) * Math.min(1, dt * 6);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 0.55) {
        this.phase = 'hidden_wait';
        this.phaseTimer = 0;
        this.placeVerticalStack(GAME_CONFIG.WIDTH / 2, -90);
      }
    } else if (this.phase === 'hidden_wait') {
      this.placeVerticalStack(GAME_CONFIG.WIDTH / 2, -90);
      if (this.phaseTimer >= 3.0) {
        this.attackHitSlots = new Set();
        if (Math.random() < 0.5) {
          // 2a: ランダムなプレイヤーの位置へ上から1秒顔を出して急降下
          const target = this.pickRandomAlivePaddle(paddles);
          this.diveX = ColorUtils.clamp(target ? target.x : GAME_CONFIG.WIDTH / 2, 60, GAME_CONFIG.WIDTH - 60);
          this.phase = 'dive_peek';
          this.phaseTimer = 0;
          this.blinking = true;
          this.blinkTimer = 0;
        } else {
          // 2b: 右・左のどちらかから大きなサイン波で進行
          this.initSlitherPath();
          this.phase = 'slither_telegraph';
          this.phaseTimer = 0;
          this.blinking = true;
          this.blinkTimer = 0;
        }
      }
    } else if (this.phase === 'dive_peek') {
      this.blinking = true;
      this.blinkTimer = this.phaseTimer;
      const u = ColorUtils.clamp(this.phaseTimer / 0.28, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      const peekY = -80 + (100 - -80) * eased;
      this.placeVerticalStack(this.diveX, peekY);

      if (this.phaseTimer >= 1.0) {
        this.blinking = false;
        this.phase = 'dive_strike';
        this.phaseTimer = 0;
        this.diveBulletPairIdx = 0;
        this.afterimages = [];
        this.afterimageTimer = 0;
      }
    } else if (this.phase === 'dive_strike') {
      const duration = 1.05;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      const startY = 100;
      const endY = HEIGHT + this.bodyLength + 120;
      const curHeadY = startY + (endY - startY) * u;
      const rampIn = Math.min(1, this.phaseTimer / 0.1);
      for (let i = 0; i < this.segmentCount; i++) {
        const y = curHeadY - this.cumDists[i];
        const wiggle = Math.sin(this.phaseTimer * 28 - i * 0.52) * 38 * rampIn;
        this.segments[i].x = this.diveX + wiggle;
        this.segments[i].y = y;
      }

      const scatterYs = [100, 200, 300, 400, 500, 600, 700, 800];
      const safeMaxY = PADDLE.Y - 20;
      const head = this.segments[0];
      while (this.diveBulletPairIdx < scatterYs.length && head.y >= scatterYs[this.diveBulletPairIdx]) {
        const targetY = scatterYs[this.diveBulletPairIdx];
        this.diveBulletPairIdx += 1;
        if (targetY <= safeMaxY) {
          this.scatterDiveBullets(enemyBullets, onBarrageSpawn, targetY);
        }
      }

      // 急降下中にパドルへ触れたら4ダメージ
      this.damagePaddlesAlongSegmentList(paddles, this.segments, 4, onDamagePaddle, effectsManager);

      if (this.phaseTimer >= duration) {
        this.phase = 'reenter';
        this.phaseTimer = 0;
        this.bodyOffsetY = -260;
        this.headAngle = 0;
        this.currentSwayAmp = 0;
      }
    } else if (this.phase === 'slither_telegraph') {
      this.blinking = true;
      this.blinkTimer = this.phaseTimer;
      const u = ColorUtils.clamp(this.phaseTimer / 0.25, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.slitherArcPos = 76 * eased;
      this.updateSlitherSegments(this.slitherArcPos);

      if (this.phaseTimer >= 0.55) {
        this.blinking = false;
        this.phase = 'slither';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'slither') {
      this.slitherArcPos += this.slitherSpeed * dt;
      this.updateSlitherSegments(this.slitherArcPos);

      // 頭部接触4ダメージ・胴体接触2ダメージ (頭部を優先判定)
      this.damagePaddlesAlongSegmentList(paddles, [this.segments[0]], 4, onDamagePaddle, effectsManager);
      this.damagePaddlesAlongSegmentList(paddles, this.segments.slice(1), 2, onDamagePaddle, effectsManager);

      if (this.slitherArcPos - this.bodyLength > this.slitherTotalArc + 50) {
        this.phase = 'reenter';
        this.phaseTimer = 0;
        this.bodyOffsetY = -260;
        this.headAngle = 0;
        this.currentSwayAmp = 0;
      }
    } else if (this.phase === 'reenter') {
      const u = ColorUtils.clamp(this.phaseTimer / 0.6, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.bodyOffsetY = -260 * (1 - eased);
      this.currentSwayAmp += (0.08 - this.currentSwayAmp) * Math.min(1, dt * 5);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 0.6) {
        this.bodyOffsetY = 0;
        this.enterCooldown(this.attackCooldown, 'spread_barrage');
      }
    } else if (this.phase === 'spread_pull') {
      const aimAngle = ColorUtils.clamp((Math.PI / 2 - this.activeBarrageAngle) * 0.7, -0.42, 0.42);
      this.headAngle += (aimAngle - this.headAngle) * Math.min(1, dt * 12);
      this.currentSwayAmp += (0.02 - this.currentSwayAmp) * Math.min(1, dt * 8);
      const u = ColorUtils.clamp(this.phaseTimer / 0.36, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.headThrustOffsetY = -34 * eased;
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 0.36) {
        this.phase = 'spread_thrust';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'spread_thrust') {
      const u = ColorUtils.clamp(this.phaseTimer / 0.15, 0, 1);
      const eased = u * u;
      this.headThrustOffsetY = -34 + (34 - -34) * eased;
      this.currentSwayAmp += (0.02 - this.currentSwayAmp) * Math.min(1, dt * 8);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 0.15) {
        this.headThrustOffsetY = 34;
        this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);
        this.fireSpadeExplodeShot(this.activeBarrageAngle, enemyBullets, effectsManager, onBarrageSpawn);
        this.phase = 'spread_recover';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'spread_recover') {
      const u = ColorUtils.clamp(this.phaseTimer / 0.34, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.headThrustOffsetY = 34 * (1 - eased);
      this.currentSwayAmp += (0.04 - this.currentSwayAmp) * Math.min(1, dt * 6);
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (this.phaseTimer >= 0.34) {
        this.headThrustOffsetY = 0;
        if (this.barrageAngles.length > 0) {
          this.activeBarrageAngle = this.barrageAngles.shift();
          this.phase = 'spread_pull';
          this.phaseTimer = 0;
        } else {
          this.enterCooldown(this.attackCooldown, 'summon');
        }
      }
    } else if (this.phase === 'summon') {
      this.headAngle += (0 - this.headAngle) * Math.min(1, dt * 8);
      this.currentSwayAmp += (0.08 - this.currentSwayAmp) * Math.min(1, dt * 5);
      const env = Math.sin(ColorUtils.clamp(this.phaseTimer / 1.25, 0, 1) * Math.PI);
      this.bodyOffsetY = Math.sin(this.phaseTimer * 42) * 14 * env;
      this.updateHangingGeometry(this.headAngle, this.currentSwayAmp);

      if (onScreenShake) {
        onScreenShake(0.08, 4.2);
      }

      if (!this.summonTriggered && this.phaseTimer >= 0.82) {
        this.summonTriggered = true;
        this.spawnSummonedEnemies(enemies);
      }

      if (this.phaseTimer >= 1.25) {
        this.bodyOffsetY = 0;
        this.enterCooldown(this.attackCooldown, 'start_cycle');
      }
    }
  }

  applyDamageAtSegment(segIndex, pulseColor, effectsManager, onScore, cooldown = 0.08) {
    if (this.hp <= 0 || this.hitCooldown > 0) return false;
    const { COLORS } = GAME_CONFIG;
    this.hitCooldown = cooldown;
    this.hp = Math.max(0, this.hp - 1);

    const seg = this.segments[segIndex] || this.segments[0];
    effectsManager.spawnPulse({
      kind: 'circle',
      target: seg,
      x: seg.x,
      y: seg.y,
      radius: seg.r,
      color: pulseColor,
      duration: this.hp > 0 ? 0.42 : 0.55,
      maxScale: this.hp > 0 ? 1.55 : 2.15
    });

    if (this.hp <= 0) {
      this.startDefeatAnimation();
      effectsManager.spawnCircleParticles(seg.x, Math.max(40, seg.y), COLORS.white, 22, 60, 220);
      if (onScore) onScore(2000);
    } else if (onScore) {
      onScore(100);
    }
    return true;
  }

  handleSwingCircleCollision(cx, cy, cr, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1 || this.hitCooldown > 0) return false;
    const { COLORS, HEIGHT } = GAME_CONFIG;
    for (let i = 0; i < this.segmentCount; i++) {
      const seg = this.segments[i];
      if (seg.y + seg.r <= 0 || seg.y - seg.r >= HEIGHT) continue;
      if (Math.hypot(cx - seg.x, cy - seg.y) <= cr + seg.r) {
        return this.applyDamageAtSegment(i, COLORS.white, effectsManager, onScore, 0.22);
      }
    }
    return false;
  }

  canTakeCrackDamage() {
    return !this.isDefeated() && this.introProgress >= 1 && this.hp > 1;
  }

  applyCrackDamage(effectsManager, onScore) {
    if (!this.canTakeCrackDamage()) return null;
    const { COLORS, HEIGHT } = GAME_CONFIG;
    const visibleIndices = [];
    for (let i = 0; i < this.segmentCount; i++) {
      const seg = this.segments[i];
      if (seg && seg.y + seg.r > 0 && seg.y - seg.r < HEIGHT) {
        visibleIndices.push(i);
      }
    }
    const segIndex = visibleIndices.length > 0
      ? visibleIndices[Math.floor(Math.random() * visibleIndices.length)]
      : 0;
    this.hitCooldown = 0;
    const applied = this.applyDamageAtSegment(segIndex, COLORS.white, effectsManager, onScore, 0);
    const seg = this.segments[segIndex] || this.segments[0];
    return applied && seg ? { x: seg.x, y: seg.y } : null;
  }

  handleBallCollision(ball, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS, BALL, HEIGHT } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;
    const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

    for (let i = 0; i < this.segmentCount; i++) {
      const c = this.segments[i];
      if (c.y + c.r <= 0 || c.y - c.r >= HEIGHT) continue;
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ball.radius + c.r) {
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        this.reflectBall(ball, c.x + nx * (c.r + ball.radius + 2), c.y + ny * (c.r + ball.radius + 2), nx, ny, BALL);
        this.applyDamageAtSegment(i, pulseColor, effectsManager, onScore, 0.08);
        return true;
      }
    }
    return false;
  }

  reflectBall(ball, newX, newY, nx, ny, BALL) {
    ball.spawningFromCenter = false;
    const prevVy = ball.vy;
    const speed = Math.hypot(ball.vx, ball.vy) || BALL.BASE_SPEED;
    ball.vx = nx * speed;
    ball.vy = ny * speed;
    if (ball.effects.yellow <= 0) {
      ball.clampVerticalAngle(speed);
    } else if (ball.effects.green > 0 && prevVy < 0 && ball.vy > 0) {
      ball.vy /= BALL.GREEN_SPEED_MULTIPLIER;
    }
    ball.x = ColorUtils.clamp(newX, ball.radius, GAME_CONFIG.WIDTH - ball.radius);
    ball.y = Math.max(ball.radius, newY);
  }

  render(ctx) {
    if (this.isDefeated() && !this.isDefeating()) return;
    const { COLORS, ENEMY, HEIGHT } = GAME_CONFIG;

    let strokeColor = COLORS.white;
    if (this.blinking) {
      const cycle = (this.blinkTimer || 0) % ENEMY.BLINK_CYCLE;
      strokeColor = cycle < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
    }

    // 0. 高速降下時の緑ボール風ブラー残像を描画
    for (const ai of this.afterimages) {
      ctx.save();
      ctx.globalAlpha = ai.alpha * 0.42;
      ctx.fillStyle = COLORS.white;
      for (let i = ai.segs.length - 1; i >= 0; i--) {
        const seg = ai.segs[i];
        ctx.beginPath();
        ctx.arc(seg.x, seg.y, seg.r * 0.92, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 1. 舌が伸びているときは二股のヘビ舌を描画（頭部の後ろ/口元から伸ばす）
    if (this.tongueProgress > 0.01) {
      const x0 = this.tongueStartX;
      const y0 = this.tongueStartY;
      const x1 = this.tongueTipX;
      const y1 = this.tongueTipY;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      if (len > 2) {
        const ux = dx / len;
        const uy = dy / len;
        const nx = -uy;
        const ny = ux;
        const forkLen = Math.min(20, len * 0.25);
        const forkBaseX = x1 - ux * forkLen;
        const forkBaseY = y1 - uy * forkLen;
        const baseHalf = 6.5;
        const midHalf = 4.2;
        const tipSpread = 11;

        ctx.save();
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = this.blinking ? strokeColor : COLORS.white;
        ctx.lineWidth = 2.6;
        ctx.lineJoin = 'miter';
        ctx.beginPath();
        ctx.moveTo(x0 + nx * baseHalf, y0 + ny * baseHalf);
        ctx.lineTo(forkBaseX + nx * midHalf, forkBaseY + ny * midHalf);
        ctx.lineTo(x1 + nx * tipSpread, y1 + ny * tipSpread);
        ctx.lineTo(forkBaseX + ux * (forkLen * 0.32), forkBaseY + uy * (forkLen * 0.32));
        ctx.lineTo(x1 - nx * tipSpread, y1 - ny * tipSpread);
        ctx.lineTo(forkBaseX - nx * midHalf, forkBaseY - ny * midHalf);
        ctx.lineTo(x0 - nx * baseHalf, y0 - ny * baseHalf);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
    }

    // 2. 尻尾(14) -> 頭(0)の順に重ねて描画（大きい頭部が前面に来る）
    ctx.save();
    ctx.fillStyle = '#000000';
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.8;
    for (let i = this.segmentCount - 1; i >= 0; i--) {
      const seg = this.segments[i];
      if (seg.y + seg.r < -20 || seg.y - seg.r > HEIGHT + 20) continue;
      ctx.beginPath();
      ctx.arc(seg.x, seg.y, seg.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  serialize() {
    const r1 = (v) => Math.round(v * 10) / 10;
    const r2 = (v) => Math.round(v * 100) / 100;
    return [
      'snake',
      this.phase,
      r2(this.phaseTimer),
      r2(this.introProgress),
      this.hp,
      this.maxHp,
      this.blinking ? 1 : 0,
      r2(this.blinkTimer || 0),
      r2(this.tongueProgress || 0),
      r1(this.tongueStartX),
      r1(this.tongueStartY),
      r1(this.tongueTipX),
      r1(this.tongueTipY),
      this.segments.map((s) => [r1(s.x), r1(s.y)])
    ];
  }

  captureInterpState() {
    return {
      introProgress: this.introProgress,
      tongueProgress: this.tongueProgress,
      tongueStartX: this.tongueStartX,
      tongueStartY: this.tongueStartY,
      tongueTipX: this.tongueTipX,
      tongueTipY: this.tongueTipY,
      segs: this.segments.map((s) => [s.x, s.y])
    };
  }

  applySnapshotStateImmediate(fields) {
    this.introProgress = fields.introProgress;
    this.tongueProgress = fields.tongueProgress;
    this.tongueStartX = fields.tongueStartX;
    this.tongueStartY = fields.tongueStartY;
    this.tongueTipX = fields.tongueTipX;
    this.tongueTipY = fields.tongueTipY;
    for (let i = 0; i < this.segmentCount; i++) {
      const pt = fields.segs[i];
      if (pt) {
        this.segments[i].x = pt[0];
        this.segments[i].y = pt[1];
      }
    }
  }

  updateClient(dt) {
    if (this._hasSnapInterp && this._interpFrom && this._interpTo) {
      this._interpElapsed += dt;
      const alpha = this._interpDuration > 0 ? Math.min(1, this._interpElapsed / this._interpDuration) : 1;
      const lerp = (a, b) => a + (b - a) * alpha;
      const from = this._interpFrom;
      const to = this._interpTo;
      const segs = new Array(this.segmentCount);
      for (let i = 0; i < this.segmentCount; i++) {
        segs[i] = [
          lerp(from.segs[i][0], to.segs[i][0]),
          lerp(from.segs[i][1], to.segs[i][1])
        ];
      }
      this.applySnapshotStateImmediate({
        introProgress: lerp(from.introProgress, to.introProgress),
        tongueProgress: lerp(from.tongueProgress, to.tongueProgress),
        tongueStartX: lerp(from.tongueStartX, to.tongueStartX),
        tongueStartY: lerp(from.tongueStartY, to.tongueStartY),
        tongueTipX: lerp(from.tongueTipX, to.tongueTipX),
        tongueTipY: lerp(from.tongueTipY, to.tongueTipY),
        segs
      });
    }

    if (this.blinking) {
      this.blinkTimer = (this.blinkTimer || 0) + dt;
    }

    this.updateAfterimages(dt);

    if (this.phase === 'defeated' || this.isDefeated()) {
      this.phase = 'defeated';
      this.defeatVibClock = (this.defeatVibClock || 0) + dt;
      this.updateDefeatVibration();
    } else {
      this.headShakeX = 0;
      this.headShakeY = 0;
    }
  }

  applySnapshot(data, interpDuration = null) {
    if (!Array.isArray(data) || data[0] !== 'snake') return;
    const [
      ,
      phase,
      phaseTimer,
      introProgress,
      hp,
      maxHp,
      blinking,
      blinkTimer,
      tongueProgress,
      tongueStartX,
      tongueStartY,
      tongueTipX,
      tongueTipY,
      segs
    ] = data;

    this.phase = phase || 'cooldown';
    this.phaseTimer = phaseTimer || 0;
    this.hp = hp;
    this.maxHp = maxHp;

    const wasBlink = this.blinking;
    this.blinking = !!blinking;
    if (!this.blinking || !wasBlink || interpDuration === null) {
      this.blinkTimer = blinkTimer || 0;
    }

    const targetState = {
      introProgress: introProgress !== undefined ? introProgress : 1,
      tongueProgress: tongueProgress || 0,
      tongueStartX: tongueStartX || 0,
      tongueStartY: tongueStartY || 0,
      tongueTipX: tongueTipX || 0,
      tongueTipY: tongueTipY || 0,
      segs: Array.from({ length: this.segmentCount }, (_, i) => (
        Array.isArray(segs) && segs[i] ? segs[i] : [this.segments[i].x, this.segments[i].y]
      ))
    };

    if (!this._hasSnapInterp || !(interpDuration > 0)) {
      this._hasSnapInterp = true;
      this.applySnapshotStateImmediate(targetState);
      this._interpFrom = this.captureInterpState();
      this._interpTo = this.captureInterpState();
      this._interpElapsed = 1;
      this._interpDuration = interpDuration || 0.042;
      return;
    }

    this._interpFrom = this.captureInterpState();
    this._interpTo = targetState;
    this._interpElapsed = 0;
    this._interpDuration = interpDuration;
  }
}

/**
 * ステージ30「cloud」ボス: 画面上部横いっぱいに広がる雲（結合された黒丸群）
 */
class CloudBoss {
  constructor(stageData, playerCount = 1) {
    const { WIDTH } = GAME_CONFIG;
    this.netKind = 'boss';
    this.id = 'cloud';
    this.name = (stageData && stageData.name) || 'cloud';
    this.stageEnemies = (stageData && Array.isArray(stageData.enemies) && stageData.enemies.length > 0)
      ? stageData.enemies
      : ['arrow', 'wide_arrow', 'sparkle', 'scissors'];
    this.spawnLimit = (stageData && stageData.spawn_limit) || 7;

    const hpScale = getBossHpScaleForCount(playerCount);
    this.maxHp = Math.round(100 * hpScale);
    this.hp = this.maxHp;
    this.hitCooldown = 0;

    this.attackCooldown = 5.0;
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = this.attackCooldown;
    this.cycleStep = 0; // 0:小雨弾, 1:レーザー予告->赤白稲妻, 2:敵3-5体召喚, 3:霧5秒展開(20秒持続), 4:ダメージ箱(&アイテム)落下

    // 雲を構成する丸群（横いっぱいに重なりをもって配置）
    this.basePuffs = [
      { bx: 8, by: 36, r: 72, phase: 0.2, bob: 2.2 },
      { bx: 94, by: 30, r: 76, phase: 0.9, bob: 2.4 },
      { bx: 190, by: 34, r: 74, phase: 1.7, bob: 2.1 },
      { bx: 292, by: 28, r: 80, phase: 2.4, bob: 2.5 },
      { bx: 396, by: 30, r: 78, phase: 3.1, bob: 2.3 },
      { bx: 500, by: 28, r: 80, phase: 3.9, bob: 2.4 },
      { bx: 602, by: 34, r: 74, phase: 4.6, bob: 2.1 },
      { bx: 696, by: 30, r: 76, phase: 5.3, bob: 2.4 },
      { bx: 774, by: 38, r: 72, phase: 6.0, bob: 2.2 },
      // 下側の丸い膨らみ列
      { bx: 52, by: 88, r: 58, phase: 0.7, bob: 2.8 },
      { bx: 148, by: 96, r: 64, phase: 1.5, bob: 3.0 },
      { bx: 248, by: 90, r: 60, phase: 2.2, bob: 2.6 },
      { bx: 350, by: 102, r: 68, phase: 3.0, bob: 3.1 },
      { bx: 454, by: 94, r: 62, phase: 3.8, bob: 2.7 },
      { bx: 556, by: 100, r: 66, phase: 4.5, bob: 3.0 },
      { bx: 656, by: 90, r: 60, phase: 5.2, bob: 2.7 },
      { bx: 742, by: 88, r: 58, phase: 5.9, bob: 2.8 }
    ];
    this.puffs = this.basePuffs.map((p, idx) => ({
      x: p.bx,
      y: p.by,
      r: p.r,
      scale: 1,
      netKind: 'boss_circle',
      id: 200 + idx
    }));

    // イントロ演出: 各円を50msごとにランダムな順番でスケールインさせてから行動開始
    this.puffIntroInterval = 0.05;
    this.puffScaleDuration = 0.28;
    this.introDuration = (this.basePuffs.length - 1) * this.puffIntroInterval + this.puffScaleDuration;
    this.introSeed = Math.floor(Math.random() * 65535) || 1;
    this.puffIntroRank = this.buildPuffIntroRank(this.introSeed);
    this.introProgress = 1;
    this.introElapsed = this.introDuration;
    this.introOffsetY = 0;

    this.idleClock = 0;
    this.trembleAmp = 0;
    this.bodyOffsetY = 0;
    this.defeatDuration = 5.0;
    this.defeatSmokeTimer = 0;
    this.defeatStartOffsetY = 0;

    // 攻撃用ステート
    this.rainSpawnTimer = 0;
    this._lastRainX = -999;
    this.lightningBolts = []; // [{ x, seed }, ...]
    this.attackHitSlots = new Set();
    this.pendingSummons = [];
    this.summonTriggered = false;
    this.pendingBoxDrops = [];
    this.boxDropTriggered = false;

    // 霧ステート（5秒かけて展開 -> 20秒持続 -> 1.5秒フェードアウト）
    this.fogLevel = 0;
    this.fogHoldTimer = 0;
    this.fogRampActive = false;
    this.fogRampTimer = 0;
    this.fogClusters = this.buildFogClusters();

    this._hasSnapInterp = false;
    this._interpFrom = null;
    this._interpTo = null;
    this._interpElapsed = 0;
    this._interpDuration = 0.042;
    this._lastGuestPhase = 'cooldown';
  }

  buildPuffIntroRank(seed) {
    const n = this.basePuffs.length;
    const order = Array.from({ length: n }, (_, idx) => idx);
    let s = ((seed || 1) ^ 0x9e3779b9) >>> 0;
    const nextRand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s & 0xffff) / 0x10000;
    };
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(nextRand() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const rank = new Array(n);
    for (let r = 0; r < n; r++) {
      rank[order[r]] = r;
    }
    return rank;
  }

  buildFogClusters() {
    const { WIDTH, HEIGHT } = GAME_CONFIG;
    const clusters = [];
    let s = 0x5f3759df;
    const nextRand = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return (s & 0xffff) / 0x10000;
    };
    const cols = 3;
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        const baseX = (c + 0.5) * (WIDTH / cols) + (nextRand() - 0.5) * 60;
        const baseY = 185 + r * ((HEIGHT - 240) / Math.max(1, rows - 1)) + (nextRand() - 0.5) * 40;
        const baseRadius = 110 + nextRand() * 35;
        const puffCount = 4 + (idx % 2);
        const puffs = [];
        for (let p = 0; p < puffCount; p++) {
          puffs.push({
            ox: (nextRand() - 0.5) * baseRadius * 1.4,
            oy: (nextRand() - 0.5) * baseRadius * 0.85,
            r: baseRadius * (0.75 + nextRand() * 0.45),
            alphaScale: 0.82 + nextRand() * 0.22
          });
        }
        clusters.push({
          baseX,
          baseY,
          driftVx: (idx % 2 === 0 ? 1 : -1) * (24 + nextRand() * 16),
          swayAmpX: 52 + nextRand() * 36,
          swayAmpY: 32 + nextRand() * 26,
          swayFreq: 0.48 + nextRand() * 0.32,
          phase: nextRand() * Math.PI * 2,
          densityFreq: 0.85 + nextRand() * 0.45,
          densityPhase: idx * 1.35 + nextRand() * 0.6,
          puffs
        });
      }
    }
    return clusters;
  }

  getIntroDuration() {
    return this.introDuration;
  }

  isDefeated() {
    return this.hp <= 0;
  }

  isDefeating() {
    return this.isDefeated() && this.phase === 'defeated' && this.phaseTimer < (this.defeatDuration || 5.0);
  }

  setIntroProgress(progress) {
    const u = ColorUtils.clamp(progress, 0, 1);
    if (u === 0 && this.introProgress >= 1) {
      this.introSeed = (Math.floor(Math.random() * 65535) || 1);
      this.puffIntroRank = this.buildPuffIntroRank(this.introSeed);
    }
    this.introProgress = u;
    this.introElapsed = u * this.introDuration;
    this.introOffsetY = 0;
    this.syncPuffPositions(0, 0);
  }

  startDefeatAnimation() {
    this.phase = 'defeated';
    this.phaseTimer = 0;
    this.defeatDuration = 5.0;
    this.defeatSmokeTimer = 0;
    this.defeatStartOffsetY = this.bodyOffsetY;
    this.lightningBolts = [];
    this.pendingSummons = [];
    this.pendingBoxDrops = [];
    this.fogRampActive = false;
    this.fogHoldTimer = 0;
    this.trembleAmp = 7.5;
  }

  syncPuffPositions(trembleX = 0, trembleY = 0) {
    const offsetY = this.bodyOffsetY + trembleY;
    const isIntro = this.introProgress < 1;
    const introTime = (this.introProgress || 0) * this.introDuration;
    for (let i = 0; i < this.basePuffs.length; i++) {
      const bp = this.basePuffs[i];
      let scale = 1;
      if (isIntro) {
        const rank = this.puffIntroRank ? this.puffIntroRank[i] : i;
        const startDelay = rank * this.puffIntroInterval;
        const localT = ColorUtils.clamp((introTime - startDelay) / this.puffScaleDuration, 0, 1);
        scale = 1 - Math.pow(1 - localT, 3);
      }
      const bobY = Math.sin(this.idleClock * 1.45 + bp.phase) * bp.bob;
      this.puffs[i].x = bp.bx + trembleX;
      this.puffs[i].y = bp.by + bobY + offsetY;
      this.puffs[i].scale = scale;
      this.puffs[i].r = bp.r * scale;
    }
  }

  getTrembleOffset() {
    if (this.trembleAmp <= 0.01) return { x: 0, y: 0 };
    const x = Math.sin(this.idleClock * 53.0) * this.trembleAmp;
    const y = Math.cos(this.idleClock * 47.0) * (this.trembleAmp * 0.65);
    return { x, y };
  }

  getCloudBottomAt(targetX) {
    let maxBottom = 115;
    for (const p of this.puffs) {
      if ((p.r || 0) <= 0.5) continue;
      if (Math.abs(targetX - p.x) <= p.r) {
        const dy = Math.sqrt(Math.max(0, p.r * p.r - (targetX - p.x) * (targetX - p.x)));
        maxBottom = Math.max(maxBottom, p.y + dy * 0.72);
      }
    }
    return maxBottom;
  }

  getCloudVisualBottomAt(targetX) {
    let maxBottom = 0;
    for (const p of this.puffs) {
      if ((p.r || 0) <= 0.5) continue;
      const dx = Math.abs(targetX - p.x);
      if (dx <= p.r) {
        const dy = Math.sqrt(Math.max(0, p.r * p.r - dx * dx));
        maxBottom = Math.max(maxBottom, p.y + dy);
      }
    }
    return maxBottom;
  }

  isEnemyHidden(enemy) {
    if (!enemy || this.isDefeated() || this.introProgress < 1) return false;
    const cloudBottom = this.getCloudVisualBottomAt(enemy.x);
    return enemy.y < cloudBottom + (enemy.currentRadius || 16) * 0.35;
  }

  enterCooldown(duration = this.attackCooldown) {
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = duration;
    this.lightningBolts = [];
    this.trembleAmp = 0;
  }

  startActionByIndex(actionIdx, paddles) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    const fullPaddleW = (PADDLE && PADDLE.MAX_HP && PADDLE.WIDTH_PER_HP)
      ? PADDLE.MAX_HP * PADDLE.WIDTH_PER_HP
      : 144;
    if (actionIdx === 0) {
      // 1. 雲の中から雨のように敵弾を真下へ降らせる (2ダメージ・画面端に見切れる範囲まで)
      // 100% HP用(第1)・40% HP用(第2)・20% HP用(第3)の3つの安全レーンを配置し、視覚的に安置を1箇所に偏らせない
      this.phase = 'rain_attack';
      this.phaseTimer = 0;
      this.rainSpawnTimer = 0;
      this._lastRainX = -999;
      const laneSpecs = [
        { halfW: Math.round(fullPaddleW * 0.5) + 18 },       // 第1レーン: 100% HP用 (全幅 180px)
        { halfW: Math.round(fullPaddleW * 0.4 * 0.5) + 14 }, // 第2レーン: 40% HP用  (全幅 86px)
        { halfW: Math.round(fullPaddleW * 0.2 * 0.5) + 12 }  // 第3レーン: 20% HP用  (全幅 52px)
      ];
      // 3レーンの並び順をシャッフルし、各レーン間および画面端との間に必ず48px以上の雨区間を確保して重なりを防ぐ
      const order = [0, 1, 2];
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      const orderedSpecs = order.map((idx) => laneSpecs[idx]);
      const lanesTotalW = orderedSpecs.reduce((sum, s) => sum + s.halfW * 2, 0);
      const minWall = 48;
      const flexWallTotal = Math.max(0, WIDTH - lanesTotalW - minWall * 4);
      const wallWeights = Array.from({ length: 4 }, () => 0.35 + Math.random());
      const wallWeightSum = wallWeights.reduce((a, b) => a + b, 0) || 1;
      const walls = wallWeights.map((w) => minWall + (w / wallWeightSum) * flexWallTotal);

      let cursorX = walls[0];
      const placedLanes = [];
      for (let i = 0; i < orderedSpecs.length; i++) {
        const spec = orderedSpecs[i];
        const centerX = cursorX + spec.halfW;
        placedLanes[order[i]] = { x: centerX, halfW: spec.halfW };
        cursorX = centerX + spec.halfW + walls[i + 1];
      }
      this.rainSafeLanes = placedLanes;
      this.rainSafeX = this.rainSafeLanes[0].x;
      this.trembleAmp = 2.2;
    } else if (actionIdx === 1) {
      // 2. 2秒間レーザー線表示(500ms前に赤くなり始める) -> 真下に赤白の稲妻を同タイミング複数発 (4ダメージ)
      // 100% HP用(第1)・40% HP用(第2)・20% HP用(第3)の3つの安全レーンを確保しつつ高密度に配置する
      const count = 8 + Math.floor(Math.random() * 2); // 8 ~ 9本
      const boltHalfW = 11;
      const gap1 = fullPaddleW + boltHalfW * 2 + 34 + Math.random() * 14;       // 実効 ~178-192px (100% HP)
      const gap2 = fullPaddleW * 0.4 + boltHalfW * 2 + 24 + Math.random() * 12; // 実効 ~82-94px   (40% HP)
      const gap3 = fullPaddleW * 0.2 + boltHalfW * 2 + 18 + Math.random() * 10; // 実効 ~47-57px   (20% HP)

      const leftX = 44 + Math.random() * 24;
      const rightX = WIDTH - (44 + Math.random() * 24);
      const span = rightX - leftX;
      const gapCount = count - 1;
      const otherCount = gapCount - 3;
      const otherTotal = Math.max(otherCount * 32, span - (gap1 + gap2 + gap3));

      // ギャップのうち3つを第1・第2・第3レーンに割り当て
      const indices = Array.from({ length: gapCount }, (_, idx) => idx);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const gapByIdx = new Array(gapCount).fill(0);
      gapByIdx[indices[0]] = gap1;
      gapByIdx[indices[1]] = gap2;
      gapByIdx[indices[2]] = gap3;

      // 安全レーン外は狭い密集〜やや広い隙間までランダムな強弱をつける (40% HP未満に抑える)
      const minOther = 22;
      const maxOther = boltHalfW * 2 + fullPaddleW * 0.4 - 6; // 73px
      const flexTotal = Math.max(0, otherTotal - minOther * otherCount);
      const rawWeights = Array.from({ length: otherCount }, () => 0.05 + Math.pow(Math.random(), 1.6) * 2.5);
      const weightSum = rawWeights.reduce((a, b) => a + b, 0) || 1;
      const otherGaps = rawWeights.map((w) => minOther + (w / weightSum) * flexTotal);
      let overflow = 0;
      for (let k = 0; k < otherCount; k++) {
        if (otherGaps[k] > maxOther) {
          overflow += otherGaps[k] - maxOther;
          otherGaps[k] = maxOther;
        }
      }
      if (overflow > 0) {
        for (let k = 0; k < otherCount && overflow > 0; k++) {
          const room = maxOther - otherGaps[k];
          if (room > 0) {
            const add = Math.min(room, overflow);
            otherGaps[k] += add;
            overflow -= add;
          }
        }
      }
      for (let k = 0; k < otherCount; k++) {
        gapByIdx[indices[3 + k]] = otherGaps[k];
      }

      const bolts = [];
      let curX = leftX;
      for (let i = 0; i < count; i++) {
        bolts.push({
          x: Math.round(curX),
          seed: Math.floor(Math.random() * 65535)
        });
        if (i < gapCount) {
          curX += gapByIdx[i];
        }
      }
      this.lightningBolts = bolts;
      this.attackHitSlots = new Set();
      this.phase = 'lightning_telegraph';
      this.phaseTimer = 0;
      this.trembleAmp = 1.8;
    } else if (actionIdx === 2) {
      // 3. 雲を揺らし、上から敵を3〜5体召喚
      this.phase = 'summon';
      this.phaseTimer = 0;
      this.summonTriggered = false;
      this.trembleAmp = 8.5;
    } else if (actionIdx === 3) {
      // 4. 雲を揺らし、5秒かけて画面全体を霧で包む（20秒持続・画面揺れなし）
      this.phase = 'fog_cast';
      this.phaseTimer = 0;
      this.fogRampActive = true;
      this.fogRampTimer = 0;
      this.trembleAmp = 6.5;
    } else {
      // 5. 雲を揺らしてダメージ判定の四角形の箱（またはアイテム）をいくつか落とす
      this.phase = 'box_drop';
      this.phaseTimer = 0;
      this.boxDropTriggered = false;
      this.trembleAmp = 7.5;
    }
  }

  startNextCycleStep(paddles) {
    const step = this.cycleStep;
    this.cycleStep = (this.cycleStep + 1) % 5;
    this.startActionByIndex(step, paddles);
  }

  spawnRainBullets(enemyBullets, onBarrageSpawn) {
    const { WIDTH } = GAME_CONFIG;
    const lanes = (this.rainSafeLanes && this.rainSafeLanes.length > 0)
      ? this.rainSafeLanes
      : [{ x: this.rainSafeX !== undefined ? this.rainSafeX : WIDTH / 2, halfW: 90 }];
    const sortedLanes = [...lanes].sort((a, b) => a.x - b.x);
    const allowed = [];
    let cursor = -4;
    for (const lane of sortedLanes) {
      const lStart = lane.x - lane.halfW;
      const lEnd = lane.x + lane.halfW;
      if (lStart > cursor) {
        allowed.push([cursor, Math.min(WIDTH + 4, lStart)]);
      }
      cursor = Math.max(cursor, lEnd);
    }
    if (cursor < WIDTH + 4) {
      allowed.push([cursor, WIDTH + 4]);
    }
    const totalSpan = allowed.reduce((sum, [a, b]) => sum + Math.max(0, b - a), 0) || 1;

    const pickX = () => {
      let r = Math.random() * totalSpan;
      for (const [a, b] of allowed) {
        const len = Math.max(0, b - a);
        if (r <= len) return a + r;
        r -= len;
      }
      return -4 + Math.random() * (WIDTH + 8);
    };

    const rBurst = Math.random();
    const burst = rBurst < 0.2 ? 3 : (rBurst < 0.55 ? 2 : 1);
    const spawned = [];
    for (let k = 0; k < burst; k++) {
      const bx = pickX();
      const clampedLookupX = ColorUtils.clamp(bx, 0, WIDTH);
      const by = Math.max(40, this.getCloudBottomAt(clampedLookupX) - 8) - Math.random() * 14;
      const angle = Math.PI / 2;
      const speed = 175 + Math.random() * 115;
      const b = {
        x: bx,
        y: by,
        vx: 0,
        vy: speed,
        angle,
        speed,
        damage: 2,
        timer: 0
      };
      enemyBullets.push(b);
      spawned.push(b);
    }
    if (onBarrageSpawn && spawned.length > 0) {
      onBarrageSpawn(spawned);
    }
  }

  spawnSummonedEnemies(enemies) {
    const { WIDTH } = GAME_CONFIG;
    if (!this.stageEnemies || this.stageEnemies.length === 0) return;

    const count = 3 + Math.floor(Math.random() * 3); // 3 ~ 5体
    const margin = 60;
    const usableW = WIDTH - margin * 2;
    const sliceW = usableW / count;
    const indices = Array.from({ length: count }, (_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    let delay = 0;
    for (let i = 0; i < count; i++) {
      const slotIdx = indices[i];
      const spawnX = margin + sliceW * slotIdx + (0.2 + Math.random() * 0.6) * sliceW;
      const typeName = this.stageEnemies[Math.floor(Math.random() * this.stageEnemies.length)];
      if (i > 0) {
        delay += 0.35 + Math.random() * 0.65;
      }
      if (delay <= 0) {
        this.spawnSingleSummonedEnemy(typeName, spawnX, enemies);
      } else {
        this.pendingSummons.push({ typeName, spawnX, delay });
      }
    }
  }

  spawnSingleSummonedEnemy(typeName, spawnX, enemies) {
    if (enemies.length >= Math.max(this.spawnLimit, 7)) return;
    const def = ENEMIES[typeName];
    if (!def) return;
    const en = new Enemy(def, spawnX);
    // 雲の下端付近から出現させ、雲に隠れている間は攻撃できないようにする
    const cloudBottom = this.getCloudVisualBottomAt(spawnX);
    en.y = Math.max(en.currentRadius, cloudBottom - 26);
    en._prevY = en.y;
    en.hiddenByCloud = this.isEnemyHidden(en);
    enemies.push(en);
  }

  spawnDroppedBoxesAndItems(enemies, items, onSpawnItem) {
    const { WIDTH } = GAME_CONFIG;
    const count = 4 + Math.floor(Math.random() * 3); // 4 ~ 6個
    const margin = 48;
    const usableW = WIDTH - margin * 2;
    const sliceW = usableW / count;
    const indices = Array.from({ length: count }, (_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    let delay = 0;
    for (let i = 0; i < count; i++) {
      const slotIdx = indices[i];
      const spawnX = margin + sliceW * slotIdx + (0.18 + Math.random() * 0.64) * sliceW;
      // 最初の1つは必ずダメージ箱にし、残りは一定確率でアイテムが代わりに降り注ぐ
      const isItem = i > 0 && Math.random() < 0.28;
      if (i > 0) {
        delay += 0.12 + Math.random() * 0.16;
      }
      if (delay <= 0) {
        this.spawnSingleBoxOrItem(spawnX, isItem, enemies, items, onSpawnItem);
      } else {
        this.pendingBoxDrops.push({ spawnX, isItem, delay });
      }
    }
  }

  spawnSingleBoxOrItem(spawnX, isItem, enemies, items, onSpawnItem) {
    const spawnY = Math.max(40, this.getCloudBottomAt(spawnX) - 6);
    if (isItem) {
      if (typeof onSpawnItem === 'function') {
        onSpawnItem(spawnX, spawnY);
      } else if (typeof Item !== 'undefined' && Array.isArray(items)) {
        const it = Item.maybeSpawn(spawnX, spawnY, 1.0, items, null);
        if (it) items.push(it);
      }
      return;
    }
    const def = (typeof ENEMIES !== 'undefined' && ENEMIES.square) ? ENEMIES.square : {
      name: 'square',
      bullet_type: 'self_destruction',
      movement_type: 'gravity_fall',
      gravity: 360,
      health: 1,
      damage: 4,
      fire_rate: 0
    };
    const vx = (Math.random() - 0.5) * 220;
    const vy = -45 + Math.random() * 85;
    const box = new Enemy(def, spawnX, undefined, vx);
    box.x = spawnX;
    box.y = spawnY;
    box._prevY = spawnY;
    box.vx = vx;
    box.vy = vy;
    box.gravity = def.gravity || 360;
    box.damage = 4;
    if (Array.isArray(enemies)) {
      enemies.push(box);
    }
  }

  updateFogState(dt) {
    if (this.isDefeated()) {
      this.fogLevel = Math.max(0, this.fogLevel - dt * 0.8);
      return;
    }
    if (this.fogRampActive) {
      this.fogRampTimer += dt;
      this.fogLevel = ColorUtils.clamp(this.fogRampTimer / 5.0, 0, 1);
      if (this.fogRampTimer >= 5.0) {
        this.fogRampActive = false;
        this.fogLevel = 1;
        this.fogHoldTimer = 20.0;
      }
    } else if (this.fogHoldTimer > 0) {
      this.fogHoldTimer = Math.max(0, this.fogHoldTimer - dt);
      this.fogLevel = 1;
    } else if (this.fogLevel > 0) {
      this.fogLevel = Math.max(0, this.fogLevel - dt / 1.5);
    }
  }

  /**
   * 稲妻攻撃中のパドル当たり判定（1斉射につき各プレイヤー最大1回4ダメージ）
   */
  applyLightningStrikeHits(paddles, effectsManager, onDamagePaddle) {
    const { COLORS } = GAME_CONFIG;
    const boltHalfW = 11;
    for (const p of paddles) {
      if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
      if (this.attackHitSlots.has(p.slot)) continue;
      const pLeft = p.x - p.currentWidth / 2;
      const pRight = p.x + p.currentWidth / 2;
      for (const bolt of this.lightningBolts) {
        const topY = this.getCloudBottomAt(bolt.x);
        if (p.y + p.height / 2 >= topY && bolt.x + boltHalfW >= pLeft && bolt.x - boltHalfW <= pRight) {
          this.attackHitSlots.add(p.slot);
          if (onDamagePaddle) {
            onDamagePaddle(p, 4);
          }
          if (effectsManager) {
            effectsManager.spawnCircleParticles(bolt.x, p.y, COLORS.red, 10, 50, 175);
          }
          break;
        }
      }
    }
  }

  update(dt, context) {
    const { COLORS } = GAME_CONFIG;
    const {
      paddles = [],
      enemies = [],
      enemyBullets = [],
      items = [],
      effectsManager,
      onDamagePaddle,
      onScreenShake,
      onBarrageSpawn,
      onSpawnItem,
      inTransition = false
    } = context || {};

    this.idleClock += dt;
    if (this.hitCooldown > 0) {
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    }

    this.updateFogState(dt);

    if (this.isDefeated()) {
      this.pendingSummons = [];
      this.pendingBoxDrops = [];
      for (const en of enemies) {
        if (en) en.hiddenByCloud = false;
      }
      if (this.phase !== 'defeated') {
        this.startDefeatAnimation();
      }
      const duration = this.defeatDuration || 5.0;
      this.phaseTimer += dt;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      const retractEase = 0.35 * u + 0.65 * (u * u * (3 - 2 * u));
      this.bodyOffsetY = this.defeatStartOffsetY + (-250 - this.defeatStartOffsetY) * retractEase;

      if (u < 1) {
        this.defeatSmokeTimer -= dt;
        if (this.defeatSmokeTimer <= 0 && effectsManager) {
          this.defeatSmokeTimer = 0.14 + Math.random() * 0.08;
          const puff = this.puffs[Math.floor(Math.random() * this.puffs.length)];
          if (puff) {
            effectsManager.spawnPulse({
              kind: 'circle',
              x: puff.x + (Math.random() - 0.5) * 44,
              y: Math.max(16, puff.y + (Math.random() - 0.5) * 32),
              radius: 26 + Math.random() * 14,
              color: COLORS.white,
              duration: 0.45,
              maxScale: 2.0
            });
          }
        }
      }

      const tb = this.getTrembleOffset();
      this.syncPuffPositions(tb.x, tb.y);
      return;
    }

    if (this.introProgress < 1) {
      this.trembleAmp = 0;
      if (!inTransition) {
        const nextElapsed = (this.introElapsed || 0) + dt;
        this.setIntroProgress(nextElapsed / this.introDuration);
      } else {
        this.syncPuffPositions(0, 0);
      }
      return;
    }

    // 遅延召喚消化
    for (let i = this.pendingSummons.length - 1; i >= 0; i--) {
      this.pendingSummons[i].delay -= dt;
      if (this.pendingSummons[i].delay <= 0) {
        const item = this.pendingSummons.splice(i, 1)[0];
        this.spawnSingleSummonedEnemy(item.typeName, item.spawnX, enemies);
      }
    }

    // 遅延ダメージ箱・アイテム落下消化
    for (let i = this.pendingBoxDrops.length - 1; i >= 0; i--) {
      this.pendingBoxDrops[i].delay -= dt;
      if (this.pendingBoxDrops[i].delay <= 0) {
        const drop = this.pendingBoxDrops.splice(i, 1)[0];
        this.spawnSingleBoxOrItem(drop.spawnX, drop.isItem, enemies, items, onSpawnItem);
      }
    }

    this.phaseTimer += dt;

    if (this.phase === 'cooldown') {
      this.trembleAmp = 0;
      if (this.phaseTimer >= this.cooldownDuration) {
        this.startNextCycleStep(paddles);
      }
    } else if (this.phase === 'rain_attack') {
      this.rainSpawnTimer -= dt;
      while (this.rainSpawnTimer <= 0 && this.phaseTimer < 1.85) {
        this.rainSpawnTimer += 0.04 + Math.random() * 0.08;
        this.spawnRainBullets(enemyBullets, onBarrageSpawn);
      }
      if (this.phaseTimer >= 1.95) {
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'lightning_telegraph') {
      if (this.phaseTimer >= 2.0) {
        this.phase = 'lightning_strike';
        this.phaseTimer = 0;
        this.trembleAmp = 6.5;
        this.attackHitSlots = new Set();
        if (onScreenShake) {
          onScreenShake(0.14, 6.5);
        }
        if (effectsManager) {
          for (let i = 0; i < this.lightningBolts.length; i++) {
            const bolt = this.lightningBolts[i];
            const topY = this.getCloudBottomAt(bolt.x);
            const pColor = i % 2 === 0 ? COLORS.red : COLORS.white;
            effectsManager.spawnCircleParticles(bolt.x, topY, pColor, 6, 40, 150);
          }
        }
        this.applyLightningStrikeHits(paddles, effectsManager, onDamagePaddle);
      }
    } else if (this.phase === 'lightning_strike') {
      this.applyLightningStrikeHits(paddles, effectsManager, onDamagePaddle);
      if (this.phaseTimer >= 0.45) {
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'summon') {
      if (onScreenShake) {
        onScreenShake(0.08, 4.2);
      }
      if (!this.summonTriggered && this.phaseTimer >= 0.82) {
        this.summonTriggered = true;
        this.spawnSummonedEnemies(enemies);
      }
      if (this.phaseTimer >= 1.25) {
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'fog_cast') {
      // 霧のエフェクト発動中は画面を揺らさない（雲本体のみ揺らす）
      if (this.phaseTimer >= 5.0) {
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'box_drop') {
      if (onScreenShake) {
        onScreenShake(0.08, 3.8);
      }
      if (!this.boxDropTriggered && this.phaseTimer >= 0.45) {
        this.boxDropTriggered = true;
        this.spawnDroppedBoxesAndItems(enemies, items, onSpawnItem);
      }
      if (this.phaseTimer >= 1.25) {
        this.enterCooldown(this.attackCooldown);
      }
    }

    const tb = this.getTrembleOffset();
    this.syncPuffPositions(tb.x, tb.y);

    for (const en of enemies) {
      if (en) {
        en.hiddenByCloud = this.isEnemyHidden(en);
      }
    }
  }

  updateClient(dt) {
    this.idleClock += dt;
    this.phaseTimer += dt;

    if (this._hasSnapInterp && this._interpFrom && this._interpTo) {
      this._interpElapsed += dt;
      const alpha = this._interpDuration > 0
        ? ColorUtils.clamp(this._interpElapsed / this._interpDuration, 0, 1)
        : 1;
      const lerp = (a, b) => a + (b - a) * alpha;
      const nextIntro = lerp(this._interpFrom.introProgress, this._interpTo.introProgress);
      this.setIntroProgress(nextIntro);
      this.fogLevel = lerp(this._interpFrom.fogLevel, this._interpTo.fogLevel);
      this.trembleAmp = lerp(this._interpFrom.trembleAmp, this._interpTo.trembleAmp);
    }

    if (this.isDefeated()) {
      const duration = this.defeatDuration || 5.0;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      const retractEase = 0.35 * u + 0.65 * (u * u * (3 - 2 * u));
      this.bodyOffsetY = -250 * retractEase;
    } else {
      this.bodyOffsetY = 0;
    }

    const tb = this.getTrembleOffset();
    this.syncPuffPositions(tb.x, tb.y);
  }

  applyDamageAtPuff(puffIndex, pulseColor, effectsManager, onScore, cooldown = 0.08) {
    if (this.hp <= 0 || this.hitCooldown > 0) return false;
    const { COLORS } = GAME_CONFIG;
    this.hitCooldown = cooldown;
    this.hp = Math.max(0, this.hp - 1);

    const puff = this.puffs[puffIndex] || this.puffs[0];
    if (effectsManager && puff) {
      effectsManager.spawnPulse({
        kind: 'circle',
        target: puff,
        x: puff.x,
        y: puff.y,
        radius: puff.r,
        color: pulseColor,
        duration: this.hp > 0 ? 0.42 : 0.55,
        maxScale: this.hp > 0 ? 1.45 : 2.0
      });
    }

    if (this.hp <= 0) {
      this.startDefeatAnimation();
      if (effectsManager && puff) {
        effectsManager.spawnCircleParticles(puff.x, Math.max(40, puff.y), COLORS.white, 22, 60, 220);
      }
      if (onScore) onScore(2000);
    } else if (onScore) {
      onScore(100);
    }
    return true;
  }

  handleSwingCircleCollision(cx, cy, cr, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1 || this.hitCooldown > 0) return false;
    const { COLORS } = GAME_CONFIG;
    for (let i = 0; i < this.puffs.length; i++) {
      const p = this.puffs[i];
      if ((p.r || 0) <= 0.5) continue;
      if (Math.hypot(cx - p.x, cy - p.y) <= cr + p.r) {
        return this.applyDamageAtPuff(i, COLORS.white, effectsManager, onScore, 0.22);
      }
    }
    return false;
  }

  canTakeCrackDamage() {
    return !this.isDefeated() && this.introProgress >= 1 && this.hp > 1;
  }

  applyCrackDamage(effectsManager, onScore) {
    if (!this.canTakeCrackDamage()) return null;
    const { COLORS } = GAME_CONFIG;
    const idx = Math.floor(Math.random() * this.puffs.length);
    this.hitCooldown = 0;
    const applied = this.applyDamageAtPuff(idx, COLORS.white, effectsManager, onScore, 0);
    const puff = this.puffs[idx] || this.puffs[0];
    return applied && puff ? { x: puff.x, y: puff.y } : null;
  }

  handleBallCollision(ball, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS, BALL } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;
    const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

    for (let i = 0; i < this.puffs.length; i++) {
      const c = this.puffs[i];
      if ((c.r || 0) <= 0.5) continue;
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ball.radius + c.r) {
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        this.reflectBall(ball, c.x + nx * (c.r + ball.radius + 2), c.y + ny * (c.r + ball.radius + 2), nx, ny, BALL);
        this.applyDamageAtPuff(i, pulseColor, effectsManager, onScore, 0.08);
        return true;
      }
    }
    return false;
  }

  reflectBall(ball, newX, newY, nx, ny, BALL) {
    ball.spawningFromCenter = false;
    const prevVy = ball.vy;
    const speed = Math.hypot(ball.vx, ball.vy) || BALL.BASE_SPEED;
    ball.vx = nx * speed;
    ball.vy = ny * speed;
    if (ball.effects.yellow <= 0) {
      ball.clampVerticalAngle(speed);
    } else if (ball.effects.green > 0 && prevVy < 0 && ball.vy > 0) {
      ball.vy /= BALL.GREEN_SPEED_MULTIPLIER;
    }
    ball.x = ColorUtils.clamp(newX, ball.radius, GAME_CONFIG.WIDTH - ball.radius);
    ball.y = Math.max(ball.radius, newY);
  }

  _drawLightningBoltPath(ctx, bx, startY, endY, seed, flickerBucket, halfWidth = 8) {
    const segs = 14;
    const stepY = (endY - startY) / segs;
    let state = (seed ^ ((flickerBucket * 2654435761) >>> 0)) >>> 0;
    const nextRand = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return (state & 0xffff) / 0xffff;
    };
    const pts = [{ x: bx, y: startY }];
    for (let i = 1; i < segs; i++) {
      const y = startY + stepY * i;
      const offset = (nextRand() - 0.5) * 32;
      pts.push({ x: bx + offset, y });
    }
    pts.push({ x: bx, y: endY });

    ctx.beginPath();
    ctx.moveTo(pts[0].x - halfWidth, pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      ctx.lineTo(pts[i].x - halfWidth, pts[i].y);
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      ctx.lineTo(pts[i].x + halfWidth, pts[i].y);
    }
    ctx.closePath();
  }

  render(ctx) {
    if (this.isDefeated() && !this.isDefeating()) return;
    const { COLORS, HEIGHT } = GAME_CONFIG;

    // 1. レーザー予告（2秒間表示、500ms前に白->赤へ変化開始）
    if (this.phase === 'lightning_telegraph' && this.lightningBolts.length > 0) {
      const elapsed = ColorUtils.clamp(this.phaseTimer, 0, 2.0);
      const redT = elapsed <= 1.5 ? 0 : ColorUtils.clamp((elapsed - 1.5) / 0.5, 0, 1);
      const lineColor = redT <= 0 ? COLORS.white : ColorUtils.lerpColor(COLORS.white, COLORS.red, redT);
      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.4;
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([7, 7]);
        ctx.lineDashOffset = -(elapsed * 160);
      }
      for (const bolt of this.lightningBolts) {
        const startY = this.getCloudBottomAt(bolt.x);
        ctx.beginPath();
        ctx.moveTo(bolt.x, startY);
        ctx.lineTo(bolt.x, HEIGHT);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 2. 稲妻攻撃（レーザーのような赤白点滅エフェクト・ストロークなしのソリッド塗りつぶし）
    if (this.phase === 'lightning_strike' && this.lightningBolts.length > 0) {
      const u = ColorUtils.clamp(this.phaseTimer / 0.45, 0, 1);
      const flickerBucket = Math.floor(this.phaseTimer / 0.05);
      const boltColor = flickerBucket % 2 === 0 ? COLORS.red : COLORS.white;
      const halfWidth = Math.max(0.8, 10.5 * (1 - u));
      ctx.save();
      ctx.globalAlpha = 1;
      ctx.fillStyle = boltColor;
      for (const bolt of this.lightningBolts) {
        const startY = this.getCloudBottomAt(bolt.x);
        this._drawLightningBoltPath(ctx, bolt.x, startY, HEIGHT, bolt.seed, flickerBucket, halfWidth);
        ctx.fill();
      }
      ctx.restore();
    }

    // 3. 結合された黒い雲（1パス目で白外枠・2パス目で黒塗りし、重なりの境界線を消す）
    ctx.save();
    ctx.fillStyle = COLORS.white;
    for (const p of this.puffs) {
      if ((p.r || 0) <= 0.5) continue;
      const borderW = 2.8 * (p.scale !== undefined ? p.scale : 1);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r + borderW, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#000000';
    for (const p of this.puffs) {
      if ((p.r || 0) <= 0.5) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  getFogClusterState(cluster, t = this.idleClock) {
    const { WIDTH } = GAME_CONFIG;
    const spanW = WIDTH + 320;
    const rawX = cluster.baseX + t * cluster.driftVx + Math.sin(t * cluster.swayFreq + cluster.phase) * cluster.swayAmpX + 160;
    const cx = ((rawX % spanW) + spanW) % spanW - 160;
    const cy = cluster.baseY + Math.cos(t * (cluster.swayFreq * 0.85) + cluster.phase) * cluster.swayAmpY;
    const wave = 0.5 + 0.5 * Math.sin(
      t * cluster.densityFreq + cluster.densityPhase + Math.sin(t * 0.33 + cluster.phase * 0.7) * 1.15
    );
    return { cx, cy, wave };
  }

  /**
   * 指定座標 (x, y) における霧の不透明度 (0..1) を算出する
   * 雲の揺らぎによって、ほぼ見えない濃い領域 (~0.92+) と、そこそこ見える中程度の領域 (~0.22..0.48) が動的に滑らかに切り替わる
   */
  getFogOpacityAt(x, y, t = this.idleClock) {
    const lvl = ColorUtils.clamp(this.fogLevel, 0, 1);
    if (lvl <= 0.005) return 0;
    // 背景全体の薄いベースモヤ（そこそこ見えるレベルの透明度）
    const spatialUndulation = 0.5 + 0.5 * Math.sin(x * 0.0065 + t * 0.65) * Math.cos(y * 0.0055 - t * 0.52);
    let transmittance = 1 - lvl * (0.20 + 0.14 * spatialUndulation);

    for (const c of this.fogClusters) {
      const { cx, cy, wave } = this.getFogClusterState(c, t);
      const effWave = Math.max(0, (wave - 0.12) / 0.88);
      const clusterStrength = lvl * 0.92 * Math.pow(effWave, 1.55);
      if (clusterStrength <= 0.005) continue;
      for (const p of c.puffs) {
        const px = cx + p.ox;
        const py = cy + p.oy;
        const dist = Math.hypot(x - px, y - py);
        if (dist >= p.r) continue;
        const falloff = 1 - dist / p.r;
        const puffAlpha = ColorUtils.clamp(clusterStrength * p.alphaScale * (falloff * falloff * (1.35 - 0.35 * falloff)), 0, 0.94);
        transmittance *= (1 - puffAlpha);
      }
    }
    return ColorUtils.clamp(1 - transmittance, 0, 0.985);
  }

  renderFog(ctx) {
    if (this.fogLevel <= 0.005) return;
    const { WIDTH, HEIGHT } = GAME_CONFIG;
    const lvl = ColorUtils.clamp(this.fogLevel, 0, 1);
    const t = this.idleClock;

    ctx.save();
    // 1. 控えめなベースモヤ層（薄い領域ではそこそこ視認できる透明度を保つ）
    ctx.fillStyle = 'rgba(255, 255, 255, 1)';
    ctx.globalAlpha = 0.22 * lvl;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    // 2. 背景の雲エフェクトと同じ放射グラデーションによる濃淡モヤ群（揺らぎで濃いほぼ見えない領域と薄い領域が滑らかに移動・変化）
    for (const c of this.fogClusters) {
      const { cx, cy, wave } = this.getFogClusterState(c, t);
      const effWave = Math.max(0, (wave - 0.12) / 0.88);
      const clusterStrength = lvl * 0.92 * Math.pow(effWave, 1.55);
      if (clusterStrength <= 0.005) continue;
      for (const p of c.puffs) {
        const px = cx + p.ox;
        const py = cy + p.oy;
        const coreAlpha = ColorUtils.clamp(clusterStrength * p.alphaScale, 0, 0.94);
        if (coreAlpha <= 0.01) continue;
        if (typeof ctx.createRadialGradient === 'function') {
          const grad = ctx.createRadialGradient(px, py, p.r * 0.08, px, py, p.r);
          grad.addColorStop(0, `rgba(255, 255, 255, ${coreAlpha})`);
          grad.addColorStop(0.52, `rgba(255, 255, 255, ${coreAlpha * 0.65})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = grad;
          ctx.globalAlpha = 1;
        } else {
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = coreAlpha;
        }
        ctx.beginPath();
        ctx.arc(px, py, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  serialize() {
    const r2 = (v) => Math.round(v * 100) / 100;
    const r3 = (v) => Math.round(v * 1000) / 1000;
    return [
      'cloud',
      this.phase,
      r2(this.phaseTimer),
      r3(this.introProgress),
      this.hp,
      this.maxHp,
      r3(this.fogLevel),
      r2(this.trembleAmp),
      this.lightningBolts.map((b) => [Math.round(b.x), b.seed])
    ];
  }

  applySnapshot(data, interpDuration = null) {
    if (!Array.isArray(data) || data[0] !== 'cloud') return;
    const [
      ,
      phase,
      phaseTimer,
      introProgress,
      hp,
      maxHp,
      fogLevel,
      trembleAmp,
      bolts
    ] = data;

    this.phase = phase || 'cooldown';
    this.phaseTimer = phaseTimer || 0;
    this.hp = hp;
    this.maxHp = maxHp;
    this.lightningBolts = Array.isArray(bolts)
      ? bolts.map((b) => ({ x: b[0], seed: b[1] }))
      : [];

    const targetState = {
      introProgress: introProgress !== undefined ? introProgress : 1,
      fogLevel: fogLevel || 0,
      trembleAmp: trembleAmp || 0
    };

    if (!this._hasSnapInterp || !(interpDuration > 0)) {
      this._hasSnapInterp = true;
      this.setIntroProgress(targetState.introProgress);
      this.fogLevel = targetState.fogLevel;
      this.trembleAmp = targetState.trembleAmp;
      this._interpFrom = { ...targetState };
      this._interpTo = { ...targetState };
      this._interpElapsed = 1;
      this._interpDuration = interpDuration || 0.042;
      return;
    }

    this._interpFrom = {
      introProgress: this.introProgress,
      fogLevel: this.fogLevel,
      trembleAmp: this.trembleAmp
    };
    this._interpTo = targetState;
    this._interpElapsed = 0;
    this._interpDuration = interpDuration;
  }
}

/**
 * ステージ40「dragon」ボス: 画面上部から顔が隠れる高さで飛ぶ大型の円形ボディ＋単純化した黒三角形群の翼を持つドラゴン
 */
const DRAGON_WING_TRIANGLES = [
  [0, -18, 200, -14, 95, 94],
  [140, -6, 255, -24, 220, 62]
];

const DRAGON_WING_OUTLINE = [
  [0, -18],
  [145, -6],
  [255, -24],
  [220, 62],
  [168, 28],
  [95, 94]
];

const DRAGON_BODY_SPEC = [
  { id: 'D0', key: 'head', lx: 0, ly: -92, r: 46, aimMul: 1.8, tailMul: 0 },
  { id: 'D1', key: 'neck', lx: 0, ly: -52, r: 34, aimMul: 0.9, tailMul: 0 },
  { id: 'D2', key: 'chest', lx: 0, ly: 0, r: 60, aimMul: 0, tailMul: 0 },
  { id: 'D3', key: 'belly', lx: 0, ly: 44, r: 48, aimMul: 0, tailMul: 0 },
  { id: 'D4', key: 'tail1', lx: 0, ly: 82, r: 30, aimMul: 0, tailMul: 1.4 },
  { id: 'D5', key: 'tail2', lx: 0, ly: 112, r: 20, aimMul: 0, tailMul: 2.5 }
];

const DRAGON_RENDER_BODY_ORDER = [5, 4, 3, 2, 1, 0];

class DragonBoss {
  constructor(stageData, playerCount = 1) {
    const { WIDTH } = GAME_CONFIG;
    this.netKind = 'boss';
    this.id = 'dragon';
    this.name = (stageData && stageData.name) || 'dragon';
    this.stageEnemies = (stageData && Array.isArray(stageData.enemies) && stageData.enemies.length > 0)
      ? stageData.enemies
      : ['prism', 'crescent', 'circle', 'bomb'];
    this.spawnLimit = (stageData && stageData.spawn_limit) || 10;

    const hpScale = getBossHpScaleForCount(playerCount);
    this.maxHp = Math.round(60 * hpScale);
    this.hp = this.maxHp;
    this.hitCooldown = 0;

    // 行動クールダウン 10秒、4つの攻撃フェース（4番目からの帰還と同時に5番目召喚）を巡回
    this.attackCooldown = 10.0;
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = this.attackCooldown;
    this.cycleStep = 0;

    this.homeX = WIDTH / 2;
    this.homeY = 38;
    this.x = this.homeX;
    this.y = this.homeY;
    this.startX = this.homeX;
    this.startY = this.homeY;
    this.bodyAngle = 0;
    this.aimOffsetX = 0;
    this.wingPhase = 0;
    this.wingSpread = 1.0;
    this.wingShakeClock = 0;

    this.blinking = false;
    this.blinkTimer = 0;

    this.introProgress = 1;
    this.introOffsetY = 0;
    this.defeatDuration = 5.0;
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.defeatStartY = this.homeY;
    this.headShakeX = 0;
    this.headShakeY = 0;

    this.hitCircles = DRAGON_BODY_SPEC.map((spec) => ({
      netKind: 'boss_circle',
      id: spec.id,
      key: spec.key,
      x: this.x + spec.lx,
      y: this.y + spec.ly,
      r: spec.r,
      radius: spec.r
    }));

    // 攻撃状態
    this.spadeFiredCount = 0;
    this.spadeLanes = [];
    this.chargeTargetX = WIDTH / 2;
    this.chargeVx = 0;
    this.chargeVy = 0;
    this.chargeHitSlots = new Set();
    this.rushDamaged = false;
    this.knifeVolleysFired = 0;
    this.arcWavesFired = 0;
    this.afterimages = [];
    this.afterimageTimer = 0;
    this.pendingSummons = [];
    this._hasSnapInterp = false;

    this.syncBodyCircles();
  }

  /**
   * 登場イントロアニメーションの進行度を設定する
   */
  setIntroProgress(progress) {
    this.introProgress = ColorUtils.clamp(progress, 0, 1);
    const eased = 1 - Math.pow(1 - this.introProgress, 3);
    this.introOffsetY = -380 * (1 - eased);
    this.syncBodyCircles();
  }

  isDefeated() {
    return this.hp <= 0;
  }

  isDefeating() {
    return this.isDefeated() && this.phase === 'defeated' && this.phaseTimer < (this.defeatDuration || 5.0);
  }

  isFlyingWithWings() {
    return (
      this.phase === 'fly_spade_up' ||
      this.phase === 'fly_spade_return' ||
      this.phase === 'charge_pullback' ||
      this.phase === 'charge_return' ||
      this.phase === 'fly_arc_up' ||
      this.phase === 'arc_return_summon'
    );
  }

  getCircleById(targetId) {
    return this.hitCircles.find((c) => c.id === targetId) || null;
  }

  computeWingPose() {
    const flapWave = Math.sin(this.wingPhase);
    const flapAmp = this.isFlyingWithWings() ? 0.34 : 0.16;
    const flapAngle = flapWave * flapAmp;
    const wingScaleX = this.wingSpread * (0.9 + 0.12 * Math.cos(flapAngle));
    return { flapAngle, wingScaleX };
  }

  /**
   * 現在の胴体座標・回転・翼揺れに合わせて全当たり判定円のワールド座標を同期する
   */
  syncBodyCircles() {
    const cx = this.x + (this.headShakeX || 0);
    const isMoving = this.phase !== 'cooldown' && !this.isDefeated();
    const hoverBob = isMoving ? 0 : Math.sin(this.wingPhase * 0.55) * 4.5;
    const cy = this.y + (this.introOffsetY || 0) + (this.headShakeY || 0) + hoverBob;
    const tailSway = Math.sin(this.wingPhase * 0.8) * 5.5;
    const cosA = Math.cos(this.bodyAngle || 0);
    const sinA = Math.sin(this.bodyAngle || 0);

    for (let i = 0; i < DRAGON_BODY_SPEC.length; i++) {
      const spec = DRAGON_BODY_SPEC[i];
      const lx = spec.lx + (this.aimOffsetX || 0) * spec.aimMul + tailSway * spec.tailMul;
      const ly = spec.ly;
      const circle = this.hitCircles[i];
      circle.x = cx + lx * cosA - ly * sinA;
      circle.y = cy + lx * sinA + ly * cosA;
    }
    return { cx, cy };
  }

  /**
   * 現在の姿勢における両翼の三角形頂点群をワールド座標で返す
   */
  getWingWorldTriangles() {
    const { cx, cy } = this.syncBodyCircles();
    const cosA = Math.cos(this.bodyAngle || 0);
    const sinA = Math.sin(this.bodyAngle || 0);
    const { flapAngle, wingScaleX } = this.computeWingPose();
    const tris = [];

    for (const side of [-1, 1]) {
      const rootX = cx + side * 34 * cosA - (-8) * sinA;
      const rootY = cy + side * 34 * sinA + (-8) * cosA;
      const rot = flapAngle + side * (this.bodyAngle || 0);
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);

      const mapPt = (px, py) => {
        const lx = px * wingScaleX;
        const rx = lx * cosR + py * sinR;
        const ry = -lx * sinR + py * cosR;
        return { x: rootX + side * rx, y: rootY + ry };
      };

      for (let i = 0; i < DRAGON_WING_TRIANGLES.length; i++) {
        const t = DRAGON_WING_TRIANGLES[i];
        tris.push([mapPt(t[0], t[1]), mapPt(t[2], t[3]), mapPt(t[4], t[5])]);
      }
    }
    return tris;
  }

  static _closestPointOnSegment(px, py, ax, ay, bx, by) {
    const abx = bx - ax;
    const aby = by - ay;
    const lenSq = abx * abx + aby * aby;
    const t = lenSq > 0 ? ColorUtils.clamp(((px - ax) * abx + (py - ay) * aby) / lenSq, 0, 1) : 0;
    return { x: ax + abx * t, y: ay + aby * t };
  }

  static _closestPointOnTriangle(px, py, a, b, c) {
    const sign = (p1, p2, p3) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
    const pt = { x: px, y: py };
    const d1 = sign(pt, a, b);
    const d2 = sign(pt, b, c);
    const d3 = sign(pt, c, a);
    const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
    const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
    if (!(hasNeg && hasPos)) {
      return { x: px, y: py, inside: true };
    }
    const e1 = DragonBoss._closestPointOnSegment(px, py, a.x, a.y, b.x, b.y);
    const e2 = DragonBoss._closestPointOnSegment(px, py, b.x, b.y, c.x, c.y);
    const e3 = DragonBoss._closestPointOnSegment(px, py, c.x, c.y, a.x, a.y);
    let best = e1;
    let bestSq = (px - e1.x) ** 2 + (py - e1.y) ** 2;
    const d2Sq = (px - e2.x) ** 2 + (py - e2.y) ** 2;
    if (d2Sq < bestSq) { best = e2; bestSq = d2Sq; }
    const d3Sq = (px - e3.x) ** 2 + (py - e3.y) ** 2;
    if (d3Sq < bestSq) { best = e3; }
    return { x: best.x, y: best.y, inside: false };
  }

  _findWingCircleHit(cx, cy, r) {
    const { HEIGHT } = GAME_CONFIG;
    const tris = this.getWingWorldTriangles();
    for (let i = 0; i < tris.length; i++) {
      const [a, b, c] = tris[i];
      if (Math.max(a.y, b.y, c.y) <= 0 || Math.min(a.y, b.y, c.y) >= HEIGHT) continue;
      const cp = DragonBoss._closestPointOnTriangle(cx, cy, a, b, c);
      const dx = cx - cp.x;
      const dy = cy - cp.y;
      const dist = Math.hypot(dx, dy);
      if (cp.inside || dist <= r) {
        return { hitX: cp.x, hitY: cp.y, dx, dy, dist, inside: cp.inside };
      }
    }
    return null;
  }

  hitsCircle(cx, cy, r) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    for (const c of this.hitCircles) {
      if (c.y + c.r <= 0 || c.y - c.r >= GAME_CONFIG.HEIGHT) continue;
      if (Math.hypot(cx - c.x, cy - c.y) <= r + c.r) {
        return true;
      }
    }
    return Boolean(this._findWingCircleHit(cx, cy, r));
  }

  startDefeatAnimation() {
    if (this.phase === 'defeated') return;
    this.phase = 'defeated';
    this.phaseTimer = 0;
    this.defeatSmokeTimer = 0;
    this.defeatVibClock = 0;
    this.defeatStartY = this.y;
    this.headShakeX = 0;
    this.headShakeY = 0;
    this.blinking = false;
    this.pendingSummons = [];
    this.afterimages = [];
  }

  updateDefeatVibration() {
    const duration = this.defeatDuration || 5.0;
    if (this.phase !== 'defeated' || this.phaseTimer >= duration) {
      this.headShakeX = 0;
      this.headShakeY = 0;
      return;
    }
    const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
    const t = this.defeatVibClock || this.phaseTimer || 0;
    const amp = 8.0 * (1 - 0.18 * u);
    this.headShakeX = (Math.sin(t * 78) * 0.65 + Math.sin(t * 131 + 1.1) * 0.35) * amp;
    this.headShakeY = (Math.cos(t * 91 + 0.7) * 0.65 + Math.cos(t * 149) * 0.35) * (amp * 0.75);
  }

  pickRandomAlivePaddle(paddles) {
    const alive = paddles.filter((p) => p && p.hp > 0);
    if (alive.length === 0) return null;
    return alive[Math.floor(Math.random() * alive.length)];
  }

  enterCooldown(duration = this.attackCooldown) {
    this.phase = 'cooldown';
    this.phaseTimer = 0;
    this.cooldownDuration = duration;
    this.blinking = false;
    this.blinkTimer = 0;
    this.bodyAngle = 0;
    this.wingSpread = 1.0;
    this.aimOffsetX = 0;
  }

  /**
   * 翼を使った飛行中の羽ばたき・画面揺れを進行する
   */
  stepWingFlight(dt, freq, spread, shakeMag, onScreenShake) {
    this.wingPhase += dt * freq;
    this.wingSpread = spread;
    this.wingShakeClock += dt;
    if (onScreenShake && this.wingShakeClock >= 0.14) {
      this.wingShakeClock = 0;
      onScreenShake(0.12, shakeMag);
    }
  }

  updateAfterimages(dt, captureActive) {
    if (captureActive) {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.022) {
        this.afterimageTimer = 0;
        const { flapAngle, wingScaleX } = this.computeWingPose();
        this.afterimages.push({
          x: this.x,
          y: this.y + (this.introOffsetY || 0),
          bodyAngle: this.bodyAngle,
          aimOffsetX: this.aimOffsetX,
          wingPhase: this.wingPhase,
          flapAngle,
          wingScaleX,
          alpha: 0.56
        });
      }
    }
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.4;
      if (this.afterimages[i].alpha <= 0) {
        this.afterimages.splice(i, 1);
      }
    }
  }

  /**
   * 行動1: 画面外からスペード型 explode 弾を複数発射する
   */
  fireOffscreenSpadeBullet(laneIndex, enemyBullets, onBarrageSpawn) {
    const { WIDTH } = GAME_CONFIG;
    const laneX = this.spadeLanes[laneIndex % Math.max(1, this.spadeLanes.length)] || (WIDTH / 2);
    const spawnX = ColorUtils.clamp(laneX + (Math.random() - 0.5) * 44, 52, WIDTH - 52);
    const spawnY = -14;
    const angle = Math.PI / 2 + (Math.random() - 0.5) * 0.34;
    const speed = 235;
    const explodeY = 365 + Math.random() * 175;
    const bullet = {
      x: spawnX,
      y: spawnY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      angle,
      speed,
      damage: 2,
      timer: 0,
      shape: 'spade',
      explodeY,
      explodeCount: 8
    };
    enemyBullets.push(bullet);
    if (onBarrageSpawn) {
      onBarrageSpawn([bullet]);
    }
  }

  /**
   * 行動3: 生存パドル(なければ中央)へ収束する10〜20本の回転フェードインナイフ弾幕を1回生成する
   * 500ms回転しながら上昇 -> 500ms進行方向へ向いて静止 -> 一斉に線分に沿って高速突進 (3ダメージ)
   */
  fireKnifeVolley(paddles, enemyBullets, onBarrageSpawn) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    const target = this.pickRandomAlivePaddle(paddles);
    const tx = target ? target.x : WIDTH / 2;
    const ty = target ? target.y : PADDLE.Y;
    const count = 10 + Math.floor(Math.random() * 11); // 10 ~ 20本
    const riseOffset = 52;
    const speed = 920;
    const spawned = [];

    for (let i = 0; i < count; i++) {
      // -30度 〜 +30度 のランダムな角度で目標点を通る線分を決定
      const theta = (Math.random() - 0.5) * (Math.PI / 3);
      const dirAngle = Math.PI / 2 + theta;
      const ux = Math.cos(dirAngle);
      const uy = Math.sin(dirAngle);

      const dist = 560 + Math.random() * 90;

      const holdX = tx - ux * dist;
      const holdY = ty - uy * dist;
      const b = {
        x: holdX,
        y: holdY + riseOffset,
        vx: 0,
        vy: 0,
        angle: dirAngle,
        speed,
        damage: 3,
        timer: 0,
        shape: 'knife',
        motionMode: 'knife',
        knifeHoldX: holdX,
        knifeHoldY: holdY,
        knifeRiseY: riseOffset,
        knifeElapsed: 0,
        knifeAlpha: 0,
        knifeVisualAngle: dirAngle - Math.PI * 2,
        trail: []
      };
      enemyBullets.push(b);
      spawned.push(b);
    }

    if (onBarrageSpawn && spawned.length > 0) {
      onBarrageSpawn(spawned);
    }
  }

  /**
   * 行動4: 画面中央上を起点に、画面左右端で反射する残像付きナイフを弧を描く扇状に5回 (8, 10, 12, 14, 16本) 発射する
   */
  spawnArcWave(waveIndex, _paddles, enemyBullets, onBarrageSpawn) {
    const { WIDTH } = GAME_CONFIG;
    const count = 4 + waveIndex;
    const originX = WIDTH / 2;
    const originY = 16;
    const spreadHalf = 1.08 + waveIndex * 0.03; // 左右の壁まで届く広い弧状扇形
    const baseSpeed = 340;
    const spawned = [];

    for (let i = 0; i < count; i++) {
      const frac = count > 1 ? (i / (count - 1)) * 2 - 1 : 0; // -1 .. +1
      const angle = Math.PI / 2 + frac * spreadHalf;
      // 中央寄りをやや速め・外周をわずかに抑えることで発射直後から美しい弧を描く
      const speed = baseSpeed + (1 - frac * frac) * 35;
      const vx = Math.cos(angle) * speed;
      const vy = Math.sin(angle) * speed;
      const bullet = {
        x: originX,
        y: originY,
        vx,
        vy,
        angle,
        speed,
        damage: 2,
        timer: 0,
        shape: 'knife',
        bounceWalls: true,
        trail: [{ x: originX, y: originY }]
      };
      enemyBullets.push(bullet);
      spawned.push(bullet);
    }

    if (onBarrageSpawn && spawned.length > 0) {
      onBarrageSpawn(spawned);
    }
  }

  /**
   * 行動5: 4〜6体の雑魚敵を召喚する
   */
  queueEnemySummons(enemies) {
    const { WIDTH } = GAME_CONFIG;
    const count = 4 + Math.floor(Math.random() * 3); // 4 ~ 6体
    const margin = 52;
    const usableW = WIDTH - margin * 2;
    const sliceW = usableW / count;
    const indices = Array.from({ length: count }, (_, idx) => idx);
    for (let i = indices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [indices[i], indices[j]] = [indices[j], indices[i]];
    }

    for (let i = 0; i < count; i++) {
      const slotIdx = indices[i];
      const spawnX = margin + sliceW * slotIdx + (0.2 + Math.random() * 0.6) * sliceW;
      const typeName = this.stageEnemies[Math.floor(Math.random() * this.stageEnemies.length)];
      if (i < 2) {
        this.spawnSingleSummonedEnemy(typeName, spawnX, enemies);
      } else {
        this.pendingSummons.push({ typeName, spawnX, delay: 0.08 + (i - 1) * 0.09 });
      }
    }
  }

  spawnSingleSummonedEnemy(typeName, spawnX, enemies) {
    if (enemies.length >= Math.max(this.spawnLimit, 10)) return;
    const def = ENEMIES[typeName];
    if (!def) return;
    enemies.push(new Enemy(def, spawnX));
  }

  checkChargePaddleCollisions(paddles, onDamagePaddle, effectsManager) {
    const { COLORS, HEIGHT } = GAME_CONFIG;
    for (const p of paddles) {
      if (!p || p.hp <= 0 || p.invincibleTimer > 0 || this.chargeHitSlots.has(p.slot)) continue;
      const pLeft = p.x - p.currentWidth / 2;
      const pRight = p.x + p.currentWidth / 2;
      const pTop = p.y - p.height / 2;
      const pBottom = p.y + p.height / 2;

      let hitPaddle = false;
      for (const c of this.hitCircles) {
        if (c.y + c.r <= 0 || c.y - c.r >= HEIGHT) continue;
        const nx = ColorUtils.clamp(c.x, pLeft, pRight);
        const ny = ColorUtils.clamp(c.y, pTop, pBottom);
        if (Math.hypot(c.x - nx, c.y - ny) <= c.r) {
          hitPaddle = true;
          break;
        }
      }
      if (hitPaddle) {
        this.chargeHitSlots.add(p.slot);
        if (onDamagePaddle) {
          onDamagePaddle(p, 6);
        }
        if (effectsManager) {
          effectsManager.spawnCircleParticles(p.x, p.y, COLORS.red, 14, 55, 220);
        }
      }
    }
  }

  update(dt, context) {
    const { WIDTH, PADDLE, HEIGHT, COLORS } = GAME_CONFIG;
    const {
      paddles = [],
      enemies = [],
      enemyBullets = [],
      effectsManager,
      onDamagePaddle,
      onScreenShake,
      onBarrageSpawn
    } = context || {};

    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.phaseTimer += dt;
    this.updateAfterimages(dt, this.phase === 'charge_rush_down' || this.phase === 'charge_rush_up');

    if (this.isDefeated()) {
      this.pendingSummons = [];
      const duration = this.defeatDuration || 5.0;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      this.defeatVibClock += dt;
      this.wingPhase += dt * 4.0;
      this.y = (this.defeatStartY !== undefined ? this.defeatStartY : this.homeY) - 300 * (u * u);
      this.updateDefeatVibration();
      if (onScreenShake && this.phaseTimer < duration) {
        onScreenShake(0.08, 2.2 * (1 - 0.45 * u));
      }
      if (effectsManager && this.phaseTimer < duration) {
        this.defeatSmokeTimer += dt;
        while (this.defeatSmokeTimer >= 0.045) {
          this.defeatSmokeTimer -= 0.045;
          const base = this.hitCircles[Math.floor(Math.random() * this.hitCircles.length)] || { x: this.x, y: this.y, r: 16 };
          if (base.y + base.r > 0 && base.y - base.r < HEIGHT) {
            effectsManager.spawnCircleParticles(
              base.x + (Math.random() - 0.5) * 18,
              Math.max(12, base.y + (Math.random() - 0.5) * 18),
              COLORS.white,
              4,
              30,
              140
            );
          }
        }
      }
      this.syncBodyCircles();
      return;
    }

    if (this.introProgress < 1) {
      this.phaseTimer = 0;
      this.wingPhase += dt * 5.2;
      this.syncBodyCircles();
      return;
    }

    // 遅延召喚キューの処理
    for (let i = this.pendingSummons.length - 1; i >= 0; i--) {
      this.pendingSummons[i].delay -= dt;
      if (this.pendingSummons[i].delay <= 0) {
        const pending = this.pendingSummons.splice(i, 1)[0];
        this.spawnSingleSummonedEnemy(pending.typeName, pending.spawnX, enemies);
      }
    }

    if (this.phase === 'cooldown') {
      this.wingPhase += dt * 3.8;
      this.wingSpread = 1.0;
      const targetX = this.homeX + Math.sin(this.phaseTimer * 0.72) * 58;
      const targetAngle = Math.cos(this.phaseTimer * 0.72) * 0.05;
      this.x += (targetX - this.x) * Math.min(1, dt * 6);
      this.y += (this.homeY - this.y) * Math.min(1, dt * 6);
      this.bodyAngle += (targetAngle - this.bodyAngle) * Math.min(1, dt * 6);
      this.aimOffsetX += (0 - this.aimOffsetX) * Math.min(1, dt * 6);

      if (this.phaseTimer >= (this.cooldownDuration || this.attackCooldown)) {
        const step = this.cycleStep;
        this.cycleStep = (this.cycleStep + 1) % 4;
        this.startX = this.x;
        this.startY = this.y;
        this.phaseTimer = 0;
        this.wingShakeClock = 0.14;

        if (step === 0) {
          this.phase = 'fly_spade_up';
        } else if (step === 1) {
          this.phase = 'charge_pullback';
          const target = this.pickRandomAlivePaddle(paddles);
          this.chargeTargetX = target ? target.x : WIDTH / 2;
          this.blinking = true;
          this.blinkTimer = 0;
        } else if (step === 2) {
          this.phase = 'knife_attack';
          this.knifeVolleysFired = 0;
        } else {
          this.phase = 'fly_arc_up';
        }
      }
    } else if (this.phase === 'fly_spade_up') {
      this.stepWingFlight(dt, 13.5, 1.15, 4.4, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.85, 0, 1);
      const eased = u * u;
      this.x = this.startX + (this.homeX - this.startX) * u;
      this.y = this.startY + (-280 - this.startY) * eased;
      this.bodyAngle += (0 - this.bodyAngle) * Math.min(1, dt * 8);
      if (this.phaseTimer >= 0.85) {
        this.phase = 'spade_barrage';
        this.phaseTimer = 0;
        this.spadeFiredCount = 0;
        this.spadeLanes = [110, 295, 485, 670, 210, 570];
      }
    } else if (this.phase === 'spade_barrage') {
      this.wingPhase += dt * 7.5;
      this.x = this.homeX;
      this.y = -280;
      const fireTimes = [0.12, 0.44, 0.76, 1.08, 1.40, 1.72];
      while (this.spadeFiredCount < fireTimes.length && this.phaseTimer >= fireTimes[this.spadeFiredCount]) {
        this.fireOffscreenSpadeBullet(this.spadeFiredCount, enemyBullets, onBarrageSpawn);
        this.spadeFiredCount += 1;
      }
      if (this.phaseTimer >= 2.1) {
        this.phase = 'fly_spade_return';
        this.phaseTimer = 0;
        this.wingShakeClock = 0.14;
      }
    } else if (this.phase === 'fly_spade_return') {
      this.stepWingFlight(dt, 11.5, 1.08, 3.6, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.85, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.x = this.homeX;
      this.y = -280 + (this.homeY - -280) * eased;
      if (this.phaseTimer >= 0.85) {
        this.x = this.homeX;
        this.y = this.homeY;
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'charge_pullback') {
      this.blinking = true;
      this.blinkTimer += dt;
      this.stepWingFlight(dt, 14.0, 1.15, 4.4, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.75, 0, 1);
      const eased = u * u;
      this.y = this.startY + (-280 - this.startY) * eased;
      this.bodyAngle = 0;
      this.aimOffsetX = 0;
      if (this.phaseTimer < 0.5) {
        const target = this.pickRandomAlivePaddle(paddles);
        if (target) {
          this.chargeTargetX = ColorUtils.clamp(target.x, 80, WIDTH - 80);
        }
      }

      if (this.phaseTimer >= 0.75) {
        // 画面上外へ完全に身を引いてから、頭を下（進行方向）へ向けて真っ直ぐ突進する
        this.x = this.chargeTargetX;
        this.y = -260;
        this.bodyAngle = Math.PI;
        this.chargeVx = 0;
        this.chargeVy = 780;
        this.chargeHitSlots = new Set();
        this.rushDamaged = false;
        this.blinking = false;
        this.afterimages = [];
        this.afterimageTimer = 0;
        this.phase = 'charge_rush_down';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'charge_rush_down') {
      this.wingPhase += dt * 6.0;
      this.wingSpread = 0.78;
      this.x = this.chargeTargetX;
      this.y += this.chargeVy * dt;
      this.bodyAngle = Math.PI;
      this.syncBodyCircles();
      this.checkChargePaddleCollisions(paddles, onDamagePaddle, effectsManager);

      if (this.y > HEIGHT + 200 || this.phaseTimer >= 2.2) {
        this.phase = 'charge_bottom_wait';
        this.phaseTimer = 0;
        this.y = HEIGHT + 260;
        this.bodyAngle = 0;
        this.aimOffsetX = 0;
      }
    } else if (this.phase === 'charge_bottom_wait') {
      this.wingPhase += dt * 6.0;
      this.y = HEIGHT + 260;
      this.bodyAngle = 0;
      if (this.phaseTimer >= 1.0) {
        const target = this.pickRandomAlivePaddle(paddles);
        this.chargeTargetX = ColorUtils.clamp(target ? target.x : WIDTH / 2, 80, WIDTH - 80);
        this.x = this.chargeTargetX;
        this.y = HEIGHT + 200;
        this.blinking = true;
        this.blinkTimer = 0;
        this.phase = 'charge_bottom_peek';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'charge_bottom_peek') {
      this.blinking = true;
      this.blinkTimer += dt;
      this.wingPhase += dt * 8.5;
      this.wingSpread = 0.96;
      this.x = this.chargeTargetX;
      this.bodyAngle = 0;
      const u = ColorUtils.clamp(this.phaseTimer / 0.25, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.y = HEIGHT + 200 + ((HEIGHT + 46) - (HEIGHT + 200)) * eased;
      if (this.phaseTimer >= 1.0) {
        this.blinking = false;
        this.chargeVx = 0;
        this.chargeVy = -780;
        this.chargeHitSlots = new Set();
        this.rushDamaged = false;
        this.afterimages = [];
        this.afterimageTimer = 0;
        this.phase = 'charge_rush_up';
        this.phaseTimer = 0;
      }
    } else if (this.phase === 'charge_rush_up') {
      this.wingPhase += dt * 6.0;
      this.wingSpread = 0.78;
      this.x = this.chargeTargetX;
      this.y += this.chargeVy * dt;
      this.bodyAngle = 0;
      this.syncBodyCircles();
      this.checkChargePaddleCollisions(paddles, onDamagePaddle, effectsManager);

      if (this.y < -280 || this.phaseTimer >= 2.2) {
        this.phase = 'charge_return';
        this.phaseTimer = 0;
        this.wingShakeClock = 0.14;
        this.x = this.homeX;
        this.y = -280;
        this.bodyAngle = 0;
        this.aimOffsetX = 0;
      }
    } else if (this.phase === 'charge_return') {
      this.stepWingFlight(dt, 11.5, 1.08, 3.8, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.85, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.x = this.homeX;
      this.y = -280 + (this.homeY - -280) * eased;
      if (this.phaseTimer >= 0.85) {
        this.x = this.homeX;
        this.y = this.homeY;
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'knife_attack') {
      this.wingPhase += dt * 5.2;
      this.wingSpread = 1.04;
      this.x = this.homeX + Math.sin(this.phaseTimer * 0.8) * 36;
      this.y += (this.homeY - this.y) * Math.min(1, dt * 6);
      const knifeTimes = [0.05, 1.05, 2.05, 3.05, 4.05];
      while (this.knifeVolleysFired < knifeTimes.length && this.phaseTimer >= knifeTimes[this.knifeVolleysFired]) {
        this.fireKnifeVolley(paddles, enemyBullets, onBarrageSpawn);
        this.knifeVolleysFired += 1;
      }
      if (this.phaseTimer >= 5.35) {
        this.enterCooldown(this.attackCooldown);
      }
    } else if (this.phase === 'fly_arc_up') {
      this.stepWingFlight(dt, 15.0, 1.2, 5.2, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.95, 0, 1);
      const eased = u * u;
      this.x = this.startX + (this.homeX - this.startX) * u;
      this.y = this.startY + (-340 - this.startY) * eased;
      this.bodyAngle += (0 - this.bodyAngle) * Math.min(1, dt * 8);
      if (this.phaseTimer >= 0.95) {
        this.phase = 'arc_barrage';
        this.phaseTimer = 0;
        this.arcWavesFired = 0;
      }
    } else if (this.phase === 'arc_barrage') {
      this.wingPhase += dt * 8.5;
      this.x = this.homeX;
      this.y = -340;
      const waveTimes = [0.15, 1.00, 1.85, 2.70, 3.55];
      while (this.arcWavesFired < waveTimes.length && this.phaseTimer >= waveTimes[this.arcWavesFired]) {
        this.spawnArcWave(this.arcWavesFired, paddles, enemyBullets, onBarrageSpawn);
        this.arcWavesFired += 1;
      }
      if (this.phaseTimer >= 4.45) {
        // 4.の行動から戻ってくると同時に、5.の敵4〜6体召喚を実行する
        this.queueEnemySummons(enemies);
        this.phase = 'arc_return_summon';
        this.phaseTimer = 0;
        this.wingShakeClock = 0.14;
      }
    } else if (this.phase === 'arc_return_summon') {
      this.stepWingFlight(dt, 12.5, 1.12, 4.4, onScreenShake);
      const u = ColorUtils.clamp(this.phaseTimer / 0.9, 0, 1);
      const eased = 1 - Math.pow(1 - u, 3);
      this.x = this.homeX;
      this.y = -340 + (this.homeY - -340) * eased;
      if (this.phaseTimer >= 0.9) {
        this.x = this.homeX;
        this.y = this.homeY;
        this.enterCooldown(this.attackCooldown);
      }
    }

    this.syncBodyCircles();
  }

  updateClient(dt) {
    this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    this.phaseTimer += dt;
    this.updateAfterimages(dt, this.phase === 'charge_rush_down' || this.phase === 'charge_rush_up');

    if (this.blinking) {
      this.blinkTimer += dt;
    }

    if (this._hasSnapInterp && this._interpTo) {
      this._interpElapsed = Math.min(this._interpDuration, this._interpElapsed + dt);
      const u = this._interpDuration > 0 ? this._interpElapsed / this._interpDuration : 1;
      const lerp = (a, b) => a + (b - a) * u;
      this.setIntroProgress(lerp(this._interpFrom.introProgress, this._interpTo.introProgress));
      this.x = lerp(this._interpFrom.x, this._interpTo.x);
      this.y = lerp(this._interpFrom.y, this._interpTo.y);
      const dAng = Math.atan2(
        Math.sin(this._interpTo.bodyAngle - this._interpFrom.bodyAngle),
        Math.cos(this._interpTo.bodyAngle - this._interpFrom.bodyAngle)
      );
      this.bodyAngle = this._interpFrom.bodyAngle + dAng * u;
      this.wingPhase = lerp(this._interpFrom.wingPhase, this._interpTo.wingPhase);
      this.wingSpread = lerp(this._interpFrom.wingSpread, this._interpTo.wingSpread);
      this.aimOffsetX = lerp(this._interpFrom.aimOffsetX, this._interpTo.aimOffsetX);
    }

    if (this.isDefeated()) {
      this.defeatVibClock += dt;
      this.updateDefeatVibration();
    } else {
      this.headShakeX = 0;
      this.headShakeY = 0;
    }

    this.syncBodyCircles();
  }

  applyDamageAtPoint(px, py, radius, targetCircle, pulseColor, effectsManager, onScore, cooldown = 0.08) {
    if (this.hp <= 0 || this.hitCooldown > 0) return false;
    const isRushing = this.phase === 'charge_rush_down' || this.phase === 'charge_rush_up';
    if (isRushing && this.rushDamaged) return false;
    if (isRushing) {
      this.rushDamaged = true;
    }
    const { COLORS } = GAME_CONFIG;
    this.hitCooldown = cooldown;
    this.hp = Math.max(0, this.hp - 1);

    if (effectsManager) {
      effectsManager.spawnPulse({
        kind: 'circle',
        target: targetCircle || null,
        x: px,
        y: py,
        radius,
        color: pulseColor,
        duration: this.hp > 0 ? 0.42 : 0.55,
        maxScale: this.hp > 0 ? 1.55 : 2.1
      });
    }

    if (this.hp <= 0) {
      this.startDefeatAnimation();
      if (effectsManager) {
        effectsManager.spawnCircleParticles(px, Math.max(40, py), COLORS.white, 22, 60, 220);
      }
      if (onScore) onScore(2000);
    } else if (onScore) {
      onScore(100);
    }
    return true;
  }

  applyDamageAtCircle(circleIndex, pulseColor, effectsManager, onScore, cooldown = 0.08) {
    const circle = this.hitCircles[circleIndex] || this.hitCircles[2] || this.hitCircles[0];
    return this.applyDamageAtPoint(
      circle ? circle.x : this.x,
      circle ? circle.y : this.y,
      circle ? circle.r : 24,
      circle,
      pulseColor,
      effectsManager,
      onScore,
      cooldown
    );
  }

  handleSwingCircleCollision(cx, cy, cr, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1 || this.hitCooldown > 0) return false;
    const { COLORS, HEIGHT } = GAME_CONFIG;
    for (let i = 0; i < this.hitCircles.length; i++) {
      const c = this.hitCircles[i];
      if (c.y + c.r <= 0 || c.y - c.r >= HEIGHT) continue;
      if (Math.hypot(cx - c.x, cy - c.y) <= cr + c.r) {
        return this.applyDamageAtCircle(i, COLORS.white, effectsManager, onScore, 0.22);
      }
    }
    const wingHit = this._findWingCircleHit(cx, cy, cr);
    if (wingHit) {
      return this.applyDamageAtPoint(wingHit.hitX, wingHit.hitY, 24, null, COLORS.white, effectsManager, onScore, 0.22);
    }
    return false;
  }

  canTakeCrackDamage() {
    return !this.isDefeated() && this.introProgress >= 1 && this.hp > 1;
  }

  applyCrackDamage(effectsManager, onScore) {
    if (!this.canTakeCrackDamage()) return null;
    const { COLORS, HEIGHT } = GAME_CONFIG;
    const visible = [];
    for (let i = 0; i < this.hitCircles.length; i++) {
      const c = this.hitCircles[i];
      if (c && c.y + c.r > 0 && c.y - c.r < HEIGHT) {
        visible.push(i);
      }
    }
    if (visible.length === 0) return null;
    const idx = visible[Math.floor(Math.random() * visible.length)];
    this.hitCooldown = 0;
    const applied = this.applyDamageAtCircle(idx, COLORS.white, effectsManager, onScore, 0);
    const circle = this.hitCircles[idx];
    return applied && circle ? { x: circle.x, y: circle.y } : null;
  }

  _reflectBallFromDragon(ball, defaultX, defaultY, nx, ny, BALL) {
    if (this.phase === 'charge_rush_down') {
      // 下突進中にボールを下へ押し込まないよう、左右上方へ逃がして落下を防ぐ
      const side = ball.x >= this.x ? 1 : -1;
      const escapeX = side >= 0 ? Math.max(defaultX, this.x + ball.radius + 16) : Math.min(defaultX, this.x - ball.radius - 16);
      const escapeY = Math.min(ball.y, defaultY);
      this.reflectBall(ball, escapeX, escapeY, side * 0.84, -0.54, BALL);
      return;
    }
    this.reflectBall(ball, defaultX, defaultY, nx, ny, BALL);
  }

  handleBallCollision(ball, effectsManager, onScore) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS, BALL, HEIGHT } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;
    const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

    for (let i = 0; i < this.hitCircles.length; i++) {
      const c = this.hitCircles[i];
      if (c.y + c.r <= 0 || c.y - c.r >= HEIGHT) continue;
      const dx = ball.x - c.x;
      const dy = ball.y - c.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ball.radius + c.r) {
        const nx = dx / (dist || 1);
        const ny = dy / (dist || 1);
        this._reflectBallFromDragon(ball, c.x + nx * (c.r + ball.radius + 2), c.y + ny * (c.r + ball.radius + 2), nx, ny, BALL);
        this.applyDamageAtCircle(i, pulseColor, effectsManager, onScore, 0.08);
        return true;
      }
    }
    const wingHit = this._findWingCircleHit(ball.x, ball.y, ball.radius);
    if (wingHit) {
      let nx = wingHit.dx;
      let ny = wingHit.dy;
      const len = Math.hypot(nx, ny);
      if (wingHit.inside || len < 1e-4) {
        const bSpd = Math.hypot(ball.vx, ball.vy) || 1;
        nx = -ball.vx / bSpd;
        ny = -ball.vy / bSpd;
      } else {
        nx /= len;
        ny /= len;
      }
      this._reflectBallFromDragon(ball, wingHit.hitX + nx * (ball.radius + 3), wingHit.hitY + ny * (ball.radius + 3), nx, ny, BALL);
      this.applyDamageAtPoint(wingHit.hitX, wingHit.hitY, 24, null, pulseColor, effectsManager, onScore, 0.08);
      return true;
    }
    return false;
  }

  reflectBall(ball, newX, newY, nx, ny, BALL) {
    ball.spawningFromCenter = false;
    const prevVy = ball.vy;
    const speed = Math.hypot(ball.vx, ball.vy) || BALL.BASE_SPEED;
    ball.vx = nx * speed;
    ball.vy = ny * speed;
    if (ball.effects.yellow <= 0) {
      ball.clampVerticalAngle(speed);
    } else if (ball.effects.green > 0 && prevVy < 0 && ball.vy > 0) {
      ball.vy /= BALL.GREEN_SPEED_MULTIPLIER;
    }
    ball.x = ColorUtils.clamp(newX, ball.radius, GAME_CONFIG.WIDTH - ball.radius);
    ball.y = Math.max(ball.radius, newY);
  }

  /**
   * 幾何学的な三角形の集まりで構成された片側の翼を描画する
   */
  _renderWingSide(ctx, rootX, rootY, side, wingScaleX, flapAngle, strokeColor, fillColor, strokeIt = true) {
    ctx.save();
    ctx.translate(rootX, rootY);
    ctx.scale(side, 1);
    ctx.rotate(-flapAngle);
    ctx.scale(wingScaleX, 1);
    ctx.fillStyle = fillColor;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = 2.6;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i < DRAGON_WING_OUTLINE.length; i++) {
      const pt = DRAGON_WING_OUTLINE[i];
      if (i === 0) ctx.moveTo(pt[0], pt[1]);
      else ctx.lineTo(pt[0], pt[1]);
    }
    ctx.closePath();
    ctx.fill();
    if (strokeIt) {
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * 翼（三角形群）と円形の胴体・足・尾・頭部を指定スタイルで描画する
   */
  _renderSilhouette(ctx, cx, cy, bodyAngle, aimOffsetX, wingPhase, flapAngle, wingScaleX, strokeColor, fillColor, drawDetails = true) {
    const cosA = Math.cos(bodyAngle || 0);
    const sinA = Math.sin(bodyAngle || 0);
    const tailSway = Math.sin((wingPhase || 0) * 0.8) * 5.5;

    const toWorld = (lx, ly) => ({
      x: cx + lx * cosA - ly * sinA,
      y: cy + lx * sinA + ly * cosA
    });

    const drawCircleIdx = (idx) => {
      const spec = DRAGON_BODY_SPEC[idx];
      const pt = toWorld(
        spec.lx + (aimOffsetX || 0) * spec.aimMul + tailSway * spec.tailMul,
        spec.ly
      );
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, spec.r, 0, Math.PI * 2);
      ctx.fillStyle = fillColor;
      ctx.fill();
      if (drawDetails) {
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      return pt;
    };

    // 1. 尻尾 (背中側)
    drawCircleIdx(5);
    drawCircleIdx(4);

    // 2. 両翼（胴体左右の肩から生える黒三角形群の翼）
    const lRoot = toWorld(-34, -8);
    const rRoot = toWorld(34, -8);
    this._renderWingSide(ctx, lRoot.x, lRoot.y, -1, wingScaleX, flapAngle - bodyAngle, strokeColor, fillColor, drawDetails);
    this._renderWingSide(ctx, rRoot.x, rRoot.y, 1, wingScaleX, flapAngle + bodyAngle, strokeColor, fillColor, drawDetails);

    // 3. 胴体・首・頭（手足・目なし）
    for (let k = 2; k < DRAGON_RENDER_BODY_ORDER.length; k++) {
      drawCircleIdx(DRAGON_RENDER_BODY_ORDER[k]);
    }
  }

  render(ctx) {
    if (this.isDefeated() && !this.isDefeating()) return;
    const { COLORS, ENEMY } = GAME_CONFIG;

    let strokeColor = COLORS.white;
    if (this.blinking) {
      const cycle = (this.blinkTimer || 0) % ENEMY.BLINK_CYCLE;
      strokeColor = cycle < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
    }

    // 0. 突進時の残像を描画
    for (const ai of this.afterimages) {
      ctx.save();
      ctx.globalAlpha = ai.alpha * 0.42;
      this._renderSilhouette(
        ctx,
        ai.x,
        ai.y,
        ai.bodyAngle,
        ai.aimOffsetX,
        ai.wingPhase,
        ai.flapAngle,
        ai.wingScaleX,
        COLORS.white,
        COLORS.white,
        false
      );
      ctx.restore();
    }

    // 1. 本体を描画
    const { cx, cy } = this.syncBodyCircles();
    const { flapAngle, wingScaleX } = this.computeWingPose();
    ctx.save();
    if (this.isDefeating()) {
      const duration = this.defeatDuration || 5.0;
      const u = ColorUtils.clamp(this.phaseTimer / duration, 0, 1);
      ctx.globalAlpha = 1 - Math.pow(u, 1.5);
    }
    this._renderSilhouette(
      ctx,
      cx,
      cy,
      this.bodyAngle,
      this.aimOffsetX,
      this.wingPhase,
      flapAngle,
      wingScaleX,
      strokeColor,
      '#000000',
      true
    );
    ctx.restore();
  }

  serialize() {
    return [
      'dragon',
      this.phase,
      Math.round(this.phaseTimer * 1000) / 1000,
      Math.round(this.introProgress * 1000) / 1000,
      Math.round(this.hp),
      Math.round(this.maxHp),
      this.blinking ? 1 : 0,
      Math.round((this.blinkTimer || 0) * 1000) / 1000,
      Math.round(this.x * 10) / 10,
      Math.round(this.y * 10) / 10,
      Math.round(this.bodyAngle * 10000) / 10000,
      Math.round((this.wingPhase || 0) * 1000) / 1000,
      Math.round((this.wingSpread !== undefined ? this.wingSpread : 1) * 1000) / 1000,
      Math.round((this.aimOffsetX || 0) * 10) / 10
    ];
  }

  applySnapshot(data, interpDuration = null) {
    if (!Array.isArray(data) || data[0] !== 'dragon') return;
    const [
      ,
      phase,
      phaseTimer,
      introProgress,
      hp,
      maxHp,
      blinking,
      blinkTimer,
      x,
      y,
      bodyAngle,
      wingPhase,
      wingSpread,
      aimOffsetX
    ] = data;

    const wasDefeated = this.isDefeated();
    this.phase = phase || 'cooldown';
    this.phaseTimer = phaseTimer || 0;
    this.hp = hp;
    this.maxHp = maxHp;
    this.blinking = Boolean(blinking);
    this.blinkTimer = blinkTimer || 0;

    if (!wasDefeated && this.hp <= 0) {
      this.startDefeatAnimation();
      this.phaseTimer = phaseTimer || 0;
    }

    const targetState = {
      introProgress: introProgress !== undefined ? introProgress : 1,
      x: x !== undefined ? x : this.homeX,
      y: y !== undefined ? y : this.homeY,
      bodyAngle: bodyAngle || 0,
      wingPhase: wingPhase || 0,
      wingSpread: wingSpread !== undefined ? wingSpread : 1,
      aimOffsetX: aimOffsetX || 0
    };

    if (!this._hasSnapInterp || !(interpDuration > 0)) {
      this._hasSnapInterp = true;
      this.setIntroProgress(targetState.introProgress);
      this.x = targetState.x;
      this.y = targetState.y;
      this.bodyAngle = targetState.bodyAngle;
      this.wingPhase = targetState.wingPhase;
      this.wingSpread = targetState.wingSpread;
      this.aimOffsetX = targetState.aimOffsetX;
      this._interpFrom = { ...targetState };
      this._interpTo = { ...targetState };
      this._interpElapsed = 1;
      this._interpDuration = interpDuration || 0.042;
      this.syncBodyCircles();
      return;
    }

    this._interpFrom = {
      introProgress: this.introProgress,
      x: this.x,
      y: this.y,
      bodyAngle: this.bodyAngle,
      wingPhase: this.wingPhase,
      wingSpread: this.wingSpread,
      aimOffsetX: this.aimOffsetX
    };
    this._interpTo = targetState;
    this._interpElapsed = 0;
    this._interpDuration = interpDuration;
  }
}

function createBossForStage(stageData, playerCount = 1) {
  if (stageData && stageData.name === 'snake') {
    return new SnakeBoss(stageData, playerCount);
  }
  if (stageData && stageData.name === 'cloud') {
    return new CloudBoss(stageData, playerCount);
  }
  if (stageData && stageData.name === 'dragon') {
    return new DragonBoss(stageData, playerCount);
  }
  return new BigfootBoss(stageData, playerCount);
}

