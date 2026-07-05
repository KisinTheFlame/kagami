// === 尖塔引擎的领域类型 ===
//
// 全部为纯数据（JSON 可往返），是存档、模拟器、HTTP 契约共享的形状。
// 复刻的是杀戮尖塔的**机制与数值**（功能性游戏规则），卡面文案为原创中文。
//
// 设计依据：本仓库根 AGENTS.md「KV 缓存优先」+ office-hours 设计文档 + issue #234。

export type CharacterId = "ironclad" | "silent" | "defect" | "watcher";

export type CardType = "attack" | "skill" | "power" | "status" | "curse";

/** 卡牌颜色：决定属于哪个角色的卡池；status/curse = 塞进牌组的废牌（不进任何奖励池）。 */
export type CardColor = "red" | "green" | "blue" | "purple" | "colorless" | "status" | "curse";

/** 卡稀有度：奖励按稀有度加权抽取；starter/special 不进普通奖励池。 */
export type CardRarity = "starter" | "common" | "uncommon" | "rare" | "special";

/** 状态效果标识。切片集合：被动修正器 + 时机触发机制（见 powers/）。 */
export type PowerId =
  | "strength" // 力量：攻击伤害 +N（被动，可负、持续）
  | "dexterity" // 敏捷：获得的格挡 +N（被动，可负、持续）
  | "vulnerable" // 易伤：受到攻击伤害 ×1.5（回合末 -1）
  | "weak" // 虚弱：造成攻击伤害 ×0.75（回合末 -1）
  | "frail" // 脆弱：获得的格挡 ×0.75（回合末 -1）
  | "entangled" // 缠绕：本回合无法打出攻击牌（回合末 -1，红色奴隶主专属）
  | "poison" // 中毒：持有者回合开始受到 = 层数的伤害（无视格挡），然后层数 -1（静默主机制）
  | "focus" // 集中：机器人充能球的被动/唤醒数值 +N（被动修正器）
  | "metallicize" // 金属化：每当自己回合结束，获得 N 点格挡（拉加维林睡眠期）
  | "ritual" // 仪式：回合开始 +N 力量（触发）
  | "curl_up" // 蜷缩：首次被攻击时获得格挡（触发，一次性）
  | "sharp_hide" // 反甲：被攻击时对攻击者（玩家）反弹 N 点无视格挡的伤害（守卫者防御姿态）
  | "enrage" // 激怒：玩家每打出一张技能牌，此敌人获得 = 层数的力量（地精头目）
  | "artifact" // 神器：抵消下一个施加到自己身上的减益（每抵消一个消耗一层）
  | "demon_form" // 恶魔形态：每个玩家回合开始时获得 = 层数的力量（玩家能力牌）
  | "thorns" // 荆棘：每次被攻击时对攻击者反弹 = 层数的伤害（无视其格挡）
  | "regen" // 再生：每回合结束回复 = 层数的生命，然后层数 -1
  | "plated_armor" // 镀甲：每回合结束获得 = 层数的格挡；受到穿透格挡的攻击伤害时 -1 层
  | "angry" // 狂怒：每次受到攻击伤害，获得 = 层数的力量（狂暴地精）
  | "spore_cloud" // 孢子云：死亡时给玩家施加易伤（真菌兽，显示用；实际死亡效果在 deathEffects）
  | "mode_shift" // 模式切换累计（守卫者，内部计数用）
  // —— 玩家能力牌触发型 power（在对应触发点由 combat 结算，玩家专属）——
  | "combust" // 燃烧：每个玩家回合结束，失 1 生命并对所有敌人造成 = 层数的伤害
  | "feel_no_pain" // 无痛：每消耗一张牌，获得 = 层数的格挡
  | "dark_embrace" // 暗黑拥抱：每消耗一张牌，抽 = 层数的牌
  | "juggernaut" // 主宰：每当你获得格挡，对随机敌人造成 = 层数的伤害
  | "brutality" // 残暴：每个玩家回合开始，失 = 层数的生命并抽 = 层数的牌
  | "barricade" // 壁垒：格挡不再于回合开始清空（层数只作存在标记）
  | "rupture" // 破裂：每当你因打出的牌失去生命，获得 = 层数的力量
  | "thousand_cuts" // 千刃：每打出一张牌，对所有敌人造成 = 层数的伤害
  | "after_image" // 残影：每打出一张牌，获得 = 层数的格挡
  | "noxious_fumes" // 毒雾：每个玩家回合开始，令所有敌人获得 = 层数的中毒
  | "devotion" // 虔诚：每个玩家回合开始，获得 = 层数的法力（观者）
  | "mental_fortress" // 心之堡垒：每次姿态改变，获得 = 层数的格挡（观者）
  | "rushdown" // 疾攻：每次进入愤怒姿态，抽 = 层数的牌（观者）
  | "storm" // 风暴：每打出一张能力牌，充能 = 层数的闪电球（机器人）
  | "heatsinks" // 散热：每打出一张能力牌，抽 = 层数的牌（机器人）
  | "static_discharge" // 静电放电：每受到穿透格挡的攻击伤害，充能 = 层数的闪电球（机器人）
  | "machine_learning" // 机器学习：每个玩家回合开始，多抽 = 层数的牌（机器人）
  | "evolve" // 进化：每抽到一张状态牌，额外抽 = 层数的牌
  | "corruption" // 腐化：技能牌费用变 0，且打出后消耗（铁甲）
  | "nirvana" // 涅槃：每次预知，获得 = 层数的格挡（观者）
  | "infinite_blades" // 无尽之刃：每个玩家回合开始，将 = 层数的飞刀加入手牌（静默）
  | "intangible" // 虚无缥缈：受到的一切伤害降为 1（回合结束 -1 层）
  | "blur" // 疾影：格挡不在回合开始清空（层数即剩余生效回合数，回合末 -1）
  | "biased_cognition" // 偏置认知：每个玩家回合开始失去 1 点集中（机器人）
  | "buffer" // 缓冲：抵消下一次会让你失去生命的伤害（每抵消一次 -1 层）
  | "battle_hymn" // 战歌：每个玩家回合开始，将 = 层数的痛斩加入手牌（观者）
  | "strength_temp" // 临时力量：回合结束时失去 = 层数的力量（屈伸），随后本 power 清零
  | "rage" // 暴怒：本回合每打出一张攻击牌，获得 = 层数的格挡（回合末清零）
  | "double_tap" // 连击：接下来的 = 层数张攻击牌各额外结算一次（每消耗一次 -1 层）
  | "berserk" // 狂暴：每个玩家回合开始，获得 = 层数的能量（代价是自身易伤，狂暴）
  | "loop" // 循环：每个玩家回合开始，额外触发最左侧球的被动 = 层数次（机器人）
  | "tools_of_the_trade" // 行业工具：每个玩家回合开始，抽 = 层数的牌并随机弃 = 层数的牌（静默）
  | "wave_of_the_hand" // 挥手：本回合每当你获得格挡，令所有敌人获得 = 层数的虚弱（观者，回合末清零）
  | "deva_form" // 提婆形态：每个玩家回合开始获得 = 层数的能量，然后层数 +1（观者，能量递增）
  | "vigor" // 活力：下一张攻击牌额外造成 = 层数的伤害（打出后清零，烈焰花环）
  | "no_draw" // 本回合无法再抽牌（战意；回合开始清除）
  | "foresight" // 未卜先知：每个玩家回合开始预知 = 层数张（观者）
  | "panache" // 华彩：本回合每打出满 5 张牌，对所有敌人造成 = 层数的伤害（观者）
  | "free_attack" // 回身步：下 = 层数张攻击牌费用视为 0（每打出一张攻击消耗一层）
  | "accuracy" // 敏锐：飞刀（shiv）额外造成 = 层数的伤害（静默）
  | "lock_on" // 靶心：带此的敌人受到闪电/暗球伤害 ×1.5（回合末 -1，机器人）
  | "choked" // 扼喉：本回合玩家每打出一张牌，此敌人损失 = 层数的生命（玩家回合末清除，静默）
  | "well_laid_plans" // 深谋远虑：回合结束可额外保留至多 = 层数张牌（静默）
  | "mark" // 标记：玩家每次攻击此敌人，获得 = 层数的格挡（观者·以手言心，敌人身上）
  | "envenom" // 淬毒：玩家攻击造成穿透格挡的伤害时，给该敌人施加 = 层数的中毒（静默）
  | "shackled" // 枷锁：此敌人被临时削弱的力量，将在其行动过后归还（内部记账，黑暗枷锁）
  | "sadistic_nature" // 虐念：玩家每给敌人施加一个减益，对其造成 = 层数的伤害（静默）
  | "establishment" // 既定事实：每当一张牌被保留，其费用永久 -层数（观者）
  | "study" // 研习：每个玩家回合结束，将 = 层数张「洞悉」加入抽牌堆（观者）
  | "omega" // 奥米加：每个玩家回合结束，对所有敌人造成 50×层数 的伤害（观者）
  | "master_reality" // 掌控现实：战斗中生成的牌进场即升级（观者）
  | "corpse_bomb" // 尸爆：此敌人死亡时，把它的中毒施加给其余所有敌人（静默，敌人身上）
  | "self_repair" // 自我修复：战斗结束时回复 = 层数的生命（机器人）
  | "magnetism" // 磁力：每个玩家回合开始，将 = 层数张随机无色牌加入手牌（机器人）
  | "flame_barrier" // 火焰屏障：本回合每当被攻击，对攻击者反弹 = 层数的伤害（回合末清除，铁甲）
  | "like_water" // 静如止水：回合结束若处于平静姿态，获得 = 层数的格挡（观者）
  | "burst" // 爆发：接下来的 = 层数张技能牌各额外结算一次（每消耗一次 -1 层，静默）
  | "phantasmal" // 幻杀：本回合你的攻击造成双倍伤害（回合末清除，静默）
  | "collect" // 采集：接下来 = 层数个回合，回合开始各将一张 0 费「洞悉」加入手牌（每回合 -1，观者）
  | "fire_breathing" // 烈焰吐息：每当你抽到状态牌或诅咒牌，对所有敌人造成 = 层数的伤害（铁甲）
  | "mayhem" // 混乱：每个玩家回合开始，打出抽牌堆顶 = 层数张牌（机器人）
  | "amplify" // 增幅：接下来的 = 层数张能力牌各额外结算一次（每张 -1 层，机器人）
  | "echo_form" // 回响形态：每回合你打出的第一张牌额外结算一次（机器人）
  | "creative_ai" // 创意 AI：每个玩家回合开始，将 = 层数张随机能力牌加入手牌（机器人）
  | "no_card_block" // 无法格挡：牌产生的格挡被抑制（层数即剩余生效回合数，回合末 -1，应急按钮）
  | "electrodynamics"; // 电动力学：闪电球伤害命中所有敌人（机器人）

