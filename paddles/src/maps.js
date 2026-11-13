/**
 * ステージ（マップ）データ定義
 */
const MAPS = [
  {
    identifier: 1,
    name: 'breakout',
    map: [
      '             ',
      ' ########### ',
      ' ########### ',
      ' ########### ',
      '             '
    ],
    enemies: [],
    spawn_interval: null,
    spawn_limit: 0
  },
  {
    identifier: 2,
    name: 'rain',
    map: [
      ' # # # # # # ',
      '# # # # # # #',
      ' # # # # # # ',
      '# # # # # # #',
      ' # # # # # # '
    ],
    enemies: ['triangle'],
    spawn_interval: 19.5,
    spawn_limit: 1
  },
  {
    identifier: 3,
    name: 'heart',
    map: [
      '  ##     ##  ',
      ' ##### ##### ',
      '  #########  ',
      '    #####    ',
      '      #      '
    ],
    enemies: ['diamond'],
    spawn_interval: 18,
    spawn_limit: 2
  },
  {
    identifier: 4,
    name: 'console',
    map: [
      ' ########### ',
      '## ## # ## ##',
      '# # ##### # #',
      '## ####### ##',
      ' ########### '
    ],
    enemies: ['pentagon'],
    spawn_interval: 16.5,
    spawn_limit: 3
  },
  {
    identifier: 5,
    name: 'poles',
    map: [
      '#############',
      ' ## ## ## ## ',
      ' ## ## ## ## ',
      ' ## ## ## ## ',
      '#############'
    ],
    enemies: ['hexagon'],
    spawn_interval: 15,
    spawn_limit: 4
  },
  {
    identifier: 6,
    name: 'mustard',
    map: [
      '#   #   #   #',
      ' # # # # # # ',
      ' # # # # # # ',
      ' # # # # # # ',
      '  #   #   #  '
    ],
    enemies: ['triangle', 'diamond'],
    spawn_interval: 10,
    spawn_limit: 10
  },
  {
    identifier: 7,
    name: 'chained',
    map: [
      '             ',
      '## ### ### ##',
      '# ## ### ## #',
      '## ### ### ##',
      '             '
    ],
    enemies: ['pentagon', 'diamond'],
    spawn_interval: 10,
    spawn_limit: 10
  },
  {
    identifier: 8,
    name: 'web',
    map: [
      '#  #  #  #  #',
      ' ## ## ## ## ',
      '  ## ### ##  ',
      ' ## ## ## ## ',
      '#  #  #  #  #'
    ],
    enemies: ['pentagon', 'hexagon'],
    spawn_interval: 10,
    spawn_limit: 10
  },
  {
    identifier: 9,
    name: 'spider',
    map: [
      '##  #   #  ##',
      '  #########  ',
      '#############',
      '  #########  ',
      '##  #   #  ##'
    ],
    enemies: ['triangle', 'pentagon', 'diamond', 'hexagon'],
    spawn_interval: 10,
    spawn_limit: 10
  }
];
