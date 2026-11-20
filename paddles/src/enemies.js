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
    health: 2,
    damage: 1, // laserでは100msごとに1ダメージ
    fire_rate: 5
  },
  sparkle: {
    name: 'sparkle', // ⯌
    bullet_type: 'aimed_laser', // laserと同じだが、 射撃1秒前にランダムなプレイヤーのパドルをエイム(一度エイムしたらその位置で固定、プレイヤーを追跡しない)
    movement_type: 'retro',
    health: 2,
    damage: 1,
    fire_rate: 5
  },
  wide_arrow: {
    name: 'wide_arrow', // 下向きの "➽"
    bullet_type: 'aimed_3round', // 3roundだが、 揺らぎ無しでプレイヤーを狙う。
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 5
  },
  scissors: {
    name: 'scissors', // 下向きの "✂"
    bullet_type: 'self_destruction', // aimed_fallのときは赤白点滅はしない
    movement_type: 'aimed_fall', // ランダムなプレイヤーをエイムし、 fire_rate時間が経過後に1秒その位置で止まり、赤白点滅を始める。 1秒が経過すると、 ものすごいスピードと残像を残しながら下へ降下
    health: 1,
    damage: 8,
    fire_rate: 10
  },

  // ステージ31 ~ 40
  prism: {
    name: 'prism',
    bullet_type: 'counter', // singleとaimedを交互に撃ち、 ダメージを受ける度に自分の体から全方位6方向に拡散する弾を放ち、 HPが0になるときに12方向へ拡散する弾を放つ
    movement_type: 'parasol', // パラソルのようなゆらゆらとした落下。
    health: 2,
    damage: 2,
    fire_rate: 2.5
  },
  circle: {
    name: 'circle',
    bullet_type: 'slice', // aimedだが、 ダメージを受けると半分に割れ、 HPが1の半円の敵2体になる。 半円の敵はそれぞれ親のfire_rateとaimedを引き継いだ敵になる。
    movement_type: 'retro',
    health: 2,
    damage: 2,
    fire_rate: 2.5
  },
  crescent: {
    name: 'crescent',
    bullet_type: 'crescent', // 三日月型のトレイルを、 プレイヤーの移動先を予測した地点へ撃つ。 (プレイヤースキルの「swing」のような残像のようなエフェクト)
    movement_type: 'retro',
    health: 2,
    damage: 6,
    fire_rate: 2.5
  },
  bomb: {
    name: 'bomb',
    bullet_type: 'self_explosion', // self_destructionに似ているが、 パドルにぶつかったり、 パドルのY座標まで落下すると、 爆発する。
    movement_type: 'parasol',
    health: 1,
    damage: 8, // eplosionは距離によって威力が減衰。 近ければ100%、 離れていくほど減衰していく。
    speed: 3,
    fire_rate: 2.5
  },

  // ステージ41 ~ 50
  aegis: {
    name: 'aegis',
    bullet_type: 'defend_counter', // counterに似ているが、 正面からきたボールではダメージを受けず、 その場合カウンター攻撃をする。 (背後からならダメージを受け、 カウンターもしない)
    movement_type: 'parasol',
    health: 1,
    damage: 2,
    fire_rate: 2.5
  },
  comet: {
    name: 'comet',
    bullet_type: 'aimed_spread',
    // 弾速が通常より1.25倍速く、残像を残しながら進む。 ボスのようにクールダウンおきに行動する (ミニボス)。 クールダウンは5秒おき。
    // 1. 弾を5回, aimedで撃つ (fire_rate)
    // 2. 弾をaimed_spreadでfire_rateの2倍時間おきに3回撃つ。 spreadに似ているが、 プレイヤーを狙って撃つ。
    // 3. (bombと同じで、 爆発位置まで移動するか、 倒すとbombと同じ爆発効果がある。)
    movement_type: 'random_retro', // retroだが、 画面の端ではなくランダムなところで折り返す。
    health: 3,
    speed: 0.75,
    damage: 3,
    fire_rate: 0.5
  },
  orbit: {
    name: 'orbit',
    bullet_type: 'rocket',
    // crescentと同じでプレイヤーの位置を予測して、 0.75倍の速度で残像を残しながら進むロケット型の弾。
    // 敵弾は、 直線ではなく、 EaseInQuadの軌道を描くように動く。 敵弾の弾頭は常に進行方向を向く。
    // 敵弾は、 プレイヤーや壁にヒットすると爆発する。 
    movement_type: 'squid', // ある程度下方向へ自然に落下すると、 マリオの敵のゲッソーのようにランダムな方向の斜め上へ移動する。 この移動のしきい値はどんどん下がってゆく。
    health: 2,
    damage: 12, // bombと同じで威力減衰がある、 範囲はbombの半分。 直接ヒットすると12ダメージ。
    fire_rate: 10
  },
  hourglass: {
    name: 'hourglass',
    bullet_type: 'waves', // 電波のアイコン。 2倍の速度で進行し、 残像を残しながら進む。 ヒットしてもダメージは受けず、 ダメージエフェクトも再生されないが、 10秒間、 移動速度が低下し、 すべての受けるダメージが1増加するようになる。
    movement_type: 'straight', // fallと同じだが、 自然に回転しない。
    health: 2,
    damage: 0,
    fire_rate: 5 // hourglassは、 弾を打つたびに身体を180度右回転させて上下を入れ替える。 (砂時計)
  },

  // Cloudボスが召喚するダメージ判定の四角形の箱
  square: {
    name: 'square',
    bullet_type: 'self_destruction',
    movement_type: 'gravity_fall', // 重力加速度＋初期ベクトルが適用された落下
    gravity: 360,
    health: 1,
    damage: 4,
    fire_rate: 0
  },

  // Circleが割れたもの
  semicircle: {
    name: 'semicircle',
    bullet_type: 'aimed',
    movement_type: 'float', // retroのようだが、 横方向の移動速度に揺らぎがあり、 ゆっくりと回転している(回転にも揺らぎがある)
    health: 1,
    damage: 2,
    fire_rate: 2.5
  },
};