/** 玩家出牌 / 敌人出招共用的效果原语。target 相对「行动者」解析。 */
export type Effect =
  // strengthMultiplier：力量按该倍率计入伤害（重刃 ×3/×5）；省略即 ×1（普通攻击）。
  | { kind: "deal_damage"; amount: number; strengthMultiplier?: number }
  | { kind: "deal_damage_all"; amount: number }
  | { kind: "deal_damage_multi"; amount: number; times: number }
  // 每次命中随机挑一个存活敌人（剑刃回旋镖：3 点 ×3，逐次随机目标）。
  | { kind: "deal_damage_random"; amount: number; times: number }
  | { kind: "deal_damage_equal_to_block" }
  // 敌人用：伤害取自本敌人锁定的固定值（红虱咬击；六火之灵分割 times 连击）。
  | { kind: "deal_damage_rolled"; times?: number }
  // 敌人用：按玩家当前生命锁定一个每击伤害存入 rolledDamage（六火之灵激活：floor(hp/divisor)+add）。
  | { kind: "store_hp_scaled_damage"; divisor: number; add: number }
  | { kind: "gain_block"; amount: number }
  // 玩家用：当前格挡翻倍（坚守）。
  | { kind: "double_block" }
  // 玩家用：充能一颗指定类型的球（机器人；球槽满则先唤醒最左侧的球）。
  | { kind: "channel_orb"; orbType: OrbType }
  // 玩家用：唤醒最左侧 count 颗球（触发唤醒效果后移除）。
  | { kind: "evoke"; count: number }
  // 玩家用：进入指定姿态（观者；离开平静时 +2 能量）。
  | { kind: "enter_stance"; stance: PlayerStance }
  // 敌人用：给一名随机存活友军加格挡（护盾地精保护）。
  | { kind: "gain_block_ally"; amount: number }
  | { kind: "apply_power"; power: PowerId; amount: number; on: "self" | "target" | "all_enemies" }
  | { kind: "draw"; amount: number }
  | { kind: "gain_energy"; amount: number }
  | { kind: "lose_hp"; amount: number }
  // 玩家回复最大生命的百分比（血之药水 40%）。
  | { kind: "heal_percent"; percent: number }
  // 玩家回复固定生命（包扎等）。
  | { kind: "heal"; amount: number }
  // 玩家用：当前力量翻倍（极限爆发）。
  | { kind: "double_strength" }
  // 玩家永久提升最大生命并回复等量（果汁药水）。
  | { kind: "gain_max_hp"; amount: number }
  // 敌人用：偷取玩家金币（拾荒者，最多偷 amount，玩家金币不足则偷光）。
  | { kind: "steal_gold"; amount: number }
  // 敌人用：本敌人逃离战斗（拾荒者烟雾弹后逃跑）。
  | { kind: "escape" }
  // 敌人用：本敌人回复自身生命（带壳寄生虫吸取）。
  | { kind: "heal_self"; amount: number }
  // 敌人用：治疗一名受伤的友军（秘法师；无受伤友军则治自己）。
  | { kind: "heal_ally"; amount: number }
  // 敌人用：召唤若干敌人加入战斗（地精首领召唤地精；新生者本回合不行动）。
  | { kind: "summon"; defIds: string[] }
  | { kind: "add_card"; cardId: string; pile: "draw" | "discard" | "hand"; count: number }
  // —— X 费牌：xValue = 打出时的能量，以下效果按 X 次 / X 倍结算 ——
  | { kind: "deal_damage_all_x"; amount: number } // 对所有敌人造成 amount 伤害，X 次（旋风斩）
  | { kind: "deal_damage_x"; amount: number } // 对目标造成 amount 伤害，X 次（穿刺）
  | { kind: "gain_block_x"; amount: number } // 获得 amount 格挡，X 次（强化机体）
  | { kind: "evoke_x" } // 唤醒 X 颗球（多重施法）
  | { kind: "channel_orb_x"; orbType: OrbType } // X 费：充能 X 颗指定球（雷暴倾泻）
  | { kind: "channel_orb_per_enemy"; orbType: OrbType } // 每个存活敌人充能 1 颗指定球（透骨寒）
  | {
      kind: "apply_power_x";
      power: PowerId;
      amount: number;
      on: "self" | "target" | "all_enemies";
    } // 施加 amount×X 层
  // —— 按数量结算：伤害 / 格挡随牌堆 / 手牌 / 状态动态计算 ——
  | { kind: "deal_damage_draw_pile_count" } // 对目标造成 = 抽牌堆张数的伤害（心灵冲击）
  | { kind: "gain_block_per_hand_card"; amount: number } // 每张手牌获得 amount 格挡（灵盾）
  | { kind: "deal_damage_per_hand_type"; cardType: CardType; amount: number } // 手牌中每张该类型牌，对目标造成 amount 伤害（飞镖：每张技能）
  | { kind: "deal_damage_perfected"; amount: number; per: number } // 基础 amount + per×(各区「打击」名牌数)（完美打击）
  | { kind: "deal_damage_bane"; amount: number } // 对目标造成 amount；若目标中毒则再造成 amount（剧毒之刃）
  // 玩家用：增减球槽数（吞噬 -1、电容器 +2）；下限 0。
  | { kind: "change_orb_slots"; delta: number }
  // 玩家用：获得法力（观者；累积到 10 自动进入神性姿态）。
  | { kind: "gain_mantra"; amount: number }
  // 玩家用：预知——看抽牌堆顶 amount 张，自动弃掉其中的状态牌，其余留在顶端（观者）。
  | { kind: "scry"; amount: number }
  // 玩家用：抽到手牌上限（疾书）。
  | { kind: "draw_to_full" }
  // —— 消耗手牌联动 / 生命偷取 ——
  | { kind: "exhaust_non_attacks" } // 消耗手牌中所有非攻击牌（断魂）
  | { kind: "exhaust_non_attacks_gain_block"; amount: number } // 消耗所有非攻击牌，每张 +amount 格挡（二度呼吸）
  | { kind: "exhaust_hand_damage"; amount: number } // 消耗全部手牌，每张对目标造成 amount 伤害（恶魔烈焰）
  | { kind: "deal_damage_all_lifesteal"; amount: number } // 对所有敌人造成 amount，回复实际造成的总伤害（收割）
  // —— 更多计数 / 状态操作 ——
  | { kind: "multiply_target_poison"; factor: number } // 将目标当前中毒层数乘以 factor（催化剂）
  | { kind: "deal_damage_per_orb"; amount: number } // 场上每颗充能球对目标造成 amount 伤害（弹幕）
  | { kind: "deal_damage_per_enemy"; amount: number } // 对目标造成 amount×(存活敌人数) 伤害（保龄冲击）
  | { kind: "deal_damage_lesson"; amount: number } // 对目标造成 amount；若因此击杀，永久升级牌组中一张随机牌（研学有成）
  | { kind: "drain_marked_enemies" } // 所有敌人损失 = 各自标记层数的生命（点穴）
  | { kind: "play_top_card_exhaust" } // 打出抽牌堆顶的牌并消耗之（浩劫）
  | { kind: "cap_hand_cost"; cap: number } // 本回合把手牌费用压到不超过 cap（顿悟）
  | { kind: "add_random_card_free"; pool: "power" | "skill" | "attack" } // 将一张随机牌加入手牌，费用视为 0（白噪音/分心/地狱之刃）
  | { kind: "discard_hand_draw_same" } // 弃掉整手，然后抽等量的牌（精算赌注）
  | { kind: "bonus_if_target_weak"; energy: number; draw: number } // 若目标虚弱：+energy 能量并抽 draw 张（勾拳）
  | { kind: "put_hand_card_on_draw_bottom_free" } // 把一张手牌置于抽牌堆底，本场费用视为 0（深谋；自动取最贵）
  | { kind: "draw_if_no_attacks"; amount: number } // 若手牌中没有攻击牌，抽 amount 张（急躁）
  | { kind: "exhaust_hand_up_to"; count: number } // 消耗手牌中至多 count 张（净化；自动取费用最低的）
  | { kind: "exhaust_one_draw"; draw: number } // 消耗一张手牌，然后抽 draw 张（焚誓；自动取费用最低）
  | { kind: "copy_hand_card"; count: number } // 复制手牌中的一张攻击/能力牌 count 份加入手牌（双持；自动取费用最高）
  | { kind: "gain_energy_if_last_attack"; amount: number } // 若上一张打出的是攻击牌，获得 amount 能量（追击）
  | { kind: "return_from_discard" } // 从弃牌堆取回一张牌到手牌（冥想；自动取最近弃掉的一张）
  | { kind: "gain_random_potion" } // 获得一瓶随机药水（炼金）
  | { kind: "transmutation" } // X 费：将 X 张随机无色牌加入手牌，本场费用视为 0（嬗变）
  | { kind: "upgrade_all_cards" } // 本场剩余时间内升级你所有的牌（神化）
  | { kind: "schedule_bomb"; turns: number; damage: number } // turns 回合后对所有敌人造成 damage（炸弹）
  | { kind: "add_random_cards_to_draw"; pool: "skill" | "attack"; count: number } // 将 count 张随机牌洗入抽牌堆，费用视为 0（蜕变/变形）
  | { kind: "fission" } // 唤醒所有充能球，每唤醒一颗获得 1 能量并抽 1 张（裂变）
  | { kind: "return_from_exhaust" } // 从消耗堆取回一张牌到手牌（掘尸；自动取最近消耗的一张）
  | { kind: "conjure_blade" } // X 费：将一张「湮灭之刃」加入手牌，其伤害随 X 提升（铸刃）
  | { kind: "lose_hp_per_hand_card" } // 失去 = 手牌张数的生命（悔恨，回合末在手时触发）
  | { kind: "play_top_card_twice" } // 打出抽牌堆顶的牌两次，随后消耗（全知）
  | { kind: "schedule_phantasmal" } // 下个回合你的攻击造成双倍伤害（幻杀）
  | { kind: "return_zero_cost_from_discard" } // 把弃牌堆里所有 0 费牌收回手牌（一心一意）
  | { kind: "put_hand_card_on_draw_free" } // 把一张手牌置于抽牌堆顶，本场费用视为 0（布置；自动取最贵的一张）
  | { kind: "scrape_draw"; count: number } // 抽 count 张，随后弃掉其中费用 >0 的（削刮）
  | { kind: "schedule_card_copies"; count: number } // 把一张手牌（自动取当前费用最高）预约到下回合加 count 张副本（噩梦）
  | { kind: "schedule_extra_turn" } // 本次结束回合后跳过敌人行动，直接再获得一个回合（宝库）
  | { kind: "collect_charge" } // X 费：接下来 X 个回合，回合开始各将一张 0 费「洞悉」加入手牌（采集）
  | { kind: "end_turn" } // 打出结算后立即结束本回合（终局；在 playCard 收尾处检测）
  | { kind: "bonus_if_target_vulnerable"; energy: number; draw: number } // 若目标易伤：+energy 能量并抽 draw 张（飞踢）
  | { kind: "weaken_enemy_strength"; amount: number } // 使目标临时失去 amount 力量，其行动后归还（黑暗枷锁）
  | { kind: "weaken_all_enemies_strength"; amount: number } // 使所有敌人临时失去 amount 力量，各自行动后归还（穿刺尖啸）
  | { kind: "deal_damage_plus_mantra_gained"; base: number } // 对目标造成 base + 本场累计法力（璀璨光辉）
  | { kind: "deal_damage_all_per_frost_channeled"; per: number } // 对所有敌人造成 per×本场充能冰霜数（暴风雪）
  | { kind: "deal_damage_random_per_lightning_channeled"; amount: number } // 对随机敌人造成 amount，重复=本场充能闪电数（雷霆一击）
  // —— 下回合预约 / 弃牌 / 随机毒 / 抽到指定张数 ——
  | { kind: "gain_block_next_turn"; amount: number } // 下个回合开始获得 amount 格挡（闪转腾挪）
  | { kind: "gain_energy_next_turn"; amount: number } // 下个回合开始获得 amount 能量（飞膝/战略欺骗）
  | { kind: "draw_next_turn"; amount: number } // 下个回合开始多抽 amount 张（掠食者）
  | { kind: "schedule_next_turn_x" } // X 费：下回合多抽 X 张并多得 X 能量（镜影分身）
  | { kind: "schedule_stance_next_turn"; stance: PlayerStance; draw: number } // 下回合开始进入姿态并抽 draw 张（烈怒渐起）
  | { kind: "set_doomed" } // 下个回合开始时角色死亡（亵渎）
  | { kind: "gain_energy_if_discarded"; amount: number } // 若本回合弃过牌，获得 amount 能量（声东击西）
  | { kind: "draw_if_cards_played_le"; max: number; amount: number } // 若本回合出牌数≤max，抽 amount（超光速）
  | { kind: "draw_then_block_if_skill"; amount: number } // 抽 1 张，若为技能则获得 amount 格挡（脱身之策）
  | { kind: "discard_random"; count: number } // 随机弃掉 count 张手牌（优先状态牌）（杂技/有备而来）
  | { kind: "discard_non_attacks" } // 弃掉手牌中所有非攻击牌（卸货）
  | { kind: "apply_poison_random"; amount: number; times: number } // 对随机敌人施加 amount 中毒，重复 times 次（弹跳药瓶）
  | { kind: "draw_up_to"; target: number } // 抽牌直到手牌达到 target 张（专精）
  | { kind: "deal_damage_per_attack"; amount: number } // 对目标造成 amount×(本回合此前打出的攻击牌数)（终结技）
  // —— 机器人补完：条件格挡 / 随机球 / 计数能量 / 移除格挡 ——
  | { kind: "gain_block_if_none"; amount: number } // 若当前无格挡，获得 amount 格挡（自动护盾）
  | { kind: "channel_random_orb"; count: number } // 随机充能 count 颗球（混沌）
  | { kind: "gain_block_discard_count"; perCard: number } // 每张弃牌堆的牌获得 perCard 格挡（堆叠）
  | { kind: "gain_energy_per_draw_pile"; divisor: number } // 抽牌堆每 divisor 张给 1 能量（聚合）
  | { kind: "remove_target_block" } // 移除目标的全部格挡（熔化）
  // —— 观者补完 / 铁甲收尾 ——
  | { kind: "change_max_energy"; delta: number } // 增减每回合最大能量（苦修 -1）
  | { kind: "gain_block_if_wrath"; base: number; bonus: number } // 获得 base 格挡；若处于愤怒姿态再 +bonus（止）
  | { kind: "execute_if_below"; threshold: number } // 若目标当前生命 ≤ threshold 则直接击杀（审判）
  | { kind: "apply_strength_temp"; amount: number } // 立即 +amount 力量，本回合结束时失去（屈伸）
  // —— 单卡实例自我成长（读写打出的这张牌的 bonus，本场战斗内有效）——
  | { kind: "deal_damage_scaling"; base: number } // 对目标造成 base + 本牌 bonus 的伤害（暴走/玻璃刀）
  | { kind: "gain_block_scaling"; base: number } // 获得 base + 本牌 bonus 的格挡（坚韧）
  | { kind: "grow_self"; amount: number } // 本牌 bonus += amount（可负，玻璃刀 -2）
  | { kind: "shuffle_discard_into_draw" } // 将弃牌堆洗入抽牌堆（深呼吸）
  // —— 击杀触发 / 意图条件 ——
  | { kind: "deal_damage_kill_maxhp"; base: number; maxhp: number } // 造成 base；若击杀目标，永久 +maxhp 最大生命（喂养）
  | { kind: "deal_damage_kill_gold"; base: number; gold: number } // 造成 base；若击杀目标，获得 gold 金币（贪婪之手）
  | { kind: "deal_damage_ritual"; base: number; grow: number } // 造成 base+本牌bonus；若击杀，本牌 bonus += grow（仪式匕首）
  | { kind: "gain_strength_if_target_attacking"; amount: number } // 若目标意图为攻击，获得 amount 力量（觅敌之弱）
  | { kind: "deal_damage_weak_if_attacking"; base: number; weak: number } // 造成 base；若目标意图为攻击，施加 weak 虚弱（瞄准眼睛）
  | { kind: "put_discard_card_on_top" } // 将弃牌堆最近一张牌置于抽牌堆顶（头槌）
  | { kind: "fetch_from_draw"; cardType?: CardType } // 从抽牌堆检索一张（指定类型则限该类型）到手牌（秘密武器/技巧/搜寻）
  | { kind: "add_random_colorless"; count: number } // 将 count 张随机无色卡加入手牌（全能）
  // —— 条件伤害 / 击杀返能 / 受击加甲 ——
  | { kind: "deal_damage_all_if_draw_empty"; amount: number } // 若抽牌堆为空，对所有敌人造成 amount（大结局）
  | { kind: "deal_damage_kill_energy"; base: number; energy: number } // 造成 base；若击杀目标，获得 energy 能量（分裂）
  | { kind: "deal_damage_gain_block_dealt"; base: number } // 造成 base，获得等同于实际造成伤害的格挡（痛打）
  | { kind: "reboot"; draw: number } // 将手牌与弃牌堆全部洗回抽牌堆，然后抽 draw 张（重启）
  | { kind: "make_random_hand_card_free" } // 随机使一张手牌本场费用变 0（疯狂）
  | { kind: "put_hand_card_on_top" } // 将一张手牌（随机非本牌）置于抽牌堆顶（未雨绸缪）
  | { kind: "return_discard_to_hand" } // 将弃牌堆最近一张牌收回手牌（全息影像）
  | { kind: "recursion" } // 唤醒最左侧球，再把同类型球重新充能到末位（递归）
  | { kind: "discard_hand_for_shivs" } // 弃掉全部手牌，每弃一张将 1 张飞刀加入手牌（钢铁风暴）
  // —— 观者条件牌 ——
  | { kind: "gain_block_draw_if_last_skill"; block: number; draw: number } // 获得 block 格挡；若上一张打出的是技能牌则抽 draw 张（神圣）
  | { kind: "deal_or_enter_wrath"; vuln: number } // 若处于愤怒则令所有敌人获得 vuln 易伤，否则进入愤怒（义愤）
  | { kind: "draw_or_enter_calm"; draw: number } // 若处于平静则抽 draw 张，否则进入平静（内心平静）
  | { kind: "deal_damage_if_hand_all_attacks"; amount: number } // 若手牌其余全为攻击牌，对目标造成 amount（招牌动作）
  | { kind: "exhaust_random"; count: number }; // 随机消耗 count 张手牌（坚毅）

