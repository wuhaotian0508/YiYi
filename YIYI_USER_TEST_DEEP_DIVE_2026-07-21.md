# YiYi 真机试用问题深度定位补充报告

**审计对象：** `Woebegone-67/YiYi`，当前默认分支最新提交 `62bee6043a56eb3d716d4beb1172262c28cf1fd8`  
**证据来源：** 用户提供的 iPhone 截图、Safari 控制台日志、Vercel 日志截图，以及当前提交源码  
**日期：** 2026-07-21

## 可信度说明

- **确定：** 截图/日志与代码能够形成闭环，根因可以直接定位。
- **高置信：** 代码存在明确缺陷，和现象高度一致，但还缺一条运行时异常或事件日志才能确认是本次故障的唯一原因。
- **待补证：** 现有代码把真实异常吞掉，无法诚实地锁定唯一根因；报告会给出最短补证方法。

---

# 总览

| # | 问题 | 结论 | 严重度 | 可信度 |
|---|---|---|---|---|
| 1 | 第二页删除后立刻输入下一段 | 时间轴只留了约 0.45 秒空档 | P2 | 确定 |
| 2 | 第三页过快、文字小、标签被裁切 | 时间轴停留不足 + CSS 固定单行/小字号/父级裁切 | P1 | 确定 |
| 3 | 校准图全部男性化 | 所有 wardrobe direction 共用同一组六张静态图 | P1 | 确定 |
| 4 | 主页面左上角多余云朵、底部按钮动画不足 | 云朵是代码主动渲染；Dock 只有极弱环形动画，主体基本静止 | P2 | 确定 |
| 5 | 天气缺温度和预览组件 | 当前数据模型只保留摘要和 12 小时极值，无法直接做小时组件 | P1（新增功能） | 确定 |
| 6 | 语音能听懂/说话，但永远不出推荐 | 首次推荐工具从未启动，12 秒本地 watchdog 主动终止 | P0 | 直接原因确定；更底层原因待补证 |
| 7 | Voice error 文案没对齐 | 78px 宽单列承载长 nowrap 文本，CSS 结构不稳 | P2 | 高置信 |
| 8 | 衣物识别抠图后无法保存 | 保存阶段异常被统一吞掉，当前无法诚实确认唯一失败点 | P0 | 待补证 |
| 9 | 标签总是 Gallery 等固定内容 | `intent` 初始值和 Mock 路径直接使用 `demoIntent` | P0 | 确定 |

---

# 1. 第二页删除完成后，下一段来得太急

## 根因

文件：

```text
src/components/onboarding/conversational-onboarding.tsx
```

正常动效路径中：

```ts
.to(decisionText, { text: "", duration: 3.4 })
.set(caret, { autoAlpha: 0 })
.addLabel("reframe:start", "+=0.45")
.to(decisionText, { text: "I have class...", duration: 4.15 })
```

也就是说，旧文字完全删除后，**空白画面只维持 0.45 秒**，下一句就开始输入。用户感到“急”不是主观错觉，而是时间轴参数本身造成的。

## 修复建议

建议把空档设置为 **1.6–1.8 秒**。视觉上从最后一个字符消失到新字符出现，体感会接近两秒：

```ts
.addLabel("decision:empty-hold", "+=1.7")
.addLabel("reframe:start")
```

不要只在现有 tween 上增加 `delay`，应建立明确的 `decision:empty-hold` label，方便视觉回归测试与未来调节。

## 验收

- 删除完最后一个字符后，空框稳定停留 1.6–1.8 秒；
- 光标可保留一次自然闪烁，也可以在删除后消失；
- 新句第一行开始时不与删除动作视觉相连；
- Reduced Motion 路径也应有约 1 秒理解停留，而不是瞬间替换。

---

# 2. 第三页过快、文字太小、第三个标签被裁切

## 2.1 时间轴确实没有给人阅读时间

当前第三页大致流程：

```text
理解页出现
→ 0.55 秒后切 Understanding
→ 5 个标签以 0.34 秒 stagger 依次出现
→ 最后标签出现约 0.5 秒后整页消失
→ 衣服逐件出现
→ reason 出现约 1.2 秒后 revision request 出现
→ revision request 出现约 0.65 秒后文字开始替换
→ 约 0.35 秒后鞋子直接替换
→ 约 0.65 秒后 request 消失
→ final reason / continuity
→ 1.8 秒后自动进入下一 onboarding 阶段
```

