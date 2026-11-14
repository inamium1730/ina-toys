/**
 * アイテムクラスおよび抽選スポーン管理
 */
class Item {
  constructor(x, y, type, color, customId) {
    Item.nextId = (Item.nextId || 0) + 1;
    this.netKind = 'item';
    this.id = customId !== undefined ? customId : Item.nextId;
    this.x = x;
    this.y = y;
    this.type = type;
    this.color = color;
    this.angle = 0;
    this.pulseTimer = 0;
  }

  static getColorForType(type) {
    const { COLORS } = GAME_CONFIG;
    const table = {
      cyan_star: COLORS.cyan,
      yellow_star: COLORS.yellow,
      green_star: COLORS.green,
      blue_circle: COLORS.blue,
      pink_heart: COLORS.pink,
      purple_square: COLORS.purple
    };
    return table[type] || COLORS.white;
  }

  static getEnemyDropChance(stageData) {
    const { ITEM } = GAME_CONFIG;
    if (!stageData || !stageData.spawn_limit || stageData.spawn_limit <= 0) {
      return 0;
    }
    const baseInterval = (ITEM && ITEM.ENEMY_BASE_INTERVAL) || 19.5;
    const interval = (typeof stageData.spawn_interval === 'number' && stageData.spawn_interval > 0)
      ? stageData.spawn_interval
      : baseInterval;
    return ColorUtils.clamp(baseInterval / (interval * stageData.spawn_limit), 0, 1);
  }

  static maybeSpawn(x, y, dropChance, items, purplePaddle, forcedType = null) {
    if (Math.random() > dropChance) return null;

    if (forcedType) {
      return new Item(x, y, forcedType, Item.getColorForType(forcedType));
    }

    const { PURPLE_PADDLE } = GAME_CONFIG;
    const fallingPurpleCount = items.filter((it) => it.type === 'purple_square').length;
    const currentPurpleBounces = purplePaddle ? purplePaddle.bounces : 0;
    const canSpawnPurple = (fallingPurpleCount + currentPurpleBounces) < PURPLE_PADDLE.MAX_UNITS;

    const pool = [
      { type: 'cyan_star', weight: 1.0 },
      { type: 'yellow_star', weight: 1.0 },
      { type: 'green_star', weight: 1.0 },
      { type: 'blue_circle', weight: 0.85 },
      { type: 'pink_heart', weight: 0.85 }
    ];

    if (canSpawnPurple) {
      pool.push({ type: 'purple_square', weight: 1.1 });
    }

    const totalWeight = pool.reduce((acc, entry) => acc + entry.weight, 0);
    let r = Math.random() * totalWeight;
    let chosen = pool[0];
    for (const entry of pool) {
      if (r <= entry.weight) {
        chosen = entry;
        break;
      }
      r -= entry.weight;
    }

    return new Item(x, y, chosen.type, Item.getColorForType(chosen.type));
  }

  update(dt, paddles, effectsManager, onCollect) {
    const { HEIGHT, ITEM } = GAME_CONFIG;
    const paddleList = Array.isArray(paddles) ? paddles : (paddles ? [paddles] : []);
    this.y += ITEM.FALL_SPEED * dt;
    this.angle += ITEM.ROTATION_SPEED * dt; // ゆっくり右回転しながら降下
    this.pulseTimer += dt;

    // 0.5秒おきにパルスアニメーション
    if (this.pulseTimer >= ITEM.PULSE_INTERVAL) {
      this.pulseTimer -= ITEM.PULSE_INTERVAL;
      effectsManager.spawnPulse({
        kind: 'item',
        target: this,
        subType: this.type,
        x: this.x,
        y: this.y,
        radius: ITEM.RADIUS,
        angle: this.angle,
        color: this.color,
        duration: 0.45,
        maxScale: 2.2
      });
    }

    // パドルとの接触取得判定 (複数重なり時は重なり取得数が最小の人を優先、同数はランダム)
    const collectors = [];
    for (const p of paddleList) {
      if (!p || p.hp <= 0) continue;
      const pLeft = p.x - p.currentWidth / 2 - ITEM.RADIUS;
      const pRight = p.x + p.currentWidth / 2 + ITEM.RADIUS;
      const pTop = p.y - p.height / 2 - ITEM.RADIUS;
      const pBottom = p.y + p.height / 2 + ITEM.RADIUS;

      if (this.x >= pLeft && this.x <= pRight && this.y >= pTop && this.y <= pBottom) {
        collectors.push(p);
      }
    }

    if (collectors.length > 0) {
      let chosen;
      if (collectors.length === 1) {
        chosen = collectors[0];
      } else {
        let minCount = Infinity;
        for (const p of collectors) {
          const count = p.contestedItemsCount || 0;
          if (count < minCount) {
            minCount = count;
          }
        }
        const candidates = collectors.filter((p) => (p.contestedItemsCount || 0) === minCount);
        chosen = candidates[Math.floor(Math.random() * candidates.length)];
        chosen.contestedItemsCount = (chosen.contestedItemsCount || 0) + 1;
      }
      onCollect(this, chosen);
      return false;
    }

    if (this.y - ITEM.RADIUS > HEIGHT + 20) {
      return false;
    }

    return true;
  }

  render(ctx) {
    ShapeRenderer.drawItemShape(
      ctx,
      this.type,
      this.x,
      this.y,
      GAME_CONFIG.ITEM.RADIUS,
      this.angle,
      this.color,
      1
    );
  }
}

