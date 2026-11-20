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
    this.vx = 0;
    this.hp = this.maxHp;
    this.currentWidth = this.computeWidthForHp(this.hp);
    this.height = PADDLE.HEIGHT;
    this.timeSinceLastDamage = 0;
    this.heartRegenTimer = 0;
    this.regenParticleTimer = 0;
    this.effectClock = 0;
    this.pulseTimer = 0;
    this.invincibleTimer = 0;
    this.statusPulseTimer = 0;
    this.statuses = {};
    for (const statusId of Object.keys(Paddle.STATUS_DEFS)) {
      this.statuses[statusId] = Paddle._createEmptyStatusState();
    }
    this.respawnTimer = 0;
    this.respawnPenalty = 0;
    this._deathRespawnHandled = false;
    this.contestedItemsCount = options.contestedItemsCount || 0;
    this.effects = {
      cyan: 0,
      yellow: 0,
      green: 0
    };
    this.afterimageTimer = 0;
    this.afterimages = [];
    this._lastAfterimageX = this.x;
  }

  static _createEmptyStatusState() {
    return {
      timer: 0,
      scaleInTimer: 0,
      scaleOutTimer: 0,
      iconPulseTimer: 0
    };
  }

  static registerStatus(def) {
    if (!def || !def.id) return;
    Paddle.STATUS_DEFS[def.id] = {
      w: 14,
      h: 14,
      blinkThreshold: 3.0,
      ...def
    };
  }

  ensureStatus(statusId) {
    if (!this.statuses) this.statuses = {};
    if (!this.statuses[statusId]) {
      this.statuses[statusId] = Paddle._createEmptyStatusState();
    }
    return this.statuses[statusId];
  }

  get guardTimer() { return this.ensureStatus('shield').timer; }
  set guardTimer(v) { this.ensureStatus('shield').timer = Math.max(0, Number(v) || 0); }
  get guardScaleInTimer() { return this.ensureStatus('shield').scaleInTimer; }
  set guardScaleInTimer(v) { this.ensureStatus('shield').scaleInTimer = Math.max(0, Number(v) || 0); }
  get guardScaleOutTimer() { return this.ensureStatus('shield').scaleOutTimer; }
  set guardScaleOutTimer(v) { this.ensureStatus('shield').scaleOutTimer = Math.max(0, Number(v) || 0); }
  get guardPulseTimer() { return this.statusPulseTimer; }
  set guardPulseTimer(v) { this.statusPulseTimer = Math.max(0, Number(v) || 0); }
  get guardIconPulseTimer() { return this.ensureStatus('shield').iconPulseTimer; }
  set guardIconPulseTimer(v) { this.ensureStatus('shield').iconPulseTimer = Math.max(0, Number(v) || 0); }

  get waveDebuffTimer() { return this.ensureStatus('snail').timer; }
  set waveDebuffTimer(v) { this.ensureStatus('snail').timer = Math.max(0, Number(v) || 0); }
  get waveScaleInTimer() { return this.ensureStatus('snail').scaleInTimer; }
  set waveScaleInTimer(v) { this.ensureStatus('snail').scaleInTimer = Math.max(0, Number(v) || 0); }
  get waveScaleOutTimer() { return this.ensureStatus('snail').scaleOutTimer; }
  set waveScaleOutTimer(v) { this.ensureStatus('snail').scaleOutTimer = Math.max(0, Number(v) || 0); }

  hasStatus(statusId) {
    const st = this.statuses && this.statuses[statusId];
    return Boolean(st && st.timer > 0);
  }

  hasAnyStatus() {
    if (!this.statuses) return false;
    for (const id of Object.keys(this.statuses)) {
      if (this.statuses[id] && this.statuses[id].timer > 0) return true;
    }
    return false;
  }

  getStatusTimer(statusId) {
    const st = this.statuses && this.statuses[statusId];
    return st ? st.timer : 0;
  }

  setStatus(statusId, duration, options = {}) {
    if (this.hp <= 0) return false;
    const hadAnyBefore = this.hasAnyStatus();
    const st = this.ensureStatus(statusId);
    const wasInactive = st.timer <= 0;
    const dur = duration > 0 ? duration : 10.0;
    st.timer = dur;
    if (wasInactive || options.resetScaleIn) {
      st.scaleInTimer = 0.32;
      st.iconPulseTimer = 0;
    }
    st.scaleOutTimer = 0;
    if (!hadAnyBefore) {
      this.statusPulseTimer = 0;
    }
    return true;
  }

  clearStatus(statusId, animateOut = false) {
    const st = this.statuses && this.statuses[statusId];
    if (!st) return;
    const wasActive = st.timer > 0;
    st.timer = 0;
    st.scaleInTimer = 0;
    st.iconPulseTimer = 0;
    st.scaleOutTimer = (animateOut && wasActive) ? 0.25 : 0;
    if (!this.hasAnyStatus()) {
      this.statusPulseTimer = 0;
    }
  }

  clearAllStatuses() {
    if (!this.statuses) return;
    for (const id of Object.keys(this.statuses)) {
      const st = this.statuses[id];
      st.timer = 0;
      st.scaleInTimer = 0;
      st.scaleOutTimer = 0;
      st.iconPulseTimer = 0;
    }
    this.statusPulseTimer = 0;
  }

  getSpeed() {
    const { PADDLE } = GAME_CONFIG;
    const mult = this.effects.green > 0 ? PADDLE.GREEN_SPEED_MULTIPLIER : 1.0;
    const debuffMult = this.hasStatus('snail') ? 0.55 : 1.0;
    return PADDLE.BASE_SPEED * mult * debuffMult;
  }

  applyWaveDebuff(duration = 10.0) {
    return this.setStatus('snail', duration > 0 ? duration : 10.0);
  }

  moveHorizontal(dt, input) {
    if (this.hp <= 0) {
      this.vx = 0;
      return;
    }
    const prevX = this.x;
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
    this.vx = dt > 0 ? (this.x - prevX) / dt : 0;
  }

  activateGuard(duration = 30) {
    this.setStatus('shield', duration > 0 ? duration : 30, { resetScaleIn: true });
  }

  /**
   * すべての「状態」タイマー・アイコンのパルスアニメーション・パドル点滅クロックを一括更新する
   */
  stepStatuses(dt, effectsManager = null) {
    const interval = (GAME_CONFIG.ITEM && GAME_CONFIG.ITEM.PULSE_INTERVAL) || 0.5;
    let anyActive = false;

    for (const statusId of Object.keys(this.statuses)) {
      const st = this.statuses[statusId];
      if (!st) continue;
      const def = Paddle.STATUS_DEFS[statusId] || { id: statusId, w: 14, h: 14 };

      if (st.scaleInTimer > 0) {
        st.scaleInTimer = Math.max(0, st.scaleInTimer - dt);
      }
      if (st.scaleOutTimer > 0) {
        st.scaleOutTimer = Math.max(0, st.scaleOutTimer - dt);
      }
      if (st.timer > 0) {
        st.timer = Math.max(0, st.timer - dt);
        if (st.timer > 0) {
          anyActive = true;
          if (st.scaleInTimer <= 0 && effectsManager) {
            st.iconPulseTimer += dt;
            if (st.iconPulseTimer >= interval) {
              st.iconPulseTimer -= interval;
              const pos = this.getStatusIconPosition(statusId);
              effectsManager.spawnPulse({
                kind: 'status',
                subType: statusId,
                target: this,
                offsetX: pos.x - this.x,
                offsetY: pos.y - this.y,
                x: pos.x,
                y: pos.y,
                w: pos.w,
                h: pos.h,
                color: def.color || GAME_CONFIG.COLORS.white,
                duration: def.pulseDuration || 0.45,
                maxScale: def.pulseMaxScale || 1.85
              }, false);
            }
          }
        } else {
          st.scaleOutTimer = 0.25;
          st.iconPulseTimer = 0;
          if (typeof def.onExpire === 'function') {
            def.onExpire(this);
          }
        }
      } else {
        st.iconPulseTimer = 0;
      }
    }

    if (anyActive) {
      this.statusPulseTimer += dt;
    } else {
      this.statusPulseTimer = 0;
    }
  }

  stepGuardTimers(dt, effectsManager = null) {
    this.stepStatuses(dt, effectsManager);
  }

  _stepPaddlePulse(dt, effectsManager) {
    if (!effectsManager) return;
    const { ITEM } = GAME_CONFIG;
    if (ColorUtils.hasAnyStarEffect(this.effects)) {
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
        }, false);
      }
    } else {
      this.pulseTimer = 0;
    }
  }

  updateAfterimages(dt, chronoActive = false, prevX = undefined) {
    if (this.hp <= 0) {
      if (this.afterimages.length > 0) this.afterimages = [];
      this.afterimageTimer = 0;
      this._lastAfterimageX = this.x;
      return;
    }
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].alpha -= dt * 2.2;
      if (this.afterimages[i].alpha <= 0) {
        this.afterimages.splice(i, 1);
      }
    }
    if (chronoActive) {
      const refX = prevX !== undefined ? prevX : (this._lastAfterimageX !== undefined ? this._lastAfterimageX : this.x);
      const movedDist = Math.abs(this.x - refX);
      this.afterimageTimer += dt;
      if (movedDist > 0.25 && (this.afterimages.length === 0 || this.afterimageTimer >= 0.018)) {
        this.afterimageTimer = 0;
        const color = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
        const steps = Math.min(3, Math.max(1, Math.floor(movedDist / 14)));
        for (let s = 0; s < steps; s++) {
          const frac = steps === 1 ? 0 : (s / steps);
          const sampleX = refX + (this.x - refX) * frac;
          this.afterimages.push({
            x: sampleX,
            y: this.y,
            w: this.currentWidth,
            h: this.height,
            color,
            alpha: 0.52 * (0.7 + 0.3 * frac)
          });
        }
        this._lastAfterimageX = this.x;
      } else if (movedDist <= 0.25) {
        this._lastAfterimageX = this.x;
      }
    } else {
      this.afterimageTimer = 0;
      this._lastAfterimageX = this.x;
    }
  }

  update(dt, input, effectsManager, chronoActive = false) {
    if (this.hp <= 0) {
      this.vx = 0;
      if (this.afterimages.length > 0) this.afterimages = [];
      this.afterimageTimer = 0;
      return;
    }

    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }
    this.stepStatuses(dt, effectsManager);

    const { WIDTH, PADDLE, ITEM } = GAME_CONFIG;
    const prevX = this.x;
    this.moveHorizontal(dt, input);
    this.updateAfterimages(dt, chronoActive, prevX);

    // 自然再生: 10秒間無被弾またはハート効果中(最大10秒/フル回復まで)に1秒間に1HP線形に回復 (HP=0のときは回復しない)
    if (this.hp < this.maxHp) {
      const heartActive = this.heartRegenTimer > 0;
      if (heartActive) {
        this.heartRegenTimer = Math.max(0, this.heartRegenTimer - dt);
      } else {
        this.timeSinceLastDamage += dt;
      }
      if (heartActive || this.timeSinceLastDamage >= PADDLE.REGEN_DELAY) {
        this.hp = Math.min(this.maxHp, this.hp + PADDLE.REGEN_RATE * dt);
        this.currentWidth = this.computeWidthForHp(this.hp);
        const halfW = this.currentWidth / 2;
        this.x = ColorUtils.clamp(this.x, halfW, WIDTH - halfW);

        if (this.hp >= this.maxHp) {
          this.heartRegenTimer = 0;
        }

        // 回復中は左右端から丸い白色のパーティクルを放出
        this.regenParticleTimer -= dt;
        if (this.regenParticleTimer <= 0) {
          this.regenParticleTimer = 0.055;
          effectsManager.spawnRegenParticles(this.x, this.y, this.currentWidth, this.height, false);
        }
      }
    } else if (this.heartRegenTimer > 0) {
      this.heartRegenTimer = 0;
    }

    // 星アイテムの効果時間更新＆パルスアニメーション
    const activeBefore = ColorUtils.hasAnyStarEffect(this.effects);
    this.effects.cyan = Math.max(0, this.effects.cyan - dt);
    this.effects.yellow = Math.max(0, this.effects.yellow - dt);
    this.effects.green = Math.max(0, this.effects.green - dt);

    if (ColorUtils.hasAnyStarEffect(this.effects)) {
      this.effectClock += dt;
    } else if (activeBefore) {
      this.effectClock = 0;
    }
    this._stepPaddlePulse(dt, effectsManager);
  }

  /**
   * ゲスト側ローカル専用: ゲームプレイに影響しない再生パーティクルや星エフェクトのパルス・残像を描画する
   */
  updateCosmeticEffects(dt, effectsManager, chronoActive = false, prevX = undefined) {
    this.updateAfterimages(dt, chronoActive, prevX);
    if (this.hp <= 0 || !effectsManager) return;
    const { PADDLE } = GAME_CONFIG;
    if (this.hp < this.maxHp) {
      const heartActive = this.heartRegenTimer > 0;
      if (heartActive) {
        this.heartRegenTimer = Math.max(0, this.heartRegenTimer - dt);
      } else {
        this.timeSinceLastDamage += dt;
      }
      if (heartActive || this.timeSinceLastDamage >= PADDLE.REGEN_DELAY) {
        this.regenParticleTimer -= dt;
        if (this.regenParticleTimer <= 0) {
          this.regenParticleTimer = 0.055;
          effectsManager.spawnRegenParticles(this.x, this.y, this.currentWidth, this.height, false);
        }
      }
    } else if (this.heartRegenTimer > 0) {
      this.heartRegenTimer = 0;
    }
    this._stepPaddlePulse(dt, effectsManager);
  }

  /**
   * 参加人数に応じた最大HP時のパドル幅(px)を返す
   */
  getMaxWidth() {
    const { PADDLE, MULTIPLAYER } = GAME_CONFIG;
    const baseWidth = PADDLE.MAX_HP * PADDLE.WIDTH_PER_HP;
    const maxPlayers = (MULTIPLAYER && MULTIPLAYER.MAX_PLAYERS) || 4;
    const count = Math.max(1, Math.min(maxPlayers, this.totalPlayers || 1));
    const scaleTable = MULTIPLAYER && MULTIPLAYER.WIDTH_SCALE_BY_PLAYER_COUNT;
    const scale = (scaleTable && scaleTable[count]) || 1.0;
    return baseWidth * scale;
  }

  /**
   * 指定HPに対応するパドル幅(px)を計算する
   */
  computeWidthForHp(hp = this.hp) {
    if (!this.maxHp || this.maxHp <= 0) return 0;
    return this.getMaxWidth() * Math.max(0, hp) / this.maxHp;
  }

  /**
   * パドル下に表示するすべての「状態」アイコン（シールド・カタツムリ・今後追加される状態）の座標一覧を返す
   * 複数重複する場合は横並びで中央揃えし、残り効果時間が長いものほど左側に配置する
   */
  getStatusIconLayout() {
    const items = [];
    if (this.statuses) {
      for (const statusId of Object.keys(this.statuses)) {
        const st = this.statuses[statusId];
        if (!st || (st.timer <= 0 && st.scaleOutTimer <= 0)) continue;
        const def = Paddle.STATUS_DEFS[statusId] || { id: statusId, w: 14, h: 14 };
        items.push({
          kind: statusId,
          remaining: Math.max(0, st.timer || 0),
          w: def.w || 14,
          h: def.h || 14
        });
      }
    }
    items.sort((a, b) => b.remaining - a.remaining);
    const baseY = this.y + this.height / 2 + 27;
    const spacing = 20;
    const startX = this.x - ((items.length - 1) * spacing) / 2;
    return items.map((item, idx) => ({
      ...item,
      x: startX + idx * spacing,
      y: baseY
    }));
  }

  getStatusIconPosition(statusId) {
    const layout = this.getStatusIconLayout();
    const found = layout.find((it) => it.kind === statusId);
    if (found) return found;
    const def = Paddle.STATUS_DEFS[statusId] || { id: statusId, w: 14, h: 14 };
    return {
      kind: statusId,
      x: this.x,
      y: this.y + this.height / 2 + 27,
      w: def.w || 14,
      h: def.h || 14
    };
  }

  getShieldIconPosition() {
    return this.getStatusIconPosition('shield');
  }

  getSnailIconPosition() {
    return this.getStatusIconPosition('snail');
  }

  revive(newMaxHp, effectsManager, totalPlayers) {
    const { COLORS, WIDTH } = GAME_CONFIG;
    if (totalPlayers !== undefined) {
      this.totalPlayers = totalPlayers;
    }
    if (newMaxHp !== undefined) {
      this.maxHp = newMaxHp;
    }
    this.hp = this.maxHp;
    this.currentWidth = this.computeWidthForHp(this.hp);
    this.timeSinceLastDamage = 0;
    this.heartRegenTimer = 0;
    this.clearAllStatuses();
    this.regenParticleTimer = 0;
    this.invincibleTimer = 3.0;
    this.respawnTimer = 0;
    this._deathRespawnHandled = false;
    this.afterimages = [];
    this.afterimageTimer = 0;
    const halfW = this.currentWidth / 2;
    this.x = ColorUtils.clamp(this.x, halfW, WIDTH - halfW);
    this._lastAfterimageX = this.x;

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
    if (this.hp <= 0 || this.invincibleTimer > 0 || damageAmount <= 0) return false;

    if (this.hasStatus('shield')) {
      const shieldPos = this.getShieldIconPosition();
      this.clearStatus('shield', false);
      this.invincibleTimer = Math.max(this.invincibleTimer, 1.0);
      if (effectsManager && typeof effectsManager.spawnShieldShatter === 'function') {
        effectsManager.spawnShieldShatter(shieldPos.x, shieldPos.y, shieldPos.w, shieldPos.h, this.x, true, this);
      }
      return false;
    }

    const { COLORS } = GAME_CONFIG;
    const effectiveDamage = this.hasStatus('snail') ? (damageAmount + 1) : damageAmount;
    const oldHp = this.hp;
    const oldWidth = this.currentWidth;
    this.hp = Math.max(0, this.hp - effectiveDamage);
    this.currentWidth = this.computeWidthForHp(this.hp);
    if (this.hp <= 0) {
      this.timeSinceLastDamage = 0;
      this.heartRegenTimer = 0;
      this.clearAllStatuses();
      this.afterimages = [];
      this.afterimageTimer = 0;
    } else if (this.heartRegenTimer <= 0) {
      this.timeSinceLastDamage = 0;
    }

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
    if (this.afterimages && this.afterimages.length > 0) {
      const baseRemoteAlpha = (showMultiplayerTags && !this.isLocal) ? 0.75 : 1.0;
      for (const ai of this.afterimages) {
        ctx.save();
        ctx.globalAlpha = ai.alpha * 0.55 * baseRemoteAlpha;
        ctx.fillStyle = ai.color || ColorUtils.getStarEffectColor(this.effects, this.effectClock);
        ctx.fillRect(ai.x - ai.w / 2, ai.y - ai.h / 2, ai.w, ai.h);
        ctx.restore();
      }
    }
    ctx.save();
    ctx.fillStyle = ColorUtils.getStarEffectColor(this.effects, this.effectClock);
    let paddleAlpha = (showMultiplayerTags && !this.isLocal) ? 0.75 : 1.0;
    if (this.invincibleTimer > 0) {
      if (isBlinkDimmed) {
        paddleAlpha *= 0.75;
      }
    } else if (this.hasAnyStatus()) {
      // どの状態が付与されていてもイージング付きの半透明・不透明の点滅アニメーションを再生
      const wave = 0.5 + 0.5 * Math.cos(2 * Math.PI * (this.statusPulseTimer % 1.0));
      paddleAlpha *= 0.75 + 0.25 * wave;
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

    const statusIcons = this.getStatusIconLayout();
    for (const icon of statusIcons) {
      const st = this.statuses && this.statuses[icon.kind];
      if (!st) continue;
      const def = Paddle.STATUS_DEFS[icon.kind] || { id: icon.kind, blinkThreshold: 3.0 };
      const baseAlpha = (showMultiplayerTags && !this.isLocal) ? 0.75 : 1.0;
      const blinkThreshold = def.blinkThreshold !== undefined ? def.blinkThreshold : 3.0;
      const isStatusBlinkDimmed =
        st.timer > 0 &&
        st.timer <= blinkThreshold &&
        Math.floor(Math.max(0, blinkThreshold - st.timer) / 0.25) % 2 === 1;
      const iconAlpha = isStatusBlinkDimmed ? baseAlpha * 0.75 : baseAlpha;

      let iconScale = 1.0;
      if (st.scaleOutTimer > 0) {
        const pOut = 1 - ColorUtils.clamp(st.scaleOutTimer / 0.25, 0, 1);
        const easeOutQuad = 1 - (1 - pOut) * (1 - pOut);
        iconScale = Math.max(0, 1 - easeOutQuad);
      } else if (st.scaleInTimer > 0) {
        const pIn = 1 - ColorUtils.clamp(st.scaleInTimer / 0.32, 0, 1);
        const c1 = 1.70158;
        const c3 = c1 + 1;
        iconScale = Math.max(0, 1 + c3 * Math.pow(pIn - 1, 3) + c1 * Math.pow(pIn - 1, 2));
      }

      if (iconScale > 0.01) {
        ShapeRenderer.drawStatusIcon(
          ctx,
          icon.kind,
          icon.x,
          icon.y,
          icon.w * iconScale,
          icon.h * iconScale,
          def.color || GAME_CONFIG.COLORS.white,
          iconAlpha
        );
      }
    }
    ctx.restore();
  }
}

Paddle.STATUS_DEFS = {
  shield: {
    id: 'shield',
    w: 13,
    h: 15,
    blinkThreshold: 10.0,
    onExpire(paddle) {
      paddle.invincibleTimer = Math.max(paddle.invincibleTimer, 1.0);
    }
  },
  snail: {
    id: 'snail',
    w: 16,
    h: 14,
    blinkThreshold: 3.0
  }
};

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
    this.dir = GameRng.next() < 0.5 ? -1 : 1;
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

