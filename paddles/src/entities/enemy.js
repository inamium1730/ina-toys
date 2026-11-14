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
    this.baseRadius = baseRadius;
    this.currentRadius = baseRadius;
    this.targetRadius = baseRadius;
    this.rotation = 0;
    this.timeAlive = 0;
    this.hitCooldown = 0;
    this.fireTimer = this.fire_rate > 0 ? this.fire_rate * 0.75 : 0;
    this.burstRemaining = 0;
    this.burstTimer = 0;
    this.hoverY = 160 + Math.random() * 140;
    this._hasFiredOnce = false;
    this._shotSeq = 0;
    this.localAutoFire = false;
    this.corrX = 0;
    this.corrY = 0;
  }

  static makeAutoBulletId(enemyId, shotSeq, subIdx = 0) {
    // 確定的発射（single/spread）はホスト・クライアント間で同一IDを生成する
    return (0x40000000 + ((enemyId & 0xffff) * 1000) + ((shotSeq & 0xff) * 4) + (subIdx & 0x03)) >>> 0;
  }

  isDeterministicShooter() {
    return (this.bullet_type === 'single' || this.bullet_type === 'spread') && this.fire_rate > 0;
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
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
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

  update(dt, paddles, enemyBullets, effectsManager, onDamagePaddle, netHooks = null) {
    const { HEIGHT, COLORS } = GAME_CONFIG;
    const paddleList = Array.isArray(paddles) ? paddles : (paddles ? [paddles] : []);
    this.stepMovementAndAnimation(dt);

    // 射撃タイプの敵は画面内に入ってから、射撃間隔 (fire_rate) に従って弾を発射
    if (
      this.bullet_type !== 'self_destruction' &&
      this.bullet_type !== 'connect' &&
      this.fire_rate > 0 &&
      this.y >= this.currentRadius
    ) {
      if (this.burstRemaining > 0) {
        this.burstTimer -= dt;
        while (this.burstRemaining > 0 && this.burstTimer <= 0) {
          const b = this._spawnWobbledDownBullet(enemyBullets);
          this.burstRemaining -= 1;
          this.burstTimer += 0.14 + (Math.random() - 0.5) * 0.04;
          if (netHooks && netHooks.onBulletsSpawned) {
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
      const hitY = this.y + this.currentRadius * 0.75;
      let hitAny = false;
      for (const p of paddleList) {
        if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
        const pLeft = p.x - p.currentWidth / 2;
        const pRight = p.x + p.currentWidth / 2;
        const pTop = p.y - p.height / 2;
        const pBottom = p.y + p.height / 2;

        if (hitX >= pLeft && hitX <= pRight && hitY >= pTop && hitY <= pBottom) {
          onDamagePaddle(p, this.damage);
          hitAny = true;
        }
      }
      if (hitAny) {
        effectsManager.spawnCircleParticles(this.x, this.y, COLORS.red, 10, 40, 150);
        return false; // 消滅
      }
    }

    if (this.y - this.currentRadius > HEIGHT + 20) {
      return false;
    }

    return true;
  }

  stepMovementAndAnimation(dt) {
    const { WIDTH } = GAME_CONFIG;
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

    // すべての敵が非常に緩やかな速度で徐々に下へと移動する
    this.y += this.vy * dt;

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
    } else if (this.movement_type === 'sway') {
      this.x = ColorUtils.clamp(
        this.originX + Math.sin(this.timeAlive * 2.2) * 85,
        this.currentRadius + 12,
        WIDTH - this.currentRadius - 12
      );
      this.rotation = Math.sin(this.timeAlive * 2.2) * 0.25;
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

  updateClient(dt, enemyBullets) {
    const { HEIGHT } = GAME_CONFIG;
    this.stepMovementAndAnimation(dt);

    // 確定的エネミーは最初の射撃タイムスタンプ受信後、ローカルで後続射撃を完全再現する
    if (this.localAutoFire && this.isDeterministicShooter()) {
      this.fireTimer -= dt;
      let guard = 0;
      while (this.fireTimer <= 0 && guard < 4) {
        guard += 1;
        this.fireBullet([], enemyBullets);
        this.fireTimer += this.fire_rate;
      }
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

  fireBullet(paddleList, enemyBullets) {
    const { PADDLE } = GAME_CONFIG;
    const spawned = [];
    if (this.bullet_type === 'single') {
      const seq = this._shotSeq++;
      const b = {
        id: Enemy.makeAutoBulletId(this.id, seq, 0),
        x: this.x,
        y: this.y + this.currentRadius,
        vx: 0,
        vy: 205,
        angle: Math.PI / 2,
        speed: 205,
        damage: this.damage,
        timer: 0
      };
      enemyBullets.push(b);
      spawned.push(b);
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
    } else if (this.bullet_type === 'aimed') {
      const alivePaddles = paddleList.filter((p) => p && p.hp > 0);
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

      const spawnY = this.y + this.currentRadius * 0.8;
      const dx = best.x - this.x;
      const dy = PADDLE.Y - spawnY;

      // パドルより下（反対側＝上向き）に向かう場合や、真下からの角度がつきすぎている場合（> 60°）は射撃しない
      const maxAimOffsetFromDown = Math.PI / 3;
      if (dy <= 0 || Math.abs(Math.atan2(dx, dy)) > maxAimOffsetFromDown) {
        return spawned;
      }

      const a = Math.atan2(dy, dx);
      const b = {
        x: this.x,
        y: spawnY,
        vx: Math.cos(a) * 230,
        vy: Math.sin(a) * 230,
        angle: a,
        speed: 230,
        damage: this.damage,
        timer: 0
      };
      enemyBullets.push(b);
      spawned.push(b);
    }
    return spawned;
  }

  hitByBall(ball, effectsManager, forceInstantKill = false) {
    const { COLORS, ENEMY } = GAME_CONFIG;
    const visualScale = (ENEMY && ENEMY.VISUAL_SCALE) || 1.5;
    const isCyanBall = ball.effects.cyan > 0;
    if (isCyanBall || forceInstantKill) {
      this.health = 0;
    } else {
      this.health -= 1;
    }

    if (this.health > 0) {
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
    let drawColor = COLORS.white;
    const isHazardBody = this.bullet_type === 'self_destruction' || this.bullet_type === 'connect';
    // self_destruction / connect の場合は敵自身が被弾判定を持つため、0.5秒サイクルで赤→白点滅（イージングなし）
    // それ以外の敵は赤点滅させず白色枠とし、全エネミー共通で内部は黒色で描画する
    if (isHazardBody) {
      const phase = this.timeAlive % ENEMY.BLINK_CYCLE;
      drawColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
    }

    ShapeRenderer.drawEnemyShape(
      ctx,
      this.name,
      this.x + (this.corrX || 0),
      this.y + (this.corrY || 0),
      this.currentRadius * visualScale,
      this.rotation,
      drawColor,
      1,
      true
    );
  }
}
