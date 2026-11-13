/**
 * ボールクラス
 */
class Ball {
  constructor(x, y, vx, vy, customId) {
    const { WIDTH, HEIGHT, PADDLE, BALL } = GAME_CONFIG;
    Ball.nextId = (Ball.nextId || 0) + 1;
    this.netKind = 'ball';
    this.id = customId !== undefined ? customId : Ball.nextId;

    const angle = -Math.PI / 2 + (Math.random() * 0.46 - 0.23);
    const speed = BALL.BASE_SPEED;

    this.x = x !== undefined ? x : WIDTH / 2;
    this.y = y !== undefined ? y : PADDLE.Y - 22;
    this.vx = vx !== undefined ? vx : Math.cos(angle) * speed;
    this.vy = vy !== undefined ? vy : Math.sin(angle) * speed;
    this.radius = BALL.BASE_RADIUS;

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
    const { paddle, paddles, purplePaddle, blocks, enemies, effectsManager, onScore, onSpawnItem, onClearPurplePaddle } = context;
    const paddleList = Array.isArray(paddles) ? paddles : (paddle ? [paddle] : []);

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
        // 弱めの重力による物理バウンド移動
        const speedMult = isGreen ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;
        const gravScale = speedMult * speedMult;
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
        });
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
        this.vy = Math.abs(this.vy);
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
          const finalAngle = this.effects.cyan > 0
            ? this.computeCyanAimAssistAngle(avgAngle, blocks, enemies)
            : avgAngle;
          this.applyPaddleBounceVelocity(finalAngle);
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
          const finalAngle = this.effects.cyan > 0
            ? this.computeCyanAimAssistAngle(bounceAngle, blocks, enemies)
            : bounceAngle;
          this.applyPaddleBounceVelocity(finalAngle);

          if (pp.consumeBounce(effectsManager)) {
            onClearPurplePaddle();
          }
        }
      }

      // ブロックとの衝突 (スケールイン演出が完了し当たり判定が追加されたブロックのみ)
      for (const blk of blocks) {
        if (!blk.alive || !blk.collidable) continue;
        const bLeft = blk.x - blk.w / 2;
        const bRight = blk.x + blk.w / 2;
        const bTop = blk.y - blk.h / 2;
        const bBottom = blk.y + blk.h / 2;

        const closestX = ColorUtils.clamp(this.x, bLeft, bRight);
        const closestY = ColorUtils.clamp(this.y, bTop, bBottom);
        const dx = this.x - closestX;
        const dy = this.y - closestY;

        if (dx * dx + dy * dy <= this.radius * this.radius) {
          blk.alive = false;
          onScore(100);
          effectsManager.spawnCircleParticles(blk.x, blk.y, COLORS.white, 7, 35, 130);
          onSpawnItem(blk.x, blk.y, 0.26);

          // 水色ボールはブロックに当たっても反射せず貫通する
          if (this.effects.cyan <= 0) {
            const overlapX = (blk.w / 2 + this.radius) - Math.abs(this.x - blk.x);
            const overlapY = (blk.h / 2 + this.radius) - Math.abs(this.y - blk.y);
            if (overlapX < overlapY) {
              this.vx = -this.vx;
            } else {
              this.vy = -this.vy;
              if (this.effects.yellow > 0 && this.vy < 0) {
                const speedMult = this.effects.green > 0 ? BALL.GREEN_SPEED_MULTIPLIER : 1.0;
                const minUpVy = Math.sqrt(2 * BALL.YELLOW_GRAVITY * Math.max(120, this.y + 60)) * speedMult;
                this.vy = -Math.max(Math.abs(this.vy), minUpVy);
              }
            }
            break;
          }
        }
      }

      // エネミーとの衝突
      for (let eIdx = enemies.length - 1; eIdx >= 0; eIdx--) {
        const enemy = enemies[eIdx];
        if (enemy.hitCooldown > 0) continue;
        const dist = Math.hypot(this.x - enemy.x, this.y - enemy.y);
        if (dist <= this.radius + enemy.currentRadius) {
          const destroyed = enemy.hitByBall(this, effectsManager);
          enemy.hitCooldown = 0.08;

          if (this.effects.cyan <= 0) {
            this.spawningFromCenter = false;
            const nx = (this.x - enemy.x) / (dist || 1);
            const ny = (this.y - enemy.y) / (dist || 1);
            const speed = Math.hypot(this.vx, this.vy);
            this.vx = nx * speed;
            this.vy = ny * speed;
            if (this.effects.yellow <= 0) {
              this.clampVerticalAngle(speed);
            }
            this.x = enemy.x + nx * (enemy.currentRadius + this.radius + 2);
            this.y = enemy.y + ny * (enemy.currentRadius + this.radius + 2);
          }

          if (destroyed) {
            onScore(150 * enemy.maxHealth);
            onSpawnItem(enemy.x, enemy.y, 0.42);
            enemies.splice(eIdx, 1);
          }
          break;
        }
      }
    }

    return this.y - this.radius <= HEIGHT + 16;
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

  /**
   * 水色ボールで跳ね返した際のエイムアシスト計算。
   * 現在の反射角度の軌道上にブロックや敵がなければ、軌道周辺を探索し、
   * 近くに標的があればそこに当たる角度へ軌道を補正する。
   */
  computeCyanAimAssistAngle(baseAngle, blocks, enemies) {
    // 1. 元の軌道でそのままブロックまたは敵に当たるかシミュレート
    if (this.simulateTrajectoryHitsTarget(baseAngle, blocks, enemies, 0)) {
      return baseAngle;
    }

    // 2. 当たらない場合、元の軌道の周辺（最大約±32度の範囲）を中心に近い順で探索
    const maxDelta = 0.56; // 約32度
    const step = 0.015;
    const minAngle = -Math.PI + 0.35;
    const maxAngle = -0.35;

    // まず確実に標的にめり込んで当たる角度（マージン付き）を優先探索し、なければ通常判定で探索
    for (const margin of [-3, 0]) {
      for (let delta = step; delta <= maxDelta; delta += step) {
        for (const sign of [1, -1]) {
          const candidate = baseAngle + sign * delta;
          if (candidate < minAngle || candidate > maxAngle) continue;
          if (this.simulateTrajectoryHitsTarget(candidate, blocks, enemies, margin)) {
            return candidate;
          }
        }
      }
    }

    return baseAngle;
  }

  /**
   * 指定した反射角度でボールの軌道をシミュレートし、ブロックまたは敵に当たるか判定する
   */
  simulateTrajectoryHitsTarget(angle, blocks, enemies, radiusMargin = 0) {
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
        const gravScale = speedMult * speedMult;
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
        simVy = Math.abs(simVy);
        hasBouncedTop = true;
      }

      // 上端で跳ね返ったあと、ブロック・敵エリアより下（y > 520）まで降りてきたら探索終了
      if (hasBouncedTop && simVy > 0 && simY > 520) {
        break;
      }
      if (simVy > 0 && simY >= PADDLE.Y) {
        break;
      }

      // ブロックとのヒットチェック
      for (const blk of blocks) {
        if (!blk.alive || !blk.collidable) continue;
        const bLeft = blk.x - blk.w / 2;
        const bRight = blk.x + blk.w / 2;
        const bTop = blk.y - blk.h / 2;
        const bBottom = blk.y + blk.h / 2;

        const closestX = ColorUtils.clamp(simX, bLeft, bRight);
        const closestY = ColorUtils.clamp(simY, bTop, bBottom);
        const dx = simX - closestX;
        const dy = simY - closestY;

        if (dx * dx + dy * dy <= simRadius * simRadius) {
          return true;
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
          x: this.x,
          y: this.y,
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

  render(ctx) {
    if (this.radius <= 0.1) return;
    for (const ai of this.afterimages) {
      ctx.save();
      ctx.globalAlpha = ai.alpha * 0.55;
      ctx.fillStyle = ai.color;
      ctx.beginPath();
      ctx.arc(ai.x, ai.y, ai.radius * 0.92, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.fillStyle = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

