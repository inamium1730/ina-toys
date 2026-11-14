/**
 * ボールクラス
 */
class Ball {
  constructor(x, y, vx, vy, customId) {
    const { WIDTH, HEIGHT, PADDLE, BALL } = GAME_CONFIG;
    Ball.nextId = Math.max(Ball.nextId || 0, customId !== undefined ? customId : 0) + (customId !== undefined ? 0 : 1);
    this.netKind = 'ball';
    this.id = customId !== undefined ? customId : Ball.nextId;

    const angle = -Math.PI / 2 + (Math.random() * 0.46 - 0.23);
    const speed = BALL.BASE_SPEED;

    this.x = x !== undefined ? x : WIDTH / 2;
    this.y = y !== undefined ? y : PADDLE.Y - 22;
    this.vx = vx !== undefined ? vx : Math.cos(angle) * speed;
    this.vy = vy !== undefined ? vy : Math.sin(angle) * speed;
    this.radius = BALL.BASE_RADIUS;

    this.corrX = 0;
    this.corrY = 0;
    this.predictedBounceTimer = 0;

    this.effectClock = 0;
    this.pulseTimer = 0;
    this.afterimageTimer = 0;
    this.afterimages = [];

    this.yellowTransitionTimer = 0;
    this.yellowTransitionStartVx = 0;
    this.yellowTransitionStartVy = 0;

    this.spawningFromCenter = false;
    this.spawnTimer = 0;
    this.spawnScaleDuration = 0.55;
    this.spawnStartY = HEIGHT / 2;

    this.swingAngle = 0;
    this.swingActiveVisual = false;
    this.swingVisualAlpha = 0;

    this.effects = {
      cyan: 0,
      yellow: 0,
      green: 0
    };
  }

  static createCenterSpawn(customId) {
    const { WIDTH, HEIGHT, BALL } = GAME_CONFIG;
    const ball = new Ball(WIDTH / 2, HEIGHT / 2, 0, BALL.BASE_SPEED * 0.1, customId);
    ball.radius = 0;
    ball.spawningFromCenter = true;
    ball.spawnTimer = 0;
    ball.spawnScaleDuration = 0.55;
    ball.spawnStartY = HEIGHT / 2;
    return ball;
  }

  /**
   * 画面中央スポーン時のEaseOutBackスケールイン（1回オーバーシュート）と
   * パドル座標到達タイミングで通常速度に一致する等加速度落下を計算する
   */
  updateCenterSpawnState(baseTargetRadius, targetLinearSpeed) {
    const { PADDLE, BALL } = GAME_CONFIG;
    const scaleU = ColorUtils.clamp(this.spawnTimer / this.spawnScaleDuration, 0, 1);
    const c1 = 2.1;
    const c3 = c1 + 1;
    const u1 = scaleU - 1;
    const scaleEased = 1 + c3 * u1 * u1 * u1 + c1 * u1 * u1;
    this.radius = baseTargetRadius * Math.max(0, scaleEased);

    const targetY = PADDLE.Y - PADDLE.HEIGHT / 2 - BALL.BASE_RADIUS;
    const travelDist = Math.max(1, targetY - this.spawnStartY);
    const progress = ColorUtils.clamp((this.y - this.spawnStartY) / travelDist, 0, 1);
    const minRatio = 0.1;
    const speedRatio = Math.sqrt(minRatio * minRatio + (1 - minRatio * minRatio) * progress);

    this.vx = 0;
    this.vy = targetLinearSpeed * speedRatio;

    if (progress >= 1 && scaleU >= 1) {
      this.spawningFromCenter = false;
      this.radius = baseTargetRadius;
      this.vy = targetLinearSpeed;
    }
  }

