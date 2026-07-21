# YiYi 三组核心问题深度代码审计与技术研究

审计对象：用户上传的最新完整代码归档  
代码状态：`codex/yiyi-core`，提交 `4760b9c`  
审计范围：Voice Realtime、推荐上下文/约束/搜索/评分/视觉排序、Voice Dock 与 YiYi 云朵动效  
审计方式：逐文件代码链审查、关键模块直接运行验证、现有测试覆盖检查、成熟 SDK/动画与推荐系统方案研究

---

# 总结结论

目前三组问题并不是三个孤立的 UI bug，而是三条底层链路分别存在结构性缺口：

1. **Voice 的根本问题不是单纯“VAD 参数不合适”**。当前同时存在自动打断过于激进、原始 SDK 事件直接覆盖产品状态、首轮与后续轮次工具策略不一致、修改工具 schema 过重、Confirm 过早断开连接、语音成功回复未与真实 mutation 成功绑定等问题。

2. **推荐算法的基础方向是正确的，但情境语义层明显不足**。现有 constraint-first + beam search + deterministic scoring + visual rerank 架构值得保留；真正的问题是活动仍是自由文本、物品缺乏运动/安全能力字段、可选配饰被搜索系统系统性奖励、context 权重过弱、修改可选槽位时不能删除、视觉模型只评价“好不好看”而非“适不适合做这件事”。

3. **Voice Dock 不应继续在现有三个按钮上修补**。应建立一个明确的 `VoiceTurnController` 状态机，并将唯一中央云朵按钮作为主要交互。动画层首选现有的 Motion for React；只有拥有真正设计完成的 `.riv` 资产时，再考虑 Rive State Machine。GSAP 不应负责持续 Voice 状态动画。

---

# 第一组：语音太敏感、易被噪声打断

## 一、当前实现

核心位置：

- `src/lib/realtime/voice-session.ts`
- `src/app/api/realtime/token/route.ts`
- `src/lib/realtime/voice-session-coordinator.ts`
- `src/app/today/page.tsx`
- `src/prompts/realtime-agent.ts`

客户端和 token route 当前均使用：

```ts
{
  type: "semantic_vad",
  eagerness: "high",
  createResponse: true,
  interruptResponse: true
}
```

客户端原始事件处理：

```ts
speech_started → listening
speech_stopped → thinking
```

没有判断：

- 当前是否已经进入 Understanding；
- 当前推荐工具是否正在执行；
- YiYi 是否正在 Speaking；
- 新声音是否只是呼吸、背景声或扬声器回声；
- 当前产品状态是否允许自动 barge-in。

## 二、已确认的主要问题

### 1. `high` 与 `interruptResponse:true` 组合过于激进

`high` 使系统更积极地结束用户轮次；`interruptResponse:true` 又允许任何被 VAD 判定为 speech-start 的新声音中断当前回复。

因此可能发生：

```text
用户说完
→ Understanding
→ 背景中出现轻微声音
→ speech_started
→ 产品状态被改回 Listening
→ 当前 response 被打断
```

安静环境成功、普通环境频繁失败，与这条链路一致。

### 2. 产品状态被原始 SDK 事件直接驱动

当前 `VoiceState` 只有：

```text
idle
connecting
listening
thinking
speaking
interrupted
error
```

它没有表达：

```text
turn_committing
understanding
tool_running
revising
presenting
recoverable_error
```

因此一个低层 `speech_started` 就能覆盖高层的推荐执行状态。这是状态建模问题，不只是参数问题。

### 3. 当前 Adapter 不支持用户要求的中央按钮语义

`VoiceSessionAdapter` 只暴露：

```ts
connect()
disconnect()
mute()
```

没有：

```ts
interrupt()
commitTurn()
startListening()
cancelCurrentOperation()
```

所以当前 UI 无法实现：

```text
Listening 时点击 → 我说完了
Speaking 时点击 → 立即打断并重新听
Error 时点击 → 重试
```

### 4. 首轮工具切换存在竞态