这套动画在工程层面“完整播放了”，但产品层面几乎没有单独的**阅读停留段**。用户看到的是连续状态切换，而不是理解一个故事。

## 2.2 建议重排时间轴

建议不要靠不断拉长 tween，而是把第三页拆成明确语义段：

```text
A. What YiYi understood
   标签全部出现后停留 1.8–2.2 秒

B. Main recommendation
   衣服全部出现 + reason 完整出现后停留 2.5 秒

C. Revision request
   “Make it a little more relaxed.”
   单独停留至少 2.0 秒

D. Replacement
   鞋子完成替换后停留 2.2 秒

E. Continuity proof
   “Only the shoes changed...”
   停留 2.5 秒
```

更稳妥的产品方案是：**第三页结尾不再自动跳转**，显示一个 `Continue` 按钮。用户仍可 Skip，但不会因为阅读速度慢而错过核心卖点。

## 2.3 标签被裁切的 CSS 根因

当前 CSS 同时存在：

```css
.outfit {
  overflow: hidden;
}

.outfitTags {
  flex-wrap: nowrap;
}

.outfitTags > span {
  white-space: nowrap;
}

.meaning {
  min-width: 79px;
}
```

三个标签被强制放在同一行，内容不允许换行，父容器又隐藏溢出。在窄屏 Safari 上，第三个 `Relaxed` 被边缘裁掉是可预期结果。

## 2.4 排版修复

推荐：

```css
.outfitTags {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  width: min(100%, 350px);
  gap: 8px;
  margin-inline: auto;
}

.outfitTags > span {
  min-width: 0;
  justify-content: center;
  text-align: center;
  white-space: normal;
  font-size: 13px;
  line-height: 1.2;
  padding: 7px 8px;
}
```

若仍使用 flex，至少允许 wrap，并删除 heading 区域不必要的 `overflow:hidden`。

当前小字尺寸：

```text
标签：11px
reason / final copy：12px
revision subtitle：10px
```

真机上明显偏小。建议：

```text
标签：13px
reason / final copy：14px
revision quote：14px
revision subtitle：12px
```

## 验收

- 320、375、390、430px 宽度下三个标签均完整；
- 三个标签在视觉中心轴上对齐；
- 字体缩放 120% 时不裁切；
- 每个语义状态都有可读停留；
- 第三页不能在人尚未看清 revision request 时自动完成。

---

# 3. Womenswear / No label 后仍然全部是男性化图片

## 确定根因

用户在前一步选择：

```text
womenswear | menswear | mixed | neutral
```

但进入校准页时，`OnboardingCalibration` 的 props 中根本没有 `direction`。组件固定导入：

```ts
calibrationCatalogV2
```

六个问题固定引用：

```text
pair-relaxed-polished.webp
pair-minimal-expressive.webp
pair-soft-utility.webp
pair-fitted-oversized.webp
pair-classic-trend.webp
pair-tonal-graphic.webp
```

因此，不管用户选择 Womenswear、Menswear、Mix both 或 No label，看到的都必然是同一组六张图片。

我也检查了六张实际资源：它们几乎全部由裤装、宽肩外套、圆领针织、衬衫和西装构成，人体比例与搭配语言高度集中在同一种偏男性化/中性偏男性的展示体系。用户的感受有充分视觉依据。

## 这不是简单换几张图

应保持校准的“语义轴”一致，但根据 wardrobe direction 选择不同视觉轨道：

```ts
calibrationCatalogForDirection(direction)
```

建议资源轨道：

```text
womenswear
menswear
neutral
```

`mixed` 可以每题在 womenswear / menswear / neutral 中平衡抽取；`No label` 不应偷偷退回 menswear，而应使用真正服装导向、身体弱化的中性展示。

每条轨道必须：

- 保留相同 question ID、option ID 和 style vector；
- 只改变视觉表达，不改变 A/B 的语义；
- 增加 assetVersion 和 wardrobeDirection 元数据；
- 避免用模特性别推断用户身份；
- Womenswear 需要覆盖裙装、不同轮廓、材质、鞋型与配饰，而非仅把男装缩腰；
- Neutral 需要真正多样，而不是“男装即中性”。

## 验收

- 四个 direction 对应的资源选择有自动测试；
- Womenswear 与 Menswear 不得加载同一整套 asset；
- No label 不能默认落入 menswear；
- 同一问题在不同方向中仍测量同一个 style axis；
- 视觉测试由至少一位不同性别表达偏好的测试者评审。

