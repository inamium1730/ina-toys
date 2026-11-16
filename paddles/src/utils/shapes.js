/**
 * 図形描画ユーティリティクラス（文字を使わず図形のみで表現）
 */
class ShapeRenderer {
  static drawPolygonPath(ctx, x, y, radius, sides, rotation = 0) {
    ctx.beginPath();
    for (let i = 0; i < sides; i++) {
      const a = rotation + (i * Math.PI * 2) / sides;
      const px = x + Math.cos(a) * radius;
      const py = y + Math.sin(a) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  static drawStarPath(ctx, x, y, outerRadius, innerRadius, points = 5, rotation = -Math.PI / 2) {
    ctx.beginPath();
    const step = Math.PI / points;
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      const a = rotation + i * step;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  static drawHeartPath(ctx, x, y, size, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const s = size * 0.065;
    ctx.beginPath();
    for (let t = 0; t <= Math.PI * 2 + 0.05; t += 0.15) {
      const hx = 16 * Math.pow(Math.sin(t), 3) * s;
      const hy = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) * s;
      if (t === 0) ctx.moveTo(hx, hy);
      else ctx.lineTo(hx, hy);
    }
    ctx.closePath();
    ctx.restore();
  }

  static drawItemShape(ctx, type, x, y, radius, angle, color, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;

    if (type === 'cyan_star' || type === 'yellow_star' || type === 'green_star') {
      ShapeRenderer.drawStarPath(ctx, x, y, radius * 1.15, radius * 0.48, 5, angle - Math.PI / 2);
      ctx.fill();
    } else if (type === 'blue_circle') {
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.9, 0, Math.PI * 2);
      ctx.fill();
    } else if (type === 'pink_heart') {
      ShapeRenderer.drawHeartPath(ctx, x, y, radius * 1.05, angle);
      ctx.fill();
    } else if (type === 'purple_square') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius * 1.0, 4, angle + Math.PI / 4);
      ctx.fill();
    }