/** 卡定义（静态数据表）。cost=null 表示不可打出（status/废牌）。 */
export type CardDef = {
  id: string;
  name: string;
  type: CardType;
  rarity: CardRarity;
  /** 卡牌颜色（所属角色卡池）。 */
  color: CardColor;
  cost: number | null;
  /** 升级后的费用（省略=不变）；用于力压/见红等升级降费卡。 */
  upgradedCost?: number;
  /** X 费牌：打出时消耗全部能量，X = 消耗的能量，effects 里的 *_x 效果按 X 结算（旋风斩等）。 */
  xCost?: boolean;
  /** 固有：战斗开局必定在起手牌中（背刺等）。 */
  innate?: boolean;
  /** 打出时费用按本回合已弃牌数下调（下限 0）（剖体斩）。 */
  costMinusDiscardThisTurn?: boolean;
  /** 打出时费用按本场已打出的能力牌数下调（下限 0）（力场）。 */
  costMinusPowersPlayedThisCombat?: boolean;
  /** 打出时费用按本场失血次数下调（下限 0）（血债血偿）。 */
  costMinusHpLossCountThisCombat?: boolean;
  /** 每打出一次，本实例本场永久 -1 费（下限 0）（流水线）。 */
  costReducesOnPlay?: boolean;
  /** 打出时费用按本场失血次数上调（巧计一击）。 */
  costPlusHpLossCountThisCombat?: boolean;
  /** 需要选择一个敌人目标（攻击类多为 true；AoE / 自身增益为 false）。 */
  targeted: boolean;
  /** 打出后进入消耗堆而非弃牌堆。 */
  exhausts: boolean;
  /** 保留：回合结束时不进弃牌堆，留在手中（观者部分卡）。 */
  retain?: boolean;
  /** 虚无：回合结束时若仍在手牌中，则被消耗（而非进弃牌堆）。 */
  ethereal?: boolean;
  /** 回合结束时若此牌在手牌中，以玩家为行动者结算这些效果（灼烧/腐朽自伤、疑虑虚弱等）。 */
  endOfTurnInHand?: Effect[];
  /** 被牌效果从手牌弃掉时，以玩家为行动者结算这些效果（急智回能量、应激反射抽牌）。 */
  onDiscard?: Effect[];
  /** 升级后的 onDiscard（省略则沿用 onDiscard）。 */
  upgradedOnDiscard?: Effect[];
  /** 被消耗（进消耗堆）时，以玩家为行动者结算这些效果（哨戒回能量）。 */
  onExhaust?: Effect[];
  /** 被抽到手牌时，以玩家为行动者结算这些效果（无尽痛楚：加一张自身副本）。 */
  onDraw?: Effect[];
  /** 被抽到时立即消耗自身（机械降神：抽到即生成奇迹并消耗）。 */
  exhaustOnDraw?: boolean;
  effects: Effect[];
  upgradedEffects: Effect[];
  description: string;
  upgradedDescription: string;
};

