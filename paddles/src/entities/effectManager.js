/**
 * パルス・パーティクル・パドル被弾時の残像＆三角形破砕演出を管理するクラス
 */
class EffectManager {
  constructor() {
    this.pulses = [];
    this.particles = [];
    this.damageTrails = [];
    this.shatterTriangles = [];
    this.onEvent = null;
  }

  emitEvent(type, payload) {
    if (this.onEvent) {
      this.onEvent(type, payload);
    }
  }

  reset() {
    this.pulses = [];
    this.particles = [];
    this.damageTrails = [];
    this.shatterTriangles = [];
  }

  spawnPulse(shapeData, emit = true) {
    this.pulses.push({
      kind: shapeData.kind, // 'rect' | 'circle' | 'item' | 'enemy'
      target: shapeData.target || null,
      x: shapeData.x,
      y: shapeData.y,
      w: shapeData.w || 0,
      h: shapeData.h || 0,
      radius: shapeData.radius || 0,
      angle: shapeData.angle || 0,
      subType: shapeData.subType || '',
      color: shapeData.color || GAME_CONFIG.COLORS.white,
      timer: 0,
      duration: shapeData.duration || 0.45,
      maxScale: shapeData.maxScale || 2.1
    });

    if (emit && this.onEvent) {
      const target = shapeData.target;
      let targetKind = null;
      let targetId = null;
      if (target && target.netKind) {
        targetKind = target.netKind;
        targetId = targetKind === 'paddle' ? target.slot : target.id;
      }
      this.emitEvent('fx_pulse', {
        kind: shapeData.kind,
        subType: shapeData.subType || '',
        x: Math.round(shapeData.x * 10) / 10,
        y: Math.round(shapeData.y * 10) / 10,
        w: shapeData.w || 0,
        h: shapeData.h || 0,
        radius: shapeData.radius || 0,
        angle: shapeData.angle || 0,
        color: shapeData.color || GAME_CONFIG.COLORS.white,
        duration: shapeData.duration || 0.45,
        maxScale: shapeData.maxScale || 2.1,
        targetKind,
        targetId
      });
    }
  }