    ctx.restore();
  }

  static drawClubPath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    const lobeR = r * 0.38;
    const topCy = -r * 0.42;
    const sideCx = r * 0.40;
    const sideCy = r * 0.16;

    // 3つの円形ローブの外周交点から途切れなく外郭をトレースし、下端に広がりのある茎を接続
    const waistTopStart = Math.atan2(0.209, -0.318);
    const waistTopEnd = Math.atan2(0.209, 0.318);
    const waistRightStart = Math.atan2(-0.371, -0.082);
    const stemRightAngle = Math.atan2(0.22, -0.29);
    const stemLeftAngle = Math.atan2(0.22, 0.29);
    const waistLeftEnd = Math.atan2(-0.371, 0.082);

    ctx.beginPath();
    let started = false;
    const pushArcPoints = (cx, cy, startA, endA, steps) => {
      let span = endA - startA;
      while (span <= 0) span += Math.PI * 2;
      for (let i = 0; i <= steps; i++) {
        const a = startA + (span * i) / steps;
        const px = cx + Math.cos(a) * lobeR;
        const py = cy + Math.sin(a) * lobeR;
        if (!started) {
          ctx.moveTo(px, py);
          started = true;
        } else {
          ctx.lineTo(px, py);
        }
      }
    };

    pushArcPoints(0, topCy, waistTopStart, waistTopEnd, 14);
    pushArcPoints(sideCx, sideCy, waistRightStart, stemRightAngle, 14);
    ctx.lineTo(r * 0.25, r * 0.90);
    ctx.lineTo(-r * 0.25, r * 0.90);
    pushArcPoints(-sideCx, sideCy, stemLeftAngle, waistLeftEnd, 14);
    ctx.closePath();
    ctx.restore();
  }

  static drawSpadePath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    // 先端 (-Y) からハート上下反転カーブ＋広がりのある茎 (+Y)
    const pts = [
      [0, -0.96],
      [0.22, -0.58],
      [0.52, -0.24],
      [0.78, 0.04],
      [0.84, 0.28],
      [0.74, 0.48],
      [0.52, 0.56],
      [0.28, 0.50],
      [0.12, 0.36],
      [0.26, 0.90],
      [-0.26, 0.90],
      [-0.12, 0.36],
      [-0.28, 0.50],
      [-0.52, 0.56],
      [-0.74, 0.48],
      [-0.84, 0.28],
      [-0.78, 0.04],
      [-0.52, -0.24],
      [-0.22, -0.58]
    ];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0] * r;
      const py = pts[i][1] * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.restore();
  }

  static drawPickaxePath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    // 上部の湾曲ツルハシ刃と下向きの柄を単一閉パスで描画
    const pts = [
      [0, -0.78],
      [0.15, -0.64],
      [0.45, -0.52],
      [0.74, -0.30],
      [0.94, -0.02],
      [0.64, -0.20],
      [0.36, -0.32],
      [0.12, -0.36],
      [0.12, 0.90],
      [-0.12, 0.90],
      [-0.12, -0.36],
      [-0.36, -0.32],
      [-0.64, -0.20],
      [-0.94, -0.02],
      [-0.74, -0.30],
      [-0.45, -0.52],
      [-0.15, -0.64]
    ];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0] * r;
      const py = pts[i][1] * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.restore();
  }

  static drawArrowPath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    const pts = [
      [0, 0.96],
      [0.84, -0.72],
      [0, -0.26],
      [-0.84, -0.72]
    ];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0] * r;
      const py = pts[i][1] * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.restore();
  }

  static drawWideArrowPath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    // 下向きの "➽"（広がった尾翼と鋭いワイド矢印）
    const pts = [
      [0, 0.98],
      [0.92, -0.06],
      [0.30, 0.14],
      [0.50, -0.88],
      [0, -0.58],
      [-0.50, -0.88],
      [-0.30, 0.14],
      [-0.92, -0.06]
    ];
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0] * r;
      const py = pts[i][1] * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.restore();
  }

  static drawScissorsShape(ctx, x, y, radius, rotation = 0, color = '#ffffff', hollow = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;

    // 交差する下向き2枚の刃
    const blades = [
      [
        [-0.24, -0.34],
        [-0.04, -0.14],
        [0.46, 0.94],
        [0.14, 0.62],
        [-0.36, -0.18]
      ],
      [
        [0.24, -0.34],
        [0.04, -0.14],
        [-0.46, 0.94],
        [-0.14, 0.62],
        [0.36, -0.18]
      ]
    ];

    for (const pts of blades) {
      ctx.beginPath();
      for (let i = 0; i < pts.length; i++) {
        const px = pts[i][0] * r;
        const py = pts[i][1] * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      if (hollow) {
        ctx.fillStyle = '#000000';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.lineJoin = 'miter';
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill();
      }
    }

    // 上部左右の持ち手リング
    const ringCenters = [
      [-0.46 * r, -0.52 * r],
      [0.46 * r, -0.52 * r]
    ];
    const outerR = 0.33 * r;
    const innerR = 0.14 * r;
    for (const [cx, cy] of ringCenters) {
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2, false);
      ctx.arc(cx, cy, innerR, 0, Math.PI * 2, true);
      if (hollow) {
        ctx.fillStyle = '#000000';
        ctx.fill('evenodd');
        ctx.strokeStyle = color;
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.fillStyle = color;
        ctx.fill('evenodd');
      }
    }

    ctx.restore();
  }

  static drawPrismShape(ctx, x, y, radius, rotation = 0, color = '#ffffff', hollow = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;

    ctx.beginPath();
    ctx.moveTo(0, -1.02 * r);
    ctx.lineTo(0.62 * r, -0.22 * r);
    ctx.lineTo(0.46 * r, 0.48 * r);
    ctx.lineTo(0, 1.02 * r);
    ctx.lineTo(-0.46 * r, 0.48 * r);
    ctx.lineTo(-0.62 * r, -0.22 * r);
    ctx.closePath();

    if (hollow) {
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'miter';
      ctx.stroke();

      // プリズム内部のファセット稜線
      ctx.beginPath();
      ctx.moveTo(-0.62 * r, -0.22 * r);
      ctx.lineTo(0, 0.10 * r);
      ctx.lineTo(0.62 * r, -0.22 * r);
      ctx.moveTo(0, -1.02 * r);
      ctx.lineTo(0, 1.02 * r);
      ctx.lineWidth = 1.6;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  static drawSemicirclePath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.92, -Math.PI / 2, Math.PI / 2, false);
    ctx.closePath();
    ctx.restore();
  }

  static drawCrescentPath(ctx, x, y, radius, rotation = 0) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const R = radius * 0.96;
    const theta = Math.PI * 0.64;
    const tipX = R * Math.cos(theta);
    const tipY = R * Math.sin(theta);
    const cxInner = -R * 0.36;
    const rInner = Math.hypot(tipX - cxInner, tipY);
    const angBottom = Math.atan2(tipY, tipX - cxInner);
    const angTop = Math.atan2(-tipY, tipX - cxInner);

    ctx.beginPath();
    ctx.arc(0, 0, R, -theta, theta, false);
    ctx.arc(cxInner, 0, rInner, angBottom, angTop, true);
    ctx.closePath();
    ctx.restore();
  }

  static drawBombShape(ctx, x, y, radius, rotation = 0, color = '#ffffff', hollow = false) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const r = radius;
    const bodyCy = 0.14 * r;
    const bodyR = 0.74 * r;

    // 上部口金
    ctx.beginPath();
    ctx.moveTo(-0.20 * r, -0.78 * r);
    ctx.lineTo(0.20 * r, -0.78 * r);
    ctx.lineTo(0.20 * r, -0.54 * r);
    ctx.lineTo(-0.20 * r, -0.54 * r);
    ctx.closePath();
    if (hollow) {
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.4;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }

    // 導火線
    ctx.beginPath();
    ctx.moveTo(0, -0.78 * r);
    ctx.quadraticCurveTo(0.08 * r, -1.04 * r, 0.34 * r, -0.96 * r);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.4;
    ctx.lineCap = 'round';
    ctx.stroke();

    // 本体球体
    ctx.beginPath();
    ctx.arc(0, bodyCy, bodyR, 0, Math.PI * 2);
    if (hollow) {
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.8;
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  static drawKnifePath(ctx, x, y, radius, rotation = 0) {
    const pts = [
      [1.18, 0],
      [0.35, 0.22],
      [-0.32, 0.22],
      [-0.32, 0.44],
      [-0.48, 0.44],
      [-0.48, 0.14],
      [-0.95, 0.14],
      [-0.95, -0.14],
      [-0.48, -0.14],
      [-0.48, -0.44],
      [-0.32, -0.44],
      [-0.32, -0.22],
      [0.35, -0.22]
    ];
    const cosA = Math.cos(rotation);
    const sinA = Math.sin(rotation);
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const px = pts[i][0] * radius;
      const py = pts[i][1] * radius;
      const wx = x + px * cosA - py * sinA;
      const wy = y + px * sinA + py * cosA;
      if (i === 0) ctx.moveTo(wx, wy);
      else ctx.lineTo(wx, wy);
    }
    ctx.closePath();
  }

  static drawEnemyShape(ctx, enemyType, x, y, radius, rotation, color = '#ffffff', alpha = 1, hollow = false) {
    ctx.save();
    ctx.globalAlpha = alpha;

    if (enemyType === 'scissors') {
      ShapeRenderer.drawScissorsShape(ctx, x, y, radius, rotation, color, hollow);
      ctx.restore();
      return;
    }

    if (enemyType === 'prism') {
      ShapeRenderer.drawPrismShape(ctx, x, y, radius, rotation, color, hollow);
      ctx.restore();
      return;
    }

    if (enemyType === 'bomb') {
      ShapeRenderer.drawBombShape(ctx, x, y, radius, rotation, color, hollow);
      ctx.restore();
      return;
    }

    if (enemyType === 'quadiamond') {
      // 4つのひし形を上下左右に配置 (❖)
      const offset = radius * 0.52;
      const subR = radius * 0.40;
      const dirs = [
        [0, -offset],
        [offset, 0],
        [0, offset],
        [-offset, 0]
      ];
      for (const [ox, oy] of dirs) {
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);
        const cx = x + ox * cos - oy * sin;
        const cy = y + ox * sin + oy * cos;
        ShapeRenderer.drawPolygonPath(ctx, cx, cy, subR, 4, rotation);
        if (hollow) {
          ctx.fillStyle = '#000000';
          ctx.fill();
          ctx.strokeStyle = color;
          ctx.lineWidth = 2.4;
          ctx.lineJoin = 'miter';
          ctx.stroke();
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }
      }
      ctx.restore();
      return;
    }

    if (enemyType === 'triangle') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 3, rotation + Math.PI / 2);
    } else if (enemyType === 'square') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 4, rotation + Math.PI / 4);
    } else if (enemyType === 'diamond') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 4, rotation);
    } else if (enemyType === 'pentagon') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 5, rotation + Math.PI / 2);
    } else if (enemyType === 'hexagon') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 6, rotation);
    } else if (enemyType === 'club') {
      ShapeRenderer.drawClubPath(ctx, x, y, radius, rotation + Math.PI);
    } else if (enemyType === 'spade') {
      ShapeRenderer.drawSpadePath(ctx, x, y, radius, rotation + Math.PI);
    } else if (enemyType === 'pickaxe') {
      ShapeRenderer.drawPickaxePath(ctx, x, y, radius, rotation);
    } else if (enemyType === 'arrow') {
      ShapeRenderer.drawArrowPath(ctx, x, y, radius, rotation);
    } else if (enemyType === 'sparkle') {
      ShapeRenderer.drawStarPath(ctx, x, y, radius * 1.06, radius * 0.34, 4, rotation);
    } else if (enemyType === 'wide_arrow') {
      ShapeRenderer.drawWideArrowPath(ctx, x, y, radius, rotation);
    } else if (enemyType === 'circle') {
      ctx.beginPath();
      ctx.arc(x, y, radius * 0.92, 0, Math.PI * 2);
    } else if (enemyType === 'semicircle') {
      ShapeRenderer.drawSemicirclePath(ctx, x, y, radius, rotation);
    } else if (enemyType === 'crescent') {
      ShapeRenderer.drawCrescentPath(ctx, x, y, radius, rotation);
    } else if (enemyType === 'knife') {
      ShapeRenderer.drawKnifePath(ctx, x, y, radius, rotation);
    } else {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 3, rotation + Math.PI / 2);
    }

    if (hollow) {
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.8;
      ctx.lineJoin = 'miter';
      ctx.stroke();
    } else {
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.restore();
  }

  static measureLabelWidth(ctx, text) {
    if (ctx && typeof ctx.measureText === 'function') {
      return ctx.measureText(text).width;
    }
    return String(text || '').length * 7;
  }

  static _hashUnit(seed) {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967295;
  }

  /**
   * quadiamond (connect) 間のレーザーを 0.25 秒おきにイージング無しでランダムなギザギザとして描画する
   */
  static drawConnectLaser(ctx, x1, y1, x2, y2, idA, idB, elapsed, color) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const dist = Math.hypot(dx, dy);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.0;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    ctx.beginPath();
    ctx.moveTo(x1, y1);

    if (dist > 4) {
      const tick = Math.floor(Math.max(0, elapsed || 0) / 0.25);
      const minId = Math.min(idA || 0, idB || 0);
      const maxId = Math.max(idA || 0, idB || 0);
      const seedBase = ((minId * 73856093) ^ (maxId * 19349663) ^ (tick * 83492791)) >>> 0;
      const segments = Math.max(4, Math.min(18, Math.round(dist / 26)));
      const nx = -dy / dist;
      const ny = dx / dist;
      const firstSign = ShapeRenderer._hashUnit(seedBase) < 0.5 ? 1 : -1;

      for (let s = 1; s < segments; s++) {
        const baseT = s / segments;
        const tJitter = (ShapeRenderer._hashUnit((seedBase + s * 31) >>> 0) - 0.5) * (0.35 / segments);
        const t = Math.max(0.02, Math.min(0.98, baseT + tJitter));
        // 正の値の範囲でランダム → 負の値の範囲でランダム を交互に繰り返して鋭いギザギザを作る
        const sign = (s % 2 === 1) ? firstSign : -firstSign;
        const mag = 4.5 + ShapeRenderer._hashUnit((seedBase + s * 53 + 11) >>> 0) * 9.5;
        const px = x1 + dx * t + nx * sign * mag;
        const py = y1 + dy * t + ny * sign * mag;
        ctx.lineTo(px, py);
      }
    }

    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  static drawSharpCheckmark(ctx, cx, cy, size = 8, lineWidth = 1.9, color = '#ffffff', alpha = 1) {
    if (alpha <= 0.01 || size <= 0.5) return;
    const h = size * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(cx - h * 0.9, cy + h * 0.05);
    ctx.lineTo(cx - h * 0.2, cy + h * 0.72);
    ctx.lineTo(cx + h * 0.95, cy - h * 0.65);
    ctx.stroke();
    ctx.restore();
  }

  static drawShieldIcon(ctx, cx, cy, w = 13, h = 15, color = '#ffffff', alpha = 1) {
    if (alpha <= 0.01 || w <= 0.5 || h <= 0.5) return;
    const hw = w * 0.5;
    const hh = h * 0.5;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx, cy - hh);
    ctx.lineTo(cx + hw, cy - hh * 0.64);
    ctx.lineTo(cx + hw, cy - hh * 0.09);
    if (typeof ctx.bezierCurveTo === 'function') {
      ctx.bezierCurveTo(
        cx + hw, cy + hh * 0.42,
        cx + hw * 0.58, cy + hh * 0.88,
        cx, cy + hh
      );
      ctx.bezierCurveTo(
        cx - hw * 0.58, cy + hh * 0.88,
        cx - hw, cy + hh * 0.42,
        cx - hw, cy - hh * 0.09
      );
    } else {
      ctx.lineTo(cx + hw * 0.72, cy + hh * 0.52);
      ctx.lineTo(cx, cy + hh);
      ctx.lineTo(cx - hw * 0.72, cy + hh * 0.52);
      ctx.lineTo(cx - hw, cy - hh * 0.09);
    }
    ctx.lineTo(cx - hw, cy - hh * 0.64);
    if (typeof ctx.closePath === 'function') {
      ctx.closePath();
    }
    ctx.fill();
    ctx.restore();
  }
}

