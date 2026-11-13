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
class BigfootBoss {
  constructor(stageData) {
    const { WIDTH } = GAME_CONFIG;
    this.netKind = 'boss';
    this.id = 'bigfoot';
    this.name = 'bigfoot';
    this.stageEnemies = Array.isArray(stageData && stageData.enemies)
      ? stageData.enemies.slice()
      : ['triangle', 'pentagon', 'diamond', 'hexagon'];
    this.spawnLimit = (stageData && typeof stageData.spawn_limit === 'number') ? stageData.spawn_limit : 10;

    this.armMaxHp = 15;
    this.headMaxHp = 10;

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

  getArm(side) {
    return side === 'left' ? this.leftArm : (side === 'right' ? this.rightArm : null);
  }

  getHeadVertices() {
    const pivotX = this.pivotX;
    const pivotY = this.basePivotY + this.introOffsetY + this.bodyOffsetY + this.headThrustOffsetY;
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

  fireSpreadBarrage(enemyBullets, effectsManager) {
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

    for (let i = 0; i < bulletCount; i++) {
      const a = minAngle + (i / (bulletCount - 1)) * (maxAngle - minAngle);
      enemyBullets.push({
        x: tip.x,
        y: tip.y,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        damage,
        timer: 0
      });
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
      onScreenShake
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

    if (this.isDefeated() || this.introProgress < 1) {
      if (this.isDefeated()) {
        this.pendingSummons = [];
      }
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
        this.enterCooldown(this.attackCooldown, 'next_punch_or_summon');
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
        this.fireSpreadBarrage(enemyBullets, effectsManager);
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

  /**
   * ボールとの衝突およびダメージ処理
   * - 両腕が残っている間は、顔に当たっても反射するのみでダメージは入らない
   * - ダメージが入った場合はパルスアニメーションを発生させてわかりやすく表現する
   */
  handleBallCollision(ball, effectsManager, onScore, onSpawnItem) {
    if (this.isDefeated() || this.introProgress < 1) return false;
    const { COLORS, BALL } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;

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

          if (arm.hitCooldown <= 0) {
            arm.hitCooldown = 0.08;
            arm.hp = Math.max(0, arm.hp - 1);
            const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

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
              if (onSpawnItem) onSpawnItem(c.x, Math.max(40, c.y), 0.55);
            } else {
              if (onScore) onScore(80);
            }
          }
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
      if (!this.areArmsAlive() && this.head.hitCooldown <= 0) {
        this.head.hitCooldown = 0.08;
        this.head.hp = Math.max(0, this.head.hp - 1);
        const pulseColor = isCyanBall ? COLORS.cyan : COLORS.white;

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
          effectsManager.spawnCircleParticles(this.head.x, Math.max(60, this.head.y - 60), COLORS.white, 22, 60, 220);
          if (onScore) onScore(1500);
        } else {
          if (onScore) onScore(100);
        }
      }
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
    if (this.isDefeated()) return;
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

  applySnapshot(data) {
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
    this.introProgress = introProgress !== undefined ? introProgress : 1;
    this.introOffsetY = -(1 - (1 - Math.pow(1 - ColorUtils.clamp(this.introProgress, 0, 1), 3))) * 235;
    this.bodyOffsetY = bodyOffsetY || 0;
    this.headThrustOffsetY = headThrustOffsetY || 0;
    this.headAngle = headAngle || 0;

    this.head.hp = headHp;
    this.head.maxHp = headMaxHp;
    const verts = this.getHeadVertices();
    this.head.x = verts[2].x;
    this.head.y = verts[2].y;
    this.head.angle = this.headAngle;

    this.leftArm.hp = leftHp;
    this.leftArm.maxHp = leftMaxHp;
    this.leftArm.blinking = !!leftBlink;
    this.leftArm.blinkTimer = leftBlinkTimer || 0;
    if (Array.isArray(leftCircles)) {
      for (let i = 0; i < 3 && i < leftCircles.length; i++) {
        this.leftArm.circles[i].x = leftCircles[i][0];
        this.leftArm.circles[i].y = leftCircles[i][1];
        this.leftArm.circles[i].r = leftCircles[i][2];
        this.leftArm.circles[i].radius = leftCircles[i][2];
      }
    }

    this.rightArm.hp = rightHp;
    this.rightArm.maxHp = rightMaxHp;
    this.rightArm.blinking = !!rightBlink;
    this.rightArm.blinkTimer = rightBlinkTimer || 0;
    if (Array.isArray(rightCircles)) {
      for (let i = 0; i < 3 && i < rightCircles.length; i++) {
        this.rightArm.circles[i].x = rightCircles[i][0];
        this.rightArm.circles[i].y = rightCircles[i][1];
        this.rightArm.circles[i].r = rightCircles[i][2];
        this.rightArm.circles[i].radius = rightCircles[i][2];
      }
    }
  }
}