---

# 4. 主页面左上角多余云朵、主按钮动画不足

## 4.1 左上云朵不是随机出现

Idle 页面当前主动渲染：

```tsx
<div className="today-morning-mark">
  <VoiceCore state="idle" disabled />
  <span>Ready for your day</span>
</div>
```

CSS 又专门将它缩小、隐藏背景波纹，因此它正是用户看到的“小云朵”。这不是 Safari 图标，也不是状态泄漏。

### 修复

主页面应只保留一个 YiYi 视觉主入口。建议删除 Idle 顶部的 `VoiceCore`，改成：

```text
Ready for your day
```

或一个极小的无品牌状态点。否则页面形成两个 YiYi 核心，主按钮的视觉权重被稀释。

## 4.2 底部按钮实际只有很弱的动画

当前 Dock：

- Listening / Speaking 时只有两圈浅灰 ring 扩散；
- 云朵主体在 Listening / Speaking 时基本静止；
- Revising 只做一次短 pulse；
- Connecting 也不是持续反馈；
- 动画不读取真实输入/输出音量。

所以“没有之前说的动画效果”是成立的：代码实现了一个最低限度状态动画，但没有实现有生命感的语音响应。

### 建议

继续使用项目已有的 Motion，不需要再加第三套动效库：

```text
Idle：极轻微呼吸
Listening：云朵随输入能量 0.98–1.06 缩放，外圈按音量扩散
Understanding：缓慢聚拢/收束
Choosing：有方向性的微旋转或层次流动
Speaking：随输出能量轻微弹性变化，表情同步
Revising：持续但克制的双脉冲
Error：一次柔和收缩，不做高频红色抖动
```

使用 MotionValue + requestAnimationFrame 更新能量，不要每帧 React `setState`。Reduced Motion 下只改变透明度和表情。

---

# 5. 天气应显示温度，并提供小型天气组件

这部分既包含一个现有信息缺失，也包含一个合理的新产品需求。

## 5.1 为什么现在没有温度

Today 顶部只显示：

```tsx
weather.summary
```

服务器虽然计算了未来 12 小时的最低/最高体感温度，却最终把摘要写成：

```text
Mild and dry
Light rain possible
```

当前数据模型没有：

- 当前温度；
- 小时温度数组；
- weather code；
- 小时图标；
- 地点名称；
- 当日 high / low 的独立字段；
- 时区化小时标签。

所以不能只做一个弹窗组件，必须先扩展 Weather API contract。

## 5.2 建议数据结构

```ts
type WeatherSnapshot = {
  locationLabel: string | null;
  timezone: string;
  current: {
    apparentTempC: number;
    weatherCode: number;
    precipitationProbability: number;
  };
  daily: {
    minApparentTempC: number;
    maxApparentTempC: number;
  };
  hourly: Array<{
    time: number;
    apparentTempC: number;
    weatherCode: number;
    precipitationProbability: number;
  }>;
  summary: string;
  fetchedAt: number;
};
```

Open-Meteo 请求应增加 current、hourly weather code、daily high/low。地点名称建议只保存城市级 label；不要把完整坐标长期存入 IndexedDB。

## 5.3 顶部展示

建议：

```text
18° · Mild and dry
```

而不是只显示 `Mild and dry`。温度取当前体感温度四舍五入。

顶部天气应改成真正的 button：

```tsx
<button aria-expanded={open} aria-controls="today-weather-panel">
```

## 5.4 天气小组件

尺寸建议：

```text
宽度：min(340px, calc(100vw - 28px))
高度：约 250–290px
位置：顶部天气按钮下方居中
```

内容：

```text
Berkeley
18°  Mild and dry
H: 21°  L: 13°

Now  4 AM  5 AM  6 AM ...
☀️    ☀️    ☁️    ☁️
18°   17°   16°   16°
```

小时横条水平滑动，使用 CSS scroll-snap；不需要把整个弹层做成横向 carousel。

交互：

- 再点天气按钮关闭；
- 点击空白处关闭；
- Escape 关闭；
- 上划超过阈值关闭；
- 弹层内水平滑动小时天气不能误触发关闭；
- 不锁死主页面滚动；
- 关闭后焦点回到天气按钮。

## 5.5 动效与“液态玻璃”