首轮只暴露推荐工具并强制调用，这是正确方向。

但当前在 `agent_tool_start` 时就立即：

```text
toolChoice → auto
updateAgent(runtimeAgent)
```

而实际推荐 handler 又等待这次 agent 更新完成才执行。

因此当前顺序是：

```text
推荐工具开始
→ 切换 Agent
→ 等待切换
→ 才运行推荐
```

更可靠的顺序应是：

```text
推荐工具完整执行
→ outfit 成功提交
→ agent_tool_end success
→ 再切换到运行时 Agent
```

### 5. 后续修改允许“只说不做”

初次推荐后，tool choice 恢复为 `auto`。模型可以说：

```text
OK.
```

却不调用任何修改工具。

这正是“语音答应了，但衣服没变化”的一种直接原因。

### 6. Revision schema 要求模型输出内部管线字段

`revise_current_outfit` 直接使用完整的 `IntentDeltaSchema`。其中必填：

```ts
confidence
ambiguity
```

以及多组内部数组和 adjustments。

实际真机日志已经出现：

```text
TOOL_ARGUMENTS_INVALID
zodIssuePaths: confidence, ambiguity
```

这些字段不应由 Realtime 模型承担。模型只应表达用户想做什么，内部 delta 应由服务端生成。

### 7. Confirm 过早断开连接

`confirmCurrent()` 当前在 tool handler 返回之前执行：

```ts
await disconnectVoice()
```

这会导致 SDK 还未把 tool result 发回模型，WebRTC data channel 已被关闭。

它还会造成一个更直接的产品问题：

```text
用户刚确认或点击 Wear this today
→ Voice session 被断开
→ 用户马上想继续修改
→ YiYi 已经听不到
```

### 8. 修改后的语音反馈没有与真实状态更新绑定

当前工具只返回：

```ts
success
summary
```

没有标准化返回：

```text
changedSlots
removedItemIds
addedItemIds
outfitVersionId
noEffectReason
```

因此模型可能在没有真实变化时仍然说“OK”。

---

## 三、建议的新 Voice 架构

### 1. 建立 `VoiceTurnController`

不要让页面直接消费原始 SDK 事件。建立产品级状态机：

```text
disconnected
connecting
listening
committing
understanding
tool_running
revising
speaking
interrupted
recoverable_error
```

原始事件只作为输入，不能直接决定最终 UI。

### 2. 采用“持续连接 + 显式单轮麦克风控制”

WebRTC 连接保持在线，但麦克风按产品状态开关：

```text
点击云朵
→ 开启麦克风
→ Listening

自动判断用户说完
或再次点击云朵
→ commit 当前音频
→ 麦克风静音
→ Understanding

YiYi Speaking
→ 麦克风保持静音
→ 避免回声和背景噪声打断

用户点击云朵
→ interrupt()
→ 停止 YiYi
→ 再次进入 Listening
```

### 3. 推荐 VAD 策略

第一轮建议测试：

```ts
semantic_vad
eagerness: "auto"
interruptResponse: false
```

理由：

- 用户已经拥有明确的手动打断按钮；
- 自动打断只作为手不方便时的补充；
- 背景噪声不应直接取消 YiYi 的 response；
- `auto` 比 `high` 更适合自然停顿。

如果仍存在大量 false speech-start，再用真实 iPhone A/B 测试 `server_vad` 的 threshold，而不是凭感觉改值。

### 4. 用一个最小 action router 取代复杂 Voice tools

建议后续每一轮强制经过一个统一工具：

```ts
handle_outfit_turn({
  action:
    | "revise"
    | "remove_item"
    | "confirm"
    | "explain"
    | "random"
    | "undo"
    | "availability"
    | "preference"
    | "no_change",
  userRequest: string,
  targetSlot?: string,
  targetDescription?: string
})
```

模型不再提交：

```text
confidence
ambiguity
完整 IntentDelta
本地 item UUID
```

服务端根据：

- 当前 outfit；
- 当前 focused item；
- subtype/category/slot；
- 用户原话；

