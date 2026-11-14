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
  },

  // ステージ21 ~ 30
  arrow: {
    name: 'arrow', // ⮟
    bullet_type: 'laser', // 射撃時間1秒前に、 movement_typeを無視して一時停止。 自分の真下に白色の点線を表示し, 500ms後に点線が赤くなり始める。 さらに500msで完全に赤色になり、 その直後で射撃時間になる。 点線表示が消え、 500msの間レーザーを放つ。 白と赤で点滅するレーザーが自分の真下に放たれ、 イージング無しで横幅が100%、 そのすぐ後レーザーは500msかけて横幅をLinearで0%のサイズにする。 当たり判定はレーザー部分そのまま。
    movement_type: 'retro',
    health: 3,
    damage: 1, // laserでは100msごとに1ダメージ
    fire_rate: 5
  },
  sparkle: {
    name: 'sparkle', // ⯌
    bullet_type: 'aimed_laser', // laserと同じだが、 射撃1秒前にランダムなプレイヤーのパドルをエイム(一度エイムしたらその位置で固定、プレイヤーを追跡しない)
    movement_type: 'retro',
    health: 3,
    damage: 1,
    fire_rate: 5
  },
  wide_arrow: {
    name: 'wide_arrow', // 下向きの "➽"
    bullet_type: 'aimed_3round', // 3roundだが、 揺らぎ無しでプレイヤーを狙う。
    movement_type: 'retro',
    health: 3,
    damage: 2,
    fire_rate: 5
  },
  scissors: {
    name: 'scissors', // 下向きの "✂"
    bullet_type: 'self_destruction', // aimed_fallのときは赤白点滅はしない
    movement_type: 'aimed_fall', // ランダムなプレイヤーをエイムし、 fire_rate時間が経過後に1秒その位置で止まり、赤白点滅を始める。 1秒が経過すると、 ものすごいスピードと残像を残しながら下へ降下
    health: 3,
    damage: 8,
    fire_rate: 10
  },
};
