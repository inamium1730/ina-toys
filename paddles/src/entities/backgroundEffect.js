/**
 * 背景スクロール演出クラス
 * - ステージ2以降: 白い半透明のドット粒子が画面全体に広がった状態でゆっくり下へ流れる
 * - ステージ3以降: 雲のような半透明エフェクトが上から下へゆっくり流れる
 * - ステージ移行時: speedMultiplier に応じて高速トラベル演出を行う
 */
class BackgroundEffect {
  constructor() {
    this.dots = [];
    this.clouds = [];
    this.dotsInitialized = false;
    this.dotFadeAlpha = 0;
    this.cloudSpawnTimer = 0;
    this.speedMultiplier = 1;
  }

  reset() {
    this.dots = [];
    this.clouds = [];
    this.dotsInitialized = false;
    this.dotFadeAlpha = 0;
    this.cloudSpawnTimer = 0;
    this.speedMultiplier = 1;
  }

  createDot(randomY = false) {
    const { WIDTH, HEIGHT } = GAME_CONFIG;
    // 奥行き（パララックス）: 敵の下降速度(20px/s)より遅い遠景スピード(5〜18px/s)に設定
    const depth = Math.random(); // 0(遠景) 〜 1(近景)
    return {
      x: Math.random() * WIDTH,
      y: randomY ? Math.random() * HEIGHT : -6 - Math.random() * 16,
      vy: 5 + depth * 13,
      radius: 0.9 + depth * 1.6,
      alpha: 0.12 + depth * 0.28
    };
  }

  createCloud(randomY = false) {
    const { WIDTH, HEIGHT } = GAME_CONFIG;
    const depth = Math.random();
    const baseRadius = 60 + depth * 65;
    const puffCount = 5 + Math.floor(Math.random() * 4);
    const puffs = [];

    for (let i = 0; i < puffCount; i++) {
      const spreadX = (Math.random() - 0.5) * baseRadius * 2.1;
      const spreadY = (Math.random() - 0.5) * baseRadius * 0.95;
      const r = baseRadius * (0.55 + Math.random() * 0.65);
      puffs.push({
        ox: spreadX,
        oy: spreadY,
        r
      });
    }

    return {
      x: Math.random() * WIDTH,
      y: randomY ? Math.random() * HEIGHT : -baseRadius * 2.0 - Math.random() * 80,
      vx: (Math.random() - 0.5) * 3,
      vy: 8 + depth * 12, // 雲も非常にゆっくり下へ流れる (8〜20px/s)
      baseAlpha: 0.045 + depth * 0.055,
      maxExtent: baseRadius * 2.2,
      puffs
    };
  }

  update(dt, stageNumber, speedMultiplier = 1) {
    const { WIDTH, HEIGHT } = GAME_CONFIG;
    this.speedMultiplier = speedMultiplier;

    // ステージ2以降: 最初から画面いっぱいにドットを配置し、フェードインさせながら下へ流す
    if (stageNumber >= 2) {
      const maxDots = 75;
      if (!this.dotsInitialized) {
        this.dotsInitialized = true;
        for (let i = 0; i < maxDots; i++) {
          this.dots.push(this.createDot(true));
        }
      }

      if (this.dotFadeAlpha < 1) {
        const fadeSpeed = speedMultiplier > 1.5 ? 4.0 : 0.9;
        this.dotFadeAlpha = Math.min(1, this.dotFadeAlpha + dt * fadeSpeed);
      }

      for (let i = 0; i < this.dots.length; i++) {
        const d = this.dots[i];
        d.y += d.vy * speedMultiplier * dt;
        if (d.y - d.radius > HEIGHT + 24) {
          this.dots[i] = this.createDot(false);
          // 高速移動中に折り返したドットは画面上端付近から連続して入るようにする
          if (speedMultiplier > 2) {
            this.dots[i].y = -(this.dots[i].y % 20);
          }
        }
      }
    }

    // ステージ3以降: 雲のようなエフェクトを上から下へ流す
    if (stageNumber >= 3) {
      const maxClouds = 6;
      if (this.clouds.length < maxClouds) {
        this.cloudSpawnTimer += dt * Math.min(4, speedMultiplier);
        if (this.clouds.length === 0 || this.cloudSpawnTimer >= 3.2) {
          this.cloudSpawnTimer = 0;
          this.clouds.push(this.createCloud(false));
        }
      }

      for (let i = 0; i < this.clouds.length; i++) {
        const c = this.clouds[i];
        c.x += c.vx * dt;
        c.y += c.vy * speedMultiplier * dt;
        if (c.x < -c.maxExtent) c.x = WIDTH + c.maxExtent;
        if (c.x > WIDTH + c.maxExtent) c.x = -c.maxExtent;

        if (c.y - c.maxExtent > HEIGHT + 40) {
          this.clouds[i] = this.createCloud(false);
        }
      }
    }
  }

  render(ctx) {
    const { COLORS } = GAME_CONFIG;

    // 1. 雲エフェクト（背景の最背面）
    if (this.clouds.length > 0) {
      ctx.save();
      for (const c of this.clouds) {
        for (const p of c.puffs) {
          const px = c.x + p.ox;
          const py = c.y + p.oy;
          const grad = ctx.createRadialGradient(px, py, p.r * 0.1, px, py, p.r);
          grad.addColorStop(0, `rgba(255, 255, 255, ${c.baseAlpha})`);
          grad.addColorStop(0.55, `rgba(255, 255, 255, ${c.baseAlpha * 0.55})`);
          grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.arc(px, py, p.r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }

    // 2. 白い半透明のドット粒子（高速移動時は進行方向にわずかに伸びてトラベル感を演出）
    if (this.dots.length > 0 && this.dotFadeAlpha > 0) {
      ctx.save();
      const stretch = Math.max(0, (this.speedMultiplier - 1) * 0.65);
      if (stretch > 0.5) {
        ctx.strokeStyle = COLORS.white;
        ctx.lineCap = 'round';
        for (const d of this.dots) {
          ctx.globalAlpha = d.alpha * this.dotFadeAlpha;
          ctx.lineWidth = d.radius * 2;
          ctx.beginPath();
          ctx.moveTo(d.x, d.y - stretch * (d.vy * 0.04));
          ctx.lineTo(d.x, d.y + stretch * (d.vy * 0.04));
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = COLORS.white;
        for (const d of this.dots) {
          ctx.globalAlpha = d.alpha * this.dotFadeAlpha;
          ctx.beginPath();
          ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }
}
