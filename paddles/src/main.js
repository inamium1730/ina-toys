/**
 * ゲームの主要ロジック (メインループ・ステージ管理・WebRTCマルチプレイ同期・入力・UI描画)
 */
(() => {
  'use strict';

  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d');
  const playButton = document.getElementById('play-button');
  const nicknameInput = document.getElementById('nickname-input');
  const endPlayers = document.getElementById('end-players');
  const lobbyHint = document.getElementById('lobby-hint');
  const roomControls = document.getElementById('room-controls');
  const copyLinkButton = document.getElementById('copy-link-button');
  const roomStatus = document.getElementById('room-status');
  const skillBar = document.getElementById('skill-bar');
  const skillUnlockLayer = typeof document.getElementById === 'function'
    ? document.getElementById('skill-unlock-layer')
    : null;

  const { WIDTH, HEIGHT, COLORS, PADDLE, BALL, BLOCKS, ITEM, ENEMY } = GAME_CONFIG;

  const input = {
    left: false,
    right: false,
    pointerX: null
  };

  const effectsManager = new EffectManager();
  const backgroundEffect = new BackgroundEffect();

  const DAMAGE_SHAKE_DURATION = 0.11;
  const CRACK_SHAKE_DURATION = 0.14;
  const NICKNAME_STORAGE_KEY = 'paddles_nickname';

  const game = {
    state: 'menu', // 'menu' | 'playing' | 'gameover' | 'victory'
    stageIndex: 0,
    stageNumber: 1,
    blocksStageIndex: -1,
    score: 0,
    displayedScore: 0,
    lives: 3,
    menuTitleAlpha: 1,
    tagTransition: 1,
    shakeTimer: 0,
    shakeMagnitude: 0,
    warpSpeedMultiplier: 1,
    damageFlash: 0,
    enemySpawnTimer: 0,
    bossSupplyTimer: 30,
    paddles: [],
    purplePaddle: null,
    balls: [],
    blocks: [],
    supplyDrops: [],
    enemies: [],
    boss: null,
    enemyBullets: [],
    items: [],
    transition: null,
    remoteTransitionSnap: null,
    endScreenPlayerNames: [],
    skills: {},
    skillUnlockQueue: [],
    skillUnlockAnim: null
  };

  function getSkillDefs() {
    return typeof SKILLS !== 'undefined' && SKILLS ? SKILLS : {};
  }

  function createInitialSkillsState() {
    const defs = getSkillDefs();
    const map = {};
    for (const key of Object.keys(defs)) {
      const def = defs[key];
      map[key] = {
        key,
        unlocked: false,
        activeTimer: 0,
        cooldownTimer: 0,
        currentStock: def.stock || 1,
        mapUses: 0
      };
    }
    return map;
  }

  game.skills = createInitialSkillsState();
  const skillButtonsByKey = new Map();

  function buildSkillIconSvg(skillKey, iconSize = 0) {
    if (typeof document === 'undefined' || typeof document.createElementNS !== 'function') return null;
    if (skillKey !== 'swing' && skillKey !== 'crack') return null;
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 32 32');
    svg.setAttribute('class', 'skill-btn-icon');
    svg.setAttribute('shape-rendering', 'geometricPrecision');
    svg.setAttribute('aria-hidden', 'true');
    if (iconSize > 0) {
      svg.setAttribute('width', String(iconSize));
      svg.setAttribute('height', String(iconSize));
    }

    if (skillKey === 'crack') {
      svg.setAttribute('id', 'mdi-bomb');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('data-iconid', '3be5bd9a');
      svg.setAttribute('data-svgname', 'Bomb');
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('d', 'M11.25,6A3.25,3.25 0 0,1 14.5,2.75A3.25,3.25 0 0,1 17.75,6C17.75,6.42 18.08,6.75 18.5,6.75C18.92,6.75 19.25,6.42 19.25,6V5.25H20.75V6A2.25,2.25 0 0,1 18.5,8.25A2.25,2.25 0 0,1 16.25,6A1.75,1.75 0 0,0 14.5,4.25A1.75,1.75 0 0,0 12.75,6H14V7.29C16.89,8.15 19,10.83 19,14A7,7 0 0,1 12,21A7,7 0 0,1 5,14C5,10.83 7.11,8.15 10,7.29V6H11.25M22,6H24V7H22V6M19,4V2H20V4H19M20.91,4.38L22.33,2.96L23.04,3.67L21.62,5.09L20.91,4.38Z');
      path.setAttribute('fill', '#ffffff');
      svg.appendChild(path);
      return svg;
    }

    const pts = [];
    const steps = 120;
    const turns = 2.5;
    for (let i = 0; i <= steps; i++) {
      const u = i / steps;
      const theta = -0.3 + u * turns * Math.PI * 2;
      const r = 0.4 + 11.0 * u;
      const x = 16 + r * Math.cos(theta);
      const y = 16 + r * Math.sin(theta);
      pts.push(`${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`);
    }
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', pts.join(' '));
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', '#ffffff');
    path.setAttribute('stroke-width', '2.2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    return svg;
  }

  function renderSkillBarUI() {
    if (!skillBar) return;
    const defs = getSkillDefs();
    const isPlaying = game.state === 'playing';
    const unlockedKeys = Object.keys(defs)
      .filter((k) => game.skills[k] && game.skills[k].unlocked)
      .sort((a, b) => (defs[a].slot || 0) - (defs[b].slot || 0));
    if (!isPlaying || unlockedKeys.length === 0) {
      if (skillBar.classList) skillBar.classList.add('hidden');
      return;
    }
    if (skillBar.classList) skillBar.classList.remove('hidden');

    for (let i = 0; i < unlockedKeys.length; i++) {
      const key = unlockedKeys[i];
      const def = defs[key];
      const sk = game.skills[key];
      let entry = skillButtonsByKey.get(key);
      if (!entry && typeof document.createElement === 'function') {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'skill-btn';
        btn.dataset.skill = key;
        btn.setAttribute('aria-label', `${key} (${def.slot})`);

        const progress = document.createElement('div');
        progress.className = 'skill-btn-progress';
        const slotEl = document.createElement('span');
        slotEl.className = 'skill-btn-slot';
        slotEl.textContent = String(def.slot);
        const stockEl = document.createElement('span');
        stockEl.className = 'skill-btn-stock';
        const iconEl = buildSkillIconSvg(key);

        btn.appendChild(progress);
        btn.appendChild(slotEl);
        btn.appendChild(stockEl);
        if (iconEl) btn.appendChild(iconEl);

        btn.addEventListener('click', (e) => {
          if (e && typeof e.stopPropagation === 'function') e.stopPropagation();
          tryActivateSkill(key);
        });

        skillBar.appendChild(btn);
        entry = { btn, progress, stockEl };
        skillButtonsByKey.set(key, entry);
      }
      if (!entry) continue;
      if (entry.btn && entry.btn.style) {
        entry.btn.style.order = String(def.slot || 0);
      }
      if (typeof skillBar.appendChild === 'function' && skillBar.children && skillBar.children[i] !== entry.btn) {
        skillBar.appendChild(entry.btn);
      }

      const usable = canActivateSkill(key);
      const isActive = sk.activeTimer > 0;
      const isCooling = !isActive && sk.currentStock <= 0 && sk.cooldownTimer > 0;
      const maxStock = def.stock || 1;
      const pendingUnlock = isSkillUnlockAnimatingFor(key);

      entry.btn.disabled = !usable;
      if (entry.btn.classList) {
        entry.btn.classList.toggle('active', isActive);
        entry.btn.classList.toggle('cooldown', isCooling);
        entry.btn.classList.toggle('ready', usable);
        entry.btn.classList.toggle('skill-btn-pending-unlock', pendingUnlock);
      }

      if (entry.stockEl) {
        if (def.limit !== null && def.limit !== undefined) {
          entry.stockEl.textContent = `${Math.max(0, def.limit - sk.mapUses)}/${def.limit}`;
        } else if (maxStock > 1) {
          entry.stockEl.textContent = `x${sk.currentStock}`;
        } else {
          entry.stockEl.textContent = '';
        }
      }

      if (entry.progress && entry.progress.style) {
        if (isActive && def.duration > 0) {
          entry.progress.style.height = `${ColorUtils.clamp((sk.activeTimer / def.duration) * 100, 0, 100).toFixed(1)}%`;
        } else if (isCooling && def.cooldown > 0) {
          entry.progress.style.height = `${ColorUtils.clamp((1 - sk.cooldownTimer / def.cooldown) * 100, 0, 100).toFixed(1)}%`;
        } else {
          entry.progress.style.height = '0%';
        }
      }
    }
  }

  function easeOutElastic(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  }

  function easeInOutQuad(t) {
    const u = ColorUtils.clamp(t, 0, 1);
    return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
  }

  function isSkillUnlockAnimatingFor(key) {
    if (!key) return false;
    if (game.skillUnlockAnim && game.skillUnlockAnim.key === key && !game.skillUnlockAnim.flyerDone) return true;
    return Array.isArray(game.skillUnlockQueue) && game.skillUnlockQueue.includes(key);
  }

  function hasActiveSkillUnlockSequence() {
    return Boolean(game.skillUnlockAnim || (Array.isArray(game.skillUnlockQueue) && game.skillUnlockQueue.length > 0));
  }

  function removeFlyerEl(anim) {
    if (!anim || !anim.el) return;
    if (anim.el.parentNode && typeof anim.el.parentNode.removeChild === 'function') {
      anim.el.parentNode.removeChild(anim.el);
    } else if (typeof anim.el.remove === 'function') {
      anim.el.remove();
    }
    anim.el = null;
  }

  function clearSkillUnlockAnimation() {
    removeFlyerEl(game.skillUnlockAnim);
    game.skillUnlockAnim = null;
    game.skillUnlockQueue = [];
    for (const entry of skillButtonsByKey.values()) {
      if (entry && entry.btn && entry.btn.classList) {
        entry.btn.classList.remove('skill-btn-pending-unlock');
      }
    }
  }

  function startNextSkillUnlockAnimation() {
    if (game.skillUnlockAnim || !Array.isArray(game.skillUnlockQueue) || game.skillUnlockQueue.length === 0) return;
    const key = game.skillUnlockQueue.shift();
    let el = null;
    const hostLayer = skillUnlockLayer || (typeof document !== 'undefined' ? document.body : null);
    if (hostLayer && typeof document.createElement === 'function' && typeof hostLayer.appendChild === 'function') {
      const flyer = document.createElement('div');
      flyer.className = 'skill-unlock-flyer';
      const iconEl = buildSkillIconSvg(key, 102);
      if (iconEl) flyer.appendChild(iconEl);
      hostLayer.appendChild(flyer);
      el = flyer;
    }

    effectsManager.spawnPulse({
      kind: 'circle',
      x: WIDTH / 2,
      y: HEIGHT / 2,
      radius: 52,
      color: COLORS.white,
      duration: 0.65,
      maxScale: 2.35
    }, false);

    game.skillUnlockAnim = {
      key,
      timer: 0,
      holdDuration: 1.0,
      flyDuration: 1.0,
      revealDuration: 0.35,
      flyerDone: false,
      el
    };
    renderSkillBarUI();
    positionSkillUnlockFlyer();
  }

  function positionSkillUnlockFlyer() {
    const anim = game.skillUnlockAnim;
    if (!anim || anim.flyerDone || !anim.el || !anim.el.style) return;

    const winW = (typeof window !== 'undefined' && window.innerWidth) ? window.innerWidth : WIDTH;
    const winH = (typeof window !== 'undefined' && window.innerHeight) ? window.innerHeight : HEIGHT;
    const canvasRect = (canvas && typeof canvas.getBoundingClientRect === 'function')
      ? canvas.getBoundingClientRect()
      : null;
    const hasCanvasBox = Boolean(canvasRect && canvasRect.width > 0 && canvasRect.height > 0 && typeof canvasRect.top === 'number');
    const centerX = hasCanvasBox ? (canvasRect.left + canvasRect.width / 2) : (winW / 2);
    const centerY = hasCanvasBox ? (canvasRect.top + canvasRect.height / 2) : (winH / 2);

    const t = anim.timer;
    let curX = centerX;
    let curY = centerY;
    let curScale = 1;
    let curAngleDeg = 0;

    if (t < anim.holdDuration) {
      const u = ColorUtils.clamp(t / anim.holdDuration, 0, 1);
      const elastic = easeOutElastic(u);
      curScale = Math.max(0, elastic);
      curAngleDeg = 10 * (1 - elastic);
    } else {
      const u = ColorUtils.clamp((t - anim.holdDuration) / anim.flyDuration, 0, 1);
      const eased = easeInOutQuad(u);
      const entry = skillButtonsByKey.get(anim.key);
      const targetRect = (entry && entry.btn && typeof entry.btn.getBoundingClientRect === 'function')
        ? entry.btn.getBoundingClientRect()
        : null;
      const targetX = (targetRect && targetRect.width > 0) ? (targetRect.left + targetRect.width / 2) : centerX;
      const targetY = (targetRect && targetRect.height > 0) ? (targetRect.top + targetRect.height / 2) : (winH - 52);
      const targetScale = (targetRect && targetRect.width > 0) ? (targetRect.width / 192) : (64 / 192);

      curX = centerX + (targetX - centerX) * eased;
      curY = centerY + (targetY - centerY) * eased;
      curScale = 1 + (targetScale - 1) * eased;
      curAngleDeg = 0;
    }

    anim.el.style.opacity = '1';
    anim.el.style.transform = `translate3d(${(curX - 96).toFixed(1)}px, ${(curY - 96).toFixed(1)}px, 0) rotate(${curAngleDeg.toFixed(2)}deg) scale(${curScale.toFixed(4)})`;
  }

  function queueSkillUnlockAnimation(key) {
    if (!key || isSkillUnlockAnimatingFor(key) || (game.skillUnlockAnim && game.skillUnlockAnim.key === key)) return;
    game.skillUnlockQueue.push(key);
    renderSkillBarUI();
    if (!game.skillUnlockAnim) {
      startNextSkillUnlockAnimation();
    }
  }

  function updateSkillUnlockAnimation(dt) {
    if (!game.skillUnlockAnim) {
      startNextSkillUnlockAnimation();
      if (!game.skillUnlockAnim) return;
    }
    const anim = game.skillUnlockAnim;
    anim.timer += dt;
    const dockTime = anim.holdDuration + anim.flyDuration;
    const total = dockTime + (anim.revealDuration || 0);

    if (!anim.flyerDone && anim.timer >= dockTime) {
      anim.flyerDone = true;
      removeFlyerEl(anim);
      renderSkillBarUI();
    }

    if (anim.timer >= total) {
      game.skillUnlockAnim = null;
      renderSkillBarUI();
      startNextSkillUnlockAnimation();
      return;
    }
    positionSkillUnlockFlyer();
  }

  function resetSkillsState() {
    clearSkillUnlockAnimation();
    game.skills = createInitialSkillsState();
    renderSkillBarUI();
  }

  function syncSkillsUnlocksForStage(stageNum, animateNew = false) {
    const defs = getSkillDefs();
    const newlyUnlocked = [];
    for (const key of Object.keys(defs)) {
      const def = defs[key];
      const sk = game.skills[key];
      if (!sk) continue;
      if (!sk.unlocked && stageNum > def.requires) {
        sk.unlocked = true;
        sk.currentStock = Math.max(sk.currentStock, def.stock || 1);
        newlyUnlocked.push(key);
      }
    }
    renderSkillBarUI();
    if (animateNew && newlyUnlocked.length > 0) {
      for (const key of newlyUnlocked) {
        queueSkillUnlockAnimation(key);
      }
    }
    return newlyUnlocked;
  }

  function resetSkillsMapUses() {
    for (const key of Object.keys(game.skills)) {
      game.skills[key].mapUses = 0;
    }
  }

  function isSkillActive(key) {
    const sk = game.skills && game.skills[key];
    return Boolean(sk && sk.unlocked && sk.activeTimer > 0);
  }

  function canActivateSkill(key) {
    if (game.state !== 'playing') return false;
    if (hasActiveSkillUnlockSequence()) return false;
    const defs = getSkillDefs();
    const def = defs[key];
    const sk = game.skills && game.skills[key];
    if (!def || !sk || !sk.unlocked) return false;
    if (sk.activeTimer > 0) return false;
    if (sk.currentStock <= 0) return false;
    if (def.limit !== null && def.limit !== undefined && sk.mapUses >= def.limit) return false;
    return true;
  }

  function spawnCrackExplosion(x, y, baseRadius = 32) {
    effectsManager.spawnPulse({
      kind: 'crack',
      x,
      y,
      radius: baseRadius,
      angle: Math.random() * Math.PI * 2,
      color: COLORS.white,
      duration: 0.42,
      maxScale: 1.55
    });
    effectsManager.spawnCircleParticles(x, y, COLORS.white, 10, 60, 210);
    effectsManager.spawnCircleParticles(x, y, COLORS.yellow, 6, 40, 150);
  }

  function executeCrackSkill() {
    const count = 4 + Math.floor(Math.random() * 3); // 4 ~ 6 のランダム整数
    const stageData = MAPS[game.stageIndex % MAPS.length];
    const enemyDropChance = Item.getEnemyDropChance(stageData);
    let didHit = false;

    for (let step = 0; step < count; step++) {
      // 1. ブロック優先
      const aliveBlocks = game.blocks.filter((b) => b && b.alive && b.collidable);
      if (aliveBlocks.length > 0) {
        const blk = aliveBlocks[Math.floor(Math.random() * aliveBlocks.length)];
        blk.alive = false;
        blk.scale = 0;
        blk.collidable = false;
        game.score += 100;
        didHit = true;
        spawnCrackExplosion(blk.x, blk.y, 30);
        if (blk.itemType) {
          maybeSpawnItem(blk.x, blk.y, 1.0, blk.itemType);
        }
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeBlockEvt({
            op: 0,
            serverTimeMs: mp.getServerTimeMs(),
            blockId: blk.id
          }));
        }
        continue;
      }

      // 2. サプライドロップ優先
      const aliveDrops = game.supplyDrops.filter((d) => d && d.alive);
      if (aliveDrops.length > 0) {
        const drop = aliveDrops[Math.floor(Math.random() * aliveDrops.length)];
        drop.alive = false;
        const dIdx = game.supplyDrops.indexOf(drop);
        if (dIdx !== -1) {
          game.supplyDrops.splice(dIdx, 1);
        }
        game.score += 100;
        didHit = true;
        spawnCrackExplosion(drop.x, drop.y, 36);
        maybeSpawnItem(drop.x, drop.y, 1.0);
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeDropEvt({
            op: 1,
            serverTimeMs: mp.getServerTimeMs(),
            id: drop.id
          }));
        }
        continue;
      }

      // 3. 敵（雑魚敵およびボス、ただしボスのHPは0にしない）
      const targets = [];
      for (const en of game.enemies) {
        if (en && en.health > 0) {
          targets.push({ kind: 'enemy', enemy: en });
        }
      }
      if (game.boss && game.boss.canTakeCrackDamage && game.boss.canTakeCrackDamage()) {
        targets.push({ kind: 'boss', boss: game.boss });
      }
      if (targets.length === 0) break;

      const chosen = targets[Math.floor(Math.random() * targets.length)];
      didHit = true;
      if (chosen.kind === 'enemy') {
        const en = chosen.enemy;
        const destroyed = en.hitByBall({ effects: { cyan: 0 } }, effectsManager, false);
        spawnCrackExplosion(en.x, en.y, Math.max(26, en.currentRadius * 1.45));
        if (destroyed) {
          game.score += 150 * en.maxHealth;
          maybeSpawnItem(en.x, en.y, enemyDropChance);
          const eIdx = game.enemies.indexOf(en);
          if (eIdx !== -1) {
            game.enemies.splice(eIdx, 1);
          }
          if (mp.mode === 'host') {
            mp.sendGameEvent(NetProto.encodeEnemyEvt({
              op: 3,
              serverTimeMs: mp.getServerTimeMs(),
              enemyId: en.id,
              reason: 0
            }));
          }
        } else if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeEnemyEvt({
            op: 2,
            serverTimeMs: mp.getServerTimeMs(),
            enemyId: en.id,
            health: en.health,
            x: en.x,
            y: en.y
          }));
        }
      } else {
        const hitPos = chosen.boss.applyCrackDamage(
          effectsManager,
          (pts) => { game.score += pts; },
          maybeSpawnItem
        );
        if (hitPos) {
          spawnCrackExplosion(hitPos.x, hitPos.y, 38);
        }
      }
    }

    if (didHit) {
      triggerCrackScreenShake();
    }
  }

  function activateSkillOnHost(key) {
    if (!canActivateSkill(key)) return false;
    const def = getSkillDefs()[key];
    const sk = game.skills[key];
    const maxStock = def.stock || 1;
    sk.currentStock = Math.max(0, sk.currentStock - 1);
    sk.activeTimer = def.duration;
    sk.mapUses += 1;
    if (sk.cooldownTimer <= 0 && sk.currentStock < maxStock) {
      sk.cooldownTimer = def.cooldown;
    }
    if (key === 'crack') {
      executeCrackSkill();
    }
    if (mp.mode === 'host') {
      sendHostSnapshot(true);
    }
    renderSkillBarUI();
    return true;
  }

  function tryActivateSkill(key) {
    if (!canActivateSkill(key)) return false;
    if (mp.mode === 'guest') {
      mp.sendToHostCtrl({ type: 'use_skill', skillKey: key });
      return true;
    }
    return activateSkillOnHost(key);
  }

  function updateSkills(dt) {
    if (game.state !== 'playing') return;
    const defs = getSkillDefs();
    for (const key of Object.keys(game.skills)) {
      const def = defs[key];
      const sk = game.skills[key];
      if (!def || !sk || !sk.unlocked) continue;
      let remainingDt = dt;
      if (sk.activeTimer > 0) {
        const consumed = Math.min(sk.activeTimer, remainingDt);
        sk.activeTimer = Math.max(0, sk.activeTimer - consumed);
        remainingDt -= consumed;
      }
      const maxStock = def.stock || 1;
      if (sk.activeTimer <= 0 && sk.currentStock < maxStock) {
        if (remainingDt > 0) {
          sk.cooldownTimer = Math.max(0, sk.cooldownTimer - remainingDt);
          if (sk.cooldownTimer <= 0) {
            sk.currentStock = Math.min(maxStock, sk.currentStock + 1);
            if (sk.currentStock < maxStock) {
              sk.cooldownTimer = def.cooldown;
            }
          }
        }
      } else if (sk.currentStock >= maxStock) {
        sk.cooldownTimer = 0;
      }
    }
    renderSkillBarUI();
  }

  function serializeSkillsForSnapshot() {
    const defs = getSkillDefs();
    const out = [];
    for (const key of Object.keys(defs)) {
      const sk = game.skills[key];
      if (!sk) continue;
      out.push([
        key,
        sk.unlocked ? 1 : 0,
        sk.activeTimer || 0,
        sk.cooldownTimer || 0,
        sk.currentStock || 0,
        sk.mapUses || 0
      ]);
    }
    return out;
  }

  const connectLaserCooldowns = new Map();
  let copyFeedbackTimer = null;
  let guestInputSeq = 0;
  let guestInputSendTimer = 0;
  let lastSentInputKey = '';
  let hostSnapSendTimer = 0;
  let hostSnapTick = 0;
  let guestLastSnapTick = -1;
  let guestStageMinSnapTick = -1;
  let guestWarpingFlag = false;
  let guestLastSnapPerfMs = 0;
  let guestSnapIntervalEstimate = 0.042;
  const guestPendingInputs = [];
  const lastProcessedInputSeqBySlot = new Map();
  let nextBulletId = 1;
  let hostBlockResyncTimer = 0;
  let menuVisualPaddles = [];
  let gameInProgressHintTimer = 0;
  let debugStartStageIndex = 0;
  let nextSupplyDropId = 0;

  const BALL_BOUNCE_SRC = {
    generic: 0,
    paddle: 1,
    block: 2,
    drop: 3,
    enemy: 4,
    boss: 5,
    purple: 6,
    respawn: 7
  };

  function getNextBulletId() {
    return nextBulletId++;
  }

  function emitBallEvt(op, ball, source = 0, sourceSlot = null, targetPeer = null) {
    if (mp.mode !== 'host' || !ball) return;
    mp.sendGameEvent(NetProto.encodeBallEvt({
      op,
      serverTimeMs: mp.getServerTimeMs(),
      id: ball.id,
      x: ball.x,
      y: ball.y,
      vx: ball.vx,
      vy: ball.vy,
      radius: ball.radius,
      effectClock: ball.effectClock || 0,
      cyan: ball.effects ? ball.effects.cyan : 0,
      yellow: ball.effects ? ball.effects.yellow : 0,
      green: ball.effects ? ball.effects.green : 0,
      source: typeof source === 'number' ? source : (BALL_BOUNCE_SRC[source] || 0),
      sourceSlot
    }), targetPeer);
  }

  function emitBlockSyncMask(targetPeer = null) {
    if (mp.mode !== 'host') return;
    const allBlocks = game.transition && game.transition.pendingBlocks
      ? game.blocks.concat(game.transition.pendingBlocks)
      : game.blocks;
    const totalCount = allBlocks.reduce((acc, b) => Math.max(acc, b.id + 1), 0);
    const aliveBits = new Array(totalCount).fill(false);
    for (const b of game.blocks) {
      if (b.alive && !b.spawning && b.id >= 0 && b.id < totalCount) {
        aliveBits[b.id] = true;
      }
    }
    mp.sendGameEvent(NetProto.encodeBlockEvt({
      op: 2,
      serverTimeMs: mp.getServerTimeMs(),
      aliveBits
    }), targetPeer);
  }

  function sendCatchupToPeer(peer) {
    if (mp.mode !== 'host' || game.state !== 'playing' || !peer) return;
    const serverMs = mp.getServerTimeMs();
    mp.sendToPeerCtrl(peer, {
      type: 'start_game',
      stageIndex: game.stageIndex,
      players: mp.serializePlayers()
    });
    const allBlocks = game.transition && game.transition.pendingBlocks
      ? game.blocks.concat(game.transition.pendingBlocks)
      : game.blocks;
    mp.sendToPeerCtrl(peer, {
      type: 'stage_init',
      stageIndex: game.stageIndex,
      stageNumber: game.stageNumber,
      snapTick: hostSnapTick,
      layout: allBlocks.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.w, b.h])
    });
    emitBlockSyncMask(peer);
    for (const ball of game.balls) {
      emitBallEvt(0, ball, BALL_BOUNCE_SRC.generic, null, peer);
    }
    for (const en of game.enemies) {
      mp.sendGameEvent(NetProto.encodeEnemyEvt({
        op: 0,
        serverTimeMs: serverMs,
        id: en.id,
        name: en.name,
        x: en.x,
        y: en.y,
        vx: en.vx,
        vy: en.vy,
        rotation: en.rotation,
        health: en.health,
        maxHealth: en.maxHealth,
        currentRadius: en.currentRadius,
        bullet_type: en.bullet_type,
        fire_rate: en.fire_rate,
        localAutoFire: !!en._hasFiredOnce || !!en.localAutoFire,
        fireTimer: en.fireTimer || 0
      }), peer);
    }
    if (game.enemyBullets.length > 0) {
      mp.sendGameEvent(NetProto.encodeBulletEvt({
        op: 0,
        serverTimeMs: serverMs,
        bullets: game.enemyBullets
      }), peer);
    }
    for (const it of game.items) {
      mp.sendGameEvent(NetProto.encodeItemEvt({
        op: 0,
        serverTimeMs: serverMs,
        id: it.id,
        itemType: it.type,
        x: it.x,
        y: it.y,
        angle: it.angle,
        color: it.color
      }), peer);
    }
    for (const d of game.supplyDrops) {
      mp.sendGameEvent(NetProto.encodeDropEvt({
        op: 0,
        serverTimeMs: serverMs,
        id: d.id,
        x: d.x,
        y: d.y,
        w: d.w
      }), peer);
    }
    sendHostSnapshot(true);
  }

  // ============================================================================
  // ニックネーム・WebRTCマルチプレイ管理初期化
  // ============================================================================
  function loadSavedNickname() {
    try {
      const fromLocal = typeof localStorage !== 'undefined' ? localStorage.getItem(NICKNAME_STORAGE_KEY) : '';
      if (fromLocal) return fromLocal;
    } catch (_) {}
    try {
      return sessionStorage.getItem(NICKNAME_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveNickname(val) {
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(NICKNAME_STORAGE_KEY, val);
      }
    } catch (_) {}
    try {
      sessionStorage.setItem(NICKNAME_STORAGE_KEY, val);
    } catch (_) {}
  }

  function getTrimmedNickname() {
    return (nicknameInput ? nicknameInput.value : '').trim().slice(0, 12);
  }

  function hasValidNickname() {
    return getTrimmedNickname().length > 0;
  }

  function triggerNicknameShake() {
    if (!nicknameInput) return;
    nicknameInput.classList.remove('shake');
    void nicknameInput.offsetWidth;
    nicknameInput.classList.add('shake');
    nicknameInput.focus();
  }

  const mp = new MultiplayerManager({
    onRoomChange: () => {
      if (mp.mode === 'host' && game.state !== 'playing') {
        if (mp.players.length <= 1 && mp.localReady) {
          mp.localReady = false;
          if (mp.players[0]) mp.players[0].ready = false;
        } else if (mp.players.length >= 2 && mp.areAllPlayersReady()) {
          startGame();
          return;
        }
      }
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onPeerJoined: (peer) => {
      if (mp.mode === 'host' && game.state === 'playing' && peer) {
        sendCatchupToPeer(peer);
      }
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onPeerLeft: (slot) => {
      lastProcessedInputSeqBySlot.delete(slot);
      if (game.state === 'playing' && mp.isHostOrSolo()) {
        const idx = game.paddles.findIndex((p) => p.slot === slot);
        if (idx !== -1) {
          const [removed] = game.paddles.splice(idx, 1);
          if (removed && removed.hp > 0) {
            effectsManager.spawnPaddleShatterSection(removed.x, removed.y, removed.currentWidth, removed.height, removed.x);
          }
          if (game.paddles.length === 0) {
            game.paddles.push(new Paddle({
              slot: mp.assignedSlot || 0,
              totalPlayers: 1,
              maxHp: MultiplayerManager.getMaxHpForCount(1),
              nickname: getTrimmedNickname(),
              isLocal: true
            }));
          }
        }
      } else if (mp.mode === 'host' && mp.players.length <= 1 && mp.localReady) {
        mp.setLocalReady(false);
      }
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onCtrlEvent: (msg) => {
      handleGuestCtrlEvent(msg);
    },
    onGameEvent: (evt) => {
      handleGuestGameEvent(evt);
    },
    onSnapshot: (snap) => {
      applyGuestSnapshot(snap);
    },
    onBecomeHost: ({ oldHostSlot }) => {
      if (game.state === 'playing') {
        const idx = game.paddles.findIndex((p) => p.slot === oldHostSlot);
        if (idx !== -1) {
          const [removed] = game.paddles.splice(idx, 1);
          if (removed && removed.hp > 0) {
            effectsManager.spawnPaddleShatterSection(removed.x, removed.y, removed.currentWidth, removed.height, removed.x);
          }
        }
        if (game.paddles.length === 0) {
          game.paddles.push(new Paddle({
            slot: mp.assignedSlot,
            totalPlayers: 1,
            maxHp: MultiplayerManager.getMaxHpForCount(1),
            nickname: getTrimmedNickname(),
            isLocal: true
          }));
        }
        for (const ball of game.balls) {
          Ball.nextId = Math.max(Ball.nextId || 0, (ball.id || 0) + 1);
        }
        for (const en of game.enemies) {
          Enemy.nextId = Math.max(Enemy.nextId || 0, (en.id || 0) + 1);
          en._netSpawnSent = true;
          en._hasFiredOnce = !!en.localAutoFire;
        }
        for (const it of game.items) {
          Item.nextId = Math.max(Item.nextId || 0, (it.id || 0) + 1);
        }
        for (const b of game.enemyBullets) {
          if (b.id && b.id < 0x40000000) {
            nextBulletId = Math.max(nextBulletId, b.id + 1);
          }
        }
        for (const d of game.supplyDrops) {
          nextSupplyDropId = Math.max(nextSupplyDropId, (d.id || 0) + 1);
        }
        for (const blk of game.blocks) {
          if (blk.alive && (blk.scale === undefined || blk.scale >= 1)) {
            blk.collidable = true;
            blk.spawning = false;
          }
        }
        if (game.remoteTransitionSnap) {
          const [phase, timer] = game.remoteTransitionSnap;
          const stageData = MAPS[game.stageIndex % MAPS.length];
          if (phase === 'boss_siren' || phase === 'boss_intro') {
            if (phase === 'boss_intro' && !game.boss) {
              game.boss = createBossForStage(stageData, Math.max(1, game.paddles.length || mp.getPlayerCount()));
            }
            game.transition = {
              phase,
              timer: timer || 0,
              pendingBlocks: []
            };
          } else {
            const spawnedSet = new Set(game.blocks.filter((b) => b.alive || b.spawning).map((b) => b.id));
            const fullStage = buildStageBlocks(stageData, false);
            game.transition = {
              phase,
              timer: timer || 0,
              pendingBlocks: phase === 'spawning_blocks' ? fullStage.filter((b) => !spawnedSet.has(b.id)) : []
            };
          }
          game.remoteTransitionSnap = null;
        }
        for (const p of game.paddles) {
          p._deathRespawnHandled = p.hp <= 0;
        }
        hostSnapTick = Math.max(hostSnapTick, Math.max(0, guestLastSnapTick) + 1);
        broadcastStageBlockLayout();
        if (!game.transition && !isBossStage(MAPS[game.stageIndex % MAPS.length])) {
          emitBlockSyncMask();
        }
        hostSnapSendTimer = 1;
        sendHostSnapshot(true);
      } else {
        if (mp.players.length <= 1 && mp.localReady) {
          mp.localReady = false;
          if (mp.players[0]) mp.players[0].ready = false;
        }
        syncMenuVisualPaddles(false);
      }
      updateMenuUI();
    },
    onHostDisconnected: () => {
      if (game.state === 'playing') {
        game.state = 'menu';
        game.menuTitleAlpha = 1;
        game.tagTransition = 1;
        effectsManager.reset();
        backgroundEffect.reset();
      }
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onGameInProgressReject: () => {
      if (game.state === 'playing') {
        game.state = 'menu';
        game.menuTitleAlpha = 1;
        game.tagTransition = 1;
        effectsManager.reset();
        backgroundEffect.reset();
      }
      gameInProgressHintTimer = 2.6;
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onRoomNotFound: () => {
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onRoomFull: () => {
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onUseSkillRequest: (_peer, skillKey) => {
      if (mp.mode === 'host' && game.state === 'playing') {
        activateSkillOnHost(skillKey);
      }
    }
  });

  // Hostのエフェクト生成をバイナリパケットで自動転送するフック
  effectsManager.onEvent = (type, payload) => {
    if (mp.mode === 'host' && game.state === 'playing') {
      mp.sendGameEvent(NetProto.encodeFxEvt(type, payload));
    }
  };

  function syncSavedNicknameFromStorage() {
    if (!nicknameInput) return;
    const saved = loadSavedNickname();
    if (!nicknameInput.value && saved) {
      nicknameInput.value = saved;
    }
    const clean = getTrimmedNickname();
    if (clean !== mp.localNickname) {
      mp.setLocalNickname(clean);
    }
  }

  if (nicknameInput) {
    nicknameInput.value = loadSavedNickname();
    mp.setLocalNickname(getTrimmedNickname());

    nicknameInput.addEventListener('input', () => {
      if (mp.localReady && game.state !== 'playing') {
        nicknameInput.value = mp.localNickname || '';
        return;
      }
      const clean = getTrimmedNickname();
      saveNickname(nicknameInput.value);
      mp.setLocalNickname(clean);
      if (!clean && mp.localReady) {
        mp.setLocalReady(false);
      }
      syncMenuVisualPaddles(false);
      updateMenuUI();
    });

    nicknameInput.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') {
        e.preventDefault();
        nicknameInput.blur();
      }
    });

    window.addEventListener('pageshow', () => {
      syncSavedNicknameFromStorage();
      syncMenuVisualPaddles(false);
      updateMenuUI();
    });
  }

  // URLパラメータ (?room=XXXXXX または #room=XXXXXX) からの自動参加
  function checkInitialRoomParam() {
    syncSavedNicknameFromStorage();
    let roomParam = null;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      roomParam = searchParams.get('room');
      if (!roomParam && window.location.hash) {
        const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
        roomParam = hashParams.get('room');
      }
    } catch (_) {}

    if (roomParam && /^[A-Za-z0-9]{4,12}$/.test(roomParam.trim())) {
      mp.joinRoom(roomParam.trim().toUpperCase());
    }
  }

  function captureEndScreenPlayerNames() {
    if (mp.mode !== 'solo' && mp.players && mp.players.length > 0) {
      return mp.players.map((p, idx) => p.nickname || `P${(p.slot !== undefined ? p.slot : idx) + 1}`);
    }
    if (game.paddles && game.paddles.length > 0) {
      return game.paddles.map((p, idx) => p.nickname || getTrimmedNickname() || `P${(p.slot !== undefined ? p.slot : idx) + 1}`);
    }
    const localName = getTrimmedNickname();
    return localName ? [localName] : [];
  }

  function renderEndPlayersList(names) {
    if (!endPlayers) return;
    if (typeof endPlayers.replaceChildren === 'function' && typeof document.createElement === 'function') {
      const nodes = [];
      names.forEach((name, idx) => {
        if (idx > 0) {
          const sep = document.createElement('span');
          sep.className = 'end-player-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '&';
          nodes.push(sep);
        }
        const span = document.createElement('span');
        span.className = 'end-player-name';
        span.textContent = name;
        nodes.push(span);
      });
      endPlayers.replaceChildren(...nodes);
    } else {
      endPlayers.textContent = names.join(' & ');
    }
  }

  function updateMenuUI() {
    const isPlaying = game.state === 'playing';
    const isEndScreen = game.state === 'gameover' || game.state === 'victory';
    const hasName = hasValidNickname();
    const isMultiLobby = mp.players && mp.players.length > 1;
    const isLocalReady = !isPlaying && !isEndScreen && !!mp.localReady && (mp.mode === 'guest' || isMultiLobby);
    const canPressPlay = isEndScreen || (hasName && (mp.mode !== 'guest' || mp.connectionStatus === 'connected' || mp.handoffSilent));

    if (playButton) {
      playButton.classList.toggle('hidden', isPlaying);
      playButton.classList.toggle('disabled', !canPressPlay);
      playButton.classList.toggle('ready', isLocalReady);
      playButton.classList.toggle('restart', isEndScreen);
      playButton.classList.remove('waiting');
      playButton.disabled = !canPressPlay;
      playButton.setAttribute('aria-disabled', String(!canPressPlay));
      playButton.setAttribute(
        'aria-label',
        isEndScreen ? 'Return to title' : (isLocalReady ? 'Ready (Click to cancel)' : 'Play')
      );
    }

    if (nicknameInput) {
      nicknameInput.classList.toggle('hidden', isPlaying || isEndScreen);
      nicknameInput.classList.toggle('collapsed', isEndScreen);
      nicknameInput.disabled = isLocalReady || isEndScreen;
      nicknameInput.classList.toggle('locked', isLocalReady);
    }

    if (endPlayers) {
      endPlayers.classList.toggle('hidden', !isEndScreen);
      if (isEndScreen) {
        if (!game.endScreenPlayerNames || game.endScreenPlayerNames.length === 0) {
          game.endScreenPlayerNames = captureEndScreenPlayerNames();
        }
        renderEndPlayersList(game.endScreenPlayerNames);
      }
    }

    if (roomControls) {
      roomControls.classList.toggle('hidden', isPlaying);
    }

    if (copyLinkButton) {
      copyLinkButton.disabled = isEndScreen;
      copyLinkButton.classList.toggle('disabled', isEndScreen);
      copyLinkButton.classList.toggle('hidden', isEndScreen);
      copyLinkButton.setAttribute('aria-disabled', String(isEndScreen));
    }

    if (roomStatus) {
      if (copyFeedbackTimer) {
        roomStatus.textContent = 'COPIED';
      } else if (mp.mode === 'host' && mp.roomCode) {
        roomStatus.textContent = `${mp.roomCode} · ${mp.getPlayerCount()}/${GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS}`;
      } else if (mp.mode === 'guest') {
        if (mp.connectionStatus === 'connected') {
          roomStatus.textContent = `${mp.roomCode} · ${mp.getPlayerCount()}/${GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS}`;
        } else if (mp.connectionStatus === 'full') {
          roomStatus.textContent = 'FULL (4/4)';
        } else if (mp.connectionStatus === 'migrating') {
          roomStatus.textContent = `${mp.roomCode} · ...`;
        } else if (mp.connectionStatus === 'disconnected') {
          roomStatus.textContent = 'DISCONNECTED';
        } else {
          roomStatus.textContent = `${mp.roomCode} · ...`;
        }
      } else if (mp.mode === 'solo' && gameInProgressHintTimer > 0) {
        roomStatus.textContent = 'IN PROGRESS';
      } else if (mp.connectionStatus === 'disconnected') {
        roomStatus.textContent = 'DISCONNECTED';
      } else {
        roomStatus.textContent = '';
      }
    }

    if (lobbyHint) {
      lobbyHint.textContent = '';
      lobbyHint.classList.add('hidden');
    }

    renderSkillBarUI();
  }

  async function copyTextToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch (_) {}
    }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) {
      return false;
    }
  }

  if (copyLinkButton) {
    copyLinkButton.addEventListener('click', async () => {
      if (game.state === 'gameover' || game.state === 'victory') return;

      const inviteUrl = mp.mode === 'guest' && mp.roomCode
        ? mp.getInviteUrl()
        : mp.hostRoom();

      await copyTextToClipboard(inviteUrl);

      copyLinkButton.classList.add('copied');
      if (copyFeedbackTimer) clearTimeout(copyFeedbackTimer);
      copyFeedbackTimer = setTimeout(() => {
        copyFeedbackTimer = null;
        copyLinkButton.classList.remove('copied');
        updateMenuUI();
      }, 1600);
      updateMenuUI();
    });
  }

  function easeInCubic(t) {
    return t * t * t;
  }

  function easeOutCubic(t) {
    return 1 - Math.pow(1 - t, 3);
  }

  function easeOutBack(t) {
    const c1 = 2.1;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  }

  function isBossStage(stageData) {
    return Boolean(stageData && (stageData.map === 'boss' || stageData.name === 'bigfoot' || stageData.name === 'snake' || stageData.name === 'cloud'));
  }

  function buildStageBlocks(stageData, spawnedImmediately = true) {
    if (!stageData || !Array.isArray(stageData.map)) return [];
    const list = [];
    let nextId = 0;
    for (let r = 0; r < BLOCKS.ROWS; r++) {
      const rowStr = stageData.map[r] || '             ';
      for (let c = 0; c < BLOCKS.COLS; c++) {
        if (rowStr[c] === '#') {
          const cx = c * BLOCKS.CELL_W + BLOCKS.CELL_W / 2;
          const cy = BLOCKS.OFFSET_TOP + r * BLOCKS.CELL_H + BLOCKS.CELL_H / 2;
          list.push({
            id: nextId++,
            x: cx,
            y: cy,
            w: BLOCKS.WIDTH,
            h: BLOCKS.HEIGHT,
            alive: true,
            collidable: spawnedImmediately,
            spawning: !spawnedImmediately,
            spawnTimer: 0,
            spawnDuration: 0.32,
            scale: spawnedImmediately ? 1 : 0,
            itemType: null
          });
        }
      }
    }
    const fixedItems = (ITEM && Array.isArray(ITEM.STAGE_BLOCK_ITEMS)) ? ITEM.STAGE_BLOCK_ITEMS : [];
    if (list.length > 0 && fixedItems.length > 0) {
      const indices = list.map((_, idx) => idx);
      for (let i = indices.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [indices[i], indices[j]] = [indices[j], indices[i]];
      }
      const assignCount = Math.min(list.length, fixedItems.length);
      for (let i = 0; i < assignCount; i++) {
        list[indices[i]].itemType = fixedItems[i];
      }
    }
    return list;
  }

  function forceDestroyEnemy(enemy) {
    if (!enemy) return;
    effectsManager.spawnPulse({
      kind: 'enemy',
      subType: enemy.name,
      x: enemy.x,
      y: enemy.y,
      radius: enemy.currentRadius,
      angle: enemy.rotation,
      color: COLORS.white,
      duration: 0.45,
      maxScale: 2.4
    });
    effectsManager.spawnCircleParticles(enemy.x, enemy.y, COLORS.white, 10, 50, 180);
    if (mp.mode === 'host') {
      mp.sendGameEvent(NetProto.encodeEnemyEvt({
        op: 3,
        serverTimeMs: mp.getServerTimeMs(),
        enemyId: enemy.id,
        reason: 0
      }));
    }
  }

  function checkBlockOverlapWithBallsOnActivate(blk) {
    for (const ball of game.balls) {
      const bLeft = blk.x - blk.w / 2;
      const bRight = blk.x + blk.w / 2;
      const bTop = blk.y - blk.h / 2;
      const bBottom = blk.y + blk.h / 2;

      const closestX = ColorUtils.clamp(ball.x, bLeft, bRight);
      const closestY = ColorUtils.clamp(ball.y, bTop, bBottom);
      const dx = ball.x - closestX;
      const dy = ball.y - closestY;

      if (dx * dx + dy * dy <= ball.radius * ball.radius) {
        // 当たり判定追加時にその位置にボールがあれば、ボールの軌道は変えずにすぐ壊す
        blk.alive = false;
        game.score += 100;
        effectsManager.spawnCircleParticles(blk.x, blk.y, COLORS.white, 7, 35, 130);
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeBlockEvt({
            op: 0,
            serverTimeMs: mp.getServerTimeMs(),
            blockId: blk.id
          }));
        }
        if (blk.itemType) {
          maybeSpawnItem(blk.x, blk.y, 1.0, blk.itemType);
        }
        break;
      }
    }
  }

  // ============================================================================
  // 入力イベント (キーボード・クリック/タップ移動・ドラッグ/スワイプ)
  // ============================================================================
  let isPointerDown = false;

  function updatePointerFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0) return;
    const canvasX = ((clientX - rect.left) / rect.width) * WIDTH;
    input.pointerX = ColorUtils.clamp(canvasX, 0, WIDTH);
  }

  function returnToTitleScreen() {
    guestLastSnapTick = -1;
    guestStageMinSnapTick = -1;
    game.state = 'menu';
    game.stageIndex = 0;
    game.stageNumber = 1;
    game.blocksStageIndex = -1;
    game.score = 0;
    game.displayedScore = 0;
    game.lives = 3;
    game.menuTitleAlpha = 1;
    game.tagTransition = 1;
    game.shakeTimer = 0;
    game.shakeMagnitude = 0;
    game.warpSpeedMultiplier = 1;
    game.damageFlash = 0;
    game.enemySpawnTimer = 0;
    game.bossSupplyTimer = 30;
    game.paddles = [];
    game.purplePaddle = null;
    game.balls = [];
    game.blocks = [];
    game.supplyDrops = [];
    game.enemies = [];
    game.boss = null;
    game.enemyBullets = [];
    game.items = [];
    game.transition = null;
    game.remoteTransitionSnap = null;
    game.endScreenPlayerNames = [];
    connectLaserCooldowns.clear();
    input.left = false;
    input.right = false;
    input.pointerX = null;
    effectsManager.reset();
    backgroundEffect.reset();
    if (mp.localReady) {
      mp.setLocalReady(false);
    }
    menuVisualPaddles = [];
    syncMenuVisualPaddles(true);
    resetSkillsState();
    updateMenuUI();
  }

  function handlePlayTrigger() {
    if (game.state === 'gameover' || game.state === 'victory') {
      returnToTitleScreen();
      return;
    }
    if (!hasValidNickname()) {
      triggerNicknameShake();
      return;
    }
    if (mp.mode === 'guest') {
      if (mp.connectionStatus !== 'connected') return;
      mp.setLocalReady(!mp.localReady);
      updateMenuUI();
      return;
    }
    if (mp.mode === 'host' && mp.players.length > 1) {
      mp.setLocalReady(!mp.localReady);
      if (mp.areAllPlayersReady()) {
        startGame();
      } else {
        updateMenuUI();
      }
      return;
    }
    startGame();
  }

  window.addEventListener('keydown', (e) => {
    if (document.activeElement === nicknameInput) {
      return;
    }
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
      input.left = true;
      input.pointerX = null;
    }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') {
      input.right = true;
      input.pointerX = null;
    }
    if ((e.code === 'Space' || e.code === 'Enter') && game.state !== 'playing') {
      e.preventDefault();
      handlePlayTrigger();
    }
    if (game.state === 'playing' && !e.repeat) {
      const defs = getSkillDefs();
      for (const key of Object.keys(defs)) {
        const slot = defs[key].slot;
        if (
          e.code === `Digit${slot}` ||
          e.code === `Numpad${slot}` ||
          e.key === String(slot)
        ) {
          if (tryActivateSkill(key) && typeof e.preventDefault === 'function') {
            e.preventDefault();
          }
          break;
        }
      }
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
      input.left = false;
    }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') {
      input.right = false;
    }
  });

  function isInteractiveControlTarget(target) {
    return Boolean(
      target &&
      typeof target.closest === 'function' &&
      target.closest('#center-controls, #room-controls, #skill-bar')
    );
  }

  window.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (isInteractiveControlTarget(e.target)) return;
    isPointerDown = true;
    updatePointerFromClientX(e.clientX);
    if (e.target && typeof e.target.setPointerCapture === 'function') {
      try {
        e.target.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
  });

  window.addEventListener('pointermove', (e) => {
    if (game.state !== 'playing' || !isPointerDown) return;
    updatePointerFromClientX(e.clientX);
  });

  window.addEventListener('pointerup', () => {
    isPointerDown = false;
  });

  window.addEventListener('pointercancel', () => {
    isPointerDown = false;
  });

  window.addEventListener('touchstart', (e) => {
    if (game.state !== 'playing') return;
    if (isInteractiveControlTarget(e.target)) return;
    if (e.touches && e.touches.length > 0) {
      if (e.cancelable) e.preventDefault();
      isPointerDown = true;
      updatePointerFromClientX(e.touches[0].clientX);
    }
  }, { passive: false });

  window.addEventListener('touchmove', (e) => {
    if (game.state !== 'playing' || !isPointerDown) return;
    if (e.touches && e.touches.length > 0) {
      if (e.cancelable) e.preventDefault();
      updatePointerFromClientX(e.touches[0].clientX);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    isPointerDown = false;
  });

  window.addEventListener('blur', () => {
    isPointerDown = false;
    input.left = false;
    input.right = false;
  });

  playButton.addEventListener('click', () => {
    if (game.state !== 'playing') {
      handlePlayTrigger();
    }
  });

  // ============================================================================
  // ステージ初期化・進行管理 (ホスト / ソロ)
  // ============================================================================
  function buildPaddlesFromRoster(roster) {
    const count = Math.max(1, roster.length);
    const maxHp = MultiplayerManager.getMaxHpForCount(count);
    return roster.map((entry, idx) => {
      const x = count <= 1 ? WIDTH / 2 : WIDTH * ((idx + 1) / (count + 1));
      const fallbackName = entry.nickname || (count > 1 ? `P${idx + 1}` : '');
      return new Paddle({
        slot: entry.slot,
        totalPlayers: count,
        maxHp,
        nickname: fallbackName,
        isLocal: entry.isLocal,
        x
      });
    });
  }

  function startGame() {
    if (!mp.isHostOrSolo() || !hasValidNickname()) return;
    if (mp.mode === 'host' && mp.players.length > 1 && !mp.areAllPlayersReady()) return;

    mp.setInGame(true);
    mp.localReady = false;
    for (const peer of mp.peers.values()) {
      peer.ready = false;
    }
    if (mp.mode === 'host') {
      mp.rebuildHostPlayersList();
    }
    nextBulletId = 1;
    lastProcessedInputSeqBySlot.clear();
    hostBlockResyncTimer = 0;
    game.score = 0;
    game.displayedScore = 0;
    const startIdx = ColorUtils.clamp(debugStartStageIndex, 0, Math.max(0, MAPS.length - 1));
    game.stageIndex = startIdx;
    game.stageNumber = startIdx + 1;
    game.menuTitleAlpha = 1;
    game.tagTransition = 0;
    game.endScreenPlayerNames = [];
    game.remoteTransitionSnap = null;
    resetSkillsState();
    loadStage(startIdx);

    if (mp.mode === 'host') {
      mp.broadcastCtrl({
        type: 'start_game',
        stageIndex: startIdx,
        players: mp.serializePlayers()
      });
      broadcastStageBlockLayout();
      for (const ball of game.balls) {
        emitBallEvt(0, ball, ball.spawningFromCenter ? BALL_BOUNCE_SRC.respawn : BALL_BOUNCE_SRC.generic);
      }
      sendHostSnapshot(true);
    }
    updateMenuUI();
  }

  function broadcastStageBlockLayout() {
    if (mp.mode !== 'host') return;
    const allBlocks = game.transition && game.transition.pendingBlocks
      ? game.transition.pendingBlocks.concat(game.blocks)
      : game.blocks;
    mp.broadcastCtrl({
      type: 'stage_init',
      stageIndex: game.stageIndex,
      stageNumber: game.stageNumber,
      snapTick: hostSnapTick,
      layout: allBlocks.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.w, b.h])
    });
  }

  function loadStage(index) {
    const stageData = MAPS[index % MAPS.length];
    game.stageIndex = index;
    game.stageNumber = index + 1;
    resetSkillsMapUses();
    syncSkillsUnlocksForStage(game.stageNumber);
    // 毎ステージ開始時にボールの残機を初期で3つ用意
    game.lives = 3;
    game.state = 'playing';

    const roster = mp.mode === 'host'
      ? mp.players
      : [{ slot: 0, nickname: getTrimmedNickname(), isLocal: true }];
    game.paddles = buildPaddlesFromRoster(roster);
    game.purplePaddle = null;
    game.balls = [Ball.createCenterSpawn()];
    game.enemies = [];
    game.enemyBullets = [];
    game.items = [];
    game.warpSpeedMultiplier = 1;
    game.shakeTimer = 0;
    game.damageFlash = 0;
    input.pointerX = null;
    effectsManager.reset();
    backgroundEffect.reset();
    game.enemySpawnTimer = stageData.spawn_interval ? stageData.spawn_interval * 0.65 : 0;
    game.bossSupplyTimer = 30;

    // ステージ開始時もブロックが1つずつEaseOutBackでポップアップして登場する（ボスマップではサイレン演出から開始）
    game.blocks = [];
    game.supplyDrops = [];
    game.boss = null;
    if (isBossStage(stageData)) {
      game.transition = {
        phase: 'boss_siren',
        timer: 0,
        pendingBlocks: []
      };
    } else {
      game.transition = {
        phase: 'spawning_blocks',
        timer: 0,
        pendingBlocks: buildStageBlocks(stageData, false)
      };
    }
  }

  function resetRespawnPenalties() {
    for (const p of game.paddles) {
      p.respawnPenalty = 0;
      p.respawnTimer = 0;
    }
  }

  function assignRespawnCountdown(p) {
    if (!p || p.hp > 0 || p._deathRespawnHandled) return;
    p._deathRespawnHandled = true;
    if (mp.mode !== 'solo') {
      const penalty = Math.max(0, p.respawnPenalty || 0);
      p.respawnTimer = Math.min(30, 10 + penalty * 10);
      p.respawnPenalty = penalty + 1;
    } else {
      p.respawnTimer = 0;
    }
  }

  function startNextStageTransition() {
    for (const p of game.paddles) {
      p.respawnPenalty = 0;
    }
    game.transition = {
      phase: 'killing_enemies', // 'killing_enemies' -> 'waiting_before_blocks' -> 'spawning_blocks'
      timer: 0,
      pendingBlocks: []
    };
  }

  function reviveDeadPaddles() {
    const count = Math.max(1, game.paddles.length);
    const maxHp = MultiplayerManager.getMaxHpForCount(count);
    for (const p of game.paddles) {
      if (p.hp <= 0) {
        p.revive(maxHp, effectsManager, count);
      }
    }
  }

  function computeWarpSpeedMultiplier(timer) {
    const maxWarpMult = 65;
    if (timer < 1.0) {
      const u = ColorUtils.clamp(timer / 1.0, 0, 1);
      return 1 + (maxWarpMult - 1) * easeInCubic(u);
    }
    if (timer < 2.0) {
      const u = ColorUtils.clamp((timer - 1.0) / 1.0, 0, 1);
      return maxWarpMult - (maxWarpMult - 1) * easeOutCubic(u);
    }
    return 1;
  }

  function advanceAfterStageEnemiesCleared(tr) {
    if (!tr) return;
    if (game.enemies.length > 0) {
      tr.phase = 'killing_enemies';
      tr.timer = 0;
      return;
    }
    const unlockedBeforeNext = syncSkillsUnlocksForStage(game.stageNumber + 1, true);
    if (unlockedBeforeNext.length > 0 || hasActiveSkillUnlockSequence()) {
      tr.phase = 'skill_unlock';
      tr.timer = 0;
      if (mp.mode === 'host') sendHostSnapshot(true);
    } else {
      tr.phase = 'waiting_before_blocks';
      tr.timer = 0;
    }
  }

  function updateStageTransition(dt) {
    const tr = game.transition;
    if (!tr) return;

    if (tr.phase === 'killing_enemies') {
      if (game.enemies.length === 0) {
        advanceAfterStageEnemiesCleared(tr);
        return;
      }
      tr.timer += dt;
      while (tr.timer >= 0.05 && game.enemies.length > 0) {
        tr.timer -= 0.05;
        const randIdx = Math.floor(Math.random() * game.enemies.length);
        const [enemy] = game.enemies.splice(randIdx, 1);
        forceDestroyEnemy(enemy);
      }
      if (game.enemies.length === 0) {
        advanceAfterStageEnemiesCleared(tr);
      }
    } else if (tr.phase === 'skill_unlock') {
      tr.timer += dt;
      if (!hasActiveSkillUnlockSequence()) {
        tr.phase = 'waiting_before_blocks';
        tr.timer = 0;
      }
    } else if (tr.phase === 'waiting_before_blocks') {
      tr.timer += dt;

      // 0〜1.0秒: EaseInで背景を高速加速 / 1.0〜2.0秒: EaseOutで元の速度へ戻す（画面揺れなし）
      if (tr.timer < 2.0) {
        game.warpSpeedMultiplier = computeWarpSpeedMultiplier(tr.timer);
      } else {
        game.warpSpeedMultiplier = 1;
        game.stageIndex += 1;
        game.stageNumber = game.stageIndex + 1;
        resetSkillsMapUses();
        syncSkillsUnlocksForStage(game.stageNumber, true);
        // 次のステージ開始という節目で、復活ペナルティをリセットしHP0になっていたパドルを復活させる
        resetRespawnPenalties();
        reviveDeadPaddles();
        const nextStageData = MAPS[game.stageIndex % MAPS.length];
        game.blocks = [];
        game.supplyDrops = [];
        game.boss = null;
        game.bossSupplyTimer = 30;
        if (isBossStage(nextStageData)) {
          tr.pendingBlocks = [];
          tr.phase = 'boss_siren';
          tr.timer = 0;
        } else {
          tr.pendingBlocks = buildStageBlocks(nextStageData, false);
          tr.phase = 'spawning_blocks';
          tr.timer = 0;
        }
        broadcastStageBlockLayout();
      }
    } else if (tr.phase === 'boss_defeat') {
      tr.timer += dt;
      if (tr.timer >= 5.0 && game.boss) {
        game.boss = null;
      }
      if (tr.timer >= 6.0) {
        if (game.stageIndex + 1 < MAPS.length) {
          tr.pendingBlocks = [];
          advanceAfterStageEnemiesCleared(tr);
        } else {
          game.transition = null;
          endGame('victory');
        }
      }
    } else if (tr.phase === 'boss_siren') {
      tr.timer += dt;
      if (tr.timer >= 2.4) {
        const nextStageData = MAPS[game.stageIndex % MAPS.length];
        game.boss = createBossForStage(nextStageData, Math.max(1, game.paddles.length || mp.getPlayerCount()));
        game.boss.setIntroProgress(0);
        tr.phase = 'boss_intro';
        tr.timer = 0;
      }
    } else if (tr.phase === 'boss_intro') {
      tr.timer += dt;
      const introDuration = 1.0;
      const u = ColorUtils.clamp(tr.timer / introDuration, 0, 1);
      if (!game.boss) {
        const nextStageData = MAPS[game.stageIndex % MAPS.length];
        game.boss = createBossForStage(nextStageData, Math.max(1, game.paddles.length || mp.getPlayerCount()));
      }
      game.boss.setIntroProgress(u);
      if (tr.timer >= introDuration) {
        game.boss.setIntroProgress(1);
        game.bossSupplyTimer = 30;
        game.transition = null;
      }
    } else if (tr.phase === 'spawning_blocks') {
      tr.timer += dt;
      const poppedIds = [];
      while (tr.timer >= 0.05 && tr.pendingBlocks.length > 0) {
        tr.timer -= 0.05;
        const randIdx = Math.floor(Math.random() * tr.pendingBlocks.length);
        const [blk] = tr.pendingBlocks.splice(randIdx, 1);
        game.blocks.push(blk);
        poppedIds.push(blk.id);
      }
      if (poppedIds.length > 0 && mp.mode === 'host') {
        mp.sendGameEvent(NetProto.encodeBlockEvt({
          op: 1,
          serverTimeMs: mp.getServerTimeMs(),
          startScale: 0,
          ids: poppedIds
        }));
      }

      let anySpawning = false;
      for (const blk of game.blocks) {
        if (!blk.alive || !blk.spawning) continue;
        blk.spawnTimer += dt;
        if (blk.spawnTimer >= blk.spawnDuration) {
          blk.spawning = false;
          blk.scale = 1;
          blk.collidable = true;
          checkBlockOverlapWithBallsOnActivate(blk);
        } else {
          blk.scale = easeOutBack(blk.spawnTimer / blk.spawnDuration);
          anySpawning = true;
        }
      }

      if (tr.pendingBlocks.length === 0 && !anySpawning) {
        const nextStageData = MAPS[game.stageIndex % MAPS.length];
        game.enemySpawnTimer = nextStageData.spawn_interval ? nextStageData.spawn_interval * 0.65 : 0;
        game.transition = null;
        if (mp.mode === 'host') {
          emitBlockSyncMask();
        }
      }
    }
  }

  function endGame(state) {
    clearSkillUnlockAnimation();
    resetRespawnPenalties();
    game.endScreenPlayerNames = captureEndScreenPlayerNames();
    game.state = state;
    if (mp.mode === 'host') {
      mp.sendGameEvent(NetProto.encodeBulletEvt({
        op: 2,
        serverTimeMs: mp.getServerTimeMs()
      }));
      mp.setInGame(false);
      mp.resetGuestsReady();
      mp.broadcastCtrl({
        type: 'end_game',
        state,
        score: game.score,
        stageIndex: game.stageIndex,
        playerNames: game.endScreenPlayerNames
      });
    }
    updateMenuUI();
  }

  function triggerLocalHitFeedback() {
    game.shakeTimer = DAMAGE_SHAKE_DURATION;
    game.shakeMagnitude = 5.0;
    game.damageFlash = 1.0;
  }

  function triggerCrackScreenShake() {
    game.shakeTimer = Math.max(game.shakeTimer, CRACK_SHAKE_DURATION);
    game.shakeMagnitude = Math.max(game.shakeMagnitude, 6.5);
  }

  function damagePaddle(targetPaddle, damageAmount) {
    if (targetPaddle && targetPaddle.takeDamage(damageAmount, effectsManager)) {
      if (targetPaddle.hp <= 0) {
        assignRespawnCountdown(targetPaddle);
      }
      if (targetPaddle.isLocal) {
        triggerLocalHitFeedback();
      } else if (mp.mode === 'host') {
        mp.sendGameEvent(NetProto.encodeFxEvt('paddle_hit', { slot: targetPaddle.slot }));
      }
      return true;
    }
    return false;
  }

  function spawnEnemyForStage(stageData) {
    if (!stageData.enemies || stageData.enemies.length === 0) return;
    if (game.enemies.length >= stageData.spawn_limit) return;

    const typeName = stageData.enemies[Math.floor(Math.random() * stageData.enemies.length)];
    const def = ENEMIES[typeName];
    if (!def) return;

    const margin = 56;
    const spawnX = margin + Math.random() * (WIDTH - margin * 2);
    game.enemies.push(new Enemy(def, spawnX));
  }

  function maybeSpawnItem(x, y, dropChance, forcedType = null) {
    const item = Item.maybeSpawn(x, y, dropChance, game.items, game.purplePaddle, forcedType);
    if (item) {
      game.items.push(item);
      if (mp.mode === 'host') {
        mp.sendGameEvent(NetProto.encodeItemEvt({
          op: 0,
          serverTimeMs: mp.getServerTimeMs(),
          id: item.id,
          itemType: item.type,
          x: item.x,
          y: item.y,
          angle: item.angle,
          color: item.color
        }));
      }
    }
  }

  function applyItemEffect(item, collectorPaddle) {
    const p = collectorPaddle || game.paddles.find((pd) => pd.hp > 0) || game.paddles[0];
    effectsManager.spawnPulse({
      kind: 'item',
      subType: item.type,
      x: item.x,
      y: item.y,
      radius: ITEM.RADIUS * 1.2,
      angle: item.angle,
      color: item.color,
      duration: 0.45,
      maxScale: 2.5
    });

    if (item.type === 'cyan_star') {
      if (p && p.hp > 0) p.effects.cyan = 10.0;
    } else if (item.type === 'yellow_star') {
      if (p && p.hp > 0) p.effects.yellow = 10.0;
    } else if (item.type === 'green_star') {
      if (p && p.hp > 0) p.effects.green = 10.0;
    } else if (item.type === 'blue_circle') {
      if (game.lives < 3) {
        game.lives += 1;
        const lifeIdx = game.lives - 1;
        const lx = 36 + lifeIdx * 28;
        const ly = 38;
        effectsManager.spawnPulse({
          kind: 'circle',
          x: lx,
          y: ly,
          radius: 8,
          color: COLORS.blue,
          duration: 0.5,
          maxScale: 2.6
        });
      } else {
        // 残機がフルの場合、同時に操作するボールの数が増える
        const refBall = game.balls[0];
        const spawnX = (p && p.hp > 0) ? p.x : (refBall ? refBall.x : WIDTH / 2);
        const spawnY = (p && p.hp > 0) ? p.y - 20 : (refBall ? refBall.y : HEIGHT / 2);
        const newBall = new Ball(spawnX, spawnY);
        game.balls.push(newBall);
        if (mp.mode === 'host') {
          emitBallEvt(0, newBall, BALL_BOUNCE_SRC.generic);
        }
        effectsManager.spawnPulse({
          kind: 'circle',
          target: newBall,
          x: newBall.x,
          y: newBall.y,
          radius: newBall.radius,
          color: COLORS.blue,
          duration: 0.45,
          maxScale: 2.8
        });
      }
    } else if (item.type === 'pink_heart') {
      // パドルのHP自然再生までの残り時間を0にする (HP=0のパドルは復活しない)
      if (p && p.hp > 0) {
        p.timeSinceLastDamage = PADDLE.REGEN_DELAY;
        effectsManager.spawnCircleParticles(p.x - p.currentWidth / 2, p.y, COLORS.white, 6, 20, 70);
        effectsManager.spawnCircleParticles(p.x + p.currentWidth / 2, p.y, COLORS.white, 6, 20, 70);
      }
    } else if (item.type === 'purple_square') {
      const spawnX = p ? p.x : WIDTH / 2;
      if (!game.purplePaddle) {
        game.purplePaddle = new PurplePaddle(spawnX);
      } else {
        game.purplePaddle.addBounceUnit();
      }
    }
  }

  // ============================================================================
  // ホスト状態スナップショット送信 & ゲスト状態受信・補間
  // ============================================================================
  function sendHostSnapshot(force = false) {
    if (mp.mode !== 'host') return;
    // スナップショット送信頻度は 20〜30Hz（約23.8Hz / 0.042秒間隔）に抑え、座標はバイナリ量子化して送る
    // 弾・ボール・エネミー・アイテム等の毎フレーム座標は送らず、生成/反射イベントのみで同期する
    if (!force && hostSnapSendTimer < 0.042) return;
    hostSnapSendTimer = 0;
    hostSnapTick += 1;

    const isWarpingToNext = !!(game.transition && (
      game.transition.phase === 'killing_enemies' ||
      game.transition.phase === 'waiting_before_blocks'
    ));

    const binPkt = NetProto.encodeSnap({
      t: hostSnapTick,
      serverTimeMs: mp.getServerTimeMs(),
      st: game.state,
      si: game.stageIndex,
      sn: game.stageNumber,
      sc: game.score,
      lv: game.lives,
      wm: game.warpSpeedMultiplier,
      w: isWarpingToNext ? 1 : 0,
      ps: game.paddles.map((p) => [
        p.slot,
        p.x,
        p.hp,
        p.maxHp,
        p.currentWidth,
        p.effectClock,
        p.effects.cyan,
        p.effects.yellow,
        p.effects.green,
        p.contestedItemsCount || 0,
        p.timeSinceLastDamage || 0,
        p.invincibleTimer || 0,
        p.isLocal ? 0 : (lastProcessedInputSeqBySlot.get(p.slot) || 0),
        p.respawnTimer || 0,
        p.respawnPenalty || 0
      ]),
      pp: game.purplePaddle
        ? [game.purplePaddle.x, game.purplePaddle.width, game.purplePaddle.bounces]
        : null,
      tr: game.transition
        ? [game.transition.phase, game.transition.timer || 0]
        : null,
      bo: game.boss ? game.boss.serialize() : null,
      sk: serializeSkillsForSnapshot()
    });

    mp.broadcastSync(binPkt);
  }

  function resolvePulseTarget(targetKind, targetId) {
    if (!targetKind) return null;
    if (targetKind === 'paddle') {
      return game.paddles.find((p) => p.slot === targetId) || null;
    }
    if (targetKind === 'ball') {
      return game.balls.find((b) => b.id === targetId) || null;
    }
    if (targetKind === 'enemy') {
      return game.enemies.find((e) => e.id === targetId) || null;
    }
    if (targetKind === 'item') {
      return game.items.find((it) => it.id === targetId) || null;
    }
    if (targetKind === 'purple') {
      return game.purplePaddle;
    }
    if (targetKind === 'boss_head') {
      return game.boss ? game.boss.head : null;
    }
    if (targetKind === 'boss_circle' && game.boss) {
      if (game.boss.getCircleById) {
        return game.boss.getCircleById(targetId);
      }
      const allCircles = game.boss.leftArm.circles.concat(game.boss.rightArm.circles);
      return allCircles.find((c) => c.id === targetId) || null;
    }
    return null;
  }

  function handleGuestCtrlEvent(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'start_game') {
      guestLastSnapTick = -1;
      guestStageMinSnapTick = -1;
      mp.setInGame(true);
      guestLastSnapTick = -1;
      guestStageMinSnapTick = -1;
      guestWarpingFlag = false;
      guestLastSnapPerfMs = 0;
      guestSnapIntervalEstimate = 0.042;
      guestPendingInputs.length = 0;
      game.score = 0;
      game.displayedScore = 0;
      game.stageIndex = msg.stageIndex || 0;
      game.stageNumber = game.stageIndex + 1;
      game.lives = 3;
      game.state = 'playing';
      game.menuTitleAlpha = 1;
      game.tagTransition = 0;
      game.endScreenPlayerNames = [];
      game.warpSpeedMultiplier = 1;
      game.shakeTimer = 0;
      game.damageFlash = 0;
      game.transition = null;
      game.balls = [];
      game.enemies = [];
      game.boss = null;
      game.enemyBullets = [];
      game.items = [];
      game.blocks = [];
      game.supplyDrops = [];
      game.blocksStageIndex = -1;
      game.purplePaddle = null;
      input.pointerX = null;
      effectsManager.reset();
      backgroundEffect.reset();
      mp.localReady = false;
      resetSkillsState();
      syncSkillsUnlocksForStage(game.stageNumber);

      const roster = (msg.players || mp.players).map((p) => ({
        ...p,
        isLocal: p.peerId === mp.localPeerId || p.slot === mp.assignedSlot
      }));
      game.paddles = buildPaddlesFromRoster(roster);
      updateMenuUI();
    } else if (msg.type === 'stage_init') {
      if (typeof msg.snapTick === 'number') {
        guestStageMinSnapTick = Math.max(guestStageMinSnapTick, msg.snapTick);
      }
      const stageChanged = game.blocksStageIndex !== msg.stageIndex;
      game.stageIndex = msg.stageIndex;
      game.stageNumber = msg.stageNumber;
      game.blocksStageIndex = msg.stageIndex;
      if (stageChanged) {
        game.supplyDrops = [];
        if (!isBossStage(MAPS[msg.stageIndex % MAPS.length])) {
          game.boss = null;
        }
        resetSkillsMapUses();
      }
      syncSkillsUnlocksForStage(game.stageNumber, stageChanged && game.state === 'playing');
      game.blocks = (msg.layout || []).map(([id, x, y, w, h]) => ({
        id,
        x,
        y,
        w,
        h,
        alive: false,
        collidable: false,
        spawning: false,
        scale: 0
      }));
    } else if (msg.type === 'paddle_hit') {
      if (msg.slot === mp.assignedSlot) {
        triggerLocalHitFeedback();
      }
    } else if (msg.type === 'fx_pulse') {
      const target = resolvePulseTarget(msg.targetKind, msg.targetId);
      effectsManager.spawnPulse({
        kind: msg.kind,
        target,
        subType: msg.subType,
        x: msg.x,
        y: msg.y,
        w: msg.w,
        h: msg.h,
        radius: msg.radius,
        angle: msg.angle,
        color: msg.color,
        duration: msg.duration,
        maxScale: msg.maxScale
      }, false);
      if (msg.kind === 'crack') {
        triggerCrackScreenShake();
      }
    } else if (msg.type === 'fx_particles') {
      effectsManager.spawnCircleParticles(
        msg.x,
        msg.y,
        msg.color,
        msg.count,
        msg.speedMin,
        msg.speedMax,
        false
      );
    } else if (msg.type === 'fx_regen') {
      effectsManager.spawnRegenParticles(msg.x, msg.y, msg.w, msg.h, false);
    } else if (msg.type === 'fx_shatter') {
      const targetPaddle = (msg.slot !== undefined && msg.slot !== null)
        ? resolvePulseTarget('paddle', msg.slot)
        : null;
      effectsManager.spawnPaddleShatterSection(msg.x, msg.y, msg.w, msg.h, msg.originPaddleX, false, targetPaddle);
    } else if (msg.type === 'end_game') {
      mp.setInGame(false);
      game.endScreenPlayerNames = Array.isArray(msg.playerNames) && msg.playerNames.length > 0
        ? msg.playerNames.slice()
        : captureEndScreenPlayerNames();
      game.state = msg.state;
      game.score = msg.score;
      game.stageIndex = msg.stageIndex;
      mp.localReady = false;
      syncMenuVisualPaddles(false);
      updateMenuUI();
    }
  }

  function advanceBallByDelay(ball, delaySec) {
    if (!ball || delaySec <= 0) return;
    const steps = Math.max(1, Math.min(24, Math.ceil(delaySec * 120)));
    const h = delaySec / steps;
    for (let i = 0; i < steps; i++) {
      ball.stepClientPrediction(h, {
        blocks: game.blocks,
        supplyDrops: game.supplyDrops
      }, false);
    }
  }

  function handleGuestGameEvent(evt) {
    if (!evt || !evt.type || mp.mode !== 'guest') return;
    const delaySec = mp.getDelaySec(evt.serverTimeMs);

    if (evt.type === 'ball_evt') {
      if (evt.op === 0) {
        game.balls = game.balls.filter((b) => b.id !== evt.id);
        const ball = evt.source === BALL_BOUNCE_SRC.respawn
          ? Ball.createCenterSpawn(evt.id)
          : new Ball(evt.x, evt.y, evt.vx, evt.vy, evt.id);
        if (evt.source !== BALL_BOUNCE_SRC.respawn) {
          ball.radius = evt.radius || BALL.BASE_RADIUS;
        }
        ball.effectClock = evt.effectClock || 0;
        ball.effects.cyan = evt.cyan || 0;
        ball.effects.yellow = evt.yellow || 0;
        ball.effects.green = evt.green || 0;
        Ball.nextId = Math.max(Ball.nextId || 0, evt.id + 1);
        advanceBallByDelay(ball, delaySec);
        game.balls.push(ball);
      } else if (evt.op === 1) {
        const sim = new Ball(evt.x, evt.y, evt.vx, evt.vy, evt.id);
        sim.spawningFromCenter = false;
        sim.radius = evt.radius || BALL.BASE_RADIUS;
        sim.effectClock = evt.effectClock || 0;
        sim.effects.cyan = evt.cyan || 0;
        sim.effects.yellow = evt.yellow || 0;
        sim.effects.green = evt.green || 0;
        advanceBallByDelay(sim, delaySec);

        const existing = game.balls.find((b) => b.id === evt.id);
        if (existing) {
          const oldRenderX = existing.x + (existing.corrX || 0);
          const oldRenderY = existing.y + (existing.corrY || 0);
          existing.spawningFromCenter = false;
          existing.x = sim.x;
          existing.y = sim.y;
          existing.vx = sim.vx;
          existing.vy = sim.vy;
          existing.radius = sim.radius;
          existing.effectClock = sim.effectClock;
          existing.effects.cyan = evt.cyan || 0;
          existing.effects.yellow = evt.yellow || 0;
          existing.effects.green = evt.green || 0;
          const dx = oldRenderX - existing.x;
          const dy = oldRenderY - existing.y;
          if (Math.hypot(dx, dy) > 85) {
            existing.corrX = 0;
            existing.corrY = 0;
          } else {
            existing.corrX = dx;
            existing.corrY = dy;
          }
          if (evt.source === BALL_BOUNCE_SRC.paddle || evt.source === BALL_BOUNCE_SRC.purple) {
            existing.predictedBounceTimer = Math.max(existing.predictedBounceTimer || 0, 0.14);
          }
        } else {
          Ball.nextId = Math.max(Ball.nextId || 0, evt.id + 1);
          game.balls.push(sim);
        }
      } else if (evt.op === 2) {
        game.balls = game.balls.filter((b) => b.id !== evt.id);
      } else if (evt.op === 3) {
        const existing = game.balls.find((b) => b.id === evt.id);
        if (existing) {
          existing.effectClock = evt.effectClock || 0;
          existing.effects.cyan = evt.cyan || 0;
          existing.effects.yellow = evt.yellow || 0;
          existing.effects.green = evt.green || 0;
        }
      }
      return;
    }

    if (evt.type === 'bullet_evt') {
      if (evt.op === 0) {
        for (const b of evt.bullets || []) {
          if (game.enemyBullets.some((eb) => eb.id === b.id)) continue;
          const bullet = {
            id: b.id,
            x: b.x,
            y: b.y,
            vx: b.vx,
            vy: b.vy,
            angle: b.angle,
            speed: b.speed,
            timer: 0,
            damage: b.damage || 1,
            shape: b.shape,
            explodeY: b.explodeY,
            explodeCount: b.explodeCount,
            homingMode: b.homingMode,
            initVx: b.initVx,
            initVy: b.initVy,
            decelDuration: b.decelDuration,
            waitTarget: b.waitTarget,
            homingTimer: b.homingTimer || 0,
            waitAfterStop: b.waitAfterStop || 0
          };
          Enemy.stepBulletMotion(bullet, delaySec);
          if (bullet.y > HEIGHT + 24 || bullet.y < -24 || bullet.x < -24 || bullet.x > WIDTH + 24) continue;
          if (!Enemy.maybeExplodeSpadeBullet(bullet, game.enemyBullets, effectsManager)) {
            game.enemyBullets.push(bullet);
          }
        }
      } else if (evt.op === 1) {
        const rm = new Set(evt.ids || []);
        game.enemyBullets = game.enemyBullets.filter((b) => !rm.has(b.id));
      } else if (evt.op === 2) {
        game.enemyBullets = [];
      } else if (evt.op === 3) {
        const targetB = game.enemyBullets.find((eb) => eb.id === evt.id);
        if (targetB) {
          targetB.x = evt.x;
          targetB.y = evt.y;
          targetB.angle = evt.angle;
          targetB.accel = evt.accel;
          targetB.maxSpeed = evt.maxSpeed;
          targetB.speed = 0;
          targetB.vx = 0;
          targetB.vy = 0;
          targetB.homingMode = 'accel';
          Enemy.stepBulletMotion(targetB, delaySec);
        }
      }
      return;
    }

    if (evt.type === 'enemy_evt') {
      if (evt.op === 0) {
        if (game.enemies.some((e) => e.id === evt.id)) return;
        const def = ENEMIES[evt.name] || {
          name: evt.name,
          bullet_type: evt.bullet_type || 'none',
          movement_type: 'fall',
          health: evt.maxHealth || 1,
          damage: 2,
          fire_rate: evt.fire_rate || 0
        };
        const en = new Enemy(def, evt.x, evt.id, evt.vx);
        en.x = evt.x;
        en.y = evt.y;
        en.vx = evt.vx;
        en.vy = evt.vy;
        en.rotation = evt.rotation || 0;
        en.health = evt.health;
        en.maxHealth = evt.maxHealth;
        en.currentRadius = evt.currentRadius;
        en.targetRadius = evt.currentRadius;
        en.bullet_type = evt.bullet_type || def.bullet_type;
        en.fire_rate = evt.fire_rate || def.fire_rate || 0;
        en.localAutoFire = !!evt.localAutoFire;
        en.fireTimer = evt.fireTimer !== undefined ? evt.fireTimer : en.fireTimer;
        if (delaySec > 0) {
          en.updateClient(delaySec, game.enemyBullets, game.paddles);
        }
        game.enemies.push(en);
      } else if (evt.op === 1) {
        // 確定的エネミーの初回射撃タイムスタンプ受信: 初弾＋遅延分を再現し、以降は完全ローカル再現する
        const en = game.enemies.find((e) => e.id === evt.enemyId);
        if (!en) return;
        en.x = evt.x;
        en.y = evt.y;
        en.rotation = evt.rotation;
        en.vx = evt.vx;
        en.vy = evt.vy;
        en._shotSeq = Math.max(0, (evt.shotSeq || 1) - 1);
        const firstBatch = [];
        en.fireBullet([], firstBatch);
        en._shotSeq = evt.shotSeq || en._shotSeq;
        for (const b of firstBatch) {
          b.x += b.vx * delaySec;
          b.y += b.vy * delaySec;
          b.timer = delaySec;
          if (
            !game.enemyBullets.some((eb) => eb.id === b.id) &&
            b.y <= HEIGHT + 24 && b.x >= -24 && b.x <= WIDTH + 24
          ) {
            game.enemyBullets.push(b);
          }
        }
        en.localAutoFire = true;
        en.fireTimer = en.fire_rate || 1.2;
        if (delaySec > 0) {
          en.updateClient(delaySec, game.enemyBullets, game.paddles);
        }
      } else if (evt.op === 2) {
        const en = game.enemies.find((e) => e.id === evt.enemyId);
        if (en) {
          const prevRenderX = en.x + (en.corrX || 0);
          const prevRenderY = en.y + (en.corrY || 0);
          const nextX = evt.x;
          const nextY = evt.y + (en.vy || 0) * delaySec;
          en.health = evt.health;
          en.x = nextX;
          en.y = nextY;
          en.corrX = prevRenderX - nextX;
          en.corrY = prevRenderY - nextY;
          if (en.maxHealth > 0) {
            en.targetRadius = en.baseRadius * (0.48 + 0.52 * (en.health / en.maxHealth));
          }
        }
      } else if (evt.op === 3) {
        game.enemies = game.enemies.filter((e) => e.id !== evt.enemyId);
      } else if (evt.op === 4) {
        game.enemies = [];
      } else if (evt.op === 5) {
        const en = game.enemies.find((e) => e.id === evt.enemyId);
        if (en) {
          en.x = evt.x;
          en.y = evt.y;
          en.vx = evt.vx;
          en.vy = evt.vy;
          if (evt.subOp === 1) {
            en.laserAngle = evt.angle;
            en.laserAimLocked = true;
            en.laserActiveTimer = 0;
            en.fireTimer = Math.max(0.001, evt.timer || 1.0);
          } else if (evt.subOp === 2) {
            en.aimedFallTargetSlot = evt.targetSlot;
            if (evt.phaseCode === 1) {
              en.aimedFallPhase = 'charging';
              en.aimedFallTimer = Math.max(0.001, evt.timer || 1.0);
              en.vx = 0;
              en.vy = 0;
            } else if (evt.phaseCode === 2) {
              en.aimedFallPhase = 'diving';
              en.vy = evt.vy || 1150;
            } else {
              en.aimedFallPhase = 'aiming';
              en.fireTimer = evt.timer || en.fireTimer;
            }
          }
          if (delaySec > 0) {
            en.updateClient(delaySec, game.enemyBullets, game.paddles);
          }
        }
      }
      return;
    }

    if (evt.type === 'item_evt') {
      if (evt.op === 0) {
        if (game.items.some((it) => it.id === evt.id)) return;
        const it = new Item(evt.x, evt.y + ITEM.FALL_SPEED * delaySec, evt.itemType, evt.color, evt.id);
        it.angle = (evt.angle || 0) + ITEM.ROTATION_SPEED * delaySec;
        game.items.push(it);
      } else if (evt.op === 1) {
        game.items = game.items.filter((it) => it.id !== evt.id);
      }
      return;
    }

    if (evt.type === 'drop_evt') {
      if (evt.op === 0) {
        if (game.supplyDrops.some((d) => d.id === evt.id)) return;
        game.supplyDrops.push({
          id: evt.id,
          x: evt.x,
          y: evt.y + 58 * delaySec,
          w: evt.w,
          h: evt.w,
          vy: 58,
          alive: true
        });
      } else if (evt.op === 1) {
        game.supplyDrops = game.supplyDrops.filter((d) => d.id !== evt.id);
      }
      return;
    }

    if (evt.type === 'block_evt') {
      if (game.blocksStageIndex !== game.stageIndex && !isBossStage(MAPS[game.stageIndex % MAPS.length])) {
        const stageData = MAPS[game.stageIndex % MAPS.length];
        game.blocks = buildStageBlocks(stageData, false);
        game.blocksStageIndex = game.stageIndex;
      }
      if (evt.op === 0) {
        const blk = game.blocks.find((b) => b.id === evt.blockId);
        if (blk) {
          blk.alive = false;
          blk.scale = 0;
          blk.collidable = false;
          blk.spawning = false;
        }
      } else if (evt.op === 1) {
        const idSet = new Set(evt.ids || []);
        for (const blk of game.blocks) {
          if (idSet.has(blk.id)) {
            blk.alive = true;
            blk.spawning = true;
            blk.spawnDuration = 0.32;
            blk.spawnTimer = delaySec;
            if (blk.spawnTimer >= blk.spawnDuration) {
              blk.spawning = false;
              blk.scale = 1;
              blk.collidable = true;
            } else {
              blk.collidable = false;
              blk.scale = easeOutBack(blk.spawnTimer / blk.spawnDuration);
            }
          }
        }
      } else if (evt.op === 2) {
        const bits = evt.aliveBits || [];
        for (const blk of game.blocks) {
          if (blk.id < 0 || blk.id >= bits.length) continue;
          if (bits[blk.id]) {
            blk.alive = true;
            blk.scale = 1;
            blk.collidable = true;
            blk.spawning = false;
          } else if (!blk.spawning) {
            blk.alive = false;
            blk.scale = 0;
            blk.collidable = false;
          }
        }
      }
    }
  }

  function setLinearInterpTarget(entity, targetX, snapThreshold = 120) {
    if (!entity.hasInterp || Math.abs(targetX - entity.x) > snapThreshold) {
      entity.x = targetX;
      entity.interpFromX = targetX;
      entity.interpToX = targetX;
      entity.interpElapsed = 1;
      entity.interpDuration = guestSnapIntervalEstimate;
      entity.hasInterp = true;
    } else {
      entity.interpFromX = entity.x;
      entity.interpToX = targetX;
      entity.interpElapsed = 0;
      entity.interpDuration = Math.max(0.035, guestSnapIntervalEstimate);
    }
  }

  function stepLinearInterp(entity, dt) {
    if (entity.hasInterp) {
      entity.interpElapsed += dt;
      const alpha = entity.interpDuration > 0 ? Math.min(1, entity.interpElapsed / entity.interpDuration) : 1;
      entity.x = entity.interpFromX + (entity.interpToX - entity.interpFromX) * alpha;
    } else if (typeof entity.targetServerX === 'number') {
      entity.x += (entity.targetServerX - entity.x) * Math.min(1, dt * 18);
    }
  }

  function applyGuestSnapshot(snap) {
    if (!snap || snap.t <= guestLastSnapTick || snap.t <= guestStageMinSnapTick) return;
    guestLastSnapTick = snap.t;

    const nowPerf = MultiplayerManager.nowPerf();
    if (guestLastSnapPerfMs > 0) {
      const intervalSec = (nowPerf - guestLastSnapPerfMs) / 1000;
      guestSnapIntervalEstimate = guestSnapIntervalEstimate * 0.7 + ColorUtils.clamp(intervalSec, 0.025, 0.085) * 0.3;
    }
    guestLastSnapPerfMs = nowPerf;

    game.score = snap.sc;
    game.lives = snap.lv;
    game.stageIndex = snap.si;
    game.stageNumber = snap.sn;
    guestWarpingFlag = !!snap.w;

    if (snap.st === 'gameover' || snap.st === 'victory') {
      if (game.state !== snap.st) {
        if (!game.endScreenPlayerNames || game.endScreenPlayerNames.length === 0) {
          game.endScreenPlayerNames = captureEndScreenPlayerNames();
        }
        game.state = snap.st;
        mp.localReady = false;
        updateMenuUI();
      }
    }

    // パドル同期 (自パドルはローカル座標を優先維持してテレポートを防ぎ、他パドルは線形補間で滑らかに接続)
    const nextPaddles = [];
    const totalCount = Math.max(1, snap.ps.length);
    for (const row of snap.ps) {
      const [slot, x, hp, maxHp, cw, clk, cyan, yellow, green, nickRaw, contestedCnt, regenTime, invTimer, ackSeq, respawnTimer, respawnPenalty] = row;
      let p = game.paddles.find((item) => item.slot === slot);
      const existed = Boolean(p);
      const nick = nickRaw !== null && nickRaw !== undefined
        ? nickRaw
        : ((mp.players.find((pl) => pl.slot === slot) || {}).nickname || (p ? p.nickname : ''));
      if (!p) {
        p = new Paddle({
          slot,
          totalPlayers: totalCount,
          maxHp,
          nickname: nick,
          isLocal: slot === mp.assignedSlot,
          x,
          contestedItemsCount: contestedCnt || 0
        });
      }
      p.isLocal = slot === mp.assignedSlot;
      p.totalPlayers = totalCount;
      p.targetServerX = x;
      p.hp = hp;
      p.maxHp = maxHp;
      p.currentWidth = cw;
      p.effectClock = clk;
      p.effects.cyan = cyan;
      p.effects.yellow = yellow;
      p.effects.green = green;
      p.nickname = nick;
      if (contestedCnt !== undefined) p.contestedItemsCount = contestedCnt;
      if (regenTime !== undefined) p.timeSinceLastDamage = regenTime;
      if (invTimer !== undefined) p.invincibleTimer = invTimer;
      if (respawnTimer !== undefined) p.respawnTimer = respawnTimer;
      if (respawnPenalty !== undefined) p.respawnPenalty = respawnPenalty;
      p._deathRespawnHandled = p.hp <= 0;

      if (p.isLocal) {
        if (hp <= 0) {
          p.x = x;
          guestPendingInputs.length = 0;
        } else {
          if (!existed) {
            p.x = x;
          }
          const halfW = p.currentWidth / 2;
          p.x = ColorUtils.clamp(p.x, halfW, WIDTH - halfW);
          const ack = ackSeq || 0;
          while (guestPendingInputs.length > 0 && (((guestPendingInputs[0].seq - ack) << 16) >> 16) <= 0) {
            guestPendingInputs.shift();
          }
        }
      } else {
        setLinearInterpTarget(p, x);
      }
      nextPaddles.push(p);
    }
    game.paddles = nextPaddles;

    // サブパドル (他プレイヤーパドル同様に受信スナップショット間を線形補間して滑らかに移動させる)
    if (snap.pp) {
      const [ppX, ppWidth, ppBounces] = snap.pp;
      if (!game.purplePaddle) {
        game.purplePaddle = new PurplePaddle(ppX);
        game.purplePaddle.width = ppWidth;
      } else if (ppBounces < game.purplePaddle.bounces) {
        game.purplePaddle.width = ppWidth;
      }
      game.purplePaddle.targetWidth = ppWidth;
      game.purplePaddle.bounces = ppBounces;
      setLinearInterpTarget(game.purplePaddle, ppX);
    } else {
      game.purplePaddle = null;
    }

    if (snap.tr) {
      if (
        game.remoteTransitionSnap &&
        game.remoteTransitionSnap[0] === snap.tr[0] &&
        Math.abs(snap.tr[1] - game.remoteTransitionSnap[1]) < 0.25
      ) {
        // 同一フェーズ中はローカルタイマーを継続し、背景ワープやサイレン演出を毎フレーム滑らかに進行させる
      } else {
        game.remoteTransitionSnap = snap.tr;
      }
    } else {
      game.remoteTransitionSnap = null;
    }

    // ボス同期（受信スナップショット間隔に合わせて60fpsで滑らかに補間）
    if (snap.bo) {
      const expectedBossKind = snap.bo[0] === 'snake'
        ? 'snake'
        : (snap.bo[0] === 'cloud' ? 'cloud' : 'bigfoot');
      if (!game.boss || game.boss.id !== expectedBossKind) {
        const stageData = MAPS[snap.si % MAPS.length];
        game.boss = expectedBossKind === 'snake'
          ? new SnakeBoss(stageData)
          : (expectedBossKind === 'cloud' ? new CloudBoss(stageData) : new BigfootBoss(stageData));
      }
      game.boss.applySnapshot(snap.bo, Math.max(0.035, guestSnapIntervalEstimate));
    } else {
      game.boss = null;
    }

    // 共有スキル状態同期
    const snapshotNewlyUnlocked = [];
    if (Array.isArray(snap.sk)) {
      for (const row of snap.sk) {
        const [key, unlocked, activeTimer, cooldownTimer, currentStock, mapUses] = row;
        const sk = game.skills[key];
        if (!sk) continue;
        const wasUnlocked = Boolean(sk.unlocked);
        sk.unlocked = !!unlocked;
        sk.activeTimer = activeTimer || 0;
        sk.cooldownTimer = cooldownTimer || 0;
        sk.currentStock = currentStock || 0;
        sk.mapUses = mapUses || 0;
        if (!wasUnlocked && sk.unlocked && game.state === 'playing') {
          snapshotNewlyUnlocked.push(key);
        }
      }
    }
    syncSkillsUnlocksForStage(game.stageNumber, game.state === 'playing');
    for (const key of snapshotNewlyUnlocked) {
      queueSkillUnlockAnimation(key);
    }
    renderSkillBarUI();
  }

  function updateGuest(dt) {
    if (game.state === 'playing') {
      updateSkills(dt);

      // パドルローカル予測（自機）＆線形補間（他プレイヤー）
      const isStageClearWarping = !!(game.remoteTransitionSnap && (
        game.remoteTransitionSnap[0] === 'killing_enemies' ||
        game.remoteTransitionSnap[0] === 'waiting_before_blocks'
      ));
      let localPaddle = null;
      for (const p of game.paddles) {
        if (p.hp <= 0) {
          if (!isStageClearWarping && p.respawnTimer > 0) {
            p.respawnTimer = Math.max(0, p.respawnTimer - dt);
          }
          continue;
        }
        if (p.invincibleTimer > 0) {
          p.invincibleTimer = Math.max(0, p.invincibleTimer - dt);
        }
        if (p.effects.cyan > 0 || p.effects.yellow > 0 || p.effects.green > 0) {
          p.effectClock += dt;
          p.effects.cyan = Math.max(0, p.effects.cyan - dt);
          p.effects.yellow = Math.max(0, p.effects.yellow - dt);
          p.effects.green = Math.max(0, p.effects.green - dt);
        }
        if (p.isLocal) {
          localPaddle = p;
          p.moveHorizontal(dt, input);
        } else {
          stepLinearInterp(p, dt);
        }
        p.updateCosmeticEffects(dt, effectsManager);
      }

      // 自分の入力と自パドル現在座標をバイナリパケットでホストへ送信する
      guestInputSendTimer += dt;
      const localX = localPaddle && localPaddle.hp > 0 ? localPaddle.x : null;
      const inputKey = `${input.left ? 1 : 0}_${input.right ? 1 : 0}_${input.pointerX !== null ? Math.round(input.pointerX) : 'n'}`;
      if (inputKey !== lastSentInputKey || guestInputSendTimer >= 0.02) {
        lastSentInputKey = inputKey;
        guestInputSendTimer = 0;
        guestInputSeq = (guestInputSeq + 1) & 0xffff;
        mp.sendToHostInput(guestInputSeq, input, localX);
      }
      guestPendingInputs.push({
        seq: guestInputSeq,
        dt,
        left: !!input.left,
        right: !!input.right,
        pointerX: input.pointerX
      });
      if (guestPendingInputs.length > 120) {
        guestPendingInputs.shift();
      }

      // 紫色のサブパドル線形補間＆幅イージング
      if (game.purplePaddle) {
        stepLinearInterp(game.purplePaddle, dt);
        game.purplePaddle.width += (game.purplePaddle.targetWidth - game.purplePaddle.width) * Math.min(1, dt * GAME_CONFIG.PURPLE_PADDLE.EASE_SPEED);
      }

      // ボールのローカル等速計算＆ローカルパドル・ブロック反射予測
      const swingActiveGuest = isSkillActive('swing');
      for (let i = game.balls.length - 1; i >= 0; i--) {
        const ball = game.balls[i];
        ball.stepClientPrediction(dt, {
          localPaddle,
          purplePaddle: game.purplePaddle,
          blocks: game.blocks,
          enemies: game.enemies,
          boss: game.boss,
          supplyDrops: game.supplyDrops,
          effectsManager,
          swingActive: swingActiveGuest
        }, true);
        if (ball.y - ball.radius > HEIGHT + 40) {
          game.balls.splice(i, 1);
        }
      }

      // 出現アニメ中ブロックのローカル補間進行
      for (const blk of game.blocks) {
        if (!blk.alive || !blk.spawning) continue;
        blk.spawnTimer += dt;
        if (blk.spawnTimer >= blk.spawnDuration) {
          blk.spawning = false;
          blk.scale = 1;
          blk.collidable = true;
        } else {
          blk.scale = easeOutBack(blk.spawnTimer / blk.spawnDuration);
        }
      }

      // エネミー移動＆確定的エネミー（single / spread）のローカル自動発射再現
      for (let i = game.enemies.length - 1; i >= 0; i--) {
        if (!game.enemies[i].updateClient(dt, game.enemyBullets, game.paddles)) {
          game.enemies.splice(i, 1);
        }
      }

      // 敵弾のローカル推進（等速 / 減速停止->遅延加速） & スペード弾の高度拡散
      for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
        const b = game.enemyBullets[i];
        Enemy.stepBulletMotion(b, dt);
        if (Enemy.maybeExplodeSpadeBullet(b, game.enemyBullets, effectsManager)) {
          game.enemyBullets.splice(i, 1);
          continue;
        }
        if (b.y > HEIGHT + 24 || b.y < -24 || b.x < -24 || b.x > WIDTH + 24) {
          game.enemyBullets.splice(i, 1);
        }
      }

      // アイテム＆サプライドロップのローカル落下
      for (let i = game.items.length - 1; i >= 0; i--) {
        const it = game.items[i];
        it.y += ITEM.FALL_SPEED * dt;
        it.angle += ITEM.ROTATION_SPEED * dt;
        if (it.y - it.radius > HEIGHT + 30) {
          game.items.splice(i, 1);
        }
      }
      for (let i = game.supplyDrops.length - 1; i >= 0; i--) {
        const drop = game.supplyDrops[i];
        drop.y += drop.vy * dt;
        if (drop.y - drop.h / 2 > HEIGHT + 30) {
          game.supplyDrops.splice(i, 1);
        }
      }

      // ボス表示補間（位置・角度・腕・点滅タイマーを60fpsで滑らかに更新）
      if (game.boss) {
        game.boss.updateClient(dt);
        if (game.boss.phase === 'summon') {
          game.shakeTimer = Math.max(game.shakeTimer, 0.08);
          game.shakeMagnitude = Math.max(game.shakeMagnitude, 4.2);
        } else if (game.boss.phase === 'fog_cast') {
          game.shakeTimer = Math.max(game.shakeTimer, 0.08);
          game.shakeMagnitude = Math.max(game.shakeMagnitude, 3.2);
        } else if (game.boss.id === 'cloud') {
          if (game.boss.phase === 'lightning_strike' && game.boss._lastGuestPhase !== 'lightning_strike') {
            game.shakeTimer = Math.max(game.shakeTimer, 0.14);
            game.shakeMagnitude = Math.max(game.shakeMagnitude, 6.5);
          }
          game.boss._lastGuestPhase = game.boss.phase;
        }
      }

      // 背景ワープ倍率やボスサイレン等のトランジションタイマーを毎フレーム完全ローカルで進行させる
      if (game.remoteTransitionSnap) {
        game.remoteTransitionSnap[1] = (game.remoteTransitionSnap[1] || 0) + dt;
        game.warpSpeedMultiplier = game.remoteTransitionSnap[0] === 'waiting_before_blocks'
          ? computeWarpSpeedMultiplier(game.remoteTransitionSnap[1])
          : 1;
      } else {
        game.warpSpeedMultiplier = 1;
      }
    }
  }

  // ============================================================================
  // 更新処理
  // ============================================================================
  function update(dt) {
    if (game.displayedScore < game.score) {
      const diff = game.score - game.displayedScore;
      game.displayedScore += Math.ceil(diff * Math.min(1, dt * 14));
    }

    if (game.shakeTimer > 0) {
      game.shakeTimer = Math.max(0, game.shakeTimer - dt);
    }
    if (game.damageFlash > 0) {
      game.damageFlash = Math.max(0, game.damageFlash - dt * 3.4);
    }

    effectsManager.update(dt);

    if (gameInProgressHintTimer > 0) {
      gameInProgressHintTimer = Math.max(0, gameInProgressHintTimer - dt);
      if (gameInProgressHintTimer === 0) {
        updateMenuUI();
      }
    }

    if (game.state === 'menu') {
      updateMenuVisualPaddles(dt);
    }

    if (game.state === 'playing' && game.tagTransition < 1) {
      game.tagTransition = Math.min(1, game.tagTransition + dt / 0.45);
    }

    if (mp.mode === 'guest') {
      if (game.state === 'playing') {
        if (game.menuTitleAlpha > 0) {
          game.menuTitleAlpha = Math.max(0, game.menuTitleAlpha - dt * 3.8);
        }
        updateGuest(dt);
        updateSkillUnlockAnimation(dt);
        const bgStageNumber = guestWarpingFlag
          ? Math.max(game.stageNumber, game.stageIndex + 2)
          : game.stageNumber;
        backgroundEffect.update(dt, bgStageNumber, game.warpSpeedMultiplier);
      }
      return;
    }

    if (game.state === 'playing') {
      if (game.menuTitleAlpha > 0) {
        game.menuTitleAlpha = Math.max(0, game.menuTitleAlpha - dt * 3.8);
      }
      const isWarpingToNext = game.transition && (
        game.transition.phase === 'killing_enemies' ||
        game.transition.phase === 'waiting_before_blocks'
      );
      const bgStageNumber = isWarpingToNext ? Math.max(game.stageNumber, game.stageIndex + 2) : game.stageNumber;
      backgroundEffect.update(dt, bgStageNumber, game.warpSpeedMultiplier);
    }

    if (game.state !== 'playing') {
      return;
    }

    updateSkills(dt);
    updateSkillUnlockAnimation(dt);

    const stageData = MAPS[game.stageIndex % MAPS.length];

    // 1. 全プレイヤーパドル更新
    const isStageClearWarping = !!(game.transition && (
      game.transition.phase === 'killing_enemies' ||
      game.transition.phase === 'waiting_before_blocks'
    ));
    const playerCount = Math.max(1, game.paddles.length);
    const currentMaxHp = MultiplayerManager.getMaxHpForCount(playerCount);
    for (const p of game.paddles) {
      if (p.hp <= 0) {
        if (mp.mode !== 'solo') {
          if (!p._deathRespawnHandled) {
            assignRespawnCountdown(p);
          }
          if (!isStageClearWarping && p.respawnTimer > 0) {
            p.respawnTimer = Math.max(0, p.respawnTimer - dt);
            if (p.respawnTimer <= 0) {
              p.revive(currentMaxHp, effectsManager, playerCount);
            }
          }
        }
        continue;
      }
      const ri = !p.isLocal ? mp.remoteInputs.get(p.slot) : null;
      if (ri && ri.seq !== undefined) {
        lastProcessedInputSeqBySlot.set(p.slot, ri.seq);
      }
      const isFresh = ri && (ri.receivedAtMs === undefined || (MultiplayerManager.nowPerf() - ri.receivedAtMs) <= 140);
      const pInput = p.isLocal
        ? input
        : (isFresh ? ri : { left: false, right: false, pointerX: null });
      p.update(dt, pInput, effectsManager);
      if (!p.isLocal && ri && typeof ri.x === 'number' && Number.isFinite(ri.x)) {
        const halfW = p.currentWidth / 2;
        const targetClientX = ColorUtils.clamp(ri.x, halfW, WIDTH - halfW);
        const diffX = targetClientX - p.x;
        const maxCorrection = p.getSpeed() * dt * 0.85;
        p.x = ColorUtils.clamp(
          p.x + ColorUtils.clamp(diffX * Math.min(1, dt * 16), -maxCorrection, maxCorrection),
          halfW,
          WIDTH - halfW
        );
      }
    }

    // 2. 紫色のサブパドル更新
    if (game.purplePaddle) {
      game.purplePaddle.update(dt);
    }

    // 3. エネミー出現＆更新 (ステージ移行演出中は新規出現を停止)
    if (!game.transition && stageData.spawn_interval && stageData.spawn_limit > 0) {
      game.enemySpawnTimer -= dt;
      if (game.enemySpawnTimer <= 0) {
        spawnEnemyForStage(stageData);
        game.enemySpawnTimer = stageData.spawn_interval;
      }
    }

    const emitNewEnemies = () => {
      if (mp.mode !== 'host') return;
      for (const en of game.enemies) {
        if (!en._netSpawnSent) {
          en._netSpawnSent = true;
          mp.sendGameEvent(NetProto.encodeEnemyEvt({
            op: 0,
            serverTimeMs: mp.getServerTimeMs(),
            id: en.id,
            name: en.name,
            x: en.x,
            y: en.y,
            vx: en.vx,
            vy: en.vy,
            rotation: en.rotation,
            health: en.health,
            maxHealth: en.maxHealth,
            currentRadius: en.currentRadius,
            bullet_type: en.bullet_type,
            fire_rate: en.fire_rate,
            localAutoFire: false,
            fireTimer: en.fireTimer || 0
          }));
        }
      }
    };
    emitNewEnemies();

    const enemyNetHooks = mp.mode === 'host' ? {
      onFirstDeterministicShot: (en) => {
        mp.sendGameEvent(NetProto.encodeEnemyEvt({
          op: 1,
          serverTimeMs: mp.getServerTimeMs(),
          enemyId: en.id,
          shotSeq: en._shotSeq,
          x: en.x,
          y: en.y,
          rotation: en.rotation,
          vx: en.vx,
          vy: en.vy
        }));
      },
      onBulletsSpawned: (spawned) => {
        if (!spawned || spawned.length === 0) return;
        for (const b of spawned) {
          if (b.id === undefined) b.id = getNextBulletId();
        }
        mp.sendGameEvent(NetProto.encodeBulletEvt({
          op: 0,
          serverTimeMs: mp.getServerTimeMs(),
          bullets: spawned
        }));
      },
      onEnemyStateSync: (en, subOp) => {
        if (!en) return;
        const phaseCode = en.aimedFallPhase === 'charging' ? 1 : (en.aimedFallPhase === 'diving' ? 2 : 0);
        const timer = subOp === 1
          ? en.fireTimer
          : (en.aimedFallPhase === 'charging' ? en.aimedFallTimer : en.fireTimer);
        mp.sendGameEvent(NetProto.encodeEnemyEvt({
          op: 5,
          serverTimeMs: mp.getServerTimeMs(),
          enemyId: en.id,
          subOp,
          x: en.x,
          y: en.y,
          vx: en.vx,
          vy: en.vy,
          angle: en.laserAngle || 0,
          timer,
          phaseCode,
          targetSlot: en.aimedFallTargetSlot
        }));
      }
    } : null;

    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const en = game.enemies[i];
      const alive = en.update(dt, game.paddles, game.enemyBullets, effectsManager, damagePaddle, enemyNetHooks);
      if (!alive) {
        game.enemies.splice(i, 1);
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeEnemyEvt({
            op: 3,
            serverTimeMs: mp.getServerTimeMs(),
            enemyId: en.id,
            reason: (en.bullet_type === 'self_destruction' || en.bullet_type === 'connect') ? 2 : 1
          }));
        }
      }
    }

    // 3a. connect エネミー（quadiamond）間の 1px 接続レーザー当たり判定
    for (const [key, cd] of connectLaserCooldowns) {
      const next = cd - dt;
      if (next <= 0) connectLaserCooldowns.delete(key);
      else connectLaserCooldowns.set(key, next);
    }
    const connectPairs = Enemy.getConnectLaserPairs(game.enemies);
    for (const [e1, e2] of connectPairs) {
      const minId = Math.min(e1.id, e2.id);
      const maxId = Math.max(e1.id, e2.id);
      for (const p of game.paddles) {
        if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
        const pairSlotKey = `${minId}_${maxId}_${p.slot}`;
        if (connectLaserCooldowns.has(pairSlotKey)) continue;
        // 1px の線幅に対応するよう半幅 0.5px をパドル矩形へ加算
        const hit = Enemy.segmentIntersectsRect(
          e1.x,
          e1.y,
          e2.x,
          e2.y,
          p.x - p.currentWidth / 2 - 0.5,
          p.y - p.height / 2 - 0.5,
          p.x + p.currentWidth / 2 + 0.5,
          p.y + p.height / 2 + 0.5
        );
        if (hit) {
          damagePaddle(p, e1.damage);
          connectLaserCooldowns.set(pairSlotKey, 0.85);
          effectsManager.spawnCircleParticles(hit.x, hit.y, COLORS.red, 7, 30, 120);
        }
      }
    }

    // 3b. ボス更新＆サプライドロップ管理 (30秒ごとに正方形白色ブロックを画面上から落下)
    if (game.boss) {
      game.boss.update(dt, {
        paddles: game.paddles,
        enemies: game.enemies,
        enemyBullets: game.enemyBullets,
        effectsManager,
        onDamagePaddle: damagePaddle,
        onScreenShake: (dur, mag) => {
          game.shakeTimer = Math.max(game.shakeTimer, dur);
          game.shakeMagnitude = Math.max(game.shakeMagnitude, mag);
        },
        onBarrageSpawn: (spawned) => {
          if (mp.mode !== 'host' || !spawned || spawned.length === 0) return;
          for (const b of spawned) {
            if (b.id === undefined) b.id = getNextBulletId();
          }
          mp.sendGameEvent(NetProto.encodeBulletEvt({
            op: 0,
            serverTimeMs: mp.getServerTimeMs(),
            bullets: spawned
          }));
        }
      });
      emitNewEnemies();

      if (!game.transition && isBossStage(stageData) && !game.boss.isDefeated()) {
        game.bossSupplyTimer -= dt;
        if (game.bossSupplyTimer <= 0) {
          game.bossSupplyTimer += 30;
          const size = 60;
          const margin = 64;
          const spawnX = margin + Math.random() * (WIDTH - margin * 2);
          nextSupplyDropId += 1;
          const drop = {
            id: nextSupplyDropId,
            x: spawnX,
            y: -size / 2 - 4,
            w: size,
            h: size,
            vy: 58,
            alive: true
          };
          game.supplyDrops.push(drop);
          if (mp.mode === 'host') {
            mp.sendGameEvent(NetProto.encodeDropEvt({
              op: 0,
              serverTimeMs: mp.getServerTimeMs(),
              id: drop.id,
              x: drop.x,
              y: drop.y,
              w: drop.w
            }));
          }
        }
      }
    }

    for (let i = game.supplyDrops.length - 1; i >= 0; i--) {
      const drop = game.supplyDrops[i];
      drop.y += drop.vy * dt;
      if (!drop.alive || drop.y - drop.h / 2 > HEIGHT + 20) {
        game.supplyDrops.splice(i, 1);
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeDropEvt({
            op: 1,
            serverTimeMs: mp.getServerTimeMs(),
            id: drop.id
          }));
        }
      }
    }

    // 4. 敵弾更新（ヒット判定は1px、パドルは見た目通り。重なり時は双方にダメージ）
    const hitRemovedBulletIds = [];
    for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
      const b = game.enemyBullets[i];
      Enemy.stepBulletMotion(b, dt);

      if (b.homingMode === 'decel' && (b.waitAfterStop || 0) >= (b.waitTarget ?? 1.0)) {
        const alivePaddles = game.paddles.filter((pl) => pl && pl.hp > 0);
        const candidates = alivePaddles.length > 0 ? alivePaddles : [{ x: WIDTH / 2, y: PADDLE.Y }];
        const validTargets = candidates.filter((pl) => Enemy.isAimAngleValid(pl.x - b.x, pl.y - b.y));
        if (validTargets.length === 0) {
          // 角度がつきすぎている場合や上向きに射撃しようとしている場合は発射しない
          effectsManager.spawnCircleParticles(b.x, b.y, COLORS.white, 5, 25, 80);
          if (b.id !== undefined) hitRemovedBulletIds.push(b.id);
          game.enemyBullets.splice(i, 1);
          continue;
        }
        const picked = validTargets[Math.floor(Math.random() * validTargets.length)];
        const angle = Math.atan2(picked.y - b.y, picked.x - b.x);
        b.homingMode = 'accel';
        b.angle = angle;
        b.speed = 0;
        b.vx = 0;
        b.vy = 0;
        b.accel = b.accel || 520;
        b.maxSpeed = b.maxSpeed || 540;
        if (mp.mode === 'host' && b.id !== undefined) {
          mp.sendGameEvent(NetProto.encodeBulletEvt({
            op: 3,
            serverTimeMs: mp.getServerTimeMs(),
            id: b.id,
            x: b.x,
            y: b.y,
            angle: b.angle,
            accel: b.accel,
            maxSpeed: b.maxSpeed
          }));
        }
      }

      let hitAny = false;
      for (const p of game.paddles) {
        if (!p || p.hp <= 0 || p.invincibleTimer > 0) continue;
        const pLeft = p.x - p.currentWidth / 2;
        const pRight = p.x + p.currentWidth / 2;
        const pTop = p.y - p.height / 2;
        const pBottom = p.y + p.height / 2;

        if (b.x >= pLeft && b.x <= pRight && b.y >= pTop && b.y <= pBottom) {
          damagePaddle(p, b.damage);
          hitAny = true;
        }
      }
      if (hitAny) {
        effectsManager.spawnCircleParticles(b.x, b.y, COLORS.red, 7, 30, 120);
        if (b.id !== undefined) hitRemovedBulletIds.push(b.id);
        game.enemyBullets.splice(i, 1);
        continue;
      }

      if (Enemy.maybeExplodeSpadeBullet(b, game.enemyBullets, effectsManager)) {
        game.enemyBullets.splice(i, 1);
        continue;
      }

      if (b.y > HEIGHT + 24 || b.y < -24 || b.x < -24 || b.x > WIDTH + 24) {
        game.enemyBullets.splice(i, 1);
      }
    }
    if (mp.mode === 'host' && hitRemovedBulletIds.length > 0) {
      mp.sendGameEvent(NetProto.encodeBulletEvt({
        op: 1,
        serverTimeMs: mp.getServerTimeMs(),
        ids: hitRemovedBulletIds
      }));
    }

    // 5. アイテム更新
    for (let i = game.items.length - 1; i >= 0; i--) {
      const it = game.items[i];
      const alive = it.update(dt, game.paddles, effectsManager, applyItemEffect);
      if (!alive) {
        game.items.splice(i, 1);
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeItemEvt({
            op: 1,
            serverTimeMs: mp.getServerTimeMs(),
            id: it.id
          }));
        }
      }
    }

    // 6. ボール更新
    const ballContext = {
      paddles: game.paddles,
      purplePaddle: () => game.purplePaddle,
      blocks: game.blocks,
      supplyDrops: game.supplyDrops,
      enemies: game.enemies,
      boss: game.boss,
      effectsManager,
      swingActive: isSkillActive('swing'),
      onScore: (pts) => {
        game.score += pts;
      },
      enemyDropChance: Item.getEnemyDropChance(stageData),
      onSpawnItem: maybeSpawnItem,
      onClearPurplePaddle: () => {
        game.purplePaddle = null;
      },
      onBounce: (ball, source) => {
        if (mp.mode === 'host') {
          emitBallEvt(1, ball, BALL_BOUNCE_SRC[source] || 0);
        }
      },
      onBlockDestroyed: (blk) => {
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeBlockEvt({
            op: 0,
            serverTimeMs: mp.getServerTimeMs(),
            blockId: blk.id
          }));
        }
      },
      onDropRemoved: (drop) => {
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeDropEvt({
            op: 1,
            serverTimeMs: mp.getServerTimeMs(),
            id: drop.id
          }));
        }
      },
      onEnemyEvent: (enemy, destroyed) => {
        if (mp.mode !== 'host' || !enemy) return;
        mp.sendGameEvent(NetProto.encodeEnemyEvt(destroyed ? {
          op: 3,
          serverTimeMs: mp.getServerTimeMs(),
          enemyId: enemy.id,
          reason: 0
        } : {
          op: 2,
          serverTimeMs: mp.getServerTimeMs(),
          enemyId: enemy.id,
          health: enemy.health,
          x: enemy.x,
          y: enemy.y
        }));
      }
    };

    for (let i = game.balls.length - 1; i >= 0; i--) {
      const ball = game.balls[i];
      const alive = ball.update(dt, ballContext);
      if (!alive) {
        game.balls.splice(i, 1);
        if (mp.mode === 'host') {
          emitBallEvt(2, ball);
        }
      }
    }

    // すべてのボールが落下した場合:
    // 全滅時（全パドルHP0）または次ステージ開始時にペナルティリセット＆復活
    if (game.balls.length === 0) {
      if (game.lives > 0) {
        game.lives -= 1;
        const allDead = game.paddles.every((p) => p.hp <= 0);
        if (allDead) {
          resetRespawnPenalties();
          reviveDeadPaddles();
        }
        const alivePaddles = game.paddles.filter((p) => p.hp > 0);
        if (alivePaddles.length === 0 && game.paddles.length === 0) return;
        const newBall = Ball.createCenterSpawn();
        game.balls.push(newBall);
        if (mp.mode === 'host') {
          emitBallEvt(0, newBall, BALL_BOUNCE_SRC.respawn);
        }
        effectsManager.spawnPulse({
          kind: 'circle',
          target: newBall,
          x: newBall.x,
          y: newBall.y,
          radius: BALL.BASE_RADIUS,
          color: COLORS.white,
          duration: 0.45,
          maxScale: 2.5
        });
      } else {
        endGame('gameover');
      }
    }

    // 7. ステージクリア＆シームレス移行演出
    if (game.transition) {
      updateStageTransition(dt);
    } else if (isBossStage(stageData)) {
      if (game.boss && game.boss.isDefeated()) {
        while (game.enemies.length > 0) {
          const enemy = game.enemies.pop();
          forceDestroyEnemy(enemy);
        }
        game.enemyBullets = [];
        game.supplyDrops = [];
        if (mp.mode === 'host') {
          mp.sendGameEvent(NetProto.encodeBulletEvt({
            op: 2,
            serverTimeMs: mp.getServerTimeMs()
          }));
        }
        game.score += 500;
        for (const p of game.paddles) {
          p.respawnPenalty = 0;
        }
        game.boss.startDefeatAnimation();
        game.transition = {
          phase: 'boss_defeat',
          timer: 0,
          pendingBlocks: []
        };
      }
    } else {
      const hasRemainingBlocks = game.blocks.some((b) => b.alive);
      if (!hasRemainingBlocks) {
        game.score += 500;
        if (game.stageIndex + 1 < MAPS.length) {
          startNextStageTransition();
        } else {
          endGame('victory');
        }
      }
    }

    // 8. マルチプレイホスト時の状態同期送信 & 低頻度ブロック整合チェック
    if (mp.mode === 'host') {
      hostSnapSendTimer += dt;
      sendHostSnapshot(false);
      if (!game.transition && !isBossStage(stageData)) {
        hostBlockResyncTimer += dt;
        if (hostBlockResyncTimer >= 1.2) {
          hostBlockResyncTimer = 0;
          emitBlockSyncMask();
        }
      }
    }
  }

  // ============================================================================
  // 描画処理 (数字と図形のみで表現)
  // ============================================================================
  function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    const damageShake = game.shakeTimer > 0 ? Math.min(1, game.shakeTimer / DAMAGE_SHAKE_DURATION) * game.shakeMagnitude : 0;
    if (damageShake > 0) {
      const sx = (Math.random() * 2 - 1) * damageShake;
      const sy = (Math.random() * 2 - 1) * damageShake;
      ctx.translate(sx, sy);
    }

    if (game.state === 'menu') {
      renderMenuScreen();
    } else {
      renderPlayfield();
      renderHUD();

      // ゲーム開始直後にタイトル文字を滑らかにフェードアウトさせる
      if (game.menuTitleAlpha > 0) {
        renderTitleText(game.menuTitleAlpha);
      }

      if (game.state === 'gameover' || game.state === 'victory') {
        renderEndOverlay();
      }
    }

    if (game.damageFlash > 0) {
      renderDamageGlow(game.damageFlash);
    }

    const sirenTimer = (game.transition && game.transition.phase === 'boss_siren')
      ? game.transition.timer
      : (mp.mode === 'guest' && game.remoteTransitionSnap && game.remoteTransitionSnap[0] === 'boss_siren'
        ? game.remoteTransitionSnap[1]
        : -1);
    if (sirenTimer >= 0) {
      renderBossSiren(sirenTimer);
    }

    ctx.restore();
  }

  function renderHUD() {
    // 左上: 3つの白いボールによる残機表示
    for (let i = 0; i < 3; i++) {
      const cx = 36 + i * 28;
      const cy = 38;
      ctx.save();
      if (i < game.lives) {
        ctx.fillStyle = COLORS.white;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, 7.2, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 右上: Google Sans Flex によるスコア表示 (数字のみ)
    ctx.save();
    ctx.fillStyle = COLORS.white;
    ctx.font = '600 32px "Google Sans Flex", sans-serif';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(game.displayedScore), WIDTH - 32, 39);
    ctx.restore();

    // マルチプレイでやられた場合、次に復活するまでの残り時間を画面に半透明で表示
    if (game.state === 'playing' && mp.mode !== 'solo') {
      const isStageClearWarping = !!(
        (game.transition && (game.transition.phase === 'killing_enemies' || game.transition.phase === 'waiting_before_blocks')) ||
        (mp.mode === 'guest' && game.remoteTransitionSnap && (game.remoteTransitionSnap[0] === 'killing_enemies' || game.remoteTransitionSnap[0] === 'waiting_before_blocks'))
      );
      const localPaddle = game.paddles.find((p) => p && p.isLocal);
      if (!isStageClearWarping && localPaddle && localPaddle.hp <= 0 && localPaddle.respawnTimer > 0) {
        const remainSec = Math.max(1, Math.ceil(localPaddle.respawnTimer));
        ctx.save();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = COLORS.white;
        ctx.font = '700 84px "Google Sans Flex", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(remainSec), WIDTH / 2, HEIGHT * 0.58);
        ctx.restore();
      }
    }
  }

  function renderPlayfield() {
    // 0. 背景スクロール演出（ステージ2以降のドット粒子・ステージ3以降の雲エフェクト）
    backgroundEffect.render(ctx);

    // 1. パルスアニメーション
    effectsManager.renderPulses(ctx);

    // 2. ブロック＆サプライドロップ (スケールイン対応)
    ctx.save();
    ctx.fillStyle = COLORS.white;
    for (const blk of game.blocks) {
      if (!blk.alive) continue;
      const scale = blk.scale !== undefined ? blk.scale : 1;
      if (scale <= 0) continue;
      const w = blk.w * scale;
      const h = blk.h * scale;
      ctx.fillRect(blk.x - w / 2, blk.y - h / 2, w, h);
    }
    for (const drop of game.supplyDrops) {
      if (!drop.alive) continue;
      ctx.fillRect(drop.x - drop.w / 2, drop.y - drop.h / 2, drop.w, drop.h);
    }
    ctx.restore();

    // 3. アイテム
    for (const it of game.items) {
      it.render(ctx);
    }

    // 4. connect レーザー（見た目のみ 0.25 秒おきにイージング無しギザギザ変化）・エネミー・ボス
    const renderConnectPairs = Enemy.getConnectLaserPairs(game.enemies);
    for (const [e1, e2] of renderConnectPairs) {
      const elapsed = Math.min(e1.timeAlive || 0, e2.timeAlive || 0);
      const phase = elapsed % ENEMY.BLINK_CYCLE;
      const laserColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
      ShapeRenderer.drawConnectLaser(
        ctx,
        e1.x + (e1.corrX || 0),
        e1.y + (e1.corrY || 0),
        e2.x + (e2.corrX || 0),
        e2.y + (e2.corrY || 0),
        e1.id,
        e2.id,
        elapsed,
        laserColor
      );
    }
    for (const e of game.enemies) {
      e.render(ctx);
    }
    if (game.boss) {
      game.boss.render(ctx);
    }

    // 5. 敵弾 (中をくり抜いた丸形／スペード型、0.5秒サイクルで赤→白点滅、イージングなし・当たり判定1px)
    ctx.save();
    ctx.lineWidth = 2.5;
    for (const b of game.enemyBullets) {
      const phase = (b.timer || 0) % ENEMY.BLINK_CYCLE;
      const strokeColor = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
      if (b.shape === 'spade') {
        const bAngle = b.angle !== undefined ? b.angle : Math.atan2(b.vy || 0, b.vx || 0);
        ShapeRenderer.drawEnemyShape(ctx, 'spade', b.x, b.y, 11, bAngle - Math.PI / 2, strokeColor, 1, true);
      } else {
        ctx.fillStyle = '#000000';
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(b.x, b.y, ENEMY.BULLET_VISUAL_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    // 6. パドル被弾時の赤ゲージ残像＆三角形破砕演出
    effectsManager.renderDamageEffects(ctx);

    // 7. 自機＆味方パドル
    const showMultiTags = game.paddles.length > 1;
    for (const p of game.paddles) {
      p.render(ctx, showMultiTags, game.tagTransition);
    }

    // 8. 紫色のサブパドル
    if (game.purplePaddle) {
      game.purplePaddle.render(ctx);
    }

    // 9. ボール＆残像
    for (const ball of game.balls) {
      ball.render(ctx);
    }

    // 10. パーティクル
    effectsManager.renderParticles(ctx);

    // 11. ステージ30ボス (cloud) の霧エフェクト
    if (game.boss && typeof game.boss.renderFog === 'function') {
      game.boss.renderFog(ctx);
    }
  }

  function renderTitleText(alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = COLORS.white;
    ctx.font = '700 72px "Google Sans Flex", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = '10px';
    }
    ctx.fillText('PADDLES', WIDTH / 2 + 5, 315);
    ctx.restore();
  }

  function getMenuPlayerList() {
    return mp.players && mp.players.length > 0
      ? mp.players
      : [{
          peerId: mp.localPeerId || 'local',
          slot: 0,
          nickname: getTrimmedNickname(),
          isLocal: true,
          isHost: true,
          ready: true
        }];
  }

  function syncMenuVisualPaddles(immediate = false) {
    const players = getMenuPlayerList();
    const count = Math.max(1, Math.min(GAME_CONFIG.MULTIPLAYER.MAX_PLAYERS, players.length));
    const targetW = MultiplayerManager.getMaxPaddleWidthForCount(count);
    const isFirstPopulate = menuVisualPaddles.length === 0;
    const existingByKey = new Map(menuVisualPaddles.map((vp) => [vp.key, vp]));
    const activeKeys = new Set();

    for (let i = 0; i < count; i++) {
      const pl = players[i];
      const key = pl.peerId || `slot:${pl.slot}`;
      activeKeys.add(key);
      const targetX = count <= 1 ? WIDTH / 2 : WIDTH * ((i + 1) / (count + 1));
      const targetAlpha = (count > 1 && !pl.isLocal) ? 0.75 : 1.0;

      let vp = existingByKey.get(key);
      if (!vp) {
        const snapNow = immediate || isFirstPopulate;
        vp = {
          key,
          slot: pl.slot ?? i,
          isLocal: !!pl.isLocal,
          nickname: pl.nickname || '',
          ready: !!pl.ready,
          readyAnim: pl.ready ? 1 : 0,
          x: targetX,
          w: snapNow ? targetW : 0,
          alpha: snapNow ? targetAlpha : 0,
          targetX,
          targetW,
          targetAlpha,
          leaving: false
        };
        menuVisualPaddles.push(vp);
      } else {
        vp.slot = pl.slot ?? i;
        vp.isLocal = !!pl.isLocal;
        vp.nickname = pl.nickname || '';
        vp.ready = !!pl.ready;
        vp.targetX = targetX;
        vp.targetW = targetW;
        vp.targetAlpha = targetAlpha;
        vp.leaving = false;
        if (immediate) {
          vp.x = targetX;
          vp.w = targetW;
          vp.alpha = targetAlpha;
          vp.readyAnim = vp.ready ? 1 : 0;
        }
      }
    }

    for (const vp of menuVisualPaddles) {
      if (!activeKeys.has(vp.key)) {
        vp.leaving = true;
        vp.targetW = 0;
        vp.targetAlpha = 0;
        if (immediate) {
          vp.w = 0;
          vp.alpha = 0;
        }
      }
    }

    if (immediate) {
      menuVisualPaddles = menuVisualPaddles.filter((vp) => !vp.leaving);
    }
  }

  function updateMenuVisualPaddles(dt) {
    if (menuVisualPaddles.length === 0) {
      syncMenuVisualPaddles(true);
      return;
    }
    const factor = 1 - Math.exp(-12 * Math.min(Math.max(dt, 0), 0.05));
    for (const vp of menuVisualPaddles) {
      vp.x += (vp.targetX - vp.x) * factor;
      vp.w += (vp.targetW - vp.w) * factor;
      vp.alpha += (vp.targetAlpha - vp.alpha) * factor;
      const targetReady = vp.ready ? 1 : 0;
      vp.readyAnim = (vp.readyAnim || 0) + (targetReady - (vp.readyAnim || 0)) * factor;
    }
    menuVisualPaddles = menuVisualPaddles.filter(
      (vp) => !(vp.leaving && vp.alpha <= 0.02 && vp.w <= 1)
    );
  }

  function renderMenuScreen() {
    renderHUD();
    renderTitleText(1);

    if (menuVisualPaddles.length === 0) {
      syncMenuVisualPaddles(true);
    }

    const activeCount = menuVisualPaddles.filter((vp) => !vp.leaving).length;
    const demoPaddleY = 790;

    ctx.save();
    for (const vp of menuVisualPaddles) {
      if (vp.w <= 0.5 || vp.alpha <= 0.01) continue;

      ctx.globalAlpha = vp.alpha;
      ctx.fillStyle = COLORS.white;
      ctx.fillRect(vp.x - vp.w / 2, demoPaddleY - PADDLE.HEIGHT / 2, vp.w, PADDLE.HEIGHT);

      if (activeCount > 1 && !vp.leaving && vp.alpha > 0.15) {
        const label = vp.nickname || `P${vp.slot + 1}`;
        const labelAlpha = vp.isLocal ? Math.min(1, vp.alpha * 0.92) : vp.alpha;
        const textY = demoPaddleY + PADDLE.HEIGHT / 2 + 13;
        ctx.globalAlpha = labelAlpha;
        ctx.font = '500 11px "Google Sans Flex", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, vp.x, textY);

        const readyAmt = vp.readyAnim || 0;
        if (readyAmt > 0.02) {
          const checkScale = 0.65 + 0.35 * readyAmt;
          ShapeRenderer.drawSharpCheckmark(
            ctx,
            vp.x,
            demoPaddleY - PADDLE.HEIGHT / 2 - 14,
            9 * checkScale,
            2.0,
            COLORS.white,
            labelAlpha * readyAmt
          );
        }
      }
    }
    ctx.restore();
  }

  function renderEndOverlay() {
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.76)';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    for (let i = 0; i < MAPS.length; i++) {
      const sx = WIDTH / 2 + (i - (MAPS.length - 1) / 2) * 34;
      const sy = 250;
      const cleared = game.state === 'victory' || i < game.stageIndex;
      ShapeRenderer.drawPolygonPath(ctx, sx, sy, 9, 4, 0);
      if (cleared) {
        ctx.fillStyle = COLORS.white;
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    ctx.fillStyle = COLORS.white;
    ctx.font = '700 68px "Google Sans Flex", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(game.score), WIDTH / 2, 345);
    ctx.restore();
  }

  function renderDamageGlow(intensity) {
    ctx.save();
    const grad = ctx.createRadialGradient(
      WIDTH / 2,
      HEIGHT / 2,
      WIDTH * 0.34,
      WIDTH / 2,
      HEIGHT / 2,
      WIDTH * 0.74
    );
    grad.addColorStop(0, 'rgba(255, 40, 60, 0)');
    grad.addColorStop(1, `rgba(255, 40, 60, ${0.2 * intensity})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);

    ctx.strokeStyle = `rgba(255, 50, 70, ${0.32 * intensity})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  function renderBossSiren(timer) {
    const cycle = 0.8;
    const phase = (timer % cycle) / cycle;
    const pulse = Math.pow(Math.sin(phase * Math.PI), 2);
    if (pulse <= 0.005) return;

    ctx.save();
    ctx.globalAlpha = 0.22 * pulse;
    ctx.fillStyle = COLORS.red;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.restore();
  }

  // ============================================================================
  // デバッグ用マップ切替コンソールコマンド
  // ============================================================================
  function resolveMapIndex(target) {
    if (typeof target === 'string') {
      const trimmed = target.trim();
      const byName = MAPS.findIndex((m) => m.name && m.name.toLowerCase() === trimmed.toLowerCase());
      if (byName !== -1) return byName;
      if (/^\d+$/.test(trimmed)) {
        const num = Number(trimmed);
        const byId = MAPS.findIndex((m) => m.identifier === num);
        if (byId !== -1) return byId;
      }
    } else if (typeof target === 'number' && Number.isFinite(target)) {
      const byId = MAPS.findIndex((m) => m.identifier === target);
      if (byId !== -1) return byId;
      if (target === 0 && MAPS.length > 0) return 0;
    }
    return -1;
  }

  window.setStartMap = (target) => {
    const idx = resolveMapIndex(target);
    if (idx === -1) {
      const available = MAPS.map((m) => `${m.identifier}:${m.name}`).join(', ');
      console.warn(`[Paddles] Unknown map "${target}". Available: ${available}`);
      return null;
    }
    debugStartStageIndex = idx;
    const chosen = MAPS[idx];
    console.info(`[Paddles] Start map set to #${chosen.identifier} (${chosen.name})`);
    return chosen;
  };

  window.jumpToMap = (target) => {
    const idx = resolveMapIndex(target);
    if (idx === -1) {
      return window.setStartMap(target);
    }
    debugStartStageIndex = idx;
    const chosen = MAPS[idx];
    if (game.state === 'playing' && mp.isHostOrSolo()) {
      loadStage(idx);
      if (mp.mode === 'host') {
        broadcastStageBlockLayout();
        sendHostSnapshot(true);
      }
      console.info(`[Paddles] Jumped to map #${chosen.identifier} (${chosen.name})`);
    } else {
      console.info(`[Paddles] Start map set to #${chosen.identifier} (${chosen.name})`);
    }
    return chosen;
  };

  window.listMaps = () => {
    const list = MAPS.map((m, i) => ({ index: i, id: m.identifier, name: m.name }));
    if (typeof console.table === 'function') {
      console.table(list);
    } else {
      console.log(list);
    }
    return list;
  };

  // ============================================================================
  // 起動＆メインループ開始
  // ============================================================================
  checkInitialRoomParam();
  syncMenuVisualPaddles(true);
  updateMenuUI();

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.05, (now - lastTime) / 1000);
    lastTime = now;

    update(dt);
    render();
    requestAnimationFrame(loop);
  }

  requestAnimationFrame(loop);
})();
