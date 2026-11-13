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

  static drawEnemyShape(ctx, enemyType, x, y, radius, rotation, color = '#ffffff', alpha = 1, hollow = false) {
    ctx.save();
    ctx.globalAlpha = alpha;

    if (enemyType === 'triangle') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 3, rotation + Math.PI / 2);
    } else if (enemyType === 'diamond') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 4, rotation);
    } else if (enemyType === 'pentagon') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 5, rotation + Math.PI / 2);
    } else if (enemyType === 'hexagon') {
      ShapeRenderer.drawPolygonPath(ctx, x, y, radius, 6, rotation);
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
}