解析真实目标并生成内部 delta。

### 5. 禁止“修改未发生却口头成功”

工具执行后增加 post-condition：

```text
remove sunglasses
→ 当前 outfit 中 sunglasses 必须不存在

replace shoes
→ shoes ID 必须改变

make it warmer
→ warmth predicate 必须改善

random
→ outfit ID 必须与当前不同
```

若条件不成立：

- 自动尝试一次合法替代；
- 仍无法完成时，给出自然且具体的说明；
- 不能说“OK”。

建议语气不是生硬的：

```text
I heard you, but I couldn’t remove them yet.
```

而是根据真实原因生成：

```text
I can take the sunglasses out — I’m adjusting the accessories now.
```

如果最终确实无法生成合法修改：

```text
I removed the sunglasses, but your wardrobe doesn’t have another suitable accessory, so I left that spot empty.
```

核心原则是：先真实完成，再说结果。

---

## 四、Voice 测试要求

必须新增：

1. noise false-start 不覆盖 `tool_running`；
2. Speaking 中背景声不会自动 cancel；
3. 手动点击可以 interrupt；
4. Listening 中点击可以 commit turn；
5. 首轮 recommendation 成功后才切换 runtime Agent；
6. 每个后续 turn 必须经过 action router；
7. Tool no-op 不能返回 success；
8. Confirm tool result 发回后才允许断开；
9. Confirm 后 grace period 内仍可继续修改；
10. Revision 不再要求 `confidence/ambiguity`；
11. 用户说“remove sunglasses”时，状态、版本和页面同步变化；
12. stale SDK event 不覆盖新 generation。

---

# 第二组：推荐修改链路与推荐算法

## 一、当前架构中值得保留的部分

当前推荐核心采用：

```text
Canonical context
→ Hard constraints
→ Anchor-first beam search
→ Deterministic scoring
→ Visual rerank
→ Versioned mutation
```

这比让模型直接生成衣服 ID 可靠得多。以下能力已经较强：

- required/excluded item；
- availability；
- explicit hard avoid；
- separates/one-piece 结构；
- preserved slots；
- operation generation；
- base-version CAS；
- exact Undo；
- deterministic fallback。

因此不建议推翻整个架构，改成一个纯 LLM 推荐器。

---

## 二、篮球 + 戒指问题已被代码直接复现

使用当前实际推荐模块运行：

```text
activity: play basketball
comfortPriority: 5
photoPriority: 1
walkingIntensity: 2
```

最高分推荐仍包含：

```text
shirt
shorts
sneakers
crossbody bag
gold necklace
sunglasses
```

前八个候选都包含 bag、jewelry 和 extraAccessory。

这说明问题不是某一次模型偶然选错，而是当前 deterministic search 本身系统性偏向“填满配饰”。

---

## 三、根因

### 1. Activity 只是自由文本

`DailyIntent.activities` 只有：

```ts
label
timeOfDay
```

没有规范化：

```text
活动类型
体力强度
活动安全
活动环境
运动幅度
出汗概率
碰撞风险
携带需求
```

### 2. Occasion 规则覆盖极少

当前只识别大致：

```text
office/work
dinner/date
gallery/museum
walk/errand/casual/coffee
party/wedding/event
travel
```

没有：

```text
basketball
gym
running
hiking
cycling
lab
beach
concert
interview
```

未识别活动会退化为 `everyday` 匹配，而大量衣物和配饰都带 `everyday` 标签。

### 3. Hard constraints 不理解活动安全

当前 validator 主要检查：

- outfit 结构；
- ID；
- availability；
- explicit exclusion；
- hard avoid；
- rain；
- 高 walking 下的低舒适鞋；
- preserve slots。

没有：

```text
篮球不能戴戒指/项链
高强度运动不带非必要包
跑步需要 secure athletic footwear
实验室需要 closed-toe shoes
```

### 4. 搜索过程系统性奖励可选配饰

Beam stages 始终加入：

```text
bag
outerwear
jewelry
extraAccessory
```

