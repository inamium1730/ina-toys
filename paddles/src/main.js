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

  const { WIDTH, HEIGHT, COLORS, PADDLE, BALL, BLOCKS, ITEM, ENEMY } = GAME_CONFIG;

  const input = {
    left: false,
    right: false,
    pointerX: null
  };

  const effectsManager = new EffectManager();
  const backgroundEffect = new BackgroundEffect();

  const DAMAGE_SHAKE_DURATION = 0.11;
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
    paddles: [],
    purplePaddle: null,
    balls: [],
    blocks: [],
    enemies: [],
    enemyBullets: [],
    items: [],
    transition: null,
    remoteTransitionSnap: null,
    endScreenPlayerNames: []
  };

  let copyFeedbackTimer = null;
  let guestInputSeq = 0;
  let guestInputSendTimer = 0;
  let lastSentInputKey = '';
  let hostSnapSendTimer = 0;
  let hostSnapTick = 0;
  let guestLastSnapTick = -1;
  let guestWarpingFlag = false;
  let menuVisualPaddles = [];
  let gameInProgressHintTimer = 0;

  // ============================================================================
  // ニックネーム・WebRTCマルチプレイ管理初期化
  // ============================================================================
  function loadSavedNickname() {
    try {
      return sessionStorage.getItem(NICKNAME_STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function saveNickname(val) {
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
    onPeerJoined: () => {
      syncMenuVisualPaddles(false);
      updateMenuUI();
    },
    onPeerLeft: (slot) => {
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
        for (const blk of game.blocks) {
          if (blk.alive && (blk.scale === undefined || blk.scale >= 1)) {
            blk.collidable = true;
            blk.spawning = false;
          }
        }
        if (game.remoteTransitionSnap) {
          const [phase, timer, pendingIds] = game.remoteTransitionSnap;
          const stageData = MAPS[game.stageIndex % MAPS.length];
          const fullStage = buildStageBlocks(stageData, false);
          const pendingSet = new Set(pendingIds || []);
          game.transition = {
            phase,
            timer: timer || 0,
            pendingBlocks: fullStage.filter((b) => pendingSet.has(b.id))
          };
          game.remoteTransitionSnap = null;
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
    }
  });

  // Hostのエフェクト生成を自動でゲストへ転送するフック
  effectsManager.onEvent = (type, payload) => {
    if (mp.mode === 'host' && game.state === 'playing') {
      mp.broadcastCtrl({ type, ...payload });
    }
  };

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
  }

  // URLパラメータ (?room=XXXXXX または #room=XXXXXX) からの自動参加
  function checkInitialRoomParam() {
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
    const canPressPlay = isEndScreen || (hasName && (mp.mode !== 'guest' || mp.connectionStatus === 'connected'));

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

  function buildStageBlocks(stageData, spawnedImmediately = true) {
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
            scale: spawnedImmediately ? 1 : 0
          });
        }
      }
    }
    return list;
  }

  function forceDestroyEnemy(enemy) {
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
        maybeSpawnItem(blk.x, blk.y, 0.26);
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
    game.paddles = [];
    game.purplePaddle = null;
    game.balls = [];
    game.blocks = [];
    game.enemies = [];
    game.enemyBullets = [];
    game.items = [];
    game.transition = null;
    game.remoteTransitionSnap = null;
    game.endScreenPlayerNames = [];
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
  });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'KeyA' || e.code === 'ArrowLeft') {
      input.left = false;
    }
    if (e.code === 'KeyD' || e.code === 'ArrowRight') {
      input.right = false;
    }
  });

  canvas.addEventListener('pointerdown', (e) => {
    if (game.state !== 'playing') return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    isPointerDown = true;
    updatePointerFromClientX(e.clientX);
    if (canvas.setPointerCapture) {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch (_) {}
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (game.state !== 'playing' || !isPointerDown) return;
    updatePointerFromClientX(e.clientX);
  });

  window.addEventListener('pointerup', () => {
    isPointerDown = false;
  });

  window.addEventListener('pointercancel', () => {
    isPointerDown = false;
  });

  canvas.addEventListener('touchstart', (e) => {
    if (game.state !== 'playing') return;
    if (e.touches.length > 0) {
      e.preventDefault();
      isPointerDown = true;
      updatePointerFromClientX(e.touches[0].clientX);
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    if (game.state !== 'playing' || !isPointerDown) return;
    if (e.touches.length > 0) {
      e.preventDefault();
      updatePointerFromClientX(e.touches[0].clientX);
    }
  }, { passive: false });

  window.addEventListener('touchend', () => {
    isPointerDown = false;
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
    game.score = 0;
    game.displayedScore = 0;
    game.stageIndex = 0;
    game.stageNumber = 1;
    game.menuTitleAlpha = 1;
    game.tagTransition = 0;
    game.endScreenPlayerNames = [];
    game.remoteTransitionSnap = null;
    loadStage(0);

    if (mp.mode === 'host') {
      mp.broadcastCtrl({
        type: 'start_game',
        stageIndex: 0,
        players: mp.serializePlayers()
      });
      broadcastStageBlockLayout();
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
      layout: allBlocks.map((b) => [b.id, Math.round(b.x), Math.round(b.y), b.w, b.h])
    });
  }

  function loadStage(index) {
    const stageData = MAPS[index % MAPS.length];
    game.stageIndex = index;
    game.stageNumber = index + 1;
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

    // ステージ開始時もブロックが1つずつEaseOutBackでポップアップして登場する
    game.blocks = [];
    game.transition = {
      phase: 'spawning_blocks',
      timer: 0,
      pendingBlocks: buildStageBlocks(stageData, false)
    };
  }

  function startNextStageTransition() {
    game.transition = {
      phase: 'killing_enemies', // 'killing_enemies' -> 'waiting_before_blocks' -> 'spawning_blocks'
      timer: 0,
      pendingBlocks: []
    };
  }

  function reviveDeadPaddles() {
    const maxHp = MultiplayerManager.getMaxHpForCount(Math.max(1, game.paddles.length));
    for (const p of game.paddles) {
      if (p.hp <= 0) {
        p.revive(maxHp, effectsManager);
      }
    }
  }

  function updateStageTransition(dt) {
    const tr = game.transition;
    if (!tr) return;

    if (tr.phase === 'killing_enemies') {
      if (game.enemies.length === 0) {
        tr.phase = 'waiting_before_blocks';
        tr.timer = 0;
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
        tr.phase = 'waiting_before_blocks';
        tr.timer = 0;
      }
    } else if (tr.phase === 'waiting_before_blocks') {
      tr.timer += dt;
      const maxWarpMult = 65;

      // 0〜1.0秒: EaseInで背景を高速加速 / 1.0〜2.0秒: EaseOutで元の速度へ戻す（画面揺れなし）
      if (tr.timer < 1.0) {
        const u = ColorUtils.clamp(tr.timer / 1.0, 0, 1);
        const eased = easeInCubic(u);
        game.warpSpeedMultiplier = 1 + (maxWarpMult - 1) * eased;
      } else if (tr.timer < 2.0) {
        const u = ColorUtils.clamp((tr.timer - 1.0) / 1.0, 0, 1);
        const eased = easeOutCubic(u);
        game.warpSpeedMultiplier = maxWarpMult - (maxWarpMult - 1) * eased;
      } else {
        game.warpSpeedMultiplier = 1;
        game.stageIndex += 1;
        game.stageNumber = game.stageIndex + 1;
        // 次のステージ開始という節目で、HP0になっていたパドルを復活させる
        reviveDeadPaddles();
        const nextStageData = MAPS[game.stageIndex % MAPS.length];
        game.blocks = [];
        tr.pendingBlocks = buildStageBlocks(nextStageData, false);
        tr.phase = 'spawning_blocks';
        tr.timer = 0;
        broadcastStageBlockLayout();
      }
    } else if (tr.phase === 'spawning_blocks') {
      tr.timer += dt;
      while (tr.timer >= 0.05 && tr.pendingBlocks.length > 0) {
        tr.timer -= 0.05;
        const randIdx = Math.floor(Math.random() * tr.pendingBlocks.length);
        const [blk] = tr.pendingBlocks.splice(randIdx, 1);
        game.blocks.push(blk);
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
      }
    }
  }

  function endGame(state) {
    game.endScreenPlayerNames = captureEndScreenPlayerNames();
    game.state = state;
    if (mp.mode === 'host') {
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

  function damagePaddle(targetPaddle, damageAmount) {
    if (targetPaddle && targetPaddle.takeDamage(damageAmount, effectsManager)) {
      if (targetPaddle.isLocal) {
        triggerLocalHitFeedback();
      } else if (mp.mode === 'host') {
        mp.broadcastCtrl({ type: 'paddle_hit', slot: targetPaddle.slot });
      }
    }
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

  function maybeSpawnItem(x, y, dropChance) {
    const item = Item.maybeSpawn(x, y, dropChance, game.items, game.purplePaddle);
    if (item) {
      game.items.push(item);
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
    if (!force && hostSnapSendTimer < 0.018) return;
    hostSnapSendTimer = 0;
    hostSnapTick += 1;

    const r1 = (v) => Math.round(v * 10) / 10;
    const r2 = (v) => Math.round(v * 100) / 100;

    // ブロック状態: 各レイアウトIDに対して 0=非表示/破壊済み, 1=出現完了, scaling=[[id, scale]]
    const allBlocks = game.transition && game.transition.pendingBlocks
      ? game.blocks.concat(game.transition.pendingBlocks)
      : game.blocks;
    const totalCount = allBlocks.reduce((acc, b) => Math.max(acc, b.id + 1), 0);
    const maskArr = new Array(totalCount).fill('0');
    const scaling = [];
    for (const b of game.blocks) {
      if (!b.alive) continue;
      if (b.spawning) {
        scaling.push([b.id, Math.round(b.scale * 1000) / 1000]);
      } else {
        maskArr[b.id] = '1';
      }
    }

    const isWarpingToNext = !!(game.transition && (
      game.transition.phase === 'killing_enemies' ||
      game.transition.phase === 'waiting_before_blocks'
    ));

    mp.broadcastSync({
      type: 'snap',
      t: hostSnapTick,
      st: game.state,
      si: game.stageIndex,
      sn: game.stageNumber,
      sc: game.score,
      lv: game.lives,
      wm: r2(game.warpSpeedMultiplier),
      w: isWarpingToNext ? 1 : 0,
      bm: maskArr.join(''),
      bs: scaling,
      ps: game.paddles.map((p) => [
        p.slot,
        r1(p.x),
        r2(p.hp),
        p.maxHp,
        r1(p.currentWidth),
        r2(p.effectClock),
        r2(p.effects.cyan),
        r2(p.effects.yellow),
        r2(p.effects.green),
        p.nickname,
        p.contestedItemsCount || 0,
        r2(p.timeSinceLastDamage || 0)
      ]),
      pp: game.purplePaddle
        ? [r1(game.purplePaddle.x), r1(game.purplePaddle.width), game.purplePaddle.bounces]
        : null,
      bl: game.balls.map((b) => [
        b.id,
        r1(b.x),
        r1(b.y),
        r1(b.vx),
        r1(b.vy),
        r1(b.radius),
        r2(b.effectClock),
        r2(b.effects.cyan),
        r2(b.effects.yellow),
        r2(b.effects.green)
      ]),
      en: game.enemies.map((e) => [
        e.id,
        e.name,
        r1(e.x),
        r1(e.y),
        r1(e.vx),
        r1(e.vy),
        r1(e.currentRadius),
        r2(e.rotation),
        e.health,
        e.maxHealth,
        e.bullet_type,
        r2(e.timeAlive)
      ]),
      eb: game.enemyBullets.map((b) => [r1(b.x), r1(b.y), r2(b.timer || 0), r1(b.vx || 0), r1(b.vy || 0), b.damage || 1]),
      it: game.items.map((it) => [it.id, it.type, r1(it.x), r1(it.y), r2(it.angle), it.color]),
      tr: game.transition
        ? [game.transition.phase, r2(game.transition.timer || 0), (game.transition.pendingBlocks || []).map((b) => b.id)]
        : null
    });
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
    return null;
  }

  function handleGuestCtrlEvent(msg) {
    if (!msg || !msg.type) return;

    if (msg.type === 'start_game') {
      guestLastSnapTick = -1;
      guestWarpingFlag = false;
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
      game.enemyBullets = [];
      game.items = [];
      game.blocks = [];
      game.blocksStageIndex = -1;
      game.purplePaddle = null;
      input.pointerX = null;
      effectsManager.reset();
      backgroundEffect.reset();
      mp.localReady = false;

      const roster = (msg.players || mp.players).map((p) => ({
        ...p,
        isLocal: p.peerId === mp.localPeerId || p.slot === mp.assignedSlot
      }));
      game.paddles = buildPaddlesFromRoster(roster);
      updateMenuUI();
    } else if (msg.type === 'stage_init') {
      game.stageIndex = msg.stageIndex;
      game.stageNumber = msg.stageNumber;
      game.blocksStageIndex = msg.stageIndex;
      game.blocks = (msg.layout || []).map(([id, x, y, w, h]) => ({
        id,
        x,
        y,
        w,
        h,
        alive: false,
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
      effectsManager.spawnPaddleShatterSection(msg.x, msg.y, msg.w, msg.h, msg.originPaddleX, false);
    } else if (msg.type === 'end_game') {
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

  function applyGuestSnapshot(snap) {
    if (!snap || snap.t <= guestLastSnapTick) return;
    guestLastSnapTick = snap.t;

    game.score = snap.sc;
    game.lives = snap.lv;
    game.stageIndex = snap.si;
    game.stageNumber = snap.sn;
    game.warpSpeedMultiplier = snap.wm;
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

    // パドル同期 (インプレース更新)
    const nextPaddles = [];
    const totalCount = Math.max(1, snap.ps.length);
    for (const row of snap.ps) {
      const [slot, x, hp, maxHp, cw, clk, cyan, yellow, green, nick, contestedCnt, regenTime] = row;
      let p = game.paddles.find((item) => item.slot === slot);
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
      p.targetServerX = x;
      if (!p.isLocal) {
        if (Math.abs(x - p.x) > 40) p.x = x;
      } else if (p.hp <= 0 && hp > 0) {
        p.x = x;
      }
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
      nextPaddles.push(p);
    }
    game.paddles = nextPaddles;

    // サブパドル
    if (snap.pp) {
      if (!game.purplePaddle) {
        game.purplePaddle = new PurplePaddle(snap.pp[0]);
      }
      game.purplePaddle.x = snap.pp[0];
      game.purplePaddle.width = snap.pp[1];
      game.purplePaddle.targetWidth = snap.pp[1];
      game.purplePaddle.bounces = snap.pp[2];
    } else {
      game.purplePaddle = null;
    }

    // ボール同期 (インプレース更新し、IDが維持されるためパルス追従・緑残像が途切れない)
    const nextBalls = [];
    for (const row of snap.bl) {
      const [id, x, y, vx, vy, r, clk, cyan, yellow, green] = row;
      let ball = game.balls.find((item) => item.id === id);
      if (!ball) {
        ball = new Ball(x, y, vx, vy, id);
      }
      ball.x = x;
      ball.y = y;
      ball.vx = vx;
      ball.vy = vy;
      ball.radius = r;
      ball.effectClock = clk;
      ball.effects.cyan = cyan;
      ball.effects.yellow = yellow;
      ball.effects.green = green;
      ball.snapAge = 0;
      nextBalls.push(ball);
    }
    game.balls = nextBalls;

    // ブロック同期
    if ((game.blocks.length === 0 || game.blocksStageIndex !== snap.si) && snap.bm && snap.bm.length > 0) {
      const fallbackStage = MAPS[snap.si % MAPS.length];
      game.blocks = buildStageBlocks(fallbackStage, false);
      game.blocksStageIndex = snap.si;
    }
    const scaleMap = new Map();
    if (snap.bs) {
      for (const [id, s] of snap.bs) {
        scaleMap.set(id, s);
      }
    }
    const mask = snap.bm || '';
    for (const blk of game.blocks) {
      if (scaleMap.has(blk.id)) {
        blk.alive = true;
        blk.scale = scaleMap.get(blk.id);
        blk.collidable = false;
        blk.spawning = true;
      } else if (mask[blk.id] === '1') {
        blk.alive = true;
        blk.scale = 1;
        blk.collidable = true;
        blk.spawning = false;
      } else {
        blk.alive = false;
        blk.scale = 0;
        blk.collidable = false;
        blk.spawning = false;
      }
    }

    // エネミー同期
    const nextEnemies = [];
    for (const row of snap.en) {
      const [id, name, x, y, vx, vy, r, rot, hp, maxHp, bulletType, timeAlive] = row;
      let en = game.enemies.find((item) => item.id === id);
      const def = ENEMIES[name] || { name, bullet_type: bulletType, movement_type: 'fall', health: maxHp, damage: 2, fire_rate: 0 };
      if (!en) {
        en = new Enemy(def, x, id);
      }
      en.x = x;
      en.y = y;
      en.vx = vx;
      en.vy = vy;
      en.currentRadius = r;
      en.targetRadius = r;
      en.rotation = rot;
      en.health = hp;
      en.maxHealth = maxHp;
      en.bullet_type = def.bullet_type;
      en.movement_type = def.movement_type;
      en.damage = def.damage;
      en.timeAlive = timeAlive;
      nextEnemies.push(en);
    }
    game.enemies = nextEnemies;

    // 敵弾同期
    game.enemyBullets = snap.eb.map(([x, y, timer, vx, vy, dmg]) => ({
      x,
      y,
      timer,
      vx: vx || 0,
      vy: vy || 0,
      damage: dmg || 1
    }));
    game.remoteTransitionSnap = snap.tr || null;

    // アイテム同期
    const nextItems = [];
    for (const row of snap.it) {
      const [id, type, x, y, angle, color] = row;
      let it = game.items.find((item) => item.id === id);
      if (!it) {
        it = new Item(x, y, type, color, id);
      }
      it.x = x;
      it.y = y;
      it.angle = angle;
      it.color = color;
      nextItems.push(it);
    }
    game.items = nextItems;
  }

  function updateGuest(dt) {
    if (game.state === 'playing') {
      // 自分の入力をホストへ高頻度送信
      guestInputSendTimer += dt;
      const inputKey = `${input.left ? 1 : 0}_${input.right ? 1 : 0}_${input.pointerX !== null ? Math.round(input.pointerX) : 'n'}`;
      if (inputKey !== lastSentInputKey || guestInputSendTimer >= 0.02) {
        lastSentInputKey = inputKey;
        guestInputSendTimer = 0;
        guestInputSeq += 1;
        mp.sendToHostInput(guestInputSeq, input);
      }

      // ローカル予測 & 補間による滑らかな表示
      for (const p of game.paddles) {
        if (p.hp <= 0) continue;
        if (p.isLocal) {
          p.moveHorizontal(dt, input);
          if (typeof p.targetServerX === 'number') {
            const diff = p.targetServerX - p.x;
            if (Math.abs(diff) > 52) {
              p.x = p.targetServerX;
            } else {
              p.x += diff * Math.min(1, dt * 14);
            }
          }
        } else if (typeof p.targetServerX === 'number') {
          p.x += (p.targetServerX - p.x) * Math.min(1, dt * 22);
        }
      }

      for (const ball of game.balls) {
        ball.snapAge = (ball.snapAge || 0) + dt;
        if (ball.snapAge <= 0.045) {
          ball.x = ColorUtils.clamp(ball.x + ball.vx * dt, ball.radius, WIDTH - ball.radius);
          ball.y = Math.max(ball.radius, ball.y + ball.vy * dt);
        }
        ball.updateAfterimages(dt);
      }

      for (const b of game.enemyBullets) {
        b.timer = (b.timer || 0) + dt;
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
        const bgStageNumber = guestWarpingFlag
          ? Math.max(game.stageNumber, game.stageIndex + 2)
          : game.stageNumber;
        backgroundEffect.update(dt, bgStageNumber, game.warpSpeedMultiplier);
        updateGuest(dt);
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

    const stageData = MAPS[game.stageIndex % MAPS.length];

    // 1. 全プレイヤーパドル更新
    for (const p of game.paddles) {
      const pInput = p.isLocal
        ? input
        : (mp.remoteInputs.get(p.slot) || { left: false, right: false, pointerX: null });
      p.update(dt, pInput, effectsManager);
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
    for (let i = game.enemies.length - 1; i >= 0; i--) {
      const alive = game.enemies[i].update(dt, game.paddles, game.enemyBullets, effectsManager, damagePaddle);
      if (!alive) {
        game.enemies.splice(i, 1);
      }
    }

    // 4. 敵弾更新（ヒット判定は1px、パドルは見た目通り。重なり時は双方にダメージ）
    for (let i = game.enemyBullets.length - 1; i >= 0; i--) {
      const b = game.enemyBullets[i];
      b.timer = (b.timer || 0) + dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;

      let hitAny = false;
      for (const p of game.paddles) {
        if (!p || p.hp <= 0) continue;
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
        game.enemyBullets.splice(i, 1);
        continue;
      }

      if (b.y > HEIGHT + 16 || b.x < -16 || b.x > WIDTH + 16) {
        game.enemyBullets.splice(i, 1);
      }
    }

    // 5. アイテム更新
    for (let i = game.items.length - 1; i >= 0; i--) {
      const alive = game.items[i].update(dt, game.paddles, effectsManager, applyItemEffect);
      if (!alive) {
        game.items.splice(i, 1);
      }
    }

    // 6. ボール更新
    const ballContext = {
      paddles: game.paddles,
      purplePaddle: () => game.purplePaddle,
      blocks: game.blocks,
      enemies: game.enemies,
      effectsManager,
      onScore: (pts) => {
        game.score += pts;
      },
      onSpawnItem: maybeSpawnItem,
      onClearPurplePaddle: () => {
        game.purplePaddle = null;
      }
    };

    for (let i = game.balls.length - 1; i >= 0; i--) {
      const alive = game.balls[i].update(dt, ballContext);
      if (!alive) {
        game.balls.splice(i, 1);
      }
    }

    // すべてのボールが落下した場合:
    // マルチプレイでパドルHPが0になったら、次のステージ／全滅してボールが落ちる／リセット等の節目まで復活しない
    if (game.balls.length === 0) {
      if (game.lives > 0) {
        game.lives -= 1;
        const allDead = game.paddles.every((p) => p.hp <= 0);
        if (allDead) {
          reviveDeadPaddles();
        }
        const alivePaddles = game.paddles.filter((p) => p.hp > 0);
        if (alivePaddles.length === 0 && game.paddles.length === 0) return;
        const newBall = Ball.createCenterSpawn();
        game.balls.push(newBall);
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

    // 8. マルチプレイホスト時の状態同期送信
    if (mp.mode === 'host') {
      hostSnapSendTimer += dt;
      sendHostSnapshot(false);
    }
  }

  // ============================================================================
  // 描画処理 (数字と図形のみで表現)
  // ============================================================================
  function render() {
    ctx.clearRect(0, 0, WIDTH, HEIGHT);

    ctx.save();
    const damageShake = game.shakeTimer > 0 ? (game.shakeTimer / DAMAGE_SHAKE_DURATION) * game.shakeMagnitude : 0;
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
  }

  function renderPlayfield() {
    // 0. 背景スクロール演出（ステージ2以降のドット粒子・ステージ3以降の雲エフェクト）
    backgroundEffect.render(ctx);

    // 1. パルスアニメーション
    effectsManager.renderPulses(ctx);

    // 2. ブロック (スケールイン対応)
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
    ctx.restore();

    // 3. アイテム
    for (const it of game.items) {
      it.render(ctx);
    }

    // 4. エネミー
    for (const e of game.enemies) {
      e.render(ctx);
    }

    // 5. 敵弾 (中をくり抜いた丸形、0.5秒サイクルで赤→白点滅、イージングなし・当たり判定1px)
    ctx.save();
    ctx.lineWidth = 2.5;
    for (const b of game.enemyBullets) {
      const phase = (b.timer || 0) % ENEMY.BLINK_CYCLE;
      ctx.fillStyle = '#000000';
      ctx.strokeStyle = phase < ENEMY.BLINK_CYCLE / 2 ? COLORS.red : COLORS.white;
      ctx.beginPath();
      ctx.arc(b.x, b.y, ENEMY.BULLET_VISUAL_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
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
    const maxHp = MultiplayerManager.getMaxHpForCount(count);
    const targetW = maxHp * PADDLE.WIDTH_PER_HP;
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
