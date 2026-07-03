// === 术语表（游戏规则事实）===
//
// 定义是功能性游戏规则（非小镜语气），归服务作数据；agent 侧 lookup 工具经 .hbs 渲染框架文案 + 插值定义。
// 切片范围：覆盖会出现在战况里的状态与概念。

export type GlossaryEntry = {
  /** 规范中文术语名。 */
  term: string;
  /** 别名（英文 / 常见叫法），用于查询匹配。 */
  aliases: string[];
  definition: string;
};

export const GLOSSARY: readonly GlossaryEntry[] = [
  {
    term: "力量",
    aliases: ["strength", "str"],
    definition: "每有 1 层，攻击牌每次造成的伤害 +1（对多段攻击每段都 +1）。持续整场战斗，可为负。",
  },
  {
    term: "敏捷",
    aliases: ["dexterity", "dex"],
    definition: "每有 1 层，获得的格挡 +1。持续整场战斗，可为负。",
  },
  {
    term: "金属化",
    aliases: ["metallicize"],
    definition: "敌人专属：每当它的回合结束，获得等量的格挡。拉加维林睡眠期靠它维持护盾。",
  },
  {
    term: "易伤",
    aliases: ["vulnerable", "vuln"],
    definition: "受到的攻击伤害提高 50%（×1.5，向下取整）。每回合结束 -1 层。",
  },
  {
    term: "虚弱",
    aliases: ["weak"],
    definition: "造成的攻击伤害降低 25%（×0.75，向下取整）。每回合结束 -1 层。",
  },
  {
    term: "脆弱",
    aliases: ["frail"],
    definition: "获得的格挡降低 25%（×0.75，向下取整）。每回合结束 -1 层。",
  },
  {
    term: "再生",
    aliases: ["regen", "regeneration"],
    definition: "每回合结束时回复等于层数的生命，然后层数 -1，直到耗尽。",
  },
  {
    term: "镀甲",
    aliases: ["plated armor", "platedarmor"],
    definition: "每回合结束获得等于层数的格挡；每次受到穿透格挡的攻击伤害，层数 -1。",
  },
  {
    term: "仪式",
    aliases: ["ritual"],
    definition: "敌人专属：每当它的回合开始，获得等量的力量。",
  },
  {
    term: "蜷缩",
    aliases: ["curl up", "curlup"],
    definition: "敌人专属：第一次被攻击时获得一次性格挡（能挡住那一击的一部分），随后蜷缩消失。",
  },
  {
    term: "激怒",
    aliases: ["enrage"],
    definition: "敌人专属：你每打出一张技能牌，它就获得等于层数的力量。地精头目开局自带。",
  },
  {
    term: "狂怒",
    aliases: ["angry"],
    definition: "敌人专属：每次受到攻击伤害，就获得等于层数的力量。狂暴地精自带，越打越猛。",
  },
  {
    term: "孢子云",
    aliases: ["spore cloud", "sporecloud"],
    definition: "敌人专属：它死亡时对你施加 2 层易伤。真菌兽自带——秒杀它反而会吃到易伤。",
  },
  {
    term: "金属化",
    aliases: ["metallicize"],
    definition: "每回合结束时获得等于层数的格挡（定值，不受敏捷/脆弱影响）。持续整场战斗。",
  },
  {
    term: "恶魔形态",
    aliases: ["demon form", "demonform"],
    definition: "每个回合开始时获得等于层数的力量。持续整场战斗，越拖越强。",
  },
  {
    term: "反甲",
    aliases: ["sharp hide", "sharphide", "thorns"],
    definition:
      "敌人专属：你每攻击它一次，就受到 N 点无视格挡的反弹伤害（直接掉血）。守卫者防御姿态期间持有。",
  },
  {
    term: "神器",
    aliases: ["artifact"],
    definition:
      "敌人专属：抵消下一个施加到它身上的减益（易伤/虚弱/脆弱等），每抵消一个消耗一层。哨卫开局各带 1 层。",
  },
  {
    term: "虚无",
    aliases: ["ethereal"],
    definition:
      "带此关键字的牌若在回合结束时仍留在手牌中，会被消耗（移出本场战斗），而非进入弃牌堆。",
  },
  {
    term: "眩晕",
    aliases: ["dazed"],
    definition:
      "无法打出的状态牌，带虚无。占用手牌，回合结束时若还在手里就被消耗。哨卫的射钉会塞给你。",
  },
  {
    term: "格挡",
    aliases: ["block"],
    definition: "抵挡伤害的护盾。受击时先扣格挡、扣完再扣生命。每当你的回合开始时清零。",
  },
  {
    term: "能量",
    aliases: ["energy"],
    definition: "打牌的资源。每回合开始恢复到 3 点，未用完不保留到下回合。",
  },
  {
    term: "消耗",
    aliases: ["exhaust"],
    definition: "被消耗的牌移出本场战斗，不回抽牌堆也不回弃牌堆，直到战斗结束。",
  },
  {
    term: "抽牌堆",
    aliases: ["draw pile", "draw"],
    definition: "还没抽到的牌堆。抽牌时若抽牌堆空，则把弃牌堆洗入抽牌堆再抽。",
  },
  {
    term: "弃牌堆",
    aliases: ["discard pile", "discard"],
    definition: "打出的牌与回合结束时手里剩的牌进入的牌堆。抽牌堆空时会被洗回抽牌堆。",
  },
];