对于一个可选槽：

- 放入物品获得正常 heuristic + compatibility 分；
- 留空只有固定 0.56。

因此只要配饰不违法，算法通常更愿意把它加入。

### 5. Targeted revision 无法删除可选槽

当前逻辑在 targeted revision 命中可选槽时，不提供 `undefined` 选项。

所以：

```text
remove sunglasses
```

算法不能真正让 `extraAccessory` 为空，只能换成：

```text
cap / scarf / belt / another eyewear
```

直接运行验证中，排除 sunglasses 后系统改成了 cap，而不是删除配饰。

### 6. Context 权重过弱

最终总分中 `contextFit` 权重有限，而 `occasionFit` 又只是 contextFit 的一小部分，实际对总分影响约为几个百分点。

用户偏好、视觉搭配和可选配饰收益可以轻易压过场景合理性。

### 7. Comfort 不计算配饰

当前 comfort/practicality 主要评价核心衣物和鞋，配饰几乎不参与运动便利性判断。

### 8. 视觉模型无法修复这类问题

视觉 ranking prompt 只评价：

```text
visualCoherence
colorBalance
silhouetteBalance
materialHarmony
styleClarity
```

它看到的候选已经由本地搜索生成。若全部候选都带不合理配饰，视觉模型只能从错误集合里选一个“最好看”的。

---

## 四、建议的新推荐语义层

### 1. 增加规范化 `SituationProfile`

由模型从用户自然语言提取，但由服务端 schema 验证：

```ts
{
  activityType:
    | "sport_active"
    | "commute"
    | "office"
    | "social"
    | "formal"
    | "creative"
    | "outdoor"
    | "travel"
    | "home",
  physicalIntensity: 0..5,
  mobilityNeed: 0..5,
  sweatLikelihood: 0..5,
  environment: "indoor" | "outdoor" | "mixed",
  contactRisk: 0..5,
  carryNeed: "none" | "light" | "medium",
  accessoryPolicy: "forbidden" | "minimal" | "optional" | "desired",
  safetyFlags: string[]
}
```

### 2. 增加物品能力字段

每件衣物除风格属性外，还应拥有：

```text
mobility
breathability
secureFit
sportSuitability
snagRisk
impactRisk
weatherProtection
carryUtility
activityTags
confidence
provenance
```

Terra 可以提供初始识别，用户修正具有更高优先级。

### 3. 将活动规则编译为 hard/soft constraints

例如篮球：

```text
hard:
- no ring
- no dangling jewelry
- no insecure footwear
- no restrictive bottom

discouraged:
- nonessential bag during play
- sunglasses for indoor court
- outerwear during active play

required/strong:
- athletic or secure closed footwear
- mobility
- breathability
```

如用户描述的是“去球场看朋友打球”而非“我要打篮球”，规则应不同。因此必须理解动作主体和活动强度，不能只关键词匹配。

### 4. 引入 `slotPolicy`

每个场景为每个槽定义：

```text
required
optional
discouraged
forbidden
```

运动场景：

```text
jewelry: forbidden
extraAccessory: discouraged/forbidden
bag: optional before/after activity
```

这样搜索不会机械填满全部槽位。

### 5. 评分改成层级，而非单一加权平均

建议优先级：

```text
1. 安全、availability、explicit request
2. 场景可行性
3. 舒适和行动需求
4. 用户偏好
5. 视觉兼容
6. 新鲜度
```

安全和场景不可被“更好看”补偿。

### 6. 多活动采用最弱项/转场策略

当前对多个活动做平均容易掩盖冲突。

例如：

```text
白天打篮球
晚上吃饭
```

应明确生成：

- 一套可完成两个场景的折中方案；
- 或篮球后只需要替换一件的 transition plan。

不能只把两个活动的匹配分平均。

---

## 五、修改链路必须同步重构

### 1. 允许删除可选目标槽

Targeted revision 对：

```text
bag
jewelry
extraAccessory
outerwear
```

必须允许 `undefined`。