建议用 Motion 负责：

```text
open / close
轻微 scale + opacity
上划 drag dismiss
spring 回弹
```

视觉用 CSS 实现类液态玻璃：

```css
backdrop-filter: blur(22px) saturate(145%);
background:
  linear-gradient(...),
  rgb(255 255 255 / .62);
border: 1px solid rgb(255 255 255 / .72);
box-shadow:
  inset 0 1px 0 rgb(255 255 255 / .9),
  0 18px 48px rgb(30 30 35 / .14);
```

不要试图一比一复制系统私有效果；浏览器端应做克制、清晰、可读的近似。图标尺寸约 18–22px，避免天气面板压住主体内容。

---

# 6. 语音能响应，但始终无法生成穿搭

## 从日志能够确定的直接原因

Safari 控制台中多次出现：

```text
recommendation started
→ 约 12 秒
→ INITIAL_RECOMMENDATION_TIMEOUT
→ sdkConnectionStatus: disconnected
```

中间没有 `tool started`。

代码中正好存在：

```ts
const INITIAL_TOOL_WATCHDOG_MS = 12_000;
```

当 speech stopped 后：

```ts
this.startInitialToolWatchdog()
```

只有收到：

```text
agent_tool_start(request_outfit_recommendation)
```

才会清除该 watchdog。12 秒内工具没有开始，应用就自行判定失败、断开 session。因此当前表面错误的直接链路已经闭环：

```text
语音连接成功
→ 语音输入结束
→ 等待首次 recommendation tool
→ 工具未在 12 秒内开始
→ 客户端 watchdog 主动失败
→ YiYi couldn’t finish that
```

## 我不能 100% 确认的更底层原因

当前证据还不能证明“工具为什么没有在 12 秒内开始”。可能性包括：

1. 12 秒对移动 Safari、网络和较大的 strict tool schema 过短；
2. Realtime session 的 tool config 已发出，但 provider ack/response 阶段较慢；
3. 当前 SDK/Realtime model 在该会话中没有按预期进入 function call；
4. 工具定义或 schema 在服务端响应阶段存在兼容问题，但当前日志没有记录 raw response 状态；
5. 有音频回复并不等于 recommendation tool 已经执行；当前固定标签又制造了“已经理解”的假象。

代码使用 `toolChoice: "required"` 的方向本身不是明显错误；官方 Realtime API 支持 `required`，也支持强制指定某个 function。真正的问题是当前诊断只记录到“超时”，没有记录 provider 在超时前究竟创建了什么 response。

## P0 修复方案

### 第一步：不要用一个 12 秒 watchdog 包打天下

拆成三段：

```text
response-create watchdog：8–10 秒
function-call-start watchdog：25–30 秒
tool-execution timeout：保留 25 秒或按 ranking 时延调整
```

网络慢时不能在工具尚未开始前就杀死整个连接。

### 第二步：首次 turn 强制指定具体 function

首次 agent 只有一个工具，但仍建议使用 API 支持的 specific function choice：

```text
request_outfit_recommendation
```

而不是泛化的 `required`。如果当前 SDK config 类型不能安全表达，先升级/验证官方支持路径，不要用无测试的 `as any`。

### 第三步：补充安全事件诊断

记录但不保存用户音频/转录：

```text
session.updated acknowledged
effective toolChoice
tool count and tool names
response.created
response.done status
response output item types
function_call_arguments.started
function_call_arguments.done
agent_tool_start
agent_tool_end
```

这样下一次能够知道是：

```text
没有 response
response 只有 audio
有 function call 但 SDK 没触发
function call 参数没有完成
工具开始后内部 recommendation 失败
```

### 第四步：更稳健的产品架构

首次推荐不应完全依赖 Realtime 模型“及时自发”调用工具。推荐将流程改为：

```text
final user transcript
→ 应用侧只触发一次 intent extraction / recommendation transaction
→ 得到持久化 outfit version
→ 将 verified result 交给 Realtime 朗读
```

Realtime 负责自然听说，应用负责确定性业务事务。这样不会再出现“YiYi 已经说话，但业务动作从未发生”。

### 第五步：错误恢复

超时时：

- 保留用户转录；
- 显示 `Recommendation took too long`，而不是 `Voice didn’t start`；
- 提供 `Try recommendation again`，无需重新申请麦克风和重说整句；
- 不显示假的理解标签。

