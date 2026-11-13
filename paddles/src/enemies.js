/**
 * エネミーデータ定義
 */
const ENEMIES = {
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
  }
};
