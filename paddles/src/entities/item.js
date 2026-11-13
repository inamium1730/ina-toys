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

  static maybeSpawn(x, y, dropChance, items, purplePaddle) {
    if (Math.random() > dropChance) return null;

    const { COLORS, PURPLE_PADDLE } = GAME_CONFIG;
    const fallingPurpleCount = items.filter((it) => it.type === 'purple_square').length;
    const currentPurpleBounces = purplePaddle ? purplePaddle.bounces : 0;
    const canSpawnPurple = (fallingPurpleCount + currentPurpleBounces) < PURPLE_PADDLE.MAX_UNITS;

    const pool = [
      { type: 'cyan_star', color: COLORS.cyan, weight: 1.0 },
      { type: 'yellow_star', color: COLORS.yellow, weight: 1.0 },
      { type: 'green_star', color: COLORS.green, weight: 1.0 },
      { type: 'blue_circle', color: COLORS.blue, weight: 0.85 },
      { type: 'pink_heart', color: COLORS.pink, weight: 0.85 }
    ];

    if (canSpawnPurple) {
      pool.push({ type: 'purple_square', color: COLORS.purple, weight: 1.1 });
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

    return new Item(x, y, chosen.type, chosen.color);
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