  update(dt, context) {
    const { WIDTH, HEIGHT, PADDLE, BALL, ITEM, COLORS } = GAME_CONFIG;
    const { paddle, paddles, purplePaddle, blocks, supplyDrops = [], enemies, boss, effectsManager, onScore, onSpawnItem, onClearPurplePaddle, onBounce, swingActive = false } = context;
    const paddleList = Array.isArray(paddles) ? paddles : (paddle ? [paddle] : []);

    this.stepSwingVisualState(dt, !!swingActive);

    const hadYellow = this.effects.yellow > 0;
    this.effects.cyan = Math.max(0, this.effects.cyan - dt);
    this.effects.yellow = Math.max(0, this.effects.yellow - dt);
    this.effects.green = Math.max(0, this.effects.green - dt);

    const isCyan = this.effects.cyan > 0;
    const isYellow = this.effects.yellow > 0;
    const isGreen = this.effects.green > 0;

    // 黄色効果時はサイズが2倍
    const baseTargetRadius = isYellow ? BALL.BASE_RADIUS * BALL.YELLOW_SIZE_MULTIPLIER : BALL.BASE_RADIUS;
    const targetLinearSpeed = BALL.BASE_SPEED * (isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0);

    // 黄色効果が切れる瞬間、進行方向を参照して線形的な動きへ滑らかにトランジション開始
    if (hadYellow && !isYellow) {
      this.yellowTransitionTimer = 0.35;
      this.yellowTransitionStartVx = this.vx;
      this.yellowTransitionStartVy = this.vy;
    }

    if (this.spawningFromCenter) {
      this.spawnTimer += dt;
      this.updateCenterSpawnState(baseTargetRadius, targetLinearSpeed);
    } else {
      this.radius += (baseTargetRadius - this.radius) * Math.min(1, dt * 10);

      if (isYellow) {
        // 弱めの重力による物理バウンド移動（緑効果併用時は上昇中のみ重力・上向き速度を加速し、落下速度は増加させない）
        const speedMult = isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;
        const risingGravMult = (isGreen && this.vy < 0) ? speedMult : 1.0;
        const gravScale = risingGravMult * risingGravMult;
        this.vy += BALL.YELLOW_GRAVITY * gravScale * dt;
        const maxVx = BALL.YELLOW_MAX_VX * speedMult;
        this.vx = ColorUtils.clamp(this.vx, -maxVx, maxVx);
      } else if (this.yellowTransitionTimer > 0) {
        // 進行方向を参照して滑らかに線形移動へ遷移
        this.yellowTransitionTimer = Math.max(0, this.yellowTransitionTimer - dt);
        const t = 1 - this.yellowTransitionTimer / 0.35;
        let dirAngle = Math.atan2(this.vy, this.vx);
        if (Math.abs(Math.sin(dirAngle)) < 0.34) {
          dirAngle = (this.vy >= 0 ? 1 : -1) * 0.35 + (this.vx >= 0 ? 0 : Math.PI);
        }
        const linearVx = Math.cos(dirAngle) * targetLinearSpeed;
        const linearVy = Math.sin(dirAngle) * targetLinearSpeed;
        this.vx = this.yellowTransitionStartVx + (linearVx - this.yellowTransitionStartVx) * t;
        this.vy = this.yellowTransitionStartVy + (linearVy - this.yellowTransitionStartVy) * t;
      } else {
        // 通常の線形移動（水平に近い角度で左右にしか跳ねなくなる現象を防ぐため上下速度をクランプ）
        this.clampVerticalAngle(targetLinearSpeed);
      }
    }

    // 星効果中のパルスアニメーション
    if (isCyan || isYellow || isGreen) {
      this.effectClock += dt;
      this.pulseTimer += dt;
      if (this.pulseTimer >= ITEM.PULSE_INTERVAL) {
        this.pulseTimer -= ITEM.PULSE_INTERVAL;
        const col = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
        effectsManager.spawnPulse({
          kind: 'circle',
          target: this,
          x: this.x,
          y: this.y,
          radius: this.radius,
          color: col,
          duration: 0.42,
          maxScale: 2.2
        }, false);
      }
    } else {
      this.effectClock = 0;
      this.pulseTimer = 0;
    }

    // 緑ボールの残像エフェクト
    this.updateAfterimages(dt);

    // 衝突抜け防止のサブステップ移動
    const subSteps = 3;
    const subDt = dt / subSteps;

    for (let s = 0; s < subSteps; s++) {
      this.x += this.vx * subDt;
      this.y += this.vy * subDt;

      if (this.spawningFromCenter) {
        this.updateCenterSpawnState(baseTargetRadius, targetLinearSpeed);
      }

      // 壁との反射
      if (this.x - this.radius < 0) {
        this.x = this.radius;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.radius > WIDTH) {
        this.x = WIDTH - this.radius;
        this.vx = -Math.abs(this.vx);
      }
      if (this.y - this.radius < 0) {
        this.y = this.radius;
        const prevVy = this.vy;
        this.vy = Math.abs(this.vy);
        if (isYellow && isGreen && prevVy < 0) {
          this.vy /= BALL.GREEN_SPEED_MULTIPLIER;
        }
      }

      // 自機パドルとの衝突（複数パドルが重なっている場合はそれぞれの反射方向を平均する）
      if (this.vy > 0) {
        const hitPaddles = [];
        for (const p of paddleList) {
          if (!p || p.hp <= 0) continue;
          const catchHalfW = p.currentWidth / 2 + PADDLE.BALL_CATCH_MARGIN;
          const pTop = p.y - p.height / 2;
          const pBottom = p.y + p.height / 2;

          if (
            this.x + this.radius >= p.x - catchHalfW &&
            this.x - this.radius <= p.x + catchHalfW &&
            this.y + this.radius >= pTop &&
            this.y - this.radius <= pBottom
          ) {
            hitPaddles.push({ p, catchHalfW, pTop });
          }
        }

        if (hitPaddles.length > 0) {
          let minTop = hitPaddles[0].pTop;
          let sumCos = 0;
          let sumSin = 0;

          for (const hit of hitPaddles) {
            const { p, catchHalfW, pTop } = hit;
            if (pTop < minTop) minTop = pTop;
            const offset = ColorUtils.clamp((this.x - p.x) / catchHalfW, -0.85, 0.85);
            const bounceAngle = -Math.PI / 2 + offset * (Math.PI * 0.35);
            sumCos += Math.cos(bounceAngle);
            sumSin += Math.sin(bounceAngle);

            // パドルの星効果を継承（パドルの残り効果時間 + 5秒）
            if (p.effects.cyan > 0) {
              this.effects.cyan = Math.max(this.effects.cyan, p.effects.cyan + 5.0);
            }
            if (p.effects.yellow > 0) {
              this.effects.yellow = Math.max(this.effects.yellow, p.effects.yellow + 5.0);
            }
            if (p.effects.green > 0) {
              this.effects.green = Math.max(this.effects.green, p.effects.green + 5.0);
            }
          }

          this.y = minTop - this.radius;
          this.spawningFromCenter = false;
          const avgAngle = Math.atan2(sumSin, sumCos);
          const finalAngle = this.resolveBounceAngle(avgAngle, context);
          this.applyPaddleBounceVelocity(finalAngle);
          if (onBounce) onBounce(this, 'paddle');
        }
      }

      // 紫色のサブパドルとの衝突
      const pp = purplePaddle();
      if (pp && this.vy > 0) {
        const ppHalfW = pp.width / 2 + 4;
        const ppTop = pp.y - pp.height / 2;
        const ppBottom = pp.y + pp.height / 2;

        if (
          this.x + this.radius >= pp.x - ppHalfW &&
          this.x - this.radius <= pp.x + ppHalfW &&
          this.y + this.radius >= ppTop &&
          this.y - this.radius <= ppBottom
        ) {
          this.y = ppTop - this.radius;
          this.spawningFromCenter = false;
          const offset = ColorUtils.clamp((this.x - pp.x) / ppHalfW, -0.8, 0.8);
          const bounceAngle = -Math.PI / 2 + offset * (Math.PI * 0.32);
          const finalAngle = this.resolveBounceAngle(bounceAngle, context);
          this.applyPaddleBounceVelocity(finalAngle);

          if (pp.consumeBounce(effectsManager)) {
            onClearPurplePaddle();
          }
          if (onBounce) onBounce(this, 'purple');
        }
      }

      // ブロックとの衝突 (スケールイン演出が完了し当たり判定が追加されたブロックのみ)
      for (const blk of blocks) {
        if (!blk.alive || !blk.collidable) continue;
        if (this.rectOverlapsCircle(blk.x, blk.y, blk.w, blk.h, this.x, this.y, this.radius)) {
          blk.alive = false;
          onScore(100);
          effectsManager.spawnCircleParticles(blk.x, blk.y, COLORS.white, 7, 35, 130);
          if (blk.itemType && onSpawnItem) {
            onSpawnItem(blk.x, blk.y, 1.0, blk.itemType);
          }
          if (context.onBlockDestroyed) context.onBlockDestroyed(blk);

          // 水色ボールはブロックに当たっても反射せず貫通する
          if (this.effects.cyan <= 0) {
            this.bounceOffRect(blk.x, blk.y, blk.w, blk.h);
            if (onBounce) onBounce(this, 'block');
            break;
          }
        }
      }

      // ボス戦サプライドロップブロックとの衝突 (破壊でスコア＆確定アイテム出現)
      for (let dIdx = supplyDrops.length - 1; dIdx >= 0; dIdx--) {
        const drop = supplyDrops[dIdx];
        if (!drop.alive) continue;
        if (this.rectOverlapsCircle(drop.x, drop.y, drop.w, drop.h, this.x, this.y, this.radius)) {
          drop.alive = false;
          onScore(100);
          effectsManager.spawnPulse({
            kind: 'rect',
            x: drop.x,
            y: drop.y,
            w: drop.w,
            h: drop.h,
            color: COLORS.white,
            duration: 0.42,
            maxScale: 2.2
          });
          effectsManager.spawnCircleParticles(drop.x, drop.y, COLORS.white, 8, 35, 130);
          onSpawnItem(drop.x, drop.y, 1.0);
          if (context.onDropRemoved) context.onDropRemoved(drop);
          supplyDrops.splice(dIdx, 1);

          if (this.effects.cyan <= 0) {
            this.bounceOffRect(drop.x, drop.y, drop.w, drop.h);
            if (onBounce) onBounce(this, 'drop');
            break;
          }
        }
      }

      // エネミーとの衝突（スイング中も雑魚敵は即死＆貫通）
      for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
        const enemy = enemies[eIdx];
        if (enemy.hitCooldown > 0) continue;
        const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
        if (dist <= this.radius + enemy.currentRadius) {
          const destroyed = enemy.hitByBall(this, effectsManager, !!swingActive);
          enemy.hitCooldown = 0.08;

          const shouldPierce = this.effects.cyan > 0 || !!swingActive;
          if (!shouldPierce) {
            this.spawningFromCenter = false;
            const prevVy = this.vy;
            const nx = (this.x - enemy.x) / (dist || 1);
            const ny = (this.y - enemy.y) / (dist || 1);
            const speed = Math.hypot(this.vx, this.vy);
            this.vx = nx * speed;
            this.vy = ny * speed;
            if (this.effects.yellow <= 0) {
              this.clampVerticalAngle(speed);
            } else if (this.effects.green > 0 && prevVy < 0 && this.vy > 0) {
              this.vy /= BALL.GREEN_SPEED_MULTIPLIER;
            }
            this.x = enemy.x + nx * (enemy.currentRadius + this.radius + 2);
            this.y = enemy.y + ny * (enemy.currentRadius + this.radius + 2);
            if (onBounce) onBounce(this, 'enemy');
          }

          if (destroyed) {
            const enemyDropChance = context.enemyDropChance !== undefined ? context.enemyDropChance : 0.42;
            onScore(150 * enemy.maxHealth);
            onSpawnItem(enemy.x, enemy.y, enemyDropChance);
            if (context.onEnemyEvent) context.onEnemyEvent(enemy, true);
            enemies.splice(eIdx, 1);
          } else if (context.onEnemyEvent) {
            context.onEnemyEvent(enemy, false);
          }
          if (!shouldPierce) break;
        }
      }

      // ボスとの衝突
      if (boss && !boss.isDefeated()) {
        if (boss.handleBallCollision(this, effectsManager, onScore, onSpawnItem)) {
          if (onBounce) onBounce(this, 'boss');
        }
      }
    }

