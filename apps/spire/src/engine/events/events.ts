// === 事件（? 节点）数据表 ===
//
// 描述 / 选项 / 结果均为**原创中文文案**（不复制杀戮尖塔的事件叙事）；机制/概率/结果结构
// 复刻其玩法骨架。结果通过 EventOutcome 复用金币/生命/牌组/遗物/药水等既有系统结算。

export type EventOutcome =
  | { kind: "gain_gold"; amount: number }
  | { kind: "lose_gold"; amount: number }
  | { kind: "heal"; amount: number }
  | { kind: "lose_hp"; amount: number }
  | { kind: "gain_max_hp"; amount: number }
  | { kind: "add_card"; cardId: string }
  | { kind: "gain_relic" }
  | { kind: "gain_potion" }
  // 移除一张牌（自动优先移除诅咒/状态牌，否则随机一张非基础牌）。
  | { kind: "remove_random_card" }
  // 升级 count 张随机未升级的牌（攻击/技能/能力）。
  | { kind: "upgrade_random_card"; count: number }
  | { kind: "nothing" };

export type EventChoice = {
  /** 选项按钮文案（原创）。 */
  label: string;
  /** 选择后展示的结果叙述（原创）。 */
  resultText: string;
  outcomes: EventOutcome[];
};

export type EventDef = {
  id: string;
  /** 事件情境描述（原创）。 */
  description: string;
  choices: EventChoice[];
};

// 开局祝福（涅奥）：不进 ? 节点池，只在 newRun 时作为第一个界面出现（复用事件机制）。
export const NEOW_EVENT_ID = "neow_blessing";

