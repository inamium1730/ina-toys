/**
 * ゲーム全体の定数定義
 */
const GAME_CONFIG = {
  VERSION: '1.1.0',
  WIDTH: 780,
  HEIGHT: 900,

  COLORS: {
    white: '#ffffff',
    red: '#ff3344',
    cyan: '#38eeff',
    yellow: '#ffd82b',
    green: '#22ee66',
    blue: '#1e6fff',
    pink: '#ff66b2',
    purple: '#aa44ff'
  },

  PADDLE: {
    MAX_HP: 8,
    WIDTH_PER_HP: 18, // 8 * 18 = 144px
    HEIGHT: 14,
    Y: 790,
    BASE_SPEED: 520,
    GREEN_SPEED_MULTIPLIER: 1.5, // 緑アイテム取得時はパドル速度も1.5倍 (780px/s)
    BALL_CATCH_MARGIN: 10,       // ボール受け止め判定は見た目よりわずかに広い
    REGEN_DELAY: 10.0,           // 10秒間無被弾で自然回復開始
    REGEN_RATE: 1.0              // 1秒間に1HP回復
  },

  PURPLE_PADDLE: {
    Y: 790 + 38,
    MAX_UNITS: 6,
    UNIT_WIDTH: 780 / 6, // 130px (最大6個分で画面幅780pxいっぱい)
    HEIGHT: 10,
    SPEED: 110,          // ゆっくり移動
    EASE_SPEED: 7.5      // 大きさが伸びる際のイージング速度
  },

  BALL: {
    BASE_RADIUS: 7,
    BASE_SPEED: 280,             // パドルのスピードで十分追いつける基本速度
    GREEN_SPEED_MULTIPLIER: 1.5, // 緑アイテム時は1.5倍
    YELLOW_SIZE_MULTIPLIER: 2.0, // 黄アイテム時は大きさ2倍
    YELLOW_GRAVITY: 140,         // 弱めの重力による物理バウンド
    YELLOW_JUMP_VY: 505,         // 画面上端(y=0)まで確実に到達する上方向ジャンプ初速
    YELLOW_MAX_VX: 230
  },

  ENEMY: {
    VISUAL_SCALE: 1.5,           // すべての敵の見た目を1.5倍
    BULLET_VISUAL_RADIUS: 6.5,   // 見た目は少し大きめの丸形 (当たり判定は1px)
    BLINK_CYCLE: 0.5             // 0.5秒サイクルで赤→白点滅
  },

  BLOCKS: {
    COLS: 13,
    ROWS: 5,
    CELL_W: 780 / 13, // 60px
    CELL_H: 34,
    WIDTH: 50,
    HEIGHT: 20,
    OFFSET_TOP: 128
  },

  ITEM: {
    RADIUS: 13,
    FALL_SPEED: 110,
    ROTATION_SPEED: 1.8, // 右回転速度 (rad/s)
    PULSE_INTERVAL: 0.5, // 0.5秒おきにパルスアニメーション
    STAGE_BLOCK_ITEMS: [
      'cyan_star',
      'yellow_star',
      'green_star',
      'blue_star',
      'blue_circle',
      'pink_heart',
      'purple_square'
    ],
    ENEMY_BASE_INTERVAL: 19.5 // ステージ2 (spawn_interval: 19.5, spawn_limit: 1) でドロップ率100%基準
  },

  MULTIPLAYER: {
    MAX_PLAYERS: 4,
    HP_BY_PLAYER_COUNT: {
      1: 8,
      2: 7,
      3: 6,
      4: 5
    },
    WIDTH_SCALE_BY_PLAYER_COUNT: {
      1: 1.0,
      2: 0.85,
      3: 0.7,
      4: 0.55
    },
    BOSS_HP_SCALE_BY_PLAYER_COUNT: {
      1: 1.0,
      2: 1.5,
      3: 2.0,
      4: 2.5
    }
  }
};