## 仍需验证的第二层故障

修复 tool-start 后，还要检查当前部署：

```text
/api/health/image
/api/outfits/rank
```

是否成功。此前旧部署曾有 Sharp/libvips 问题，但本轮截图使用的是另一个当前部署域名；不能诚实地把旧部署的 Sharp 错误直接当成本轮超时的唯一根因。

---

# 7. “Voice didn’t start. Tap to retry” 没有对齐

## 高置信代码问题

当前 Voice Dock 是：

```css
grid-template-columns: 78px;
```

状态文本也被放在这条 78px 的 grid track 中，并设置：

```css
text-align: center;
font-size: 11px;
white-space: nowrap;
```

短句 `Understanding…` 看起来尚可；长句 `Voice didn’t start. Tap to retry` 会从极窄轨道向两侧溢出。在 Safari 的子像素排版、浏览器工具栏和安全区共同作用下，很容易出现视觉偏移或边缘不平衡。

我没有看到该错误状态的精确截图，所以不能声称已经 100% 排除其他 Safari safe-area 问题；但当前 CSS 本身就不适合承载长状态文案。

## 修复

让按钮仍保持 72px，但状态文本拥有页面级宽度：

```css
.voice-dock-status {
  position: absolute;
  left: 50%;
  bottom: 0;
  width: min(300px, calc(100vw - 32px));
  transform: translateX(-50%);
  text-align: center;
  white-space: normal;
  text-wrap: balance;
  font-size: 12px;
  line-height: 1.35;
}
```

同时为错误状态允许两行，避免继续缩字。

## 验收

WebKit 截图覆盖：

```text
320 × 568
375 × 667
390 × 844
430 × 932
```

并测试浏览器底栏展开与收起两种 viewport。

---

# 8. 衣物识别和抠图成功，但无法保存

## 现有代码能确认什么

保存阶段全部发生在浏览器 Dexie / IndexedDB 中，不会请求 Vercel。因此 Vercel 日志里没有错误，并不能说明保存成功，也不能帮助定位本地异常。

当前保存依次执行：

```text
构建 WardrobeItem
→ 复制 original/cutout Blob
→ Canvas 生成 WebP thumbnail
→ 读取图片尺寸
→ ItemImageSetSchema 校验
→ Dexie transaction 写 wardrobeItems + itemImages
→ 单独调用 setExperienceMode("personal")
→ router.push
```

任何一步异常都被同一个无参数 `catch` 吞掉，统一显示：

```text
LOCAL_SAVE_FAILED
```

因此目前无法从现有证据中诚实地判断本次失败到底是：

- Safari thumbnail canvas / WebP 编码失败；
- Blob 无法被 Dexie structured clone；
- IndexedDB quota；
- item/image schema；
- transaction；
- 后续 `setExperienceMode`；
- 或导航前状态问题。

## 已确认的架构缺陷

衣物和图片写入完成后，才开启另一个独立 transaction 执行：

```ts
setExperienceMode("personal")
```

若第二步失败，界面会报告“无法保存”，但衣物可能已经存在。用户重试会生成新 UUID，造成重复衣物。这是确定存在的 partial-commit 风险，但尚不能证明它就是本次唯一失败点。

## 最短补证改造

给保存流程加入 stage：

```ts
let stage:
  | "validate-item"
  | "clone-blobs"
  | "thumbnail"
  | "dimensions"
  | "validate-images"
  | "dexie-write"
  | "switch-mode"
  | "navigate";
```

catch 中记录安全信息：

```text
stage
error.name
error.message
navigator.storage.estimate()
cutout bytes
thumbnail bytes
```

不记录图片内容。

保存失败后立即查询刚才的 ID：

```ts
const partiallySaved = await db.wardrobeItems.get(id)
```

若已经保存，就不要让用户重试创建重复物品，而应修复 mode 并继续导航。

## 推荐修复

1. 将 item、image、experienceMode、onboardingState 和 demo cleanup 放进同一可恢复事务；
2. 个人图片默认只保存 cutout + thumbnail，original 可按存储空间选择性保留；
3. `makeThumbnail` 增加 JPEG/PNG fallback；
4. 对 Safari 显示 IndexedDB quota 友好的专门错误；
5. 加入真实 WebKit Blob/Dexie E2E；
6. 保存按钮点击后必须有不可重复提交锁；
7. `needs-review` 状态要明确指出必须编辑 category、color、material；若按钮只是 disabled，这不是“存储失败”，而是 review gate。