### 2. 目标解析由服务端完成

用户说：

```text
I don’t want the sunglasses.
```

服务端从当前 outfit 中解析：

```text
extraAccessory
category=eyewear
subtype=sunglasses
current item ID
```

而不是要求模型知道本地 UUID。

### 3. 旧 intent 不应无限累积

当前 `applyIntentDelta()` 会持续 union：

```text
required items
excluded items
excluded categories
temporary rules
```

需要区分：

```text
本次 turn 临时要求
本日 session 约束
长期 preference
已经被用户撤销的约束
```

否则对话越长，隐藏约束越多，最终可能无候选或行为不可解释。

### 4. 每次修改必须验证请求是否真正生效

建议统一返回：

```ts
{
  success: true,
  outfitVersionId,
  changedSlots,
  removedItemIds,
  addedItemIds,
  satisfiedPredicates
}
```

UI 和 Voice 都以这份结果为准。

---

## 六、必须新增的推荐验收场景

当前 golden tests 场景太少，应新增：

```text
篮球
健身房
跑步
徒步
实验室
面试
婚礼
海边
雨天通勤
大量步行
打球后聚餐
指定一件 hoodie
remove sunglasses
no jewelry
remove bag
warmer
less colorful
tiny wardrobe
hard constraint conflict
```

测试不应断言固定 item ID，而应断言语义不变量，例如：

```text
basketball → no jewelry
running → secure athletic footwear
remove sunglasses → no sunglasses
targeted shoes → only shoes change
```

---

# 第三组：Voice Dock 与 YiYi 云朵动效

## 一、当前 UI 的结构问题

现有 `VoiceDock`：

- 左侧 Mic/MicOff；
- 中央云朵；
- 右侧 PhoneOff；
- active 时中央云朵可能变成不可点击的 `<div>`。

因此：

- 左右两个图标视觉相似；
- 一个是 toggle，一个是立即结束，危险级别完全不同；
- 中央视觉焦点在最需要操作时反而没有行为；
- 用户必须猜测三个图标；
- 产品体验更像通话控制台，而不是 YiYi Live。

---

## 二、建议的唯一中央控件

删除主界面的左右按钮，只保留中央云朵。

| 状态 | 点击行为 | 文案 |
|---|---|---|
| Disconnected | 连接并开始 | Tap to talk |
| Connecting | 暂不重复触发 | Connecting… |
| Listening | 手动提交本轮 | Listening · Tap when done |
| Committing | 不重复提交 | Got it… |
| Understanding | 可取消并重新听，或暂时锁定 | Understanding… |
| Revising | 根据 mutation 阶段决定是否可取消 | Updating your outfit… |
| Speaking | interrupt 并重新监听 | Tap to interrupt |
| Error | 重试 | Tap to retry |

会话退出不再占据主界面：

```text
离开页面
进入后台
长时间空闲
设置中的 End voice session
```

---

## 三、动效技术选择

### 首选：Motion for React

项目已经安装 Motion。它适合：

- 状态驱动的 SVG 动画；
- spring；
- variants；
- 可中断切换；
- reduced motion；
- GPU-friendly transform/opacity；
- 不依赖 React 每帧重渲染。

### GSAP 的职责

GSAP继续只负责：

- Onboarding 的固定 storyboard；
- 可 seek/replay 的演示时间线。

不应用于持续运行的 Voice Core 状态动画。

### Rive 的条件

Rive State Machine 是更高级的长期方向，适合：

```text
idle
listening
understanding
speaking
error
```

但只有在真正制作好 `.riv` 资产时使用。不要让 Codex仅为了“用了 Rive”而自动生成粗糙资产。

比赛阶段建议：

```text
Motion SVG 完成成熟版本
→ 真机验证
→ 赛后由设计工作流升级为 Rive
```

---

## 四、YiYi 云朵动画设计

### Idle

- 几乎静止；
- 4–6 秒极轻微呼吸；
- 动画会 settle，不永久高频运动。

### Connecting