/** 牌组里的一张牌实例。bonus=本场自我成长数值（暴走/玻璃刀）；costZero=本实例本场费用视为 0（疯狂）。 */
export type CardInstance = {
  uid: number;
  defId: string;
  upgraded: boolean;
  bonus?: number;
  costZero?: boolean;
  /** 本实例本场累计的永久降费（流水线：每打出一次 +1，playCard 时从费用扣除，下限 0）。 */
  costReduction?: number;
  /** 本回合费用上限（顿悟：把手牌费用压到不超过此值；回合结束清除）。 */
  costCapThisTurn?: number;
};

export type PowerInstance = { id: PowerId; amount: number };

/** 敌人一次出招。intent 是给玩家看的意图分类；effects 是实际结算。 */
export type EnemyMove = {
  id: string;
  name: string;
  effects: Effect[];
  /** 给玩家渲染意图用的分类。attack 的展示数值在运行时按当前状态重算。 */
  intent: EnemyIntentKind;
};

export type EnemyIntentKind = "attack" | "defend" | "buff" | "debuff" | "unknown";

/** 敌人意图选择规则：脚本开局 + 加权随机 + 连续限制（复刻 StS 手感，issue #234 C8）。 */
export type IntentRule = {
  /** 按回合序号固定出招（1-based）；用尽后转 weighted。 */
  scripted: string[];
  weighted: { move: string; weight: number; maxInARow: number }[];
};

