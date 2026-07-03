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

const EVENT_LIST: EventDef[] = [
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

export const EVENT_POOL: readonly string[] = EVENT_LIST.map(event => event.id);
