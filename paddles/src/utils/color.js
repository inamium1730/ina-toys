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

/**
 * ホスト共有シードに基づく決定論的PRNG (Mulberry32)
 * 全クライアントで同一シード・同一ストリームから乱数を生成する。
 */
class GameRng {
  static normalizeSeed(seed) {
    const s = (Number(seed) || 0) >>> 0;
    return s === 0 ? 0x6d2b79f5 : s;
  }

  static mixSeed(a, b) {
    let h = ((Number(a) >>> 0) ^ (Math.imul(Number(b) >>> 0, 0x9e3779b1))) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h === 0 ? 0x9e3779b1 : h;
  }

  static fromSeed(seed) {
    let a = GameRng.normalizeSeed(seed);
    const next = () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    return {
      next,
      range(min, max) {
        return min + next() * (max - min);
      },
      int(min, maxInclusive) {
        return min + Math.floor(next() * (maxInclusive - min + 1));
      },
      pick(arr) {
        if (!arr || arr.length === 0) return undefined;
        return arr[Math.floor(next() * arr.length)];
      },
      shuffle(arr) {
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(next() * (i + 1));
          const tmp = arr[i];
          arr[i] = arr[j];
          arr[j] = tmp;
        }
        return arr;
      },
      getState() {
        return a >>> 0;
      },
      setState(state) {
        a = GameRng.normalizeSeed(state);
      }
    };
  }

  static setGameSeed(seed) {
    GameRng._gameSeed = GameRng.normalizeSeed(seed);
    GameRng._stageNumber = 1;
    GameRng._stageSeed = GameRng.mixSeed(GameRng._gameSeed, 1);
    GameRng._shared = GameRng.fromSeed(GameRng._gameSeed);
  }

  static setStageSeed(stageNumber) {
    const num = Math.max(1, (Number(stageNumber) | 0) || 1);
    GameRng._stageNumber = num;
    GameRng._stageSeed = GameRng.mixSeed(GameRng.getGameSeed(), num);
  }

  static getGameSeed() {
    if (!GameRng._gameSeed) {
      GameRng._gameSeed = GameRng.normalizeSeed(((Math.random() * 0xffffffff) >>> 0) || 1);
      GameRng._stageSeed = GameRng.mixSeed(GameRng._gameSeed, GameRng._stageNumber || 1);
    }
    return GameRng._gameSeed;
  }

  static getStageSeed() {
    if (!GameRng._stageSeed) {
      GameRng._stageSeed = GameRng.mixSeed(GameRng.getGameSeed(), GameRng._stageNumber || 1);
    }
    return GameRng._stageSeed;
  }

  static _ensureShared() {
    if (!GameRng._shared) {
      GameRng._shared = GameRng.fromSeed(GameRng.getGameSeed());
    }
    return GameRng._shared;
  }

  static next() {
    return GameRng._ensureShared().next();
  }

  static getState() {
    return GameRng._ensureShared().getState();
  }

  static setState(state) {
    GameRng._ensureShared().setState(state);
  }

  static shuffle(arr) {
    return GameRng._ensureShared().shuffle(arr);
  }

  static pick(arr) {
    return GameRng._ensureShared().pick(arr);
  }
}

GameRng._gameSeed = 0;
GameRng._stageNumber = 1;
GameRng._stageSeed = 0;
GameRng._shared = null;