/** 敌人定义（静态数据表）。 */
export type EnemyDef = {
  id: string;
  name: string;
  hpMin: number;
  hpMax: number;
  moves: EnemyMove[];
  intentRule: IntentRule;
  /** 守卫者专用：模式切换阈值。省略表示无模式切换。 */
  modeShiftThreshold?: number;
  /** 守卫者专用：防御姿态下的出招表 id 与进攻姿态出招表 id。 */
  stanceMoves?: { offensive: string[]; defensive: string[] };
  /** 半血分裂：降到 ≤maxHp/2 时分裂成这些敌人（各自 HP = 分裂瞬间当前 HP）。 */
  splitInto?: string[];
  /** 亡语：此敌人死亡时结算的效果（真菌兽孢子云给玩家易伤）。 */
  deathEffects?: Effect[];
  /** 复活：首次死亡时以此 HP 复活并获得力量（觉醒者二阶段），仅触发一次。 */
  reviveHp?: number;
};

export type EnemyState = {
  defId: string;
  name: string;
  hp: number;
  maxHp: number;
  block: number;
  powers: PowerInstance[];
  /** 最近若干次出招 id（判 maxInARow）。 */
  moveHistory: string[];
  /** 循环型出招（Boss 姿态轮转）的进度指针。 */
  rotationIndex: number;
  /** 本回合已 telegraph 的出招 id。 */
  currentMove: string;
  /** 蜷缩是否已消耗。 */
  curlUpConsumed: boolean;
  /** 出生时掷定、整场固定的攻击基础值（红虱咬击 5~7）。0 表示该敌人不用此机制。 */
  rolledDamage: number;
  /** 是否沉睡（拉加维林开局睡眠；受伤或睡满自然醒时置 false）。 */
  asleep: boolean;
  /** 是否已分裂过（半血分裂只触发一次）。 */
  hasSplit: boolean;
  /** 是否已复活过（觉醒者二阶段只触发一次）。 */
  hasRevived: boolean;
  /** 是否已逃离战斗（拾荒者烟雾弹后逃跑；逃跑后不再算作战斗目标）。 */
  escaped: boolean;
  /** 守卫者：进攻姿态下累计受到的伤害（达阈值切姿态后清零，非每回合重置——复刻 StS 累计语义）。 */
  modeShiftAccum: number;
  modeShiftThreshold: number | null;
  stance: "offensive" | "defensive" | null;
};