## 下一次最需要的运行时证据

Safari 控制台在点击 `Add to wardrobe` 后输出的：

```text
stage + error.name + error.message
```

有了这三项，才能把本问题从“待补证”升级为确定根因。

---

# 9. 不管说什么都显示 Gallery / Dinner / Photo-ready / Not overdressed / No dresses

## 根因已经完全定位

Today 页初始化：

```ts
const [intent, setIntent] = useState<DailyIntent>(demoIntent);
```

而 `demoIntent` 本身正是：

```text
Gallery
Dinner with friends
photo-ready
not overdressed
excluded one_piece → No dresses
```

页面在 Listening / Understanding 阶段直接从当前 `intent` 生成标签。真正的 live recommendation tool 尚未成功执行时，`intent` 根本还没有被用户语句替换，因此页面展示的就是 Demo 标签。

Mock 路径更直接：

```ts
runRecommendation(demoIntent, nextTranscript.text)
```

这里虽然传入了用户 transcript，但 recommendation intent 仍然硬编码为 `demoIntent`。所以在 Mock 模式下，不管用户说什么，逻辑上都必然得到同一组标签。

这与用户截图一一对应，不是模型同质化，而是 **Demo state 泄漏进生产交互**。

## 修复

### 取消 demoIntent 作为真实 state 初值

```ts
const [intent, setIntent] = useState<DailyIntent | null>(null);
```

Demo 只能存在于显式的 demo session，不能成为所有 session 的默认理解。

### 分离三种状态

```text
transcriptDraft
extractedIntentDraft
persistedSessionIntent
```

UI 只有在当前 generation + transcript hash 对应的 extraction 完成后，才能展示 `extractedIntentDraft` 标签。

### Mock 模式也必须解析实际输入

两种选择：

- 使用本地 deterministic mock parser；
- 或 demo button 明确提交一段固定 Demo 文案。

不能继续将任意 transcript 配上固定 `demoIntent`。

### 防止旧标签闪现

开始新 turn 时：

```text
清空 draft tags
保留旧穿搭但将旧标签标为 previous context
等待本轮 extraction
原子替换本轮标签
```

不得在新输入理解期间继续展示旧 Demo 标签，好像这是新结果。

## 必须新增的测试

输入：

```text
I’m playing basketball.
I’m staying home and want something warm.
Formal interview, no sneakers.
Beach walk, no bag.
I want a dress and I do not have dinner plans.
```

断言：

- 结果标签彼此明显不同；
- 没提 Gallery 就不能出现 Gallery；
- 说 `I want a dress` 时不能出现 `No dresses`；
- 当前 generation 不能读取上一轮 draft；
- tool timeout 时不显示任何伪造理解结果。

---

# 修复优先级

## P0：先修，否则主闭环不可用

1. **问题 9：移除 `demoIntent` 对 live/mock 真实交互的污染；**
2. **问题 6：修复首次 recommendation tool 启动与 watchdog；**
3. **问题 8：保存流程分阶段诊断并修复原子性。**

这三个问题共同造成当前最严重的假象：

```text
看似听懂了
→ 实际显示的是固定 Demo 标签
→ Recommendation tool 没启动
→ 没有穿搭
→ 即使录入衣物，也可能保存失败
```

## P1：修完核心闭环后处理

4. 校准图按 wardrobe direction 分轨；
5. 第三页节奏、文字尺寸与裁切；
6. 天气数据 contract 与预览组件。

## P2：视觉收尾

7. 第二页删除后的停顿；
8. 移除顶部重复云朵；
9. Voice Dock 动画与错误文案对齐。

---

# 最终判断

本轮真机试用发现的九个问题中，七个可以直接由当前源码解释；衣物保存的唯一失败点仍被 catch 吞掉，不能负责任地强行下结论；语音推荐失败的**直接原因**已经确定为首次工具 12 秒未启动后本地 watchdog 终止，但 provider 为什么没有及时发出 function call，仍需要补充 Realtime response 级诊断。

最关键的新发现不是某一个小 UI bug，而是：

```text
固定 Demo intent 仍然占据真实交互状态
+
首次业务工具没有执行
```

这两者叠加后，页面会“看起来理解了用户”，实际既没有从用户语言生成那些标签，也没有产生穿搭。这应作为下一轮修复的第一优先级。