- 一条柔和轨迹完成单次环绕；
- 不使用普通 360° spinner；
- 建立“正在建立联系”的感觉。

### Listening

- 云朵轻微纵向压缩、横向舒展；
- 2–3 层非同步浅环扩散；
- 有有效 speech energy 时幅度增加；
- 无声音时保持安静，不持续夸张 pulse。

### Committing

- 用户点击“说完”或自动结束时：
- 所有外环向内收拢；
- 云朵轻微压缩；
- 形成一个清晰的 turn boundary。

### Understanding

- 不再旋转；
- 环形视觉缓慢向中心聚合；
- 云朵表情进入专注但温和状态；
- 表达“收拢信息”，不是 loading。

### Revising

- 单次聚焦 pulse；
- 与页面中目标衣物的 replacement 同步；
- 云朵不应独立演完一段与衣物无关的循环。

### Speaking

- 嘴部或下方曲线极轻微变化；
- 外环向外释放；
- 若能获取输出音量，幅度随音频能量变化；
- 点击后立即 spring 收束并进入 Listening。

### Interrupted

- 当前 Speaking 动画立即停止；
- 云朵快速但克制地向内压缩；
- 无等待地进入 Listening；
- 必须体现可中断性。

### Error

- 所有循环停止；
- 仅保留淡红轮廓或一个静止提示；
- 不 shake，不制造焦虑。

### Reduced Motion

- 使用静态形态、透明度和文案变化；
- 取消持续缩放、扩散和旋转；
- 状态含义仍完整。

---

## 五、可参考的成熟实现

可研究但不直接照搬：

- OpenAI Realtime Agents 的 session/mute/interrupt/commit 能力；
- Motion 官方 SVG、variants、springs、gesture 和 reduced-motion patterns；
- Rive State Machine 与 Data Binding；
- LiveKit 开源 React Voice Assistant 的 audio visualizer/state mapping；
- 当前仓库中的：
  - `apple-design`
  - `emil-design-eng`
  - `animation-vocabulary`
  - `improve-animations`
  - `find-animation-opportunities`
  - `ui-sound-design`

原则是借用成熟状态建模和动画 primitive，不复制其他产品的视觉资产。

---

# 最终实施顺序

## 第一阶段：修复真实功能

1. 建立 `VoiceTurnController`；
2. `high → auto`，关闭自动 response interruption；
3. 中央按钮支持 commit/interrupt/retry；
4. Confirm 不再立即 disconnect；
5. Revision schema 最小化；
6. 每个 follow-up turn 强制 action router；
7. Mutation 后置验证，禁止 false success；
8. 可选槽允许真正删除。

## 第二阶段：修复推荐情境层

9. 建立 SituationProfile；
10. 增加 item capability；
11. 活动规则编译成 hard/soft constraints；
12. slotPolicy；
13. 重设 context/practicality 优先级；
14. 增加运动、职业、安全和 remove-item golden tests。

## 第三阶段：重构 Voice UI

15. 删除左右按钮；
16. 中央云朵接入完整状态机；
17. 用 Motion 实现所有状态；
18. 加入 reduced motion 与真机性能审查；
19. 只有高质量资产完成后再评估 Rive。

---

# 本轮验证边界

已完成：

- 最新源码逐文件审阅；
- `pnpm lint` 通过；
- `pnpm typecheck` 通过；
- 使用当前实际推荐模块直接运行，复现篮球搭配包含 bag、jewelry、sunglasses；
- 直接复现 targeted removal 把 sunglasses 换成 cap，而不是删除。

未能完整完成：

- 当前环境中的完整 Vitest suite 无法启动，因为可复用依赖目录缺少 Linux Rolldown native binding，且环境无法联网补装；
- 未在真实 iPhone 上重新测量 VAD false-start 率和动画帧稳定性；
- 未对实际 OpenAI/Photoroom provider 发起新的付费 live smoke。

因此，推荐问题的代码根因与直接运行结果置信度很高；VAD 参数最终取值仍需要真实 iPhone 噪声样本 A/B 验证。