/** 充能球类型（机器人专属）：闪电/冰霜/暗/等离子。 */
export type OrbType = "lightning" | "frost" | "dark" | "plasma";

/** 一颗充能球实例（占一个球槽）。value 供暗球累积的伤害用（其它球恒为 0/省略）。 */
export type Orb = { type: OrbType; value?: number };

/** 玩家姿态（观者专属）：平静 / 愤怒 / 神性 / 无。神性下攻击 ×3，回合结束退出。 */
export type PlayerStance = "none" | "calm" | "wrath" | "divinity";

export type CombatState = {
  turn: number;
  energy: number;
  maxEnergy: number;
  playerBlock: number;
  playerPowers: PowerInstance[];
  enemies: EnemyState[];
  hand: CardInstance[];
  drawPile: CardInstance[];
  discardPile: CardInstance[];
  exhaustPile: CardInstance[];
  /** 机器人充能球（左→右按槽位排列）；非机器人对局恒为空。 */
  orbs: Orb[];
  /** 球槽数量（机器人默认 3；其他角色 0）。 */
  orbSlots: number;
  /** 玩家姿态（观者）：愤怒下攻击/受击双倍；离开平静 +2 能量。默认 none。 */
  playerStance: PlayerStance;
  /** 观者法力：累积到 10 自动进入神性姿态并清空。默认 0（非观者恒为 0）。 */
  mantra: number;
  /** 预约到下个玩家回合开始的格挡 / 能量 / 抽牌（闪转腾挪/飞膝/掠食者等）。用完清零。 */
  nextTurnBlock: number;
  nextTurnEnergy: number;
  nextTurnDraw: number;
  /** 预约到下个回合开始进入的姿态（烈怒渐起）；null=不预约。 */
  nextTurnStance: PlayerStance | null;
  /** 噩梦：预约下个回合开始加入手牌的牌副本；null=不预约。 */
  nightmarePending: { cardId: string; count: number } | null;
  /** 炸弹：预约在若干回合后对所有敌人造成伤害；null=无。 */
  pendingBomb: { turns: number; damage: number } | null;
  /** 宝库：为真则本次结束回合后不让敌人行动，直接再获得一个玩家回合。默认 false。 */
  extraTurnPending: boolean;
  /** 亵渎：为真则下个回合开始时角色死亡。默认 false。 */
  doomedNextTurn: boolean;
  /** 幻杀：为真则下个回合开始时获得「幻杀」（当回合攻击双倍）。默认 false。 */
  nextTurnPhantasmal: boolean;
  /** 本回合已打出的攻击牌数（终结技按此结算；每回合开始清零）。 */
  attacksThisTurn: number;
  /** 本回合已（由牌效果）弃掉的手牌数（剖体斩降费 / 声东击西给能量按此；回合开始清零）。 */
  cardsDiscardedThisTurn: number;
  /** 本回合已打出的牌数（含当前正在结算的这张）（超光速判据 / 华彩每 5 张触发；回合开始清零）。 */
  cardsPlayedThisTurn: number;
  /** 本场战斗累计获得的法力（璀璨光辉按此结算；整场不清零）。 */
  mantraGainedThisCombat: number;
  /** 本场战斗累计充能的冰霜球数（暴风雪按此结算；整场不清零）。 */
  frostChanneledThisCombat: number;
  /** 本场战斗累计充能的闪电球数（雷霆一击按此结算；整场不清零）。 */
  lightningChanneledThisCombat: number;
  /** 本场战斗累计打出的能力牌数（力场按此降费；整场不清零）。 */
  powersPlayedThisCombat: number;
  /** 本场战斗玩家失血的次数（血债血偿按此降费；整场不清零）。 */
  timesLostHpThisCombat: number;
  /** 上一张打出的牌的类型（神圣「若上一张是技能」判据）；null=本回合还没打过。 */
  lastCardType: CardType | null;
  /** 本场战斗奖励的敌人组标识（用于 reward 生成）。 */
  encounterId: string;
  isBoss: boolean;
};

