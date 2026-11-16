/**
 * エネミークラスおよび敵弾管理
 */
class Enemy {
  constructor(def, spawnX, customId, customVx) {
    Enemy.nextId = Math.max(Enemy.nextId || 0, customId !== undefined ? customId : 0) + (customId !== undefined ? 0 : 1);
    this.netKind = 'enemy';
    this.id = customId !== undefined ? customId : Enemy.nextId;

    const visualScale = (GAME_CONFIG.ENEMY && GAME_CONFIG.ENEMY.VISUAL_SCALE) || 1.5;
    const baseRadius = 17 + (def.health - 1) * 3.5;
    this.name = def.name;
    this.bullet_type = def.bullet_type;
    this.movement_type = def.movement_type;
    this.maxHealth = def.health;
    this.health = def.health;
    this.damage = def.damage;
    this.fire_rate = typeof def.fire_rate === 'number' ? def.fire_rate : 0;

    this.x = spawnX;
    this.y = -baseRadius * visualScale - 8; // 画面外の上から出現
    this.originX = spawnX;
    this.vx = customVx !== undefined ? customVx : (Math.random() < 0.5 ? -1 : 1) * 75;
    this.speedMultiplier = typeof def.speed === 'number' ? def.speed : 1;
    this.vy = 20 * this.speedMultiplier; // すべての敵が非常に緩やかな速度で徐々に下へ移動
    this.gravity = typeof def.gravity === 'number' ? def.gravity : 0;
    this.hiddenByCloud = false;
    this.baseRadius = baseRadius;
    this.currentRadius = baseRadius;
    this.targetRadius = baseRadius;
    this.rotation = def.name === 'crescent' ? Math.PI / 2 : 0;
    this.timeAlive = 0;
    this.hitCooldown = 0;
    this.fireTimer = this.movement_type === 'aimed_fall'
      ? this.fire_rate
      : (this.fire_rate > 0 ? this.fire_rate * 0.75 : 0);
    this.burstRemaining = 0;
    this.burstTimer = 0;
    this.burstTargetSlot = null;
    this.hoverY = 160 + Math.random() * 140;
    this._hasFiredOnce = false;
    this._shotSeq = 0;
    this._counterUseAimed = false;
    this._pendingSpawnedBullets = [];
    this._pendingSplitEnemies = [];
    this.localAutoFire = false;
    this.corrX = 0;
    this.corrY = 0;
    this._prevY = this.y;

    // laser / aimed_laser 用状態
    this.laserAngle = Math.PI / 2;
    this.laserAimLocked = false;
    this.laserActiveTimer = 0;
    this.laserDuration = 0.5;
    this.laserBlinkTimer = 0;
    this.laserDamageCooldowns = new Map();

    // aimed_fall (scissors) 用状態
    this.aimedFallPhase = 'aiming'; // 'aiming' -> 'charging' -> 'diving'
    this.aimedFallTimer = 0;
    this.aimedFallTargetSlot = null;
    this._aimedFallTargetChanged = false;
    this.afterimages = [];
    this.afterimageSpawnTimer = 0;
  }

  static makeAutoBulletId(enemyId, shotSeq, subIdx = 0) {
    // 確定的発射（single/spread）はホスト・クライアント間で同一IDを生成する
    return (0x40000000 + ((enemyId & 0xffff) * 1000) + ((shotSeq & 0xff) * 4) + (subIdx & 0x03)) >>> 0;
  }

  isDeterministicShooter() {
    return (this.bullet_type === 'single' || this.bullet_type === 'spread') && this.fire_rate > 0;
  }

  isLaserShooter() {
    return this.bullet_type === 'laser' || this.bullet_type === 'aimed_laser';
  }

  isLaserTelegraphing() {
    return (
      !this.hiddenByCloud &&
      this.isLaserShooter() &&
      this.laserActiveTimer <= 0 &&
      this.fireTimer > 0 &&
      this.fireTimer <= 1.0 &&
      this.y >= this.currentRadius
    );
  }

  isLaserFiring() {
    return this.isLaserShooter() && this.laserActiveTimer > 0;
  }

  isMovementPausedForAction() {
    if (this.isLaserTelegraphing() || this.isLaserFiring()) {
      return true;
    }
    if (this.movement_type === 'aimed_fall' && this.aimedFallPhase === 'charging') {
      return true;
    }
    return false;
  }

  getLaserMaxWidth() {
    const visualScale = (GAME_CONFIG.ENEMY && GAME_CONFIG.ENEMY.VISUAL_SCALE) || 1.5;
    return this.currentRadius * visualScale * 1.6;
  }

  getLaserCurrentWidth() {
    if (this.laserActiveTimer <= 0 || this.laserDuration <= 0) return 0;
    const ratio = ColorUtils.clamp(this.laserActiveTimer / this.laserDuration, 0, 1);
    return this.getLaserMaxWidth() * ratio;
  }

  /**
   * レーザー帯（始点 ox, oy から角度 angle 方向へ長さ length・幅 width の回転矩形）とパドルAABBの交差判定 (SAT)
   */
  static laserBeamIntersectsRect(ox, oy, angle, length, width, left, top, right, bottom) {
    if (width <= 0 || length <= 0) return null;
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    const halfW = width * 0.5;

    const c0x = ox + nx * halfW;
    const c0y = oy + ny * halfW;
    const c1x = ox - nx * halfW;
    const c1y = oy - ny * halfW;
    const c2x = ox + ux * length - nx * halfW;
    const c2y = oy + uy * length - ny * halfW;
    const c3x = ox + ux * length + nx * halfW;
    const c3y = oy + uy * length + ny * halfW;

    const minX = Math.min(c0x, c1x, c2x, c3x);
    const maxX = Math.max(c0x, c1x, c2x, c3x);
    if (maxX < left || minX > right) return null;

    const minY = Math.min(c0y, c1y, c2y, c3y);
    const maxY = Math.max(c0y, c1y, c2y, c3y);
    if (maxY < top || minY > bottom) return null;

    const rCorners = [
      [left - ox, top - oy],
      [right - ox, top - oy],
      [right - ox, bottom - oy],
      [left - ox, bottom - oy]
    ];

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < 4; i++) {
      const rx = rCorners[i][0];
      const ry = rCorners[i][1];
      const u = rx * ux + ry * uy;
      const v = rx * nx + ry * ny;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }

    if (maxU < 0 || minU > length) return null;
    if (maxV < -halfW || minV > halfW) return null;

