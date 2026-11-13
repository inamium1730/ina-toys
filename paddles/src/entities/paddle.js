/**
 * 自機パドルおよび紫色のサブパドルクラス
 */
class Paddle {
  constructor(options = {}) {
    const { WIDTH, PADDLE } = GAME_CONFIG;
    this.netKind = 'paddle';
    this.slot = options.slot !== undefined ? options.slot : 0;
    this.totalPlayers = options.totalPlayers || 1;
    this.maxHp = options.maxHp !== undefined ? options.maxHp : PADDLE.MAX_HP;
    this.nickname = options.nickname || '';
    this.isLocal = options.isLocal !== undefined ? options.isLocal : true;

    const defaultX = this.totalPlayers <= 1
      ? WIDTH / 2
      : WIDTH * ((this.slot + 1) / (this.totalPlayers + 1));

    this.x = options.x !== undefined ? options.x : defaultX;
    this.y = PADDLE.Y;
    this.hp = this.maxHp;
    this.currentWidth = this.maxHp * PADDLE.WIDTH_PER_HP;
    this.height = PADDLE.HEIGHT;
    this.timeSinceLastDamage = 0;
    this.regenParticleTimer = 0;
    this.effectClock = 0;
    this.pulseTimer = 0;
    this.invincibleTimer = 0;
    this.contestedItemsCount = options.contestedItemsCount || 0;
    this.effects = {
      cyan: 0,
      yellow: 0,
      green: 0
    };
  }

  getSpeed() {
    const { PADDLE } = GAME_CONFIG;
    const mult = this.effects.green > 0 ? PADDLE.GREEN_SPEED_MULTIPLIER : 1.0;
    return PADDLE.BASE_SPEED * mult;
  }

  moveHorizontal(dt, input) {
    if (this.hp <= 0) return;
    const halfW = this.currentWidth / 2;
    const maxStep = this.getSpeed() * dt;

    if (input.left || input.right) {
      let dir = 0;
      if (input.left) dir -= 1;
      if (input.right) dir += 1;
      this.x += dir * maxStep;
    } else if (input.pointerX !== null && input.pointerX !== undefined) {
      const targetX = ColorUtils.clamp(input.pointerX, halfW, GAME_CONFIG.WIDTH - halfW);
      const diff = targetX - this.x;
      if (Math.abs(diff) <= maxStep) {
        this.x = targetX;
      } else {
        this.x += Math.sign(diff) * maxStep;
      }
    }

    this.x = ColorUtils.clamp(this.x, halfW, GAME_CONFIG.WIDTH - halfW);
  }

  update(dt, input, effectsManager) {
    if (this.hp <= 0) return;

    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }

    const { WIDTH, PADDLE, ITEM } = GAME_CONFIG;
    this.moveHorizontal(dt, input);

    // 自然再生: 10秒間ダメージを受けずにいると1秒間に1HP線形に回復 (HP=0のときは回復しない)
    if (this.hp < this.maxHp) {
      this.timeSinceLastDamage += dt;
      if (this.timeSinceLastDamage >= PADDLE.REGEN_DELAY) {
        this.hp = Math.min(this.maxHp, this.hp + PADDLE.REGEN_RATE * dt);
        this.currentWidth = this.hp * PADDLE.WIDTH_PER_HP;
        const halfW = this.currentWidth / 2;
        this.x = ColorUtils.clamp(this.x, halfW, WIDTH - halfW);

        // 回復中は左右端から丸い白色のパーティクルを放出
        this.regenParticleTimer -= dt;
        if (this.regenParticleTimer <= 0) {
          this.regenParticleTimer = 0.055;
          effectsManager.spawnRegenParticles(this.x, this.y, this.currentWidth, this.height);
        }
      }
    }

    // 星アイテムの効果時間更新＆パルスアニメーション
    const activeBefore = ColorUtils.hasAnyStarEffect(this.effects);
    this.effects.cyan = Math.max(0, this.effects.cyan - dt);
    this.effects.yellow = Math.max(0, this.effects.yellow - dt);
    this.effects.green = Math.max(0, this.effects.green - dt);