export type RewardState = {
  /** 三选一（或跳过）的卡奖励，存 defId + 是否升级。 */
  cardChoices: { defId: string; upgraded: boolean }[];
};

/** 持有的遗物实例。counter 供计数型遗物用（如「每出 N 张攻击牌」），默认 0。 */
export type RelicState = { id: string; counter: number };

export type MapNodeType = "combat" | "elite" | "event" | "rest" | "shop" | "treasure" | "boss";

/** 分支地图节点（DAG）。next 是上一层可达节点 id；Boss 节点 next 为空。 */
export type MapNode = {
  id: string;
  row: number;
  col: number;
  type: MapNodeType;
  next: string[];
};

export type MapGraph = {
  nodes: Record<string, MapNode>;
  rows: number;
  /** 底层入口节点 id（首次选路从这里挑）。 */
  startNodeIds: string[];
  bossNodeId: string;
};

export type Screen =
  | "map"
  | "combat"
  | "reward"
  | "rest"
  | "event"
  | "shop"
  | "gameover"
  | "victory";

/** 当前进行中的事件（? 节点）。 */
export type EventState = { id: string };

/** 商店一件在售商品。sold 后不可再买。 */
export type ShopItem =
  | { kind: "card"; defId: string; cost: number; sold: boolean }
  | { kind: "relic"; id: string; cost: number; sold: boolean }
  | { kind: "potion"; id: string; cost: number; sold: boolean };

