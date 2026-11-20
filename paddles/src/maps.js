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
    spawn_interval: 19,
    spawn_limit: 3
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
    spawn_limit: 3
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
    spawn_interval: 17,
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
    spawn_interval: 16,
    spawn_limit: 3
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
    spawn_interval: 15,
    spawn_limit: 4
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
    spawn_interval: 14,
    spawn_limit: 4
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
    spawn_interval: 13,
    spawn_limit: 4
  },
  {
    identifier: 9,
    name: 'crab',
    map: [
      '##  #   #  ##',
      '  # ##### #  ',
      '#############',
      '  # ##### #  ',
      '##  #   #  ##'
    ],
    enemies: ['triangle', 'pentagon', 'diamond', 'hexagon'],
    spawn_interval: 12,
    spawn_limit: 4
  },
  {
    identifier: 10,
    name: 'bigfoot',
    map: 'boss',
    enemies: ['triangle', 'pentagon', 'diamond', 'hexagon'],
    spawn_interval: null,
    spawn_limit: 6
  },
  {
    identifier: 11,
    name: 'audio',
    map: [
      '#         #  ',
      '#   #   # # #',
      '# # # # # # #',
      '             ',
      '#############'
    ],
    enemies: ['triangle', 'diamond', 'hexagon', 'pentagon'],
    spawn_interval: 10,
    spawn_limit: 4
  },
  {
    identifier: 12,
    name: 'crossroad',
    map: [
      '## ## # ## ##',
      '      #      ',
      ' ### ### ### ',
      '      #      ',
      '## ## # ## ##'
    ],
    enemies: ['triangle', 'club'],
    spawn_interval: 17,
    spawn_limit: 4
  },
  {
    identifier: 13,
    name: 'contents',
    map: [
      '## #### ## ##',
      '## #### ## ##',
      '           ##',
      '#### ## ## ##',
      '#### ## ## ##'
    ],
    enemies: ['diamond', 'spade'],
    spawn_interval: 16,
    spawn_limit: 4
  },
  {
    identifier: 14,
    name: 'stairs',
    map: [
      '           ##',
      '        #####',
      '     ########',
      '  ###########',
      '#############'
    ],
    enemies: ['pentagon', 'quadiamond'],
    spawn_interval: 15,
    spawn_limit: 4
  },
  {
    identifier: 15,
    name: 'bounce',
    map: [
      '#############',
      '             ',
      '  #########  ',
      '             ',
      '    #####    '
    ],
    enemies: ['hexagon', 'pickaxe'],
    spawn_interval: 14,
    spawn_limit: 4
  },
  {
    identifier: 16,
    name: 'switch',
    map: [
      '#############',
      '# #       # #',
      '# #       # #',
      '# #       # #',
      '#############'
    ],
    enemies: ['club', 'spade', 'triangle'],
    spawn_interval: 13,
    spawn_limit: 5
  },
  {
    identifier: 17,
    name: 'math',
    map: [
      ' ##      ##  ',
      '   #  #    # ',
      '  #  ### ##  ',
      ' #    #    # ',
      ' ###     ##  '
    ],
    enemies: ['spade', 'quadiamond', 'diamond'],
    spawn_interval: 12,
    spawn_limit: 5
  },
  {
    identifier: 18,
    name: 'blockdrop',
    map: [
      '#### ##  ### ',
      '      ##  #  ',
      '   ##        ',
      '#   #   ## ##',
      '### #  ##  ##'
    ],
    enemies: ['quadiamond', 'pickaxe', 'pentagon'],
    spawn_interval: 11,
    spawn_limit: 5
  },
  {
    identifier: 19,
    name: 'glasses',
    map: [
      ' ###     ### ',
      '#   #   #   #',
      '# # ##### # #',
      '#   #   #   #',
      ' ###     ### '
    ],
    enemies: ['hexagon', 'spade', 'club', 'quadiamond', 'pickaxe'],
    spawn_interval: 10,
    spawn_limit: 5
  },
  {
    identifier: 20,
    name: 'snake',
    map: 'boss',
    enemies: ['pickaxe', 'quadiamond', 'club', 'spade'],
    spawn_interval: null,
    spawn_limit: 8
  },
  {
    identifier: 21,
    name: 'castle',
    map: [
      '    #####    ',
      '### #   # ###',
      '# # #   # # #',
      '# ######### #',
      '# #       # #'
    ],
    enemies: ['spade', 'club', 'quadiamond', 'pickaxe'],
    spawn_interval: 10,
    spawn_limit: 5
  },
  {
    identifier: 22,
    name: 'maze',
    map: [
      '# # ### #####',
      '# # # # #   #',
      '##### # ### #',
      '#     # # # #',
      '##### ### # #'
    ],
    enemies: ['arrow', 'club'],
    spawn_interval: 13,
    spawn_limit: 5
  },
  {
    identifier: 23,
    name: 'aaa',
    map: [
      '  #   #   #  ',
      ' # # # # # # ',
      ' ### ### ### ',
      ' # # # # # # ',
      ' # # # # # # '
    ],
    enemies: ['spade', 'sparkle'],
    spawn_interval: 12,
    spawn_limit: 5
  },
  {
    identifier: 24,
    name: 'notfound',
    map: [
      ' # # ### # # ',
      ' # # # # # # ',
      ' ### # # ### ',
      '   # # #   # ',
      '   # ###   # '
    ],
    enemies: ['quadiamond', 'wide_arrow'],
    spawn_interval: 11,
    spawn_limit: 5
  },
  {
    identifier: 25,
    name: 'factory',
    map: [
      '             ',
      '    #  #  #  ',
      '   ## ## ##  ',
      '  #########  ',
      '  #########  '
    ],
    enemies: ['pickaxe', 'scissors'],
    spawn_interval: 10,
    spawn_limit: 5
  },
  {
    identifier: 26,
    name: 'mimimi',
    map: [
      ' ### ### ### ',
      '             ',
      ' ### ### ### ',
      '             ',
      ' ### ### ### '
    ],
    enemies: ['arrow', 'sparkle', 'club', 'triangle'],
    spawn_interval: 9,
    spawn_limit: 6
  },
  {
    identifier: 27,
    name: 'hdd',
    map: [
      '    #####    ',
      '   #######   ',
      '  #########  ',
      ' #         # ',
      '  #########  '
    ],
    enemies: ['diamond', 'spade', 'sparkle', 'wide_arrow'],
    spawn_interval: 8,
    spawn_limit: 6
  },
  {
    identifier: 28,
    name: 'bigwalk',
    map: [
      '  #  ###  #  ',
      ' #  #####  # ',
      ' #  #####  # ',
      ' #  #####  # ',
      '  #  ###  #  '
    ],
    enemies: ['pentagon', 'quadiamond', 'wide_arrow', 'scissors'],
    spawn_interval: 7,
    spawn_limit: 6
  },
  {
    identifier: 29,
    name: 'diamonds',
    map: [
      '#   #   #   #',
      ' # # # # # # ',
      '  #   #   #  ',
      ' # # # # # # ',
      '#   #   #   #'
    ],
    enemies: ['hexagon', 'pickaxe', 'scissors', 'wide_arrow', 'arrow', 'sparkle'],
    spawn_interval: 6,
    spawn_limit: 6
  },
  {
    identifier: 30,
    name: 'cloud',
    map: 'boss',
    enemies: ['arrow', 'wide_arrow', 'sparkle', 'scissors', 'square'],
    spawn_interval: null,
    spawn_limit: 10
  },
  {
    identifier: 31,
    name: 'trophy',
    map: [
      '###  ###  ###',
      ' ###  #  ### ',
      ' ###  #  ### ',
      ' ###  #  ### ',
      '  ### # ###  '
    ],
    enemies: ['sparkle', 'arrow', 'wide_arrow', 'scissors'],
    spawn_interval: 10,
    spawn_limit: 8
  },
  {
    identifier: 32,
    name: 'download',
    map: [
      '   #######   ',
      '#   #####   #',
      '#    ###    #',
      '#           #',
      '#############'
    ],
    enemies: ['prism', 'arrow'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 33,
    name: 'folder',
    map: [
      ' #####       ',
      ' ######      ',
      ' ########### ',
      ' ########### ',
      ' ########### '
    ],
    enemies: ['sparkle', 'circle'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 34,
    name: 'gun',
    map: [
      '#############',
      '#############',
      '     #  #### ',
      '      ###### ',
      '         ####'
    ],
    enemies: ['wide_arrow', 'crescent'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 35,
    name: 'puzzle',
    map: [
      '#############',
      '             ',
      '  # # #   # #',
      '#   #   #   #',
      '# #   # # #  '
    ],
    enemies: ['scissors', 'bomb'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 36,
    name: 'focus',
    map: [
      '   ##   ##   ',
      '#   #   #   #',
      '##  ## ##  ##',
      '##  ## ##  ##',
      '###  # #  ###'
    ],
    enemies: ['arrow', 'prism', 'circle', 'wide_arrow'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 37,
    name: 'flowers',
    map: [
      '       #     ',
      ' #   ## #  # ',
      '# # # ##  # #',
      ' #   # #   # ',
      ' # # # # # # '
    ],
    enemies: ['sparkle', 'circle', 'spade', 'crescent'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 38,
    name: 'measure',
    map: [
      '#           #',
      '# # # # # # #',
      '#############',
      '# # # # # # #',
      '#           #'
    ],
    enemies: ['crescent', 'bomb', 'quadiamond', 'hexagon'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 39,
    name: 'zigzag',
    map: [
      '### ### ### #',
      '# # # # # # #',
      '# # # # # # #',
      '# # # # # # #',
      '# ### ### ###'
    ],
    enemies: ['bomb', 'crescent', 'circle', 'prism', 'pentagon', 'sparkle'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 40,
    name: 'dragon',
    map: 'boss',
    enemies: ['prism', 'crescent', 'circle', 'bomb'],
    spawn_interval: null,
    spawn_limit: 12
  },
  {
    identifier: 41,
    name: 'mask',
    map: [
      ' ##       ## ',
      ' ########### ',
      '  #  ###  #  ',
      '  ##  #  ##  ',
      '   #######   '
    ],
    enemies: ['prism', 'circle', 'crescent', 'bomb'],
    spawn_interval: 10,
    spawn_limit: 8
  },
  {
    identifier: 42,
    name: 'crown',
    map: [
      '      #      ',
      '#  ## # ##  #',
      '## # # # # ##',
      '# #### #### #',
      ' #    #    # '
    ],
    enemies: ['prism', 'aegis'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 43,
    name: 'cancel',
    map: [
      '  #########  ',
      '#############',
      '####     ####',
      '#############',
      '  #########  '
    ],
    enemies: ['circle', 'comet'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 44,
    name: 'send',
    map: [
      '#######      ',
      '  #######    ',
      '     ########',
      '  #######    ',
      '#######      '
    ],
    enemies: ['crescent', 'orbit'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 45,
    name: 'usb',
    map: [
      ' ########### ',
      '##         ##',
      '## ####### ##',
      '##         ##',
      ' ########### '
    ],
    enemies: ['bomb', 'hourglass'],
    spawn_interval: 6,
    spawn_limit: 4
  },
  {
    identifier: 46,
    name: 'mail',
    map: [
      ' ########### ',
      '#  #######  #',
      '###  ###  ###',
      '#####   #####',
      '#############'
    ],
    enemies: ['comet', 'aegis', 'prism', 'quadiamond'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 47,
    name: 'check',
    map: [
      '          ###',
      '        #### ',
      '###  #####   ',
      ' #######     ',
      '  ####       '
    ],
    enemies: ['comet', 'orbit', 'crescent', 'sparkle'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 48,
    name: 'file',
    map: [
      '#########    ',
      '#      ####  ',
      '#      ######',
      '#           #',
      '#############'
    ],
    enemies: ['orbit', 'hourglass', 'bomb', 'crescent'],
    spawn_interval: 8,
    spawn_limit: 5
  },
  {
    identifier: 49,
    name: 'clip',
    map: [
      ' ########### ',
      '            #',
      '########### #',
      '#           #',
      ' ########### '
    ],
    enemies: ['aegis', 'comet', 'hourglass', 'orbit', 'scissors', 'pentagon'],
    spawn_interval: 8,
    spawn_limit: 5
  }
];