  spawnCircleParticles(x, y, color, count = 8, speedMin = 40, speedMax = 160, emit = true) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speedMin + Math.random() * (speedMax - speedMin);
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        radius: 2 + Math.random() * 2.5,
        color,
        alpha: 1,
        timer: 0,
        duration: 0.35 + Math.random() * 0.25
      });
    }
    if (emit && this.onEvent) {
      this.emitEvent('fx_particles', {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        color,
        count,
        speedMin,
        speedMax
      });
    }
  }

  spawnRegenParticles(x, y, width, height, emit = true) {
    const color = GAME_CONFIG.COLORS.white;
    for (const side of [-1, 1]) {
      const edgeX = x + side * (width / 2);
      this.particles.push({
        x: edgeX,
        y: y + (Math.random() - 0.5) * height,
        vx: side * (22 + Math.random() * 38),
        vy: (Math.random() - 0.5) * 36,
        radius: 2.2 + Math.random() * 1.8,
        color,
        alpha: 0.95,
        timer: 0,
        duration: 0.38
      });
    }
    if (emit && this.onEvent) {
      this.emitEvent('fx_regen', {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        w: Math.round(width * 10) / 10,
        h: height
      });
    }
  }

  spawnPaddleShatterSection(xCenter, yCenter, width, height, originPaddleX, emit = true, targetPaddle = null) {
    if (width <= 0) return;
    const target = targetPaddle && targetPaddle.hp > 0 ? targetPaddle : null;
    this.damageTrails.push({
      x: xCenter,
      y: yCenter,
      w: width,
      h: height,
      originPaddleX,
      target,
      offsetX: target ? xCenter - target.x : xCenter - originPaddleX,
      offsetY: target ? yCenter - target.y : 0,
      timer: 0,
      holdDuration: 0.22
    });
    if (emit && this.onEvent) {
      this.emitEvent('fx_shatter', {
        x: Math.round(xCenter * 10) / 10,
        y: Math.round(yCenter * 10) / 10,
        w: Math.round(width * 10) / 10,
        h: height,
        originPaddleX: Math.round(originPaddleX * 10) / 10,
        slot: target && target.slot !== undefined ? target.slot : null
      });
    }
  }

  syncDamageTrailPosition(trail) {
    if (trail.target && trail.target.hp > 0) {
      trail.x = trail.target.x + trail.offsetX;
      trail.y = trail.target.y + trail.offsetY;
      trail.originPaddleX = trail.target.x;
    }
  }

  shatterTrailIntoTriangles(trail) {
    const cols = Math.max(2, Math.ceil(trail.w / 9));
    const cellW = trail.w / cols;
    const startX = trail.x - trail.w / 2;
    const topY = trail.y - trail.h / 2;

    for (let i = 0; i < cols; i++) {
      const x0 = startX + i * cellW;
      const x1 = x0 + cellW;
      const y0 = topY;
      const y1 = topY + trail.h;

      const tris = [
        [
          { x: x0, y: y0 },
          { x: x1, y: y0 },
          { x: x0, y: y1 }
        ],
        [
          { x: x1, y: y0 },
          { x: x1, y: y1 },
          { x: x0, y: y1 }
        ]
      ];

      for (const pts of tris) {
        const cx = (pts[0].x + pts[1].x + pts[2].x) / 3;
        const cy = (pts[0].y + pts[1].y + pts[2].y) / 3;
        const localPts = pts.map((p) => ({ x: p.x - cx, y: p.y - cy }));
        const spreadAngle = Math.atan2(cy - GAME_CONFIG.PADDLE.Y, cx - trail.originPaddleX) + (Math.random() - 0.5) * 1.4;
        const speed = 35 + Math.random() * 85;
        this.shatterTriangles.push({
          x: cx,
          y: cy,
          pts: localPts,
          vx: Math.cos(spreadAngle) * speed,
          vy: Math.sin(spreadAngle) * speed,
          rot: 0,
          vRot: (Math.random() - 0.5) * 8,
          scale: 1,
          alpha: 1,
          color: GAME_CONFIG.COLORS.red,
          timer: 0,
          duration: 0.6 + Math.random() * 0.25
        });
      }
    }
  }

  update(dt) {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const pls = this.pulses[i];
      pls.timer += dt;
      if (pls.timer >= pls.duration) {
        this.pulses.splice(i, 1);
      }
    }

    for (let i = this.damageTrails.length - 1; i >= 0; i--) {
      const tr = this.damageTrails[i];
      this.syncDamageTrailPosition(tr);
      tr.timer += dt;
      if (tr.timer >= tr.holdDuration) {
        this.shatterTrailIntoTriangles(tr);
        this.damageTrails.splice(i, 1);
      }
    }

    for (let i = this.shatterTriangles.length - 1; i >= 0; i--) {
      const tri = this.shatterTriangles[i];
      tri.timer += dt;
      tri.x += tri.vx * dt;
      tri.y += tri.vy * dt;
      tri.rot += tri.vRot * dt;
      const progress = tri.timer / tri.duration;
      tri.scale = Math.max(0, 1 - progress * 0.85);
      tri.alpha = Math.max(0, 1 - progress);
      if (tri.timer >= tri.duration) {
        this.shatterTriangles.splice(i, 1);
      }
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const pt = this.particles[i];
      pt.timer += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.alpha = Math.max(0, 1 - pt.timer / pt.duration);
      if (pt.timer >= pt.duration) {
        this.particles.splice(i, 1);
      }
    }
  }

  renderPulses(ctx) {
    for (const pls of this.pulses) {
      const t = ColorUtils.clamp(pls.timer / pls.duration, 0, 1);
      const scale = 1 + (pls.maxScale - 1) * t;
      const alpha = (1 - t) * 0.55;

      // 追従対象(target)がある場合は、現在の座標・角度をリアルタイムに参照して置いていかれないようにする
      const px = pls.target ? pls.target.x : pls.x;
      const py = pls.target ? pls.target.y : pls.y;
      const pAngle = pls.target
        ? (pls.target.angle !== undefined ? pls.target.angle : (pls.target.rotation !== undefined ? pls.target.rotation : pls.angle))
        : pls.angle;

      if (pls.kind === 'rect') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pls.color;
        const baseW = (pls.target && pls.target.currentWidth > 0) ? pls.target.currentWidth : pls.w;
        const w = baseW * scale;
        const h = pls.h * scale;
        ctx.fillRect(px - w / 2, py - h / 2, w, h);
        ctx.restore();
      } else if (pls.kind === 'circle') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pls.color;
        const baseR = (pls.target && pls.target.radius > 0) ? pls.target.radius : pls.radius;
        ctx.beginPath();
        ctx.arc(px, py, baseR * scale, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else if (pls.kind === 'item') {
        ShapeRenderer.drawItemShape(ctx, pls.subType, px, py, pls.radius * scale, pAngle, pls.color, alpha);
      } else if (pls.kind === 'enemy') {
        ShapeRenderer.drawEnemyShape(ctx, pls.subType, px, py, pls.radius * scale, pAngle, pls.color, alpha);
      } else if (pls.kind === 'boss_head') {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = pls.color;
        const cosA = Math.cos(pAngle);
        const sinA = Math.sin(pAngle);
        const halfBase = (pls.w || 126) * scale;
        const len = (pls.h || 260) * scale;
        const centerDist = 110;
        const cx = px - sinA * centerDist;
        const cy = py - cosA * centerDist;
        const tipDist = centerDist * scale;
        const backDist = (len - centerDist) * scale;

        const tipX = cx + sinA * tipDist;
        const tipY = cy + cosA * tipDist;
        const baseCenterX = cx - sinA * backDist;
        const baseCenterY = cy - cosA * backDist;

        const tlX = baseCenterX - cosA * halfBase;
        const tlY = baseCenterY + sinA * halfBase;
        const trX = baseCenterX + cosA * halfBase;
        const trY = baseCenterY - sinA * halfBase;

        ctx.beginPath();
        ctx.moveTo(tlX, tlY);
        ctx.lineTo(trX, trY);
        ctx.lineTo(tipX, tipY);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }
  }

  renderDamageEffects(ctx) {
    ctx.save();
    for (const tr of this.damageTrails) {
      this.syncDamageTrailPosition(tr);
      ctx.fillStyle = GAME_CONFIG.COLORS.red;
      ctx.globalAlpha = 0.88;
      ctx.fillRect(tr.x - tr.w / 2, tr.y - tr.h / 2, tr.w, tr.h);
    }
    ctx.restore();

    for (const tri of this.shatterTriangles) {
      ctx.save();
      ctx.translate(tri.x, tri.y);
      ctx.rotate(tri.rot);
      ctx.scale(tri.scale, tri.scale);
      ctx.globalAlpha = tri.alpha;
      ctx.fillStyle = tri.color;
      ctx.beginPath();
      ctx.moveTo(tri.pts[0].x, tri.pts[0].y);
      ctx.lineTo(tri.pts[1].x, tri.pts[1].y);
      ctx.lineTo(tri.pts[2].x, tri.pts[2].y);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  renderParticles(ctx) {
    for (const pt of this.particles) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}