const EVENT_LIST: EventDef[] = [
  {
    id: NEOW_EVENT_ID,
    description:
      "尖塔脚下，一团柔和的光影缓缓聚成人形，向你伸出手——它说，愿为踏塔者赠上一份临行的祝福。",
    choices: [
      {
        label: "强健体魄（最大生命 +8）",
        resultText: "一股暖流沉入四肢，你觉得自己比来时更结实了。",
        outcomes: [{ kind: "gain_max_hp", amount: 8 }],
      },
      {
        label: "满囊金币（+100 金币）",
        resultText: "沉甸甸的钱袋落进你手心。",
        outcomes: [{ kind: "gain_gold", amount: 100 }],
      },
      {
        label: "神秘馈赠（获得一件遗物）",
        resultText: "光影散去，一件古旧的器物留在了你掌中。",
        outcomes: [{ kind: "gain_relic" }],
      },
      {
        label: "行者补给（一瓶药水 + 回 10 生命）",
        resultText: "你的行囊里多了一瓶药水，旅途的倦意也消了几分。",
        outcomes: [{ kind: "gain_potion" }, { kind: "heal", amount: 10 }],
      },
    ],
  },
  {
    id: "cooling_embers",
    description: "半塌的石室中央，一堆灰烬还残着余温，灰里似乎埋着被人匆忙丢下的东西。",
    choices: [
      {
        label: "拢近火堆取暖",
        resultText: "暖意顺着骨头爬上来，疲惫散了些。你回复了 12 点生命。",
        outcomes: [{ kind: "heal", amount: 12 }],
      },
      {
        label: "徒手在灰里翻找",
        resultText: "你摸出几枚发烫的硬币，指尖也被余烬燎起了泡。",
        outcomes: [
          { kind: "gain_gold", amount: 30 },
          { kind: "lose_hp", amount: 6 },
        ],
      },
    ],
  },
  {
    id: "faceless_shrine",
    description: "岔路口立着一尊没有面孔的石像，双手摊在身前，掌心磨得发亮，像是等了很久的供奉。",
    choices: [
      {
        label: "空手合十，诚心祈祷",
        resultText: "石像掌心浮起一点微光，一件旧物落进你怀里。",
        outcomes: [{ kind: "gain_relic" }],
      },
      {
        label: "掀翻石像看看底下",
        resultText: "石像下压着一小袋钱币，倒下时的石棱也划破了你。",
        outcomes: [
          { kind: "gain_gold", amount: 55 },
          { kind: "lose_hp", amount: 10 },
        ],
      },
    ],
  },
  {
    id: "lost_peddler",
    description: "一个背着鼓胀行囊的商贩瘫坐路边，喘着气说只要一点接济，就把货分你一些。",
    choices: [
      {
        label: "分他一些盘缠",
        resultText: "他千恩万谢，从行囊里翻出一瓶药水塞给你。",
        outcomes: [{ kind: "lose_gold", amount: 25 }, { kind: "gain_potion" }],
      },
      {
        label: "抢过他的行囊",
        resultText: "你夺过钱袋就跑，慌乱里也把他包里一片带刺的脏东西塞进了自己牌组。",
        outcomes: [
          { kind: "gain_gold", amount: 45 },
          { kind: "add_card", cardId: "wound" },
        ],
      },
      {
        label: "绕开他继续赶路",
        resultText: "你没有停下，脚步声很快盖过了他的呼唤。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "ragged_beggar",
    description: "一个裹着破布的乞儿蹲在墙角，见你走近，怯生生地伸出了手。",
    choices: [
      {
        label: "施舍他 30 金币",
        resultText: "他攥紧铜板，从怀里掏出一件旧物硬塞给你，说是祖上传下的护身符。",
        outcomes: [{ kind: "lose_gold", amount: 30 }, { kind: "gain_relic" }],
      },
      {
        label: "摇摇头走开",
        resultText: "你没有停留，身后的呼唤很快被风声盖过。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "dusty_bookshelf",
    description: "一排蒙尘的书架斜倚在墙上，大多已被虫蛀，只有一本还算完整。",
    choices: [
      {
        label: "通读那本兵书",
        resultText: "字句晦涩，可读罢你只觉一股火气在胸腔里烧了起来。",
        outcomes: [{ kind: "add_card", cardId: "inflame" }],
      },
      {
        label: "撕下书页生火取暖",
        resultText: "火光跳动，你就着暖意歇了好一会儿。",
        outcomes: [{ kind: "heal", amount: 15 }],
      },
    ],
  },
  {
    id: "blood_altar",
    description: "一方暗红的石台立在房间中央，凹槽里干涸的痕迹还残着腥气，像在等待新的供奉。",
    choices: [
      {
        label: "割破手掌，献上鲜血",
        resultText: "血珠落进凹槽的刹那，石台亮起，一件器物凭空落入你手。",
        outcomes: [{ kind: "lose_hp", amount: 10 }, { kind: "gain_relic" }],
      },
      {
        label: "收回手，退开",
        resultText: "你压下心底那点悸动，绕过石台离开了。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "glowing_pool",
    description: "地面裂缝里积着一汪泛着微光的水潭，光影随你的呼吸轻轻晃动。",
    choices: [
      {
        label: "掬起一捧饮下",
        resultText: "清冽的凉意一路淌到四肢百骸，你觉得自己比先前更耐得住了。",
        outcomes: [{ kind: "gain_max_hp", amount: 8 }],
      },
      {
        label: "用潭水冲洗伤口",
        resultText: "伤处的刺痛迅速退去，血也止住了。",
        outcomes: [{ kind: "heal", amount: 20 }],
      },
      {
        label: "探手到潭底摸索",
        resultText: "指尖触到几枚沉底的钱币，也被潭里不知名的东西划了一下。",
        outcomes: [
          { kind: "gain_gold", amount: 30 },
          { kind: "lose_hp", amount: 5 },
        ],
      },
    ],
  },
  {
    id: "weapon_rack",
    description: "一排废弃的兵器斜插在架上，大半锈成了废铁，只有一柄还透着寒光。",
    choices: [
      {
        label: "取下那柄趁手的重刃",
        resultText: "你掂了掂分量，正合手——这一路总算多了件像样的家伙。",
        outcomes: [{ kind: "add_card", cardId: "heavy_blade" }],
      },
      {
        label: "把能拆的金属都拆下变卖",
        resultText: "锈铁不值钱，可积少成多也换了几枚硬币。",
        outcomes: [{ kind: "gain_gold", amount: 25 }],
      },
    ],
  },
  {
    id: "lone_grave",
    description: "一座无名孤坟立在路旁，土堆前的粗陶碗里还压着几枚发黑的铜钱。",
    choices: [
      {
        label: "掘开坟冢取走陪葬",
        resultText: "你搜刮到一小袋钱币，但心口莫名一沉，像是揣上了什么甩不掉的东西。",
        outcomes: [
          { kind: "gain_gold", amount: 40 },
          { kind: "add_card", cardId: "wound" },
        ],
      },
      {
        label: "添一抔新土，默立片刻",
        resultText: "你替这无名之人整了整坟头，起身时觉得脚步竟稳了几分。",
        outcomes: [{ kind: "gain_max_hp", amount: 6 }],
      },
    ],
  },
  {
    id: "fungal_ring",
    description: "一圈鼓胀的蘑菇在幽光里轻轻搏动，凑近能闻到一股又腥又甜的气味。",
    choices: [
      {
        label: "掰下一朵尝尝",
        resultText: "腥甜在喉咙里炸开，肚子绞了一下，可你觉得身子骨更结实了。",
        outcomes: [
          { kind: "gain_max_hp", amount: 10 },
          { kind: "lose_hp", amount: 5 },
        ],
      },
      {
        label: "小心采下孢子",
        resultText: "你把饱满的孢子囊收进行囊——或许能派上用场。",
        outcomes: [{ kind: "gain_potion" }],
      },
      {
        label: "一脚把它们踩碎",
        resultText: "菌盖爆开，露出几枚被菌丝裹着的硬币。",
        outcomes: [{ kind: "gain_gold", amount: 15 }],
      },
    ],
  },
  // —— 补全批次：更多 ? 节点事件（机制忠实、文案原创）——
  {
    id: "golden_idol",
    description:
      "祭坛中央供着一尊沉甸甸的金像，它的眼睛像是在盯着你看。伸手去拿，总觉得会惊动什么。",
    choices: [
      {
        label: "抱走金像",
        resultText: "金像入手的刹那，一道无形的诅咒钻进了你的牌组。",
        outcomes: [{ kind: "gain_relic" }, { kind: "add_card", cardId: "injury" }],
      },
      {
        label: "不碰，转身离开",
        resultText: "你压下贪念，退出了这间密室。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "big_fish",
    description: "一汪水潭里游着条通人性的大鱼。它吐出三样东西，示意你只能挑一件。",
    choices: [
      {
        label: "香蕉（回复生命）",
        resultText: "果肉香甜，倦意与伤痛都消退了不少。",
        outcomes: [{ kind: "heal", amount: 25 }],
      },
      {
        label: "甜甜圈（最大生命 +6）",
        resultText: "一股扎实的暖流沉入身体，你比先前更耐打了。",
        outcomes: [{ kind: "gain_max_hp", amount: 6 }],
      },
      {
        label: "木盒（一件遗物，附带代价）",
        resultText: "盒中是件古物，可打开它也松开了封在里面的悔意。",
        outcomes: [{ kind: "gain_relic" }, { kind: "add_card", cardId: "regret" }],
      },
    ],
  },
  {
    id: "golden_shrine",
    description: "一座敷着金箔的神龛静立在尘埃里，隐隐透出可以被亵渎、也可以被敬奉的气息。",
    choices: [
      {
        label: "虔诚祈祷",
        resultText: "神龛回应了你的敬意，几枚金币凭空落下。",
        outcomes: [{ kind: "gain_gold", amount: 100 }],
      },
      {
        label: "撬走金箔（更多金币，招致诅咒）",
        resultText: "你剥下所有金箔，也剥落了自己的一点体面。",
        outcomes: [
          { kind: "gain_gold", amount: 275 },
          { kind: "add_card", cardId: "regret" },
        ],
      },
      {
        label: "转身离开",
        resultText: "你向神龛行了一礼，退了出去。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "the_serpent",
    description:
      "阴影里盘着一条会说话的长蛇，它用尾尖挑着一袋金币，语气甜得发腻：拿去吧，不要白不要。",
    choices: [
      {
        label: "接过金币（种下疑虑）",
        resultText: "钱袋沉甸甸的，可你心里从此多了一根拔不掉的刺。",
        outcomes: [
          { kind: "gain_gold", amount: 175 },
          { kind: "add_card", cardId: "doubt" },
        ],
      },
      {
        label: "不理它，走开",
        resultText: "你没有回头，蛇的嗤笑消失在身后。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "world_of_goop",
    description: "整个房间灌满了半凝的黏液，金币若隐若现地悬在其中。伸手去捞，代价是弄得满身狼狈。",
    choices: [
      {
        label: "把手伸进黏液捞金币",
        resultText: "你抓到了不少硬币，也被黏液啃掉了一层皮。",
        outcomes: [
          { kind: "gain_gold", amount: 75 },
          { kind: "lose_hp", amount: 11 },
        ],
      },
      {
        label: "绕开这摊麻烦",
        resultText: "你贴着墙根挪了出去，一枚金币也没沾。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "scrap_ooze",
    description: "一团软泥裹着某样硬邦邦的东西缓缓蠕动。想拿到它，就得忍着它的腐蚀往里掏。",
    choices: [
      {
        label: "忍痛掏出里面的东西",
        resultText: "腐蚀灼着你的手，但指尖终于扣住了一件遗物。",
        outcomes: [{ kind: "lose_hp", amount: 3 }, { kind: "gain_relic" }],
      },
      {
        label: "不值得，走开",
        resultText: "你甩了甩发麻的手，离开了。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "the_cleric",
    description: "一位游方牧师在废墟里支起摊子，说只要付些金币，他能为你诵一段驱痛的祷文。",
    choices: [
      {
        label: "付 35 金币，接受治疗",
        resultText: "祷文低回，伤口以肉眼可见的速度合拢。",
        outcomes: [
          { kind: "lose_gold", amount: 35 },
          { kind: "heal", amount: 25 },
        ],
      },
      {
        label: "囊中羞涩，谢过离开",
        resultText: "牧师点点头，目送你远去。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "forgotten_altar",
    description: "一座荒废已久的祭坛，凹槽里还残留着暗褐色的痕迹。它似乎渴望一份献祭。",
    choices: [
      {
        label: "献上鲜血（最大生命 +7）",
        resultText: "你割破掌心滴入凹槽，祭坛回赠你一具更坚韧的躯体。",
        outcomes: [
          { kind: "lose_hp", amount: 5 },
          { kind: "gain_max_hp", amount: 7 },
        ],
      },
      {
        label: "供上金币（换一件遗物）",
        resultText: "金币没入凹槽，祭坛深处升起一件古物。",
        outcomes: [{ kind: "lose_gold", amount: 50 }, { kind: "gain_relic" }],
      },
      {
        label: "不打扰它，离开",
        resultText: "你退后一步，让祭坛继续沉睡。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "wing_statue",
    description: "一尊长着翅膀的石像立在通道尽头，翼尖挂着一枚闪光的护符，触手可及。",
    choices: [
      {
        label: "取下护符（一件遗物，代价是刺痛）",
        resultText: "护符入手，石像的翅膀无声地垂了下去。",
        outcomes: [{ kind: "gain_relic" }, { kind: "lose_hp", amount: 7 }],
      },
      {
        label: "向石像祈祷（回复生命）",
        resultText: "你合十默祷，一阵微光拂过，倦意稍解。",
        outcomes: [{ kind: "heal", amount: 15 }],
      },
    ],
  },
  // —— 补全批次 2：涉及改牌/去牌/升级的事件 ——
  {
    id: "whirlpool_of_purity",
    description:
      "一汪静止的清池泛着奇异的洁光，凑近时，你手里最碍事的那张牌隐隐发烫，像想被它带走。",
    choices: [
      {
        label: "把一张牌投进池中净化",
        resultText: "牌落水的瞬间化作光点消散，你的牌组清爽了几分。",
        outcomes: [{ kind: "remove_random_card" }],
      },
      {
        label: "不舍得，转身离开",
        resultText: "你把牌重新收好，绕过了水池。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "shining_light",
    description: "石室深处悬着一团刺目的白光，传说踏入者会被灼痛，却也会因此被磨砺得更利。",
    choices: [
      {
        label: "走进光中（受创，但两张牌被磨砺）",
        resultText: "白光灼过全身，退出时你发现随身的两件家伙都更趁手了。",
        outcomes: [
          { kind: "lose_hp", amount: 12 },
          { kind: "upgrade_random_card", count: 2 },
        ],
      },
      {
        label: "遮住眼退开",
        resultText: "你不愿平白受这份罪，退出了石室。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "bonfire_spirits",
    description: "篝火里跃动着几缕通灵的火魂，它们伸出手，示意你可以投入一张牌，换取火中之物。",
    choices: [
      {
        label: "投入一张牌，静待馈赠",
        resultText: "牌在火中噼啪炸开，灰烬里凝出一件温热的器物。",
        outcomes: [{ kind: "remove_random_card" }, { kind: "gain_relic" }],
      },
      {
        label: "不献祭，烤烤火就走",
        resultText: "你就着火光暖了暖身子，什么也没舍得投。",
        outcomes: [{ kind: "heal", amount: 10 }],
      },
    ],
  },
  {
    id: "living_wall",
    description: "一整面墙缓缓起伏，像在呼吸。它开口说话，愿意为你的牌组做一件事——添、削、或是磨。",
    choices: [
      {
        label: "吸纳（获得一张随机无色牌）",
        resultText: "墙面凸起，一张陌生的牌被推进你怀里。",
        outcomes: [{ kind: "add_card", cardId: "apparition" }],
      },
      {
        label: "遗忘（移除一张牌）",
        resultText: "墙面凹陷，你最累赘的一张牌被吞了进去。",
        outcomes: [{ kind: "remove_random_card" }],
      },
      {
        label: "深化（升级一张牌）",
        resultText: "墙面纹路流转，你的一张牌被打磨得更加锋利。",
        outcomes: [{ kind: "upgrade_random_card", count: 1 }],
      },
    ],
  },
  // —— 补全批次 3：交易 / 冒险类 ? 事件（既有 outcome）——
  {
    id: "knowing_skull",
    description:
      "墙上嵌着一颗会说话的骷髅，它咧嘴笑道：想要什么尽管开口，只是——每句回答都得拿血来换。",
    choices: [
      {
        label: "问它讨要金币（付 6 生命）",
        resultText: "骷髅嘎嘎笑着，墙缝里滚出一串金币。",
        outcomes: [
          { kind: "lose_hp", amount: 6 },
          { kind: "gain_gold", amount: 90 },
        ],
      },
      {
        label: "问它讨要药水（付 6 生命）",
        resultText: "它吐出一只还带着体温的小瓶。",
        outcomes: [{ kind: "lose_hp", amount: 6 }, { kind: "gain_potion" }],
      },
      {
        label: "捂住耳朵走开",
        resultText: "你不想再听它废话，快步离开了。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "the_nest",
    description: "石梁上垒着一个巨大的鸟巢，巢里既有闪光的碎金，也供着一柄祭祀用的匕首。",
    choices: [
      {
        label: "掏走巢里的碎金",
        resultText: "你抓了满满一把金屑，惊起的怪鸟扑棱着飞远了。",
        outcomes: [{ kind: "gain_gold", amount: 50 }],
      },
      {
        label: "握住祭刀，割手立誓",
        resultText: "血顺着刀刃滴落，一股嗜血的锋锐涌入你的牌组。",
        outcomes: [
          { kind: "lose_hp", amount: 6 },
          { kind: "add_card", cardId: "ritual_dagger" },
        ],
      },
    ],
  },
  {
    id: "the_mausoleum",
    description: "一具华丽的石棺横在墓室中央，缝隙里透出金光，也透出一丝说不清的阴冷。",
    choices: [
      {
        label: "撬开石棺取走陪葬",
        resultText: "金银哗啦作响，可你分明感到有什么东西缠上了你。",
        outcomes: [
          { kind: "gain_gold", amount: 90 },
          { kind: "add_card", cardId: "writhe" },
        ],
      },
      {
        label: "敬而远之",
        resultText: "你朝石棺欠了欠身，退出了墓室。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "cursed_tome",
    description:
      "讲台上摊着一本自行翻页的古书，每读一页都像有什么在啃食你的精神，但书末似乎压着件宝物。",
    choices: [
      {
        label: "强忍着读到最后",
        resultText: "合上书时你几乎脱力，指间却多了一件古物。",
        outcomes: [{ kind: "lose_hp", amount: 12 }, { kind: "gain_relic" }],
      },
      {
        label: "果断合上书页",
        resultText: "你按住乱翻的书，退开了几步。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "winding_halls",
    description: "一段扭曲反复的长廊在你面前岔开，每一条路似乎都要用不同的代价换取通行。",
    choices: [
      {
        label: "抄阴森的近路（受创，但更强韧）",
        resultText: "穿过那片阴冷时你抖了个寒战，出来却觉得皮实了几分。",
        outcomes: [
          { kind: "lose_hp", amount: 8 },
          { kind: "gain_max_hp", amount: 8 },
        ],
      },
      {
        label: "走稳妥的远路（歇口气）",
        resultText: "路虽然绕，你却难得地喘匀了气。",
        outcomes: [{ kind: "heal", amount: 15 }],
      },
      {
        label: "闯没探过的密道（有赏也有殃）",
        resultText: "密道尽头是一小袋金币，还有一片甩不掉的晦气。",
        outcomes: [
          { kind: "gain_gold", amount: 50 },
          { kind: "add_card", cardId: "decay" },
        ],
      },
    ],
  },
  {
    id: "sensory_stone",
    description: "一块半透明的感知之石悬在半空，触碰它似乎能把某些陌生的技艺直接灌进脑海。",
    choices: [
      {
        label: "把手按上去（受创，换来新知）",
        resultText: "一阵刺痛过后，你的脑中凭空多出了一套陌生的招式。",
        outcomes: [
          { kind: "lose_hp", amount: 5 },
          { kind: "add_card", cardId: "apparition" },
        ],
      },
      {
        label: "不去招惹它",
        resultText: "你收回手，绕过了那块石头。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "falling_pit",
    description: "脚下的石板毫无征兆地塌陷，你堪堪抓住崖壁的藤蔓，可背上的行囊正一件件往深渊里掉。",
    choices: [
      {
        label: "松开一只手，保住性命（丢一张牌）",
        resultText: "你甩掉一件累赘换来平衡，稳稳落回了地面。",
        outcomes: [{ kind: "remove_random_card" }],
      },
      {
        label: "死死抱住行囊硬扛（磕得不轻）",
        resultText: "东西一件没丢，你自己却结结实实摔了一跤。",
        outcomes: [{ kind: "lose_hp", amount: 10 }],
      },
    ],
  },
  // —— 补全批次 4：更靠后的 ? 事件（既有 outcome）——
  {
    id: "council_of_ghosts",
    description: "一圈半透明的幽魂围坐着，低声邀你加入它们的低语——代价是把几缕虚影收进牌里。",
    choices: [
      {
        label: "与它们低语（收下 3 张幻影）",
        resultText: "冷意钻进指尖，三缕虚影化作牌，落进了你的牌组。",
        outcomes: [
          { kind: "add_card", cardId: "apparition" },
          { kind: "add_card", cardId: "apparition" },
          { kind: "add_card", cardId: "apparition" },
        ],
      },
      {
        label: "婉拒它们的邀请",
        resultText: "你退出圈外，幽魂们的低语渐渐散了。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "face_trader",
    description: "一张会浮动的石面具悬在龛中，它开口议价：拿脸上的一点血色，换你想要的东西。",
    choices: [
      {
        label: "以血换财",
        resultText: "面具吸走你几分气色，吐出一串金币。",
        outcomes: [
          { kind: "lose_hp", amount: 10 },
          { kind: "gain_gold", amount: 75 },
        ],
      },
      {
        label: "戴上面具（换一件遗物）",
        resultText: "戴上的一瞬你几乎窒息，摘下时手中已多了件古物。",
        outcomes: [{ kind: "lose_hp", amount: 12 }, { kind: "gain_relic" }],
      },
      {
        label: "不与它做交易",
        resultText: "你别过脸，快步走开。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "mind_bloom",
    description:
      "空气里绽开一朵由记忆凝成的花，它许诺满足你此刻最强烈的渴望——无论是变强，还是发财。",
    choices: [
      {
        label: "渴望力量（磨砺 3 张牌）",
        resultText: "花瓣拂过，你手上几件家伙齐齐利了一截。",
        outcomes: [{ kind: "upgrade_random_card", count: 3 }],
      },
      {
        label: "渴望财富（大笔金币，附带心魔）",
        resultText: "金币如潮涌来，可花心也塞给你一缕挥不去的心魔。",
        outcomes: [
          { kind: "gain_gold", amount: 150 },
          { kind: "add_card", cardId: "doubt" },
        ],
      },
      {
        label: "无欲无求，转身离去",
        resultText: "你没有伸手，花在身后悄然合拢。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "tomb_of_the_red_mask",
    description: "一座猩红面具装点的陵墓横在路上，墓志铭只有一句：倾其所有者，得其所愿。",
    choices: [
      {
        label: "献上身上所有金币",
        resultText: "钱袋倾空的刹那，墓中亮起，一件赤红古物落入你手。",
        outcomes: [{ kind: "lose_gold", amount: 9999 }, { kind: "gain_relic" }],
      },
      {
        label: "不舍得，绕道而行",
        resultText: "你捂紧钱袋，绕过了这座贪婪的陵墓。",
        outcomes: [{ kind: "nothing" }],
      },
    ],
  },
  {
    id: "fountain_of_cleansing",
    description: "一眼清泉汩汩涌着莹白的光，泉眼旁的石碑写着：涤去缠身之秽者，可轻装再上路。",
    choices: [
      {
        label: "以泉水净身（涤除一张牌）",
        resultText: "一缕污浊被泉水冲散，你的牌组清爽了些。",
        outcomes: [{ kind: "remove_random_card" }],
      },
      {
        label: "只掬水润喉便走",
        resultText: "清冽的泉水下肚，倦意也淡了几分。",
        outcomes: [{ kind: "heal", amount: 10 }],
      },
    ],
  },
  {
    id: "divine_fountain",
    description: "一泓明净的圣泉在洞窟深处静静流淌，传说饮下它的人能焕然一新。",
    choices: [
      {
        label: "痛饮圣泉（大幅回复）",
        resultText: "暖流涤过全身，多日的伤痛竟一扫而空。",
        outcomes: [{ kind: "heal", amount: 40 }],
      },
      {
        label: "灌满水囊留作后用",
        resultText: "你把圣水装进随身的瓶子，或许路上能救急。",
        outcomes: [{ kind: "gain_potion" }],
      },
    ],
  },
];

const EVENT_MAP: ReadonlyMap<string, EventDef> = new Map(
  EVENT_LIST.map(event => [event.id, event]),
);

export const ALL_EVENTS: readonly EventDef[] = EVENT_LIST;

export function getEventDef(id: string): EventDef {
  const def = EVENT_MAP.get(id);
  if (!def) {
    throw new Error(`未知事件 id: ${id}`);
  }
  return def;
}

/** ? 节点事件池（不含开局祝福涅奥）。 */
export const EVENT_POOL: readonly string[] = EVENT_LIST.filter(
  event => event.id !== NEOW_EVENT_ID,
).map(event => event.id);