    if (swingActive) {
      this.handleSwingArmsCollisions(context);
    }

    return this.y - this.radius <= HEIGHT + 16;
  }

  rectOverlapsCircle(rx, ry, rw, rh, cx, cy, cr) {
    const closestX = ColorUtils.clamp(cx, rx - rw / 2, rx + rw / 2);
    const closestY = ColorUtils.clamp(cy, ry - rh / 2, ry + rh / 2);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx * dx + dy * dy <= cr * cr;
  }

  bounceOffRect(rx, ry, rw, rh, pushOut = false) {
    const { BALL } = GAME_CONFIG;
    const overlapX = (rw / 2 + this.radius) - Math.abs(this.x - rx);
    const overlapY = (rh / 2 + this.radius) - Math.abs(this.y - ry);
    if (overlapX < overlapY) {
      if (pushOut) {
        const dirX = this.x >= rx ? 1 : -1;
        this.x = rx + dirX * (rw / 2 + this.radius + 0.5);
      }
      this.vx = -this.vx;
      return;
    }
    if (pushOut) {
      const dirY = this.y >= ry ? 1 : -1;
      this.y = ry + dirY * (rh / 2 + this.radius + 0.5);
    }
    const prevVy = this.vy;
    this.vy = -this.vy;
    if (this.effects.yellow > 0) {
      if (this.vy < 0) {
        const speedMult = this.effects.green > 0 ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;
        const minUpVy = Math.sqrt(2 * BALL.YELLOW_GRAVITY * Math.max(120, this.y + 60)) * speedMult;
        this.vy = -Math.max(Math.abs(this.vy), minUpVy);
      } else if (this.effects.green > 0 && prevVy < 0) {
        this.vy /= BALL.GREEN_SPEED_MULTIPLIER;
      }
    }
  }

  /**
   * ボールが真横に近い角度で左右にしか跳ねなくなるのを防ぐため、
   * 最小の上下角度（水平から約20度以上）を保証して速度を正規化する
   */
  clampVerticalAngle(targetSpeed) {
    const minSin = 0.34; // sin(20°) ≒ 0.342
    const currentSpeed = Math.hypot(this.vx, this.vy) || targetSpeed;
    let nx = this.vx / currentSpeed;
    let ny = this.vy / currentSpeed;

    if (Math.abs(ny) < minSin) {
      const signY = ny === 0 ? (this.y < GAME_CONFIG.HEIGHT / 2 ? 1 : -1) : Math.sign(ny);
      const signX = Math.sign(nx) || 1;
      ny = signY * minSin;
      nx = signX * Math.sqrt(1 - minSin * minSin);
    }

    this.vx = nx * targetSpeed;
    this.vy = ny * targetSpeed;
  }

  stepSwingVisualState(dt, swingActive) {
    this.swingActiveVisual = !!swingActive;
    const target = swingActive ? 1 : 0;
    const fadeRate = 4.0; // 約0.25秒で発動/終了を滑らかにフェードイン・フェードアウト
    if (this.swingVisualAlpha < target) {
      this.swingVisualAlpha = Math.min(1, this.swingVisualAlpha + dt * fadeRate);
    } else if (this.swingVisualAlpha > target) {
      this.swingVisualAlpha = Math.max(0, this.swingVisualAlpha - dt * fadeRate);
    }
    if (swingActive || this.swingVisualAlpha > 0) {
      this.swingAngle = (this.swingAngle - 7.0 * dt + Math.PI * 2) % (Math.PI * 2);
    }
  }

  getSwingSweepRadius() {
    const baseR = this.radius || GAME_CONFIG.BALL.BASE_RADIUS;
    return 6.2 * baseR;
  }

  /**
   * 半径 outerR の円内で中心(centerX, centerY)から外側境界へ伸びる直線翼上の点を返す
   */
  getSwingCurvePoint(centerX, centerY, armAngle, outerR, u) {
    const dist = outerR * u;
    return {
      x: centerX + Math.cos(armAngle) * dist,
      y: centerY + Math.sin(armAngle) * dist
    };
  }

  getSwingArmCircles(centerX = this.x, centerY = this.y) {
    const baseR = this.radius || GAME_CONFIG.BALL.BASE_RADIUS;
    const outerR = this.getSwingSweepRadius();
    const uSamples = [0.36, 0.65, 0.94];
    const hitR = 0.72 * baseR;
    const circles = [];
    for (let armIdx = 0; armIdx < 2; armIdx++) {
      const armBaseAngle = this.swingAngle + armIdx * Math.PI;
      for (const u of uSamples) {
        const pt = this.getSwingCurvePoint(centerX, centerY, armBaseAngle, outerR, u);
        circles.push({ x: pt.x, y: pt.y, r: hitR });
      }
    }
    return circles;
  }

  handleSwingArmsCollisions(context) {
    const { enemies = [], boss = null, effectsManager, onScore, onSpawnItem } = context;
    const circles = this.getSwingArmCircles();
    for (const c of circles) {
      for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
        const enemy = enemies[eIdx];
        if (enemy.hitCooldown > 0) continue;
        if (Math.hypot(c.x - enemy.x, c.y - enemy.y) <= c.r + enemy.currentRadius) {
          const destroyed = enemy.hitByBall(this, effectsManager, false);
          enemy.hitCooldown = 0.2;
          if (destroyed) {
            const enemyDropChance = context.enemyDropChance !== undefined ? context.enemyDropChance : 0.42;
            if (onScore) onScore(150 * enemy.maxHealth);
            if (onSpawnItem) onSpawnItem(enemy.x, enemy.y, enemyDropChance);
            if (context.onEnemyEvent) context.onEnemyEvent(enemy, true);
            enemies.splice(eIdx, 1);
          } else if (context.onEnemyEvent) {
            context.onEnemyEvent(enemy, false);
          }
        }
      }
      if (boss && !boss.isDefeated()) {
        boss.handleSwingCircleCollision(c.x, c.y, c.r, effectsManager, onScore, onSpawnItem);
      }
    }
  }

  resolveBounceAngle(baseAngle, context) {
    const { blocks = [], enemies = [], boss = null, supplyDrops = [], swingActive = false } = context;
    if (this.effects.cyan > 0) {
      return this.computeCyanAimAssistAngle(baseAngle, blocks, enemies, boss, supplyDrops);
    }
    if (swingActive && enemies.length > 0) {
      return this.computeSwingEnemyAimAssistAngle(baseAngle, enemies);
    }
    return baseAngle;
  }

  /**
   * パドル反射時のエイムアシスト計算の共通ヘルパー
   */
  computeAimAssistAngle(baseAngle, blocks, enemies, boss, supplyDrops, maxDelta, step, enemiesOnly = false) {
    if (this.simulateTrajectoryHitsTarget(baseAngle, blocks, enemies, 0, boss, supplyDrops, enemiesOnly)) {
      return baseAngle;
    }

    const minAngle = -Math.PI + 0.35;
    const maxAngle = -0.35;
    const margins = enemiesOnly ? [0] : [-3, 0];

    for (const margin of margins) {
      for (let delta = step; delta <= maxDelta; delta += step) {
        for (const sign of [1, -1]) {
          const candidate = baseAngle + sign * delta;
          if (candidate < minAngle || candidate > maxAngle) continue;
          if (this.simulateTrajectoryHitsTarget(candidate, blocks, enemies, margin, boss, supplyDrops, enemiesOnly)) {
            return candidate;
          }
        }
      }
    }

    return baseAngle;
  }

  /**
   * 水色ボールで跳ね返した際のエイムアシスト計算。
   * 現在の反射角度の軌道上にブロックや敵がなければ、軌道周辺を探索し、
   * 近くに標的があればそこに当たる角度へ軌道を補正する。
   */
  computeCyanAimAssistAngle(baseAngle, blocks, enemies, boss = null, supplyDrops = []) {
    return this.computeAimAssistAngle(baseAngle, blocks, enemies, boss, supplyDrops, 0.56, 0.015, false);
  }

  /**
   * スイング発動中の雑魚敵への若干のエイムアシスト計算
   */
  computeSwingEnemyAimAssistAngle(baseAngle, enemies) {
    return this.computeAimAssistAngle(baseAngle, [], enemies, null, [], 0.22, 0.02, true);
  }

  /**
   * 指定した反射角度でボールの軌道をシミュレートし、ブロックまたは敵に当たるか判定する
   */
  simulateTrajectoryHitsTarget(angle, blocks, enemies, radiusMargin = 0, boss = null, supplyDrops = [], enemiesOnly = false) {
    const { WIDTH, PADDLE, BALL } = GAME_CONFIG;
    const isYellow = this.effects.yellow > 0;
    const isGreen = this.effects.green > 0;
    const speedMult = isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;

    let simX = this.x;
    let simY = this.y;
    let simVx;
    let simVy;

    if (isYellow) {
      const horizontalRatio = Math.sin(angle + Math.PI / 2);
      simVx = horizontalRatio * BALL.YELLOW_MAX_VX * speedMult;
      simVy = -BALL.YELLOW_JUMP_VY * speedMult;
    } else {
      const bounceSpeed = BALL.BASE_SPEED * speedMult;
      simVx = Math.cos(angle) * bounceSpeed;
      simVy = Math.sin(angle) * bounceSpeed;
    }

    const simRadius = Math.max(2, (isYellow ? BALL.BASE_RADIUS * BALL.YELLOW_SIZE_MULTIPLIER : this.radius) + radiusMargin);
    const simDt = 0.016;
    const maxSteps = 150; // パドルから上端へ到達し、跳ね返って中段まで戻るまでの十分なステップ数
    let hasBouncedTop = false;

    for (let step = 0; step < maxSteps; step++) {
      if (isYellow) {
        const risingGravMult = (isGreen && simVy < 0) ? speedMult : 1.0;
        const gravScale = risingGravMult * risingGravMult;
        simVy += BALL.YELLOW_GRAVITY * gravScale * simDt;
      }

      simX += simVx * simDt;
      simY += simVy * simDt;

      // 左右の壁反射
      if (simX - simRadius < 0) {
        simX = simRadius;
        simVx = Math.abs(simVx);
      } else if (simX + simRadius > WIDTH) {
        simX = WIDTH - simRadius;
        simVx = -Math.abs(simVx);
      }

      // 上端の壁反射
      if (simY - simRadius < 0) {
        simY = simRadius;
        const prevSimVy = simVy;
        simVy = Math.abs(simVy);
        if (isYellow && isGreen && prevSimVy < 0) {
          simVy /= BALL.GREEN_SPEED_MULTIPLIER;
        }
        hasBouncedTop = true;
      }

      // 上端で跳ね返ったあと、ブロック・敵エリアより下（y > 520）まで降りてきたら探索終了
      if (hasBouncedTop && simVy > 0 && simY > 520) {
        break;
      }
      if (simVy > 0 && simY >= PADDLE.Y) {
        break;
      }

      if (!enemiesOnly) {
        // ブロック・サプライドロップとのヒットチェック
        for (const blk of blocks) {
          if (!blk.alive || !blk.collidable) continue;
          if (this.rectOverlapsCircle(blk.x, blk.y, blk.w, blk.h, simX, simY, simRadius)) {
            return true;
          }
        }
        const simElapsed = (step + 1) * simDt;
        for (const drop of supplyDrops) {
          if (!drop.alive) continue;
          const dyPos = drop.y + drop.vy * simElapsed;
          if (this.rectOverlapsCircle(drop.x, dyPos, drop.w, drop.h, simX, simY, simRadius)) {
            return true;
          }
        }
      }

      // エネミーとのヒットチェック（経過時間に応じた移動予測位置も考慮）
      const elapsed = (step + 1) * simDt;
      for (const enemy of enemies) {
        let ex = enemy.x;
        const ey = enemy.y + enemy.vy * elapsed;
        if (enemy.movement_type === 'retro') {
          ex = ColorUtils.clamp(enemy.x + enemy.vx * elapsed, enemy.currentRadius, WIDTH - enemy.currentRadius);
        }
        const dist = Math.hypot(simX - ex, simY - ey);
        if (dist <= simRadius + enemy.currentRadius) {
          return true;
        }
      }

      // ボスのダメージ有効部位とのヒットチェック
      if (!enemiesOnly && boss && !boss.isDefeated() && boss.introProgress >= 1) {
        if (boss.hitsCircle && boss.hitsCircle(simX, simY, simRadius)) {
          return true;
        }
      }
    }

    return false;
  }

  applyPaddleBounceVelocity(bounceAngle) {
    const { BALL } = GAME_CONFIG;
    const speedMult = this.effects.green > 0 ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;

    if (this.effects.yellow > 0) {
      // パドルのどの位置に当たっても画面上端(y=0)まで必ず届く上方向初速を付与
      const horizontalRatio = Math.sin(bounceAngle + Math.PI / 2);
      this.vx = horizontalRatio * BALL.YELLOW_MAX_VX * speedMult;
      this.vy = -BALL.YELLOW_JUMP_VY * speedMult;
    } else {
      const bounceSpeed = BALL.BASE_SPEED * speedMult;
      this.vx = Math.cos(bounceAngle) * bounceSpeed;
      this.vy = Math.sin(bounceAngle) * bounceSpeed;
    }
  }

  updateAfterimages(dt) {
    if (this.effects.green > 0) {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.02) {
        this.afterimageTimer = 0;
        this.afterimages.push({
          x: this.x + (this.corrX || 0),
          y: this.y + (this.corrY || 0),
          radius: this.radius,
          color: ColorUtils.getStarEffectColor(this.effects, this.effectClock),
          alpha: 0.55
        });
      }
    }
    for (let aIdx = this.afterimages.length - 1; aIdx >= 0; aIdx--) {
      this.afterimages[aIdx].alpha -= dt * 2.4;
      if (this.afterimages[aIdx].alpha <= 0) {
        this.afterimages.splice(aIdx, 1);
      }
    }
  }

  /**
   * ゲスト側クライアント予測＆等速直線運動（イベント間の毎フレーム描画用）
   * allowLocalPaddlePrediction=false のときは壁反射のみ（イベント遅延補完の早送り用）
   */
  stepClientPrediction(dt, context = {}, allowLocalPaddlePrediction = true) {
    const { WIDTH, PADDLE, BALL, ITEM } = GAME_CONFIG;
    const { localPaddle, purplePaddle = null, blocks = [], enemies = [], boss = null, supplyDrops = [], effectsManager, swingActive = false } = context;

    if (allowLocalPaddlePrediction || swingActive || this.swingVisualAlpha > 0) {
      this.stepSwingVisualState(dt, !!swingActive);
    }

    if (this.predictedBounceTimer > 0) {
      this.predictedBounceTimer = Math.max(0, this.predictedBounceTimer - dt);
    }

    // ホスト補正誤差を滑らかに減衰
    if (this.corrX || this.corrY) {
      const decay = Math.exp(-16 * dt);
      this.corrX *= decay;
      this.corrY *= decay;
      if (Math.abs(this.corrX) < 0.05) this.corrX = 0;
      if (Math.abs(this.corrY) < 0.05) this.corrY = 0;
    }

    const hadYellow = this.effects.yellow > 0;
    this.effects.cyan = Math.max(0, this.effects.cyan - dt);
    this.effects.yellow = Math.max(0, this.effects.yellow - dt);
    this.effects.green = Math.max(0, this.effects.green - dt);

    const isCyan = this.effects.cyan > 0;
    const isYellow = this.effects.yellow > 0;
    const isGreen = this.effects.green > 0;

    const baseTargetRadius = isYellow ? BALL.BASE_RADIUS * BALL.YELLOW_SIZE_MULTIPLIER : BALL.BASE_RADIUS;
    const targetLinearSpeed = BALL.BASE_SPEED * (isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0);

    if (hadYellow && !isYellow) {
      this.yellowTransitionTimer = 0.35;
      this.yellowTransitionStartVx = this.vx;
      this.yellowTransitionStartVy = this.vy;
    }

    if (this.spawningFromCenter) {
      this.spawnTimer += dt;
      this.updateCenterSpawnState(baseTargetRadius, targetLinearSpeed);
    } else {
      this.radius += (baseTargetRadius - this.radius) * Math.min(1, dt * 10);
      if (isYellow) {
        const speedMult = isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;
        const risingGravMult = (isGreen && this.vy < 0) ? speedMult : 1.0;
        this.vy += BALL.YELLOW_GRAVITY * (risingGravMult * risingGravMult) * dt;
        const maxVx = BALL.YELLOW_MAX_VX * speedMult;
        this.vx = ColorUtils.clamp(this.vx, -maxVx, maxVx);
      } else if (this.yellowTransitionTimer > 0) {
        this.yellowTransitionTimer = Math.max(0, this.yellowTransitionTimer - dt);
        const t = 1 - this.yellowTransitionTimer / 0.35;
        let dirAngle = Math.atan2(this.vy, this.vx);
        if (Math.abs(Math.sin(dirAngle)) < 0.34) {
          dirAngle = (this.vy >= 0 ? 1 : -1) * 0.35 + (this.vx >= 0 ? 0 : Math.PI);
        }
        const linearVx = Math.cos(dirAngle) * targetLinearSpeed;
        const linearVy = Math.sin(dirAngle) * targetLinearSpeed;
        this.vx = this.yellowTransitionStartVx + (linearVx - this.yellowTransitionStartVx) * t;
        this.vy = this.yellowTransitionStartVy + (linearVy - this.yellowTransitionStartVy) * t;
      } else {
        this.clampVerticalAngle(targetLinearSpeed);
      }
    }

    if (allowLocalPaddlePrediction && effectsManager) {
      if (isCyan || isYellow || isGreen) {
        this.effectClock += dt;
        this.pulseTimer += dt;
        if (this.pulseTimer >= ITEM.PULSE_INTERVAL) {
          this.pulseTimer -= ITEM.PULSE_INTERVAL;
          const col = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
          effectsManager.spawnPulse({
            kind: 'circle',
            target: this,
            x: this.x + (this.corrX || 0),
            y: this.y + (this.corrY || 0),
            radius: this.radius,
            color: col,
            duration: 0.42,
            maxScale: 2.2
          }, false);
        }
      } else {
        this.effectClock = 0;
        this.pulseTimer = 0;
      }
      this.updateAfterimages(dt);
    }

    const subSteps = 3;
    const subDt = dt / subSteps;
    for (let s = 0; s < subSteps; s++) {
      this.x += this.vx * subDt;
      this.y += this.vy * subDt;

      if (this.spawningFromCenter) {
        this.updateCenterSpawnState(baseTargetRadius, targetLinearSpeed);
      }

      if (this.x - this.radius < 0) {
        this.x = this.radius;
        this.vx = Math.abs(this.vx);
      } else if (this.x + this.radius > WIDTH) {
        this.x = WIDTH - this.radius;
        this.vx = -Math.abs(this.vx);
      }
      if (this.y - this.radius < 0) {
        this.y = this.radius;
        const prevVy = this.vy;
        this.vy = Math.abs(this.vy);
        if (isYellow && isGreen && prevVy < 0) {
          this.vy /= BALL.GREEN_SPEED_MULTIPLIER;
        }
      }

      // 自分のパドルに対する即座のローカル反射予測
      if (allowLocalPaddlePrediction && this.predictedBounceTimer <= 0 && this.vy > 0 && localPaddle && localPaddle.hp > 0) {
        const catchHalfW = localPaddle.currentWidth / 2 + PADDLE.BALL_CATCH_MARGIN;
        const pTop = localPaddle.y - localPaddle.height / 2;
        const pBottom = localPaddle.y + localPaddle.height / 2;
        if (
          this.x + this.radius >= localPaddle.x - catchHalfW &&
          this.x - this.radius <= localPaddle.x + catchHalfW &&
          this.y + this.radius >= pTop &&
          this.y - this.radius <= pBottom
        ) {
          this.y = pTop - this.radius;
          this.spawningFromCenter = false;
          if (localPaddle.effects.cyan > 0) {
            this.effects.cyan = Math.max(this.effects.cyan, localPaddle.effects.cyan + 5.0);
          }
          if (localPaddle.effects.yellow > 0) {
            this.effects.yellow = Math.max(this.effects.yellow, localPaddle.effects.yellow + 5.0);
          }
          if (localPaddle.effects.green > 0) {
            this.effects.green = Math.max(this.effects.green, localPaddle.effects.green + 5.0);
          }
          const offset = ColorUtils.clamp((this.x - localPaddle.x) / catchHalfW, -0.85, 0.85);
          const bounceAngle = -Math.PI / 2 + offset * (Math.PI * 0.35);
          const finalAngle = this.resolveBounceAngle(bounceAngle, context);
          this.applyPaddleBounceVelocity(finalAngle);
          this.predictedBounceTimer = 0.2;
        }
      }

      // 紫色のサブパドルとの予測反射（回数は消費せずホスト権威を保つ）
      if (allowLocalPaddlePrediction && this.predictedBounceTimer <= 0 && this.vy > 0 && purplePaddle) {
        const ppHalfW = purplePaddle.width / 2 + 4;
        const ppTop = purplePaddle.y - purplePaddle.height / 2;
        const ppBottom = purplePaddle.y + purplePaddle.height / 2;
        if (
          this.x + this.radius >= purplePaddle.x - ppHalfW &&
          this.x - this.radius <= purplePaddle.x + ppHalfW &&
          this.y + this.radius >= ppTop &&
          this.y - this.radius <= ppBottom
        ) {
          this.y = ppTop - this.radius;
          this.spawningFromCenter = false;
          const offset = ColorUtils.clamp((this.x - purplePaddle.x) / ppHalfW, -0.8, 0.8);
          const bounceAngle = -Math.PI / 2 + offset * (Math.PI * 0.32);
          const finalAngle = this.resolveBounceAngle(bounceAngle, context);
          this.applyPaddleBounceVelocity(finalAngle);
          this.predictedBounceTimer = 0.2;
        }
      }

      // ブロック＆サプライドロップに対するローカル視覚反射予測（破壊確定はホストのblock_evt/drop_evtに従う）
      if (!isCyan && !this.spawningFromCenter) {
        for (const blk of blocks) {
          if (!blk.alive || !blk.collidable) continue;
          if (this.rectOverlapsCircle(blk.x, blk.y, blk.w, blk.h, this.x, this.y, this.radius)) {
            this.bounceOffRect(blk.x, blk.y, blk.w, blk.h, true);
            break;
          }
        }
        for (const drop of supplyDrops) {
          if (!drop.alive) continue;
          if (this.rectOverlapsCircle(drop.x, drop.y, drop.w, drop.h, this.x, this.y, this.radius)) {
            this.bounceOffRect(drop.x, drop.y, drop.w, drop.h, true);
            break;
          }
        }
      }
    }
  }

  render(ctx) {
    if (this.radius <= 0.1) return;
    const drawX = this.x + (this.corrX || 0);
    const drawY = this.y + (this.corrY || 0);
    for (const ai of this.afterimages) {
      ctx.save();
      ctx.globalAlpha = ai.alpha * 0.55;
      ctx.fillStyle = ai.color;
      ctx.beginPath();
      ctx.arc(ai.x, ai.y, ai.radius * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    const ballColor = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
    const swingAlpha = this.swingVisualAlpha > 0
      ? this.swingVisualAlpha
      : (this.swingActiveVisual ? 1 : 0);
    if (swingAlpha > 0.005) {
      const outerR = this.getSwingSweepRadius();
      const trailArc = Math.PI * 0.78;
      const trailSteps = 28;

      ctx.save();
      ctx.beginPath();
      ctx.arc(drawX, drawY, outerR, 0, Math.PI * 2);
      if (typeof ctx.clip === 'function') {
        ctx.clip();
      }

      // 直線ブレードに沿った回転扇形の残像のみを円形パスに沿って描画（発動・終了時は滑らかにフェード・ボール色に同期）
      ctx.fillStyle = ballColor;
      for (let armIdx = 0; armIdx < 2; armIdx++) {
        const leadAngle = this.swingAngle + armIdx * Math.PI;
        for (let k = trailSteps - 1; k >= 0; k--) {
          const frac = k / trailSteps;
          const angA = leadAngle + (k / trailSteps) * trailArc;
          const angB = leadAngle + ((k + 1) / trailSteps) * trailArc;
          ctx.globalAlpha = Math.pow(1 - frac, 2.0) * 0.62 * swingAlpha;
          ctx.beginPath();
          ctx.moveTo(drawX, drawY);
          ctx.arc(drawX, drawY, outerR, angA, angB, false);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = ballColor;
    ctx.beginPath();
    ctx.arc(drawX, drawY, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

