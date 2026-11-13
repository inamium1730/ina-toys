/**
 * 数値・色補間および星アイテム重複時の色遷移ユーティリティクラス
 */
class ColorUtils {
  static clamp(val, min, max) {
    return Math.max(min, Math.min(max, val));
  }

  static hexToRgb(hex) {
    const clean = hex.replace('#', '');
    const num = parseInt(clean, 16);
    return {
      r: (num >> 16) & 255,
      g: (num >> 8) & 255,
      b: num & 255
    };
  }

  static rgbToHex(r, g, b) {
    const toHex = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  static lerpColor(hexA, hexB, t) {
    const a = ColorUtils.hexToRgb(hexA);
    const b = ColorUtils.hexToRgb(hexB);
    return ColorUtils.rgbToHex(
      a.r + (b.r - a.r) * t,
      a.g + (b.g - a.g) * t,
      a.b + (b.b - a.b) * t
    );
  }

  static hasAnyStarEffect(effects) {
    return effects.cyan > 0 || effects.yellow > 0 || effects.green > 0;
  }

  /**
   * 星アイテムの効果色を取得する。
   * 重複取得時は0.5秒ごとに0.25秒かけて次の色へ滑らかに変化する。
   */
  static getStarEffectColor(effects, clock) {
    const { COLORS } = GAME_CONFIG;
    const activeColors = [];
    if (effects.cyan > 0) activeColors.push(COLORS.cyan);
    if (effects.yellow > 0) activeColors.push(COLORS.yellow);
    if (effects.green > 0) activeColors.push(COLORS.green);

    if (activeColors.length === 0) return COLORS.white;
    if (activeColors.length === 1) return activeColors[0];

    const stepIndex = Math.floor(clock / 0.5);
    const stepTime = clock % 0.5;
    const c1 = activeColors[stepIndex % activeColors.length];
    const c2 = activeColors[(stepIndex + 1) % activeColors.length];

    if (stepTime < 0.25) {
      return ColorUtils.lerpColor(c1, c2, stepTime / 0.25);
    }
    return c2;
  }
}