    const midY = (top + bottom) * 0.5;
    const tRay = Math.abs(uy) > 0.001 ? Math.max(0, (midY - oy) / uy) : 0;
    return {
      x: ColorUtils.clamp(ox + ux * tRay, left, right),
      y: midY
    };
  }

  /**
   * スペード型の explode 弾が指定高度まで降下したら6方向へ丸形敵弾を拡散させる
   */
  static maybeExplodeSpadeBullet(b, enemyBullets, effectsManager) {
    if (!b || b.shape !== 'spade' || !b.explodeY || b.y < b.explodeY) {
      return false;
    }
    const { COLORS } = GAME_CONFIG;
    const overshootSec = b.vy > 0 ? Math.max(0, (b.y - b.explodeY) / b.vy) : 0;
    const originX = b.x - (b.vx || 0) * overshootSec;
    const originY = b.explodeY;

    if (effectsManager) {
      effectsManager.spawnCircleParticles(originX, originY, COLORS.white, 8, 40, 145);
    }

    const baseId = b.id !== undefined ? (((b.id & 0x0fffffff) * 8) | 0x80000000) >>> 0 : undefined;
    const childSpeed = 185;
    const splitCount = b.explodeCount || 6;
    for (let k = 0; k < splitCount; k++) {
      const a = (k / splitCount) * Math.PI * 2;
      const vx = Math.cos(a) * childSpeed;
      const vy = Math.sin(a) * childSpeed;
      enemyBullets.push({
        id: baseId !== undefined ? (baseId + k) >>> 0 : undefined,
        x: originX + vx * overshootSec,
        y: originY + vy * overshootSec,
        vx,
        vy,
        angle: a,
        speed: childSpeed,
        damage: b.damage,
        timer: overshootSec
      });
    }
    return true;
  }

  /**
   * 追尾系・自機狙い弾の射角が妥当（下向きかつ真下からの角度が許容範囲内）かを判定する
   */
  static isAimAngleValid(dx, dy, maxOffsetFromDown = Math.PI / 3) {
    if (dy <= 0) return false;
    return Math.abs(Math.atan2(dx, dy)) <= maxOffsetFromDown;
  }

  /**
   * 敵弾の1フレーム進行（通常等速 / 減速停止->遅延加速弾を共通処理）
   */
  static stepBulletMotion(b, dt) {
    b.timer = (b.timer || 0) + dt;
    if (b.homingMode === 'decel') {
      const decelDur = b.decelDuration || 0.4;
      const initVx = b.initVx !== undefined ? b.initVx : b.vx;
      const initVy = b.initVy !== undefined ? b.initVy : b.vy;
      const prevT = b.homingTimer || 0;
      b.homingTimer = prevT + dt;

      if (prevT < decelDur) {
        const effDt = Math.min(dt, decelDur - prevT);
        const t0 = prevT / decelDur;
        const t1 = (prevT + effDt) / decelDur;
        const avgFactor = 1 - 0.5 * (t0 + t1);
        b.x += initVx * avgFactor * effDt;
        b.y += initVy * avgFactor * effDt;
      }

      if (b.homingTimer >= decelDur) {
        b.vx = 0;
        b.vy = 0;
        b.speed = 0;
        b.waitAfterStop = Math.max(0, b.homingTimer - decelDur);
      } else {
        const factor = 1 - b.homingTimer / decelDur;
        b.vx = initVx * factor;
        b.vy = initVy * factor;
        b.speed = Math.hypot(b.vx, b.vy);
      }
      return;
    }

    if (b.homingMode === 'accel') {
      const maxSpd = b.maxSpeed || 540;
      const accel = b.accel || 520;
      const prevSpd = b.speed || 0;
      const nextSpd = Math.min(maxSpd, prevSpd + accel * dt);
      const avgSpd = 0.5 * (prevSpd + nextSpd);
      const ux = Math.cos(b.angle || 0);
      const uy = Math.sin(b.angle || 0);
      b.speed = nextSpd;
      b.vx = ux * nextSpd;
      b.vy = uy * nextSpd;
      b.x += ux * avgSpd * dt;
      b.y += uy * avgSpd * dt;
      return;
    }

    if (b.motionMode === 'knife') {
      const riseDur = 0.5;
      const waitDur = 0.5;
      const launchAt = riseDur + waitDur;
      const prevT = b.knifeElapsed || 0;
      const t = prevT + dt;
      b.knifeElapsed = t;

      const holdX = b.knifeHoldX !== undefined ? b.knifeHoldX : b.x;
      const holdY = b.knifeHoldY !== undefined ? b.knifeHoldY : b.y;
      const riseOffset = b.knifeRiseY !== undefined ? b.knifeRiseY : 52;
      const targetAng = b.angle !== undefined ? b.angle : Math.PI / 2;

      if (t < riseDur) {
        const u = t / riseDur;
        const ease = 1 - Math.pow(1 - u, 3);
        b.x = holdX;
        b.y = holdY + riseOffset * (1 - ease);
        b.knifeAlpha = ColorUtils.clamp(t / 0.28, 0, 1);
        b.knifeVisualAngle = targetAng - Math.PI * 2 * (1 - ease);
        b.vx = 0;
        b.vy = 0;
      } else if (t < launchAt) {
        b.x = holdX;
        b.y = holdY;
        b.knifeAlpha = 1;
        b.knifeVisualAngle = targetAng;
        b.vx = 0;
        b.vy = 0;
      } else {
        b.knifeAlpha = 1;
        b.knifeVisualAngle = targetAng;
        const spd = b.speed || 920;
        b.vx = Math.cos(targetAng) * spd;
        b.vy = Math.sin(targetAng) * spd;
        if (prevT < launchAt) {
          b.x = holdX;
          b.y = holdY;
        }
        Enemy.recordBulletTrail(b, 14);
        const effDt = prevT < launchAt ? (t - launchAt) : dt;
        b.x += b.vx * effDt;
        b.y += b.vy * effDt;
      }
      return;
    }

    if (b.motionMode === 'arc') {
      const dur = Math.max(0.1, b.arcDur || 1.4);
      const startX = b.arcStartX !== undefined ? b.arcStartX : b.x;
      const startY = b.arcStartY !== undefined ? b.arcStartY : b.y;
      const targetX = b.arcTargetX !== undefined ? b.arcTargetX : b.x;
      const targetY = b.arcTargetY !== undefined ? b.arcTargetY : GAME_CONFIG.PADDLE.Y;
      const bend = b.arcBend || 0;
      b.arcElapsed = (b.arcElapsed || 0) + dt;
      const u = b.arcElapsed / dur;

      Enemy.recordBulletTrail(b, 14);

      if (u <= 1) {
        const dxLin = targetX - startX;
        const dyLin = targetY - startY;
        b.x = startX + dxLin * u + bend * Math.sin(Math.PI * u);
        b.y = startY + dyLin * u;
        b.vx = dxLin / dur + bend * (Math.PI / dur) * Math.cos(Math.PI * u);
        b.vy = dyLin / dur;
        b.speed = Math.hypot(b.vx, b.vy);
        b.angle = Math.atan2(b.vy, b.vx);
      } else {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
      }
      return;
    }

    if (b.shape === 'crescent' || b.bounceWalls) {
      Enemy.recordBulletTrail(b, 14);
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;

    if (b.bounceWalls) {
      const margin = 8;
      if (b.x <= margin && b.vx < 0) {
        b.x = margin + (margin - b.x);
        b.vx = -b.vx;
        b.angle = Math.atan2(b.vy, b.vx);
      } else if (b.x >= GAME_CONFIG.WIDTH - margin && b.vx > 0) {
        b.x = (GAME_CONFIG.WIDTH - margin) - (b.x - (GAME_CONFIG.WIDTH - margin));
        b.vx = -b.vx;
        b.angle = Math.atan2(b.vy, b.vx);
      }
    }
  }

  /**
   * 残像付き敵弾の過去座標を一定間隔で記録する
   */
  static recordBulletTrail(b, maxLen = 14) {
    if (!Array.isArray(b.trail)) {
      b.trail = [];
    }
    const last = b.trail.length > 0 ? b.trail[b.trail.length - 1] : null;
    if (!last || Math.hypot(b.x - last.x, b.y - last.y) >= 4) {
      b.trail.push({ x: b.x, y: b.y });
      if (b.trail.length > maxLen) {
        b.trail.shift();
      }
    }
  }

  /**
   * connect タイプの敵（2体以上）間の接続ペア一覧を返す
   */
  static getConnectLaserPairs(enemies) {
    const connected = [];
    for (const e of enemies) {
      if (e && e.bullet_type === 'connect' && e.y >= -e.currentRadius * 0.5) {
        connected.push(e);
      }
    }
    const pairs = [];
    for (let i = 0; i < connected.length; i++) {
      for (let j = i + 1; j < connected.length; j++) {
        pairs.push([connected[i], connected[j]]);
      }
    }
    return pairs;
  }

  /**
   * 1pxレーザー線分とパドル矩形の交差判定 (Liang-Barsky)
   */
  static segmentIntersectsRect(x1, y1, x2, y2, left, top, right, bottom) {
    let t0 = 0;
    let t1 = 1;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const p = [-dx, dx, -dy, dy];
    const q = [x1 - left, right - x1, y1 - top, bottom - y1];
    for (let i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        const r = q[i] / p[i];
        if (p[i] < 0) {
          if (r > t1) return null;
          if (r > t0) t0 = r;
        } else {
          if (r < t0) return null;
          if (r < t1) t1 = r;
        }
      }
    }
    if (t0 > t1) return null;
    const midT = (t0 + t1) * 0.5;
    return {
      x: x1 + dx * midT,
      y: y1 + dy * midT
    };
  }

  _checkAndApplyLaserDamage(paddleList, effectsManager, onDamagePaddle) {
    if (!onDamagePaddle) return;
    const { COLORS } = GAME_CONFIG;
    const laserW = this.getLaserCurrentWidth();
    if (laserW <= 0.5) return;
    for (const p of paddleList) {
      if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
      if (this.laserDamageCooldowns.has(p.slot)) continue;
      const hit = Enemy.laserBeamIntersectsRect(
        this.x,
        this.y,
        this.laserAngle,
        1200,
        laserW,
        p.x - p.currentWidth / 2,
        p.y - p.height / 2,
        p.x + p.currentWidth / 2,
        p.y + p.height / 2
      );
      if (hit) {
        onDamagePaddle(p, this.damage);
        this.laserDamageCooldowns.set(p.slot, 0.05);
        if (effectsManager) {
          effectsManager.spawnCircleParticles(hit.x, hit.y, COLORS.red, 5, 30, 110);
        }
      }
    }
  }

  update(dt, paddles, enemyBullets, effectsManager, onDamagePaddle, netHooks = null) {
    const { HEIGHT, COLORS } = GAME_CONFIG;
    const paddleList = Array.isArray(paddles) ? paddles : (paddles ? [paddles] : []);
    this.stepMovementAndAnimation(dt, paddleList);

    // aimed_fall (scissors): fire_rate経過後に1秒その位置で止まり赤白点滅、1秒経過後に高速＋残像で下へ降下（雲に隠れている間は攻撃不可）
    if (this.movement_type === 'aimed_fall') {
      if (this.aimedFallPhase === 'aiming') {
        if (this._aimedFallTargetChanged) {
          this._aimedFallTargetChanged = false;
          if (netHooks && netHooks.onEnemyStateSync) {
            netHooks.onEnemyStateSync(this, 2);
          }
        }
        if (!this.hiddenByCloud) {
          this.fireTimer -= dt;
          if (this.fireTimer <= 0) {
            this.aimedFallPhase = 'charging';
            this.aimedFallTimer = 1.0;
            this.vx = 0;
            this.vy = 0;
            if (netHooks && netHooks.onEnemyStateSync) {
              netHooks.onEnemyStateSync(this, 2);
            }
          }
        }
      } else if (this.aimedFallPhase === 'charging') {
        this.aimedFallTimer -= dt;
        if (this.aimedFallTimer <= 0) {
          this.aimedFallPhase = 'diving';
          this.vy = 1150;
          this.afterimageSpawnTimer = 0;
          if (netHooks && netHooks.onEnemyStateSync) {
            netHooks.onEnemyStateSync(this, 2);
          }
        }
      }
    }

    // laser / aimed_laser (arrow / sparkle): 射撃1秒前に横移動停止＆白→赤点線、射撃時に500msの間100%→0%幅レーザー照射 (50msごと1ダメージ)
    if (this.isLaserShooter()) {
      if (this.laserActiveTimer > 0) {
        this.laserBlinkTimer += dt;
        for (const [slot, cd] of this.laserDamageCooldowns) {
          const next = cd - dt;
          if (next <= 1e-6) this.laserDamageCooldowns.delete(slot);
          else this.laserDamageCooldowns.set(slot, next);
        }
        this._checkAndApplyLaserDamage(paddleList, effectsManager, onDamagePaddle);
        this.laserActiveTimer = Math.max(0, this.laserActiveTimer - dt);
        if (this.laserActiveTimer <= 1e-6) {
          this.laserActiveTimer = 0;
          this.laserAimLocked = false;
          this.laserDamageCooldowns.clear();
        }
      } else if (!this.hiddenByCloud && this.y >= this.currentRadius && this.fire_rate > 0) {
        this.fireTimer -= dt;
        if (this.fireTimer <= 1.0 && !this.laserAimLocked) {
          this.laserAimLocked = true;
          if (this.bullet_type === 'aimed_laser') {
            const alivePaddles = paddleList.filter((p) => p && p.hp > 0);
            if (alivePaddles.length > 0) {
              const picked = alivePaddles[Math.floor(Math.random() * alivePaddles.length)];
              const dx = picked.x - this.x;
              const dy = picked.y - this.y;
              this.laserAngle = dy > 4 ? Math.atan2(dy, dx) : Math.PI / 2;
            } else {
              this.laserAngle = Math.PI / 2;
            }
          } else {
            this.laserAngle = Math.PI / 2;
          }
          if (netHooks && netHooks.onEnemyStateSync) {
            netHooks.onEnemyStateSync(this, 1);
          }
        }
        if (this.fireTimer <= 0) {
          this.laserActiveTimer = 0.5;
          this.laserDuration = 0.5;
          this.laserBlinkTimer = 0;
          this.laserDamageCooldowns.clear();
          this.fireTimer = this.fire_rate;
          this._checkAndApplyLaserDamage(paddleList, effectsManager, onDamagePaddle);
        }
      }
    } else if (
      // 通常射撃タイプの敵は画面内に入り、かつ雲に隠れていない時に射撃間隔 (fire_rate) に従って弾を発射
      !this.hiddenByCloud &&
      this.bullet_type !== 'self_destruction' &&
      this.bullet_type !== 'self_explosion' &&
      this.bullet_type !== 'connect' &&
      this.fire_rate > 0 &&
      this.y >= this.currentRadius
    ) {
      if (this.burstRemaining > 0) {
        this.burstTimer -= dt;
        while (this.burstRemaining > 0 && this.burstTimer <= 0) {
          const b = this.bullet_type === 'aimed_3round'
            ? this._spawnAimedBurstBullet(paddleList, enemyBullets)
            : this._spawnWobbledDownBullet(enemyBullets);
          this.burstRemaining -= 1;
          this.burstTimer += this.bullet_type === 'aimed_3round'
            ? 0.14
            : (0.14 + (Math.random() - 0.5) * 0.04);
          if (b && netHooks && netHooks.onBulletsSpawned) {
            netHooks.onBulletsSpawned([b], this);
          }
        }
      }

      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        const spawnedBullets = this.fireBullet(paddleList, enemyBullets);
        if (netHooks && spawnedBullets.length > 0) {
          if (this.isDeterministicShooter()) {
            if (!this._hasFiredOnce) {
              this._hasFiredOnce = true;
              if (netHooks.onFirstDeterministicShot) {
                netHooks.onFirstDeterministicShot(this);
              }
            }
          } else if (netHooks.onBulletsSpawned) {
            netHooks.onBulletsSpawned(spawnedBullets, this);
          }
        }
        this.fireTimer += this.fire_rate;
        if (this.fireTimer <= 0) {
          this.fireTimer = this.fire_rate;
        }
      }
    }

    // self_destruction / connect の敵のみ、敵自体がパドルへの被弾判定を持ち、触れると消滅する
    if (this.bullet_type === 'self_destruction' || this.bullet_type === 'connect') {
      const hitX = this.x;
      const hitHalfW = this.name === 'square' ? this.currentRadius * 0.85 : 0;
      const prevHitY = (this._prevY !== undefined ? this._prevY : this.y) + this.currentRadius * 0.75;
      const hitY = this.y + this.currentRadius * 0.75;
      const minHitY = Math.min(prevHitY, hitY) - hitHalfW;
      const maxHitY = Math.max(prevHitY, hitY);
      let hitAny = false;
      for (const p of paddleList) {
        if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
        const pLeft = p.x - p.currentWidth / 2;
        const pRight = p.x + p.currentWidth / 2;
        const pTop = p.y - p.height / 2;
        const pBottom = p.y + p.height / 2;

        if (hitX + hitHalfW >= pLeft && hitX - hitHalfW <= pRight && maxHitY >= pTop && minHitY <= pBottom) {
          onDamagePaddle(p, this.damage);
          hitAny = true;
        }
      }
      if (hitAny) {
        effectsManager.spawnCircleParticles(this.x, this.y, COLORS.red, 10, 40, 150);
        return false; // 消滅
      }
    } else if (this.bullet_type === 'self_explosion') {
      // bomb (self_explosion): パドルに触れるかパドルのY座標まで降下すると爆発し、距離に応じた割合ダメージを与える
      const { PADDLE } = GAME_CONFIG;
      let shouldExplode = this.y >= PADDLE.Y;
      if (!shouldExplode) {
        const hitHalfW = this.currentRadius * 0.72;
        const prevHitY = (this._prevY !== undefined ? this._prevY : this.y) + this.currentRadius * 0.72;
        const hitY = this.y + this.currentRadius * 0.72;
        const minHitY = Math.min(prevHitY, hitY) - hitHalfW;
        const maxHitY = Math.max(prevHitY, hitY);
        for (const p of paddleList) {
          if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
          const pLeft = p.x - p.currentWidth / 2;
          const pRight = p.x + p.currentWidth / 2;
          const pTop = p.y - p.height / 2;
          const pBottom = p.y + p.height / 2;
          if (this.x + hitHalfW >= pLeft && this.x - hitHalfW <= pRight && maxHitY >= pTop && minHitY <= pBottom) {
            shouldExplode = true;
            break;
          }
        }
      }
      if (shouldExplode) {
        this.triggerSelfExplosion(effectsManager, paddleList, onDamagePaddle, netHooks);
        return false; // 爆発して消滅
      }
    }

    if (this.y - this.currentRadius > HEIGHT + 20) {
      return false;
    }

    return true;
  }

  stepMovementAndAnimation(dt, paddleList = []) {
    const { WIDTH, ENEMY, COLORS } = GAME_CONFIG;
    this._prevY = this.y;
    this.timeAlive += dt;
    if (this.corrX || this.corrY) {
      const decay = Math.exp(-16 * dt);
      this.corrX *= decay;
      this.corrY *= decay;
      if (Math.abs(this.corrX) < 0.05) this.corrX = 0;
      if (Math.abs(this.corrY) < 0.05) this.corrY = 0;
    }
    if (this.hitCooldown > 0) {
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    }
    this.currentRadius += (this.targetRadius - this.currentRadius) * Math.min(1, dt * 14);

    if (this.afterimages && this.afterimages.length > 0) {
      for (let i = this.afterimages.length - 1; i >= 0; i--) {
        const ai = this.afterimages[i];
        ai.timer += dt;
        ai.alpha = Math.max(0, (1 - ai.timer / ai.duration) * 0.55);
        if (ai.timer >= ai.duration) {
          this.afterimages.splice(i, 1);
        }
      }
    }

    // aimed_fall (scissors) の1秒停止中は完全停止
    if (this.movement_type === 'aimed_fall' && this.aimedFallPhase === 'charging') {
      return;
    }

    // gravity_fall (Cloudボスが落とす四角形ダメージ箱): 重力加速度＋初期速度ベクトルを適用
    if (this.movement_type === 'gravity_fall' || this.gravity > 0) {
      const g = this.gravity || 360;
      const prevVy = this.vy;
      this.vy += g * dt;
      this.y += 0.5 * (prevVy + this.vy) * dt;
      this.x += this.vx * dt;
      const minX = this.currentRadius;
      const maxX = WIDTH - this.currentRadius;
      if (this.x < minX) {
        this.x = minX;
        this.vx = Math.abs(this.vx);
      } else if (this.x > maxX) {
        this.x = maxX;
        this.vx = -Math.abs(this.vx);
      }
      this.rotation += ((this.vx || 0) * 0.012 + 1.8) * dt;
      return;
    }

    // すべての敵が非常に緩やかな速度で徐々に下へと移動する
    this.y += this.vy * dt;

    // レーザー予告・照射中は movement_type の横移動等を無視して一時停止（下方向への移動は継続）
    if (this.isLaserTelegraphing() || this.isLaserFiring()) {
      return;
    }

    if (this.movement_type === 'aimed_fall') {
      if (this.aimedFallPhase === 'aiming') {
        const alivePaddles = Array.isArray(paddleList) ? paddleList.filter((p) => p && p.hp > 0) : [];
        let targetPaddle = alivePaddles.find((p) => p.slot === this.aimedFallTargetSlot) || null;
        if (!targetPaddle && alivePaddles.length > 0) {
          targetPaddle = alivePaddles[Math.floor(Math.random() * alivePaddles.length)];
          this.aimedFallTargetSlot = targetPaddle.slot;
          this._aimedFallTargetChanged = true;
        }
        if (targetPaddle) {
          const dx = targetPaddle.x - this.x;
          const maxStep = 185 * dt;
          const moveX = ColorUtils.clamp(dx * Math.min(1, dt * 6.5), -maxStep, maxStep);
          const minX = this.currentRadius;
          const maxX = WIDTH - this.currentRadius;
          this.x = ColorUtils.clamp(this.x + moveX, minX, maxX);
        }
      } else if (this.aimedFallPhase === 'diving') {
        this.afterimageSpawnTimer -= dt;
        const visualScale = (ENEMY && ENEMY.VISUAL_SCALE) || 1.5;
        while (this.afterimageSpawnTimer <= 0) {
          this.afterimageSpawnTimer += 0.018;
          const phase = this.timeAlive % ENEMY.BLINK_CYCLE;
          const trailColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
          this.afterimages.push({
            x: this.x + (this.corrX || 0),
            y: this.y + (this.corrY || 0),
            radius: this.currentRadius * visualScale,
            rotation: this.rotation,
            color: trailColor,
            alpha: 0.55,
            timer: 0,
            duration: 0.22
          });
        }
      }
      return;
    }

    if (this.movement_type === 'fall') {
      // 右回転しながらゆっくり降下（speed倍率に応じて右回転速度もスケーリング）
      this.rotation += 1.4 * (this.speedMultiplier || 1) * dt;
    } else if (this.movement_type === 'retro') {
      // 画面端まで左右にゆっくり往復移動（折り返し時の段差移動なし）
      this.x += this.vx * dt;
      const minX = this.currentRadius;
      const maxX = WIDTH - this.currentRadius;
      if (this.vx < 0 && this.x <= minX) {
        this.x = minX;
        this.vx = Math.abs(this.vx);
      } else if (this.vx > 0 && this.x >= maxX) {
        this.x = maxX;
        this.vx = -Math.abs(this.vx);
      }
    } else if (this.movement_type === 'float') {
      // retroのように画面端で折り返しつつ、横移動速度と回転速度に揺らぎがある
      const phase = (this.id || 0) * 1.3;
      const speedFactor = 1.0 + Math.sin(this.timeAlive * 2.1 + phase) * 0.35;
      this.x += this.vx * speedFactor * dt;
      const minX = this.currentRadius;
      const maxX = WIDTH - this.currentRadius;
      if (this.vx < 0 && this.x <= minX) {
        this.x = minX;
        this.vx = Math.abs(this.vx);
      } else if (this.vx > 0 && this.x >= maxX) {
        this.x = maxX;
        this.vx = -Math.abs(this.vx);
      }
      const rotDir = (this.id || 0) % 2 === 0 ? 1 : -1;
      const rotSpeed = 0.65 + Math.sin(this.timeAlive * 1.7 + phase * 0.7) * 0.3;
      this.rotation += rotDir * rotSpeed * dt;
    } else if (this.movement_type === 'sway') {
      this.x = ColorUtils.clamp(
        this.originX + Math.sin(this.timeAlive * 2.2) * 85,
        this.currentRadius + 12,
        WIDTH - this.currentRadius - 12
      );
      this.rotation = Math.sin(this.timeAlive * 2.2) * 0.25;
    } else if (this.movement_type === 'parasol') {
      const margin = this.currentRadius + 16;
      const dir = (this.id || 0) % 2 === 0 ? 1 : -1;
      const targetX = ColorUtils.clamp(
        this.originX + Math.sin(this.timeAlive * 1.55) * 76 * dir,
        margin,
        WIDTH - margin
      );
      this.vx = dt > 0 ? (targetX - this.x) / dt : 0;
      this.x = targetX;
      this.rotation = Math.sin(this.timeAlive * 1.55) * 0.22 * dir;
    } else if (this.movement_type === 'hover') {
      this.x += this.vx * dt;
      if (this.x - this.currentRadius <= 20) {
        this.x = this.currentRadius + 20;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.currentRadius >= WIDTH - 20) {
        this.x = WIDTH - this.currentRadius - 20;
        this.vx = -Math.abs(this.vx);
      }
      this.rotation += 0.65 * dt;
    } else if (this.movement_type === 'zigzag') {
      this.x += this.vx * 1.1 * dt;
      if (this.x - this.currentRadius <= 16) {
        this.x = this.currentRadius + 16;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.currentRadius >= WIDTH - 16) {
        this.x = WIDTH - this.currentRadius - 16;
        this.vx = -Math.abs(this.vx);
      }
      this.rotation += 1.0 * dt;
    }
  }

  updateClient(dt, enemyBullets, paddles = []) {
    const { HEIGHT } = GAME_CONFIG;
    const paddleList = Array.isArray(paddles) ? paddles : (paddles ? [paddles] : []);
    this.stepMovementAndAnimation(dt, paddleList);

    if (this.movement_type === 'aimed_fall') {
      if (this.aimedFallPhase === 'aiming') {
        if (!this.hiddenByCloud) {
          this.fireTimer -= dt;
          if (this.fireTimer <= 0) {
            this.aimedFallPhase = 'charging';
            this.aimedFallTimer = 1.0;
            this.vx = 0;
            this.vy = 0;
          }
        }
      } else if (this.aimedFallPhase === 'charging') {
        this.aimedFallTimer -= dt;
        if (this.aimedFallTimer <= 0) {
          this.aimedFallPhase = 'diving';
          this.vy = 1150;
          this.afterimageSpawnTimer = 0;
        }
      }
    }

    if (this.isLaserShooter()) {
      if (this.laserActiveTimer > 0) {
        this.laserBlinkTimer += dt;
        this.laserActiveTimer = Math.max(0, this.laserActiveTimer - dt);
        if (this.laserActiveTimer <= 1e-6) {
          this.laserActiveTimer = 0;
          this.laserAimLocked = false;
        }
      } else if (!this.hiddenByCloud && this.y >= this.currentRadius && this.fire_rate > 0) {
        this.fireTimer -= dt;
        if (this.fireTimer <= 1.0 && !this.laserAimLocked) {
          this.laserAimLocked = true;
          if (this.bullet_type === 'laser') {
            this.laserAngle = Math.PI / 2;
          }
        }
        if (this.fireTimer <= 0) {
          this.laserActiveTimer = 0.5;
          this.laserDuration = 0.5;
          this.laserBlinkTimer = 0;
          this.fireTimer = this.fire_rate;
        }
      }
    } else if (!this.hiddenByCloud && this.localAutoFire && this.isDeterministicShooter()) {
      // 確定的エネミーは最初の射撃タイムスタンプ受信後、ローカルで後続射撃を完全再現する
      this.fireTimer -= dt;
      let guard = 0;
      while (this.fireTimer <= 0 && guard < 4) {
        guard += 1;
        this.fireBullet([], enemyBullets);
        this.fireTimer += this.fire_rate;
      }
    }

    if (this.bullet_type === 'self_explosion' && this.y > GAME_CONFIG.PADDLE.Y) {
      this.y = GAME_CONFIG.PADDLE.Y;
    }

    return this.y - this.currentRadius <= HEIGHT + 20;
  }

  _spawnWobbledDownBullet(enemyBullets) {
    const a = Math.PI / 2 + (Math.random() - 0.5) * 0.34;
    const spd = 205 + (Math.random() - 0.5) * 24;
    const b = {
      x: this.x,
      y: this.y + this.currentRadius * 0.85,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      angle: a,
      speed: spd,
      damage: this.damage,
      timer: 0
    };
    enemyBullets.push(b);
    return b;
  }

  _spawnAimedBurstBullet(paddleList, enemyBullets) {
    const { PADDLE } = GAME_CONFIG;
    const alivePaddles = Array.isArray(paddleList) ? paddleList.filter((p) => p && p.hp > 0) : [];
    if (alivePaddles.length === 0) return null;
    let target = alivePaddles.find((p) => p.slot === this.burstTargetSlot) || null;
    if (!target) {
      target = alivePaddles[Math.floor(Math.random() * alivePaddles.length)];
      this.burstTargetSlot = target.slot;
    }
    const spawnY = this.y + this.currentRadius * 0.85;
    const dx = target.x - this.x;
    const dy = (target.y !== undefined ? target.y : PADDLE.Y) - spawnY;
    if (!Enemy.isAimAngleValid(dx, dy)) return null;
    const a = Math.atan2(dy, dx);
    const spd = 215;
    const b = {
      x: this.x,
      y: spawnY,
      vx: Math.cos(a) * spd,
      vy: Math.sin(a) * spd,
      angle: a,
      speed: spd,
      damage: this.damage,
      timer: 0
    };
    enemyBullets.push(b);
    return b;
  }

  _fireSingleDownBullet(enemyBullets, deterministic = true) {
    const seq = deterministic ? this._shotSeq++ : undefined;
    const b = {
      x: this.x,
      y: this.y + this.currentRadius,
      vx: 0,
      vy: 205,
      angle: Math.PI / 2,
      speed: 205,
      damage: this.damage,
      timer: 0
    };
    if (deterministic) {
      b.id = Enemy.makeAutoBulletId(this.id, seq, 0);
    }
    enemyBullets.push(b);
    return b;
  }

  _fireAimedBullet(paddleList, enemyBullets, predictLead = false, speed = 230, shape = undefined) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    const alivePaddles = Array.isArray(paddleList) ? paddleList.filter((p) => p && p.hp > 0) : [];
    if (alivePaddles.length === 0) return null;

    let best = alivePaddles[0];
    let bestDist = Math.abs(best.x - this.x);
    for (let i = 1; i < alivePaddles.length; i++) {
      const d = Math.abs(alivePaddles[i].x - this.x);
      if (d < bestDist) {
        bestDist = d;
        best = alivePaddles[i];
      }
    }

    const spawnY = this.y + this.currentRadius * 0.8;
    const dy = PADDLE.Y - spawnY;
    let targetX = best.x;
    if (predictLead && dy > 0) {
      const halfW = best.currentWidth * 0.5;
      const pv = best.vx || 0;
      const t1 = Math.hypot(targetX - this.x, dy) / speed;
      const px1 = ColorUtils.clamp(best.x + pv * t1, halfW, WIDTH - halfW);
      const t2 = Math.hypot(px1 - this.x, dy) / speed;
      targetX = ColorUtils.clamp(best.x + pv * t2, halfW, WIDTH - halfW);
    }

    const dx = targetX - this.x;
    if (!Enemy.isAimAngleValid(dx, dy)) {
      return null;
    }

    const a = Math.atan2(dy, dx);
    const b = {
      x: this.x,
      y: spawnY,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      angle: a,
      speed,
      damage: this.damage,
      timer: 0
    };
    if (shape) {
      b.shape = shape;
      if (shape === 'crescent') {
        b.trail = [{ x: b.x, y: b.y }];
      }
    }
    enemyBullets.push(b);
    return b;
  }

  _spawnCounterRadialBullets(count, enemyBullets) {
    const spawned = [];
    const speed = 215;
    const baseAngle = Math.PI / 2;
    const radius = this.currentRadius * 0.7;
    for (let i = 0; i < count; i++) {
      const a = baseAngle + (i * Math.PI * 2) / count;
      const b = {
        x: this.x + Math.cos(a) * radius,
        y: this.y + Math.sin(a) * radius,
        vx: Math.cos(a) * speed,
        vy: Math.sin(a) * speed,
        angle: a,
        speed,
        damage: this.damage,
        timer: 0
      };
      if (enemyBullets) {
        enemyBullets.push(b);
      }
      spawned.push(b);
      this._pendingSpawnedBullets.push(b);
    }
    return spawned;
  }

  triggerSelfExplosion(effectsManager, paddleList = [], onDamagePaddle = null, netHooks = null) {
    const { COLORS } = GAME_CONFIG;
    const innerR = this.currentRadius * 0.7;
    const outerR = 260;
    if (onDamagePaddle && Array.isArray(paddleList)) {
      for (const p of paddleList) {
        if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
        const nearestX = ColorUtils.clamp(this.x, p.x - p.currentWidth / 2, p.x + p.currentWidth / 2);
        const nearestY = ColorUtils.clamp(this.y, p.y - p.height / 2, p.y + p.height / 2);
        const dist = Math.hypot(this.x - nearestX, this.y - nearestY);
        if (dist <= outerR) {
          const scale = dist <= innerR ? 1 : ColorUtils.clamp(1 - (dist - innerR) / (outerR - innerR), 0, 1);
          const dmg = Math.round(this.damage * scale);
          if (dmg > 0) {
            onDamagePaddle(p, dmg);
          }
        }
      }
    }
    if (effectsManager) {
      effectsManager.spawnPulse({
        kind: 'circle',
        subType: 'bomb',
        x: this.x,
        y: this.y,
        radius: this.currentRadius,
        color: COLORS.white,
        duration: 0.42,
        maxScale: outerR / Math.max(1, this.currentRadius)
      });
    }
    if (netHooks && netHooks.onBombExplode) {
      netHooks.onBombExplode(this, outerR);
    }
  }

  consumePendingBullets() {
    if (!this._pendingSpawnedBullets || this._pendingSpawnedBullets.length === 0) {
      return [];
    }
    const out = this._pendingSpawnedBullets;
    this._pendingSpawnedBullets = [];
    return out;
  }

  consumePendingSplitEnemies() {
    if (!this._pendingSplitEnemies || this._pendingSplitEnemies.length === 0) {
      return [];
    }
    const out = this._pendingSplitEnemies;
    this._pendingSplitEnemies = [];
    return out;
  }

  fireBullet(paddleList, enemyBullets) {
    const { PADDLE } = GAME_CONFIG;
    const spawned = [];
    if (this.bullet_type === 'single') {
      spawned.push(this._fireSingleDownBullet(enemyBullets, true));
    } else if (this.bullet_type === 'spread') {
      const seq = this._shotSeq++;
      const angles = [Math.PI / 2 - 0.26, Math.PI / 2, Math.PI / 2 + 0.26];
      angles.forEach((a, subIdx) => {
        const b = {
          id: Enemy.makeAutoBulletId(this.id, seq, subIdx),
          x: this.x,
          y: this.y + this.currentRadius * 0.8,
          vx: Math.cos(a) * 190,
          vy: Math.sin(a) * 190,
          angle: a,
          speed: 190,
          damage: this.damage,
          timer: 0
        };
        enemyBullets.push(b);
        spawned.push(b);
      });
    } else if (this.bullet_type === '3round') {
      // 少し揺らぎのある3連続射撃
      spawned.push(this._spawnWobbledDownBullet(enemyBullets));
      if (this.burstRemaining <= 0) {
        this.burstRemaining = 2;
        this.burstTimer = 0.14 + (Math.random() - 0.5) * 0.04;
      }
    } else if (this.bullet_type === 'aimed_3round') {
      // 揺らぎ無しでプレイヤーを狙う3連続射撃
      const alivePaddles = Array.isArray(paddleList) ? paddleList.filter((p) => p && p.hp > 0) : [];
      if (alivePaddles.length === 0) return spawned;
      let best = alivePaddles[0];
      let bestDist = Math.abs(best.x - this.x);
      for (let i = 1; i < alivePaddles.length; i++) {
        const d = Math.abs(alivePaddles[i].x - this.x);
        if (d < bestDist) {
          bestDist = d;
          best = alivePaddles[i];
        }
      }
      this.burstTargetSlot = best.slot;
      const b = this._spawnAimedBurstBullet(paddleList, enemyBullets);
      if (b) {
        spawned.push(b);
        if (this.burstRemaining <= 0) {
          this.burstRemaining = 2;
          this.burstTimer = 0.14;
        }
      }
    } else if (this.bullet_type === 'explode') {
      // スペード型の弾を下向きに放ち、一定高度まで落ちると6つの丸型弾へ全方位拡散
      // 爆発高度がプレイヤーとほぼ同じ高さまたはそれ以下になる場合は発射しない
      const spawnY = this.y + this.currentRadius * 0.8;
      const explodeY = Math.max(480, spawnY + 180);
      if (explodeY >= PADDLE.Y - 30) {
        return spawned;
      }
      const b = {
        x: this.x,
        y: spawnY,
        vx: 0,
        vy: 185,
        angle: Math.PI / 2,
        speed: 185,
        damage: this.damage,
        timer: 0,
        shape: 'spade',
        explodeY
      };
      enemyBullets.push(b);
      spawned.push(b);
    } else if (this.bullet_type === 'aimed' || this.bullet_type === 'slice') {
      const b = this._fireAimedBullet(paddleList, enemyBullets, false, 230);
      if (b) spawned.push(b);
    } else if (this.bullet_type === 'counter') {
      const useAimed = this._counterUseAimed;
      this._counterUseAimed = !this._counterUseAimed;
      const b = useAimed
        ? this._fireAimedBullet(paddleList, enemyBullets, false, 230)
        : this._fireSingleDownBullet(enemyBullets, false);
      if (b) spawned.push(b);
    } else if (this.bullet_type === 'crescent') {
      const b = this._fireAimedBullet(paddleList, enemyBullets, true, 290, 'crescent');
      if (b) spawned.push(b);
    }
    return spawned;
  }

  hitByBall(ball, effectsManager, forceInstantKill = false, enemyBullets = null) {
    const { COLORS, ENEMY, WIDTH } = GAME_CONFIG;
    const visualScale = (ENEMY && ENEMY.VISUAL_SCALE) || 1.5;
    const isCyanBall = ball && ball.effects && ball.effects.cyan > 0;
    if (isCyanBall || forceInstantKill) {
      this.health = 0;
    } else {
      this.health -= 1;
    }

    if (this.bullet_type === 'counter') {
      const radialCount = this.health > 0 ? 6 : 12;
      this._spawnCounterRadialBullets(radialCount, enemyBullets);
    }

    if (this.health > 0) {
      if (this.bullet_type === 'slice') {
        // circle が破壊に至らないダメージを受けると 2 体の semicircle に分裂する
        const childDef = (typeof ENEMIES !== 'undefined' && ENEMIES.semicircle)
          ? ENEMIES.semicircle
          : { name: 'semicircle', bullet_type: 'aimed', movement_type: 'retro', health: 1, damage: this.damage, fire_rate: this.fire_rate };
        const leftChild = new Enemy(childDef, Math.max(24, this.x - 14), undefined, -95);
        leftChild.y = this.y;
        leftChild.rotation = Math.PI;
        leftChild.fireTimer = Math.max(0.6, this.fireTimer || 0.8);
        leftChild.hitCooldown = 0.14;

        const rightChild = new Enemy(childDef, Math.min(WIDTH - 24, this.x + 14), undefined, 95);
        rightChild.y = this.y;
        rightChild.rotation = 0;
        rightChild.fireTimer = Math.max(0.6, this.fireTimer || 0.8);
        rightChild.hitCooldown = 0.14;

        this._pendingSplitEnemies.push(leftChild, rightChild);
        effectsManager.spawnPulse({
          kind: 'enemy',
          subType: this.name,
          x: this.x,
          y: this.y,
          radius: this.currentRadius * visualScale,
          angle: this.rotation,
          color: COLORS.white,
          duration: 0.42,
          maxScale: 2.15
        });
        effectsManager.spawnCircleParticles(this.x, this.y, COLORS.white, 8, 45, 150);
        return false; // スコア・アイテム付与なしの分裂置換
      }

      // 縮小し、縮小時に1回だけパルスアニメーション
      const prevRadius = this.currentRadius;
      const healthRatio = this.health / this.maxHealth;
      this.targetRadius = this.baseRadius * (0.48 + 0.52 * healthRatio);
      effectsManager.spawnPulse({
        kind: 'enemy',
        target: this,
        subType: this.name,
        x: this.x,
        y: this.y,
        radius: prevRadius * visualScale,
        angle: this.rotation,
        color: COLORS.white,
        duration: 0.42,
        maxScale: 2.15
      });
      return false; // 生存
    }

    // 撃破
    if (this.bullet_type === 'self_explosion') {
      this._pendingSelfExplosion = true;
      return true;
    }

    effectsManager.spawnPulse({
      kind: 'enemy',
      subType: this.name,
      x: this.x,
      y: this.y,
      radius: this.currentRadius * visualScale,
      angle: this.rotation,
      color: isCyanBall ? COLORS.cyan : COLORS.white,
      duration: 0.45,
      maxScale: 2.4
    });
    effectsManager.spawnCircleParticles(this.x, this.y, COLORS.white, 10, 50, 180);
    return true; // 消滅
  }

  render(ctx) {
    const { COLORS, ENEMY } = GAME_CONFIG;
    const visualScale = (ENEMY && ENEMY.VISUAL_SCALE) || 1.5;
    const drawX = this.x + (this.corrX || 0);
    const drawY = this.y + (this.corrY || 0);

    // 1. aimed_fall (scissors) 急降下時の残像描画
    if (this.afterimages && this.afterimages.length > 0) {
      for (const ai of this.afterimages) {
        if (ai.alpha <= 0.01) continue;
        ShapeRenderer.drawEnemyShape(
          ctx,
          this.name,
          ai.x,
          ai.y,
          ai.radius,
          ai.rotation,
          ai.color,
          ai.alpha,
          true
        );
      }
    }

    // 2. laser / aimed_laser の射撃1秒前点線表示（下方向へ流れるアニメ、前半500msは白、後半500msで白→赤へ線形変化）
    if (this.isLaserTelegraphing()) {
      const telegraphElapsed = ColorUtils.clamp(1.0 - this.fireTimer, 0, 1.0);
      const redT = telegraphElapsed <= 0.5 ? 0 : ColorUtils.clamp((telegraphElapsed - 0.5) / 0.5, 0, 1);
      const lineColor = redT <= 0 ? COLORS.white : ColorUtils.lerpColor(COLORS.white, COLORS.red, redT);
      ctx.save();
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 2.2;
      if (typeof ctx.setLineDash === 'function') {
        ctx.setLineDash([6, 6]);
        ctx.lineDashOffset = -(telegraphElapsed * 140);
      }
      ctx.beginPath();
      ctx.moveTo(drawX, drawY);
      ctx.lineTo(
        drawX + Math.cos(this.laserAngle) * 1200,
        drawY + Math.sin(this.laserAngle) * 1200
      );
      ctx.stroke();
      ctx.restore();
    }

    // 3. laser / aimed_laser の500msレーザー照射
    if (this.isLaserFiring()) {
      const laserW = this.getLaserCurrentWidth();
      if (laserW > 0.2) {
        const laserColor = Math.floor(this.laserBlinkTimer / 0.05) % 2 === 0 ? COLORS.white : COLORS.red; // User: 高速に切り替える
        ctx.save();
        ctx.translate(drawX, drawY);
        ctx.rotate(this.laserAngle);
        ctx.fillStyle = laserColor;
        ctx.fillRect(0, -laserW / 2, 1200, laserW);
        ctx.restore();
      }
    }

    let drawColor = COLORS.white;
    const isHazardBody =
      this.bullet_type === 'connect' ||
      this.bullet_type === 'self_explosion' ||
      (this.bullet_type === 'self_destruction' && (
        this.movement_type !== 'aimed_fall' || this.aimedFallPhase !== 'aiming'
      ));
    // self_destruction / connect の場合は敵自身が被弾判定を持つため、0.5秒サイクルで赤→白点滅（イージングなし）
    // ただし aimed_fall (scissors) は fire_rate 経過後の1秒停止に入るまでは赤白点滅しない
    if (isHazardBody) {
      const phase = this.timeAlive % ENEMY.BLINK_CYCLE;
      drawColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
    }

    ShapeRenderer.drawEnemyShape(
      ctx,
      this.name,
      drawX,
      drawY,
      this.currentRadius * visualScale,
      this.rotation,
      drawColor,
      1,
      true
    );
  }
}