/** 商店库存（进店时一次性生成，定价固定）。 */
export type ShopState = {
  items: ShopItem[];
  /** 去牌服务费用。 */
  purgeCost: number;
  /** 本店去牌服务是否已用（每店限一次）。 */
  purgeUsed: boolean;
  /** 是否处于「选择要移除的牌」子界面。 */
  removing: boolean;
};

/** RNG 内部状态：必须完整可序列化并从存档精确复原（issue #234 C11）。 */
export type RngState = { s0: number; s1: number; s2: number; s3: number };

export type GameState = {
  /** 每个动作后自增，供 HTTP 幂等（expectedVersion）与乐观并发。 */
  version: number;
  runId: string;
  seed: number;
  character: CharacterId;
  ascension: number;
  /** 当前幕（1-based）。打完本幕 Boss 若还有后续幕则携带状态进入下一幕。 */
  act: number;
  screen: Screen;
  hp: number;
  maxHp: number;
  gold: number;
  /** 大牌组（master deck）。 */
  deck: CardInstance[];
  /** 持有的遗物（按获得顺序）。 */
  relics: RelicState[];
  /** 药水槽（定长 3；null = 空槽）。 */
  potions: (string | null)[];
  /** 战斗后掉药水的概率加成（基础 40%，未掉 +10、掉了 -10）。 */
  potionDropBonus: number;
  map: MapGraph;
  /** 当前所在地图节点 id；null = 还没进入地图（在底层选入口）。 */
  currentNodeId: string | null;
  combat: CombatState | null;
  reward: RewardState | null;
  /** 当前进行中的事件（? 节点）；null = 不在事件屏。 */
  event: EventState | null;
  /** 当前商店库存；null = 不在商店屏。 */
  shop: ShopState | null;
  /** 已进入过的普通战斗数（决定抽 weak / strong encounter 池，复刻 StS Act1 节奏）。 */
  combatsEntered: number;
  /** 本场战斗胜利后是否发一个遗物（精英战为 true；下次 generateReward 消费后清零）。 */
  pendingRelicReward: boolean;
  rng: RngState;
  /** 递增的牌实例 uid 分配器。 */
  nextUid: number;
  /** 仅「本次动作」产生的日志；GET /state 返回时清空（KV 字节确定性，issue #234 C3）。 */
  log: string[];
};
