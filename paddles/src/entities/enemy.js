/**
 * エネミークラスおよび敵弾管理
 */
class Enemy {
  constructor(def, spawnX, customId) {
    Enemy.nextId = (Enemy.nextId || 0) + 1;
    this.netKind = 'enemy';
    this.id = customId !== undefined ? customId : Enemy.nextId;

    const baseRadius = 17 + (def.health - 1) * 3.5;
    this.name = def.name;
    this.bullet_type = def.bullet_type;
    this.movement_type = def.movement_type;
    this.maxHealth = def.health;
    this.health = def.health;
    this.damage = def.damage;
    this.fire_rate = typeof def.fire_rate === 'number' ? def.fire_rate : 0;

    this.x = spawnX;
    this.y = -baseRadius - 8; // 画面外の上から出現
    this.originX = spawnX;
    this.vx = (Math.random() < 0.5 ? -1 : 1) * 75;
    this.vy = 20; // すべての敵が非常に緩やかな速度で徐々に下へ移動
    this.baseRadius = baseRadius;
    this.currentRadius = baseRadius;
    this.targetRadius = baseRadius;
    this.rotation = 0;
    this.timeAlive = 0;
    this.hitCooldown = 0;
    this.fireTimer = this.fire_rate > 0 ? this.fire_rate * 0.75 : 0;
    this.hoverY = 160 + Math.random() * 140;
  }

  update(dt, paddles, enemyBullets, effectsManager, onDamagePaddle) {
    const { WIDTH, HEIGHT, COLORS } = GAME_CONFIG;
    const paddleList = Array.isArray(paddles) ? paddles : (paddles ? [paddles] : []);
    this.timeAlive += dt;
    if (this.hitCooldown > 0) {
      this.hitCooldown = Math.max(0, this.hitCooldown - dt);
    }
    this.currentRadius += (this.targetRadius - this.currentRadius) * Math.min(1, dt * 14);

    // すべての敵が非常に緩やかな速度で徐々に下へと移動する
    this.y += this.vy * dt;

    if (this.movement_type === 'fall') {
      // 右回転しながらゆっくり降下
      this.rotation += 1.4 * dt;
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

    // 射撃タイプの敵は画面内に入ってから、射撃間隔 (fire_rate) に従って弾を発射
    if (this.bullet_type !== 'self_destruction' && this.fire_rate > 0 && this.y >= this.currentRadius) {
      this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this.fireBullet(paddleList, enemyBullets);
        this.fireTimer += this.fire_rate;
        if (this.fireTimer <= 0) {
          this.fireTimer = this.fire_rate;
        }
      }
    }

    // パドルとの被弾判定（重なっているすべての生存パドルがダメージを受ける）
    const hitX = this.x;
    const hitY = this.bullet_type === 'self_destruction' ? this.y + this.currentRadius * 0.75 : this.y;
    let hitAny = false;
    for (const p of paddleList) {
      if (!p || p.hp <= 0) continue;
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

    if (this.y - this.currentRadius > HEIGHT + 20) {
      return false;
    }

    return true;
  }

  fireBullet(paddleList, enemyBullets) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    if (this.bullet_type === 'single') {
      enemyBullets.push({
        x: this.x,
        y: this.y + this.currentRadius,
        vx: 0,
        vy: 205,
        damage: this.damage,
        timer: 0
      });
    } else if (this.bullet_type === 'spread') {
      const angles = [Math.PI / 2 - 0.26, Math.PI / 2, Math.PI / 2 + 0.26];
      for (const a of angles) {
        enemyBullets.push({
          x: this.x,
          y: this.y + this.currentRadius * 0.8,
          vx: Math.cos(a) * 190,
          vy: Math.sin(a) * 190,
          damage: this.damage,
          timer: 0
        });
      }
    } else if (this.bullet_type === 'aimed') {
      const alivePaddles = paddleList.filter((p) => p && p.hp > 0);
      let targetX = WIDTH / 2;
      if (alivePaddles.length > 0) {
        let best = alivePaddles[0];
        let bestDist = Math.abs(best.x - this.x);
        for (let i = 1; i < alivePaddles.length; i++) {
          const d = Math.abs(alivePaddles[i].x - this.x);
          if (d < bestDist) {
            bestDist = d;
            best = alivePaddles[i];
          }
        }
        targetX = best.x;
      }
      const targetY = PADDLE.Y;
      const a = Math.atan2(targetY - this.y, targetX - this.x);
      enemyBullets.push({
        x: this.x,
        y: this.y + this.currentRadius * 0.8,
        vx: Math.cos(a) * 230,
        vy: Math.sin(a) * 230,
        damage: this.damage,
        timer: 0
      });
    }
  }

  hitByBall(ball, effectsManager) {
    const { COLORS } = GAME_CONFIG;
    const isCyanBall = ball.effects.cyan > 0;
    if (isCyanBall) {
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
        radius: prevRadius,
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
      radius: this.currentRadius,
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
    let drawColor = COLORS.white;
    const isSelfDestruction = this.bullet_type === 'self_destruction';
    // self_destruction の場合は敵自身が敵弾判定を持つため、0.5秒サイクルで赤→白点滅（イージングなし）
    // それ以外の敵は赤点滅させず白色枠とし、全エネミー共通で内部は黒色で描画する
    if (isSelfDestruction) {
      const phase = this.timeAlive % ENEMY.BLINK_CYCLE;
      drawColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
    }

    ShapeRenderer.drawEnemyShape(
      ctx,
      this.name,
      this.x,
      this.y,
      this.currentRadius,
      this.rotation,
      drawColor,
      1,
      true
    );
  }
}
