/**
 * エネミーデータ定義
 */
const ENEMIES = {
  // ステージ1 ~ 10
  triangle: {
    // 敵の名前 (マップの "enemies" で使用)
    name: 'triangle',

    // 攻撃手段: 自分自身に被弾判定を持ち、ヒット時に消滅
    bullet_type: 'self_destruction',

    // 移動手段: 出現した位置から右回転しながらゆっくりまっすぐ降下していく
    movement_type: 'fall',

    // HP: ボールヒットごとに縮小(1回パルス)、0で消滅、赤ボールヒットで即0
    health: 1,

    // パドルに与えるダメージ量
    damage: 4,

    // 射撃間隔 (秒): self_destructionでは使用されない
    fire_rate: 0
  },
  diamond: {
    name: 'diamond',
    bullet_type: 'single',
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 2
  },
  pentagon: {
    name: 'pentagon',
    bullet_type: 'spread',
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 5
  },
  hexagon: {
    name: 'hexagon',
    bullet_type: 'aimed',
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 2.5
  },

  // ステージ11 ~ 20
  club: {
    name: 'club',
    bullet_type: '3round', // 少し揺らぎのある3連続射撃
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 5
  },
  spade: {
    name: 'spade',
    bullet_type: 'explode', // スペード型の弾を下向きに放ち、 ある程度下に高度が落ちると6つの丸形の敵弾を全方位に拡散
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 10
  },
  quadiamond: {
    name: 'quadiamond', // ❖
    bullet_type: 'connect', // self_destruction同様に自分に当たり判定があり、 2体以上出現するとお互いの間にレーザーが接続される。 レーザーは1pxの線の被弾判定がある。
    movement_type: 'fall',
    health: 2,
    damage: 1,
    fire_rate: 0 // connectでは使用されない
  },
  pickaxe: {
    name: 'pickaxe', // ⛏
    bullet_type: 'self_destruction',
    movement_type: 'fall',
    speed: 10, // fallの10倍の速度で下降
    health: 1,
    damage: 6,
    fire_rate: 0
  }
};