    if (ColorUtils.hasAnyStarEffect(this.effects)) {
      this.effectClock += dt;
      this.pulseTimer += dt;
      if (this.pulseTimer >= ITEM.PULSE_INTERVAL) {
        this.pulseTimer -= ITEM.PULSE_INTERVAL;
        const currentColor = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
        effectsManager.spawnPulse({
          kind: 'rect',
          target: this,
          x: this.x,
          y: this.y,
          w: this.currentWidth,
          h: this.height,
          color: currentColor,
          duration: 0.45,
          maxScale: 1.85
        });
      }
    } else if (activeBefore) {
      this.effectClock = 0;
      this.pulseTimer = 0;
    }
  }

  revive(newMaxHp, effectsManager) {
    const { PADDLE, COLORS, WIDTH } = GAME_CONFIG;
    if (newMaxHp !== undefined) {
      this.maxHp = newMaxHp;
    }
    this.hp = this.maxHp;
    this.currentWidth = this.hp * PADDLE.WIDTH_PER_HP;
    this.timeSinceLastDamage = 0;
    this.regenParticleTimer = 0;
    this.invincibleTimer = 3.0;
    const halfW = this.currentWidth / 2;
    this.x = ColorUtils.clamp(this.x, halfW, WIDTH - halfW);

    if (effectsManager) {
      effectsManager.spawnPulse({
        kind: 'rect',
        target: this,
        x: this.x,
        y: this.y,
        w: this.currentWidth,
        h: this.height,
        color: COLORS.white,
        duration: 0.45,
        maxScale: 1.85
      });
    }
  }

  takeDamage(damageAmount, effectsManager) {
    if (this.hp <= 0 || this.invincibleTimer > 0) return false;

    const { PADDLE, COLORS } = GAME_CONFIG;
    const oldHp = this.hp;
    const oldWidth = this.currentWidth;
    this.hp = Math.max(0, this.hp - damageAmount);
    this.currentWidth = this.hp * PADDLE.WIDTH_PER_HP;
    this.timeSinceLastDamage = 0;

    if (this.hp <= 0) {
      effectsManager.spawnPaddleShatterSection(this.x, this.y, oldWidth, this.height, this.x);
    } else {
      const lostTotal = oldWidth - this.currentWidth;
      const sideLost = lostTotal / 2;
      if (sideLost > 0.5) {
        const leftCenter = this.x - this.currentWidth / 2 - sideLost / 2;
        const rightCenter = this.x + this.currentWidth / 2 + sideLost / 2;
        effectsManager.spawnPaddleShatterSection(leftCenter, this.y, sideLost, this.height, this.x, true, this);
        effectsManager.spawnPaddleShatterSection(rightCenter, this.y, sideLost, this.height, this.x, true, this);
      }
    }

    if (oldHp > 0 && this.hp === 0) {
      effectsManager.spawnCircleParticles(this.x, this.y, COLORS.red, 14, 50, 190);
    }

    return true;
  }

  render(ctx, showMultiplayerTags = false, localTagMorph = 1) {
    if (this.hp <= 0 || this.currentWidth <= 0) return;
    const isBlinkDimmed =
      this.invincibleTimer > 0 &&
      Math.floor(Math.max(0, 3.0 - this.invincibleTimer) / 0.25) % 2 === 1;
    ctx.save();
    ctx.save();
    ctx.fillStyle = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
    let paddleAlpha = (showMultiplayerTags && !this.isLocal) ? 0.75 : 1.0;
    if (isBlinkDimmed) {
      paddleAlpha *= 0.75;
    }
    ctx.globalAlpha = paddleAlpha;
    ctx.fillRect(this.x - this.currentWidth / 2, this.y - this.height / 2, this.currentWidth, this.height);
    ctx.restore();

    if (showMultiplayerTags) {
      const t = ColorUtils.clamp(localTagMorph, 0, 1);
      const textY = this.y + this.height / 2 + 13;
      const checkAlpha = Math.pow(1 - t, 1.4);
      const checkScale = 1 - t * 0.3;

      // パドルの上の中央にあったReadyチェックマークをゲーム開始時に滑らかに消す
      if (t < 0.999) {
        const checkOpacity = checkAlpha * (this.isLocal ? 0.92 : 0.75);
        if (checkOpacity > 0.01) {
          ShapeRenderer.drawSharpCheckmark(
            ctx,
            this.x,
            this.y - this.height / 2 - 14,
            9 * checkScale,
            2.0,
            GAME_CONFIG.COLORS.white,
            checkOpacity
          );
        }
      }

      if (this.isLocal) {
        const label = this.nickname || `P${this.slot + 1}`;
        // タイトル画面の自機名からゲーム中の丸印へ滑らかに切り替える
        if (t < 0.999 && label) {
          const textAlpha = checkAlpha * 0.92;
          const textScale = 1 - t * 0.28;
          if (textAlpha > 0.01) {
            ctx.save();
            ctx.globalAlpha = textAlpha;
            ctx.fillStyle = GAME_CONFIG.COLORS.white;
            ctx.font = '500 11px "Google Sans Flex", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.translate(this.x, textY - t * 2);
            ctx.scale(textScale, textScale);
            ctx.fillText(label, 0, 0);
            ctx.restore();
          }
        }
        if (t > 0.001) {
          const eased = 1 - Math.pow(1 - t, 3);
          const circleAlpha = eased * 0.95;
          const radius = 4.2 * eased;
          if (radius > 0.05 && circleAlpha > 0.01) {
            ctx.globalAlpha = circleAlpha;
            ctx.fillStyle = GAME_CONFIG.COLORS.white;
            ctx.beginPath();
            ctx.arc(this.x, this.y + this.height / 2 + 10, radius, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else if (this.nickname) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = GAME_CONFIG.COLORS.white;
        ctx.font = '500 11px "Google Sans Flex", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.nickname, this.x, textY);
      }
    }
    ctx.restore();
  }
}

class PurplePaddle {
  constructor(initialX) {
    const { PURPLE_PADDLE } = GAME_CONFIG;
    this.netKind = 'purple';
    this.id = 0;
    this.x = initialX;
    this.y = PURPLE_PADDLE.Y;
    this.bounces = 1;
    this.width = 0; // 初回出現時も滑らかにイージングして伸びる
    this.targetWidth = PURPLE_PADDLE.UNIT_WIDTH;
    this.height = PURPLE_PADDLE.HEIGHT;
    this.dir = Math.random() < 0.5 ? -1 : 1;
    this.clampPosition();
  }

  addBounceUnit() {
    const { PURPLE_PADDLE } = GAME_CONFIG;
    if (this.bounces < PURPLE_PADDLE.MAX_UNITS) {
      this.bounces += 1;
      this.targetWidth = this.bounces * PURPLE_PADDLE.UNIT_WIDTH;
      this.clampPosition();
    }
  }

  clampPosition() {
    const halfW = Math.max(this.width, this.targetWidth) / 2;
    this.x = ColorUtils.clamp(this.x, halfW, GAME_CONFIG.WIDTH - halfW);
  }

  update(dt) {
    const { WIDTH, PURPLE_PADDLE } = GAME_CONFIG;
    // パドルの大きさを目標幅へ向かって滑らかにイージング
    this.width += (this.targetWidth - this.width) * Math.min(1, dt * PURPLE_PADDLE.EASE_SPEED);

    this.x += this.dir * PURPLE_PADDLE.SPEED * dt;
    const halfW = this.width / 2;
    if (this.x - halfW <= 0) {
      this.x = halfW;
      this.dir = 1;
    } else if (this.x + halfW >= WIDTH) {
      this.x = WIDTH - halfW;
      this.dir = -1;
    }
  }

  consumeBounce(effectsManager) {
    const { PURPLE_PADDLE, COLORS } = GAME_CONFIG;
    effectsManager.spawnPulse({
      kind: 'rect',
      target: this.bounces > 1 ? this : null,
      x: this.x,
      y: this.y,
      w: this.width,
      h: this.height,
      color: COLORS.purple,
      duration: 0.4,
      maxScale: 1.7
    });

    this.bounces -= 1;
    if (this.bounces <= 0) {
      effectsManager.spawnCircleParticles(this.x, this.y, COLORS.purple, 10, 40, 140);
      return true; // 消滅
    }
    this.targetWidth = this.bounces * PURPLE_PADDLE.UNIT_WIDTH;
    this.width = this.targetWidth;
    this.clampPosition();
    return false;
  }

  render(ctx) {
    if (this.bounces <= 0 || this.width <= 0.5) return;
    ctx.save();
    ctx.fillStyle = GAME_CONFIG.COLORS.purple;
    ctx.fillRect(this.x - this.width / 2, this.y - this.height / 2, this.width, this.height);
    ctx.restore();
  }
}

