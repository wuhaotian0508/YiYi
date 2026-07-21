# YiYi 最终轮地毯式代码审计

**审计对象：** `Woebegone-67/YiYi`，默认分支 `codex/yiyi-core`，最新提交 `62bee6043a56eb3d716d4beb1172262c28cf1fd8`  
**基线：** 此前已完整解压并逐行审计的提交 `c94dfcc3650a64bd2149a9d09af585ac2e092b37`  
**本轮覆盖：** 基线全部源码 + 从基线到最新提交的 70 个变更文件 + 当前测试与发布配置

## 审计限制

本轮已尝试直接执行：

```bash
git clone --depth 1 --branch codex/yiyi-core https://github.com/Woebegone-67/YiYi.git
```

但当前执行容器无法解析 `github.com`，因此没有假装完成最新提交的本地 clone 和完整 test run。本报告通过 GitHub connector 读取最新提交及所有高风险变更文件，并与本地完整基线逐文件对照。此前基线的 lint、typecheck、unit/property/race 和 production build 已独立运行；最新提交的运行时结论中，无法由源码证明的项目均明确标为“需要生产 smoke”。

---

# 一、最终判断

最新一轮已经真实修复了许多此前的主问题：

- 主页面深层链接已有统一 onboarding gate；
- Demo 衣橱不再由环境变量隐式写入；
- 客户端已加入设备定位天气；
- Sharp 已改成 lazy loader、固定 0.34.5，并增加 Linux 架构与 tracing 配置；
- Terra 失败后可以保留抠图进入手动 Review；
- Voice 已加入产品级 turn controller、`semantic_vad:auto`、near-field noise reduction、关闭自动 response interruption；
- 后续修改已统一到 action router；
- 删除太阳镜等可选槽位现在可以真正置空；
- 篮球、健身、跑步已有基础安全约束。

但目前仍不能把项目判定为“最终无问题”。

```text
核心本地推荐/版本链：较强
Onboarding 隔离：主体修复
Weather：已接通，但仍有隐私、启动阻塞和恢复边界
Wardrobe：源码边界明显改善，但生产 Sharp/HEIC 仍须真实验证
Voice Today：主体改善，但首轮 anchor、打断时序仍有缺口
Fine-tune Voice：仍未完成同等级重构
情境推荐：只完成第一层关键词规则，未达到研究报告中的完整架构
发布安全：最终归档 secret scan 仍有已知漏洞
```

**结论：Build Week 单人受控演示可以继续推进；在邀请更多测试者前，建议先完成下列 P0/P1。**

---

# 二、P0：发布归档安全仍未修复

## P0-1 Secret scan 仍只扫描 Git tracked files

位置：

```text
release-audit/06-release/secret-scan.mjs
```

当前仍使用：

```js
git ls-files
```

这无法发现被 `.gitignore` 忽略、但可能被手工打进 ZIP/TAR 的：

```text
.env.local
.next/
.vercel/
临时日志与缓存
```

这正是之前归档泄露真实 API key 的根因。`.gitignore` 正确并不能保护“把整个工作目录压缩”的发布方式。

### 必须修复

- 从 allowlist staging directory 生成提交包；
- 扫描 staging directory，而不是 Git tracked files；
- 打包后再次解压最终 archive 并扫描；
- 明确拒绝 `.env*`、`.next`、`.vercel`、`node_modules`、日志、缓存和 token pattern；
- 发布脚本失败时禁止生成分卷。

---

# 三、P1：影响核心用户体验或推荐正确性

## P1-1 首次语音请求仍无法可靠解析“指定我已有的某件衣物”

当前 Realtime prompt 要求模型在首次推荐中把用户指定的衣物写入 `requiredItemIds`，但模型没有获得本地 Dexie 衣橱及 UUID 列表。

首次工具只接收 `DailyIntent`，随后 Today 直接把它交给推荐引擎。当前本地语义 resolver `voiceActionToIntentDelta()` 只用于**首次推荐之后**的 follow-up turn。

因此用户第一次说：

```text
I want to wear my navy hoodie today.
```

模型知道语义，却不知道该 hoodie 的本地 UUID。它只能：

- 留空 `requiredItemIds`；
- 猜一个非法 UUID；
- 或把要求只留在 freeformSummary 中，而引擎不会把它变成 hard anchor。

现有测试“resolves a named available hoodie locally”测试的是 follow-up revision，不是首次推荐。

### 修复

首次工具不应要求模型知道 UUID。改成：

```text
semantic anchors / required item descriptions
→ 客户端根据 wardrobe subtype、category、color 和用户编辑字段解析
→ 唯一匹配时转成 requiredItemId
→ 多个匹配时至多问一个问题
```

并新增首次 turn 的 hoodie、jacket、specific shoes、歧义两件 navy tops 测试。

---

## P1-2 Follow-up item resolver 会把风格要求误当成指定衣物

位置：

```text
src/domain/recommendation/voice-action-router.ts
```

`requestedAvailableItemIds()` 当前把以下内容都当作物品身份短语：

- subtype；
- primaryColor；
- `color + subtype`；
- styleTags。

只要全衣橱中唯一一件物品匹配，就会成为 required anchor。

因此可能发生：

```text
Make it more casual.
→ 唯一带 casual/relaxed tag 的单品被强行 required

Make it less blue.
→ 唯一 blue item 反而被 required
```

这是语义方向相反的风险。

### 修复

- 只有存在明确 `wear / use / keep / include / with my...` 等 anchor 意图时才解析 required item；
- item identity 只使用 subtype、category、用户名称、color+subtype；
- styleTags 不参与唯一物品解析；
- `less / avoid / don’t want / no` 进入 exclusion/adjustment，不得进入 required；
- 增加反向语义与否定范围测试。

---

## P1-3 Fine-tune Voice 仍保留“看起来能点、实际没有对应动作”的旧交互

位置：

```text
src/components/preferences/fine-tune-voice.tsx
```

Today 的 Voice Dock 已重构为中央按钮，但 onboarding/preferences 中的 Fine-tune Voice 仍是独立麦克风按钮：

- Listening/Understanding 时按钮仍可点击；
- 点击始终调用 `start()`；
- 同一 owner 已连接时 coordinator 只会复用 session，用户点击没有 commit/interrupt 效果；
- live fine-tune 没有像 Today follow-up 一样强制每个 turn 调用 preference tool；
- 保存成功后 `outcome=done` 会覆盖正在继续 Listening 的真实 session 状态。

因此这里仍可能出现：

```text
按钮按了没反应
模型口头回复但没有保存
界面显示 Added，麦克风实际上还在监听
```

### 修复

- Fine-tune 复用同一个 VoiceTurnController/中央云朵；
- Listening 点击 commit，Speaking 点击 interrupt；
- preference turn 必须调用 preference tool；
- 保存完成后明确 mute/stop，或清楚进入“继续添加另一条”状态；
- UI outcome 不得覆盖真实连接状态；
- 补 live adapter、tool-required、保存后 session 生命周期测试。

---

## P1-4 手动打断后过早重新打开麦克风

位置：

```text
src/lib/realtime/voice-turn-controller.ts
```

当前 Speaking 点击后：

```text
调用 session.interrupt()
→ 状态立刻 interrupted
→ 紧接着立刻 listening
→ microphone 立即 unmute
```

产品状态没有等待真实的 `audio_interrupted` 或 `audio_stopped`。如果输出音频还有尾音，麦克风可能重新收进 YiYi 自己的声音，形成下一次错误 speech-start。

### 修复

保持 `interrupted` 且麦克风静音，直到收到 SDK 的实际中断/停止事件，再进入 Listening。增加带延迟 audio stop 的 transport test，而不是只用同步 fake。

---

## P1-5 Today 首屏 hydration 被定位权限最长阻塞约 7 秒

位置：

```text
src/app/today/page.tsx
```

当前初始化顺序：

```text
读取衣橱/session/cache
→ await fetchConfiguredWeather()
→ 才 setWardrobe / setHydrated / 恢复 outfit
```

首次定位弹窗、用户犹豫或定位 timeout 时，本地衣橱和已有推荐也被一起等待。天气是补充上下文，不应阻断本地核心界面。

### 修复

- 先从 IndexedDB 立即 hydrate 衣橱、session 和 cached/session weather；
- 页面先恢复可用状态；
- 定位天气并行更新；
- 新天气回来后再验证是否需要清除/修复旧 outfit；
- UI 显示短暂 weather loading，而不是整个 Today 等待。

---

## P1-6 天气仍有隐私、重试和 provider 可靠性缺口

### 精确坐标进入 URL

客户端将浏览器返回的完整纬度/经度放入 query string：

```text
/api/weather?latitude=...&longitude=...
```

虽然 IndexedDB 不保存坐标，但 URL 可能进入平台 access log、cache key 和诊断链。Settings 却写着“Approximate location ... is not stored”。`enableHighAccuracy:false` 不保证返回值一定粗略。

### Provider 失败后 Settings 无法重试

Settings 只有在 `permission !== granted` 时才把 Weather 行渲染成 Retry 按钮。若权限已经 granted，但 Open-Meteo 失败，页面只显示不可点击的 `Weather unavailable`。

### Server route 缺少明确 timeout、rate limit 和 structured provider log

`/api/weather` 当前没有像其他 provider route 一样使用 provider timeout、统一诊断和 rate limit。

### 修复

- 客户端先量化坐标至城市/街区级精度，或改用不进入 access-path 的请求方式；
- 文案准确说明坐标会即时发送到 YiYi server/provider；
- Retry 根据 `errorCode/source`，而不是 permission 单独决定；
- Open-Meteo 加 5–8 秒 timeout、量化坐标 cache、宽松 rate limit 和安全诊断；
- 增加“permission granted + provider failed + retry success”测试。

---

## P1-7 Raw HEIC fallback 与 Vercel Sharp 预编译能力不一致

客户端尽量通过 `createImageBitmap` 转 WebP，但失败且文件较小时会把原始文件上传。服务端明确接受 HEIC magic，随后交给 Sharp。

Sharp 官方预编译二进制的常规输入列表不包含 patent-encumbered HEIC；HEIC/HEVC 需要带相应 codec 的自定义全局 libvips。当前 Vercel 使用 npm prebuilt Sharp 0.34.5，因此 raw HEIC 不应被视为已可靠支持。

### 修复路径（二选一）

1. **推荐：**在 iPhone 浏览器端保证 HEIC 解码并转成 JPEG/WebP，增加 `<img>`/canvas fallback；服务器只接受已转码格式；
2. 真正引入可验证的 HEIC decoder 或带 codec 的运行环境。

在完成生产 smoke 前，不要向用户承诺 raw HEIC server support。测试必须包含 Camera HEIC、Photos HEIC、方向信息和大图。

---

## P1-8 Sharp smoke 已写，但没有进入默认验证门禁

项目新增：

```text
pnpm verify:sharp
/api/health/image
```

但：

- `pnpm verify` 不包含 `verify:sharp`；
- CI workflow 也没有执行 `verify:sharp`；
- build success 不能证明 Vercel Function runtime 能加载 `.so`；
- `outputFileTracingIncludes` 使用精确 `.pnpm` 版本路径，lockfile 改动后容易失效。

### 修复

- Linux CI 明确执行 `pnpm verify:sharp`；
- post-deploy 自动请求 `/api/health/image`，失败则阻止 promotion；
- 检查 `.next` route trace 是否包含 binding 与 libvips；
- tracing 配置尽量使用可维护的窄 glob，而非脆弱的完整虚拟仓库版本路径；
- 生产 health 只返回 ready，不公开 Sharp/libvips 版本。

---

## P1-9 Situation Profile 目前仍只是单一英文关键词分类器

最新代码解决了“basketball + jewelry”的直接问题，但研究报告提出的情境层只实现了一小部分：

- 一个请求只得到一个 `SituationKind`；
- 任何出现 `basketball` 的句子都被视为亲自打球；
- `I’m watching a basketball game` 也会被强制运动鞋、禁止包和首饰；
- `training session` 可能是工作培训，却会被识别成 gym；
- “打球后吃饭”等多活动被第一个 regex 吞掉；
- `discouraged` slot policy 没有进入 constraint/search/scoring，属于死语义；
- WardrobeItem 没有 mobility、secureFit、snagRisk、sportSuitability 等能力字段，仍靠 subtype/styleTag 猜。

### 修复

- Situation 增加 participation：`performing / attending / observing`；
- 支持多 segment 与时间顺序，而不是单一 kind；
- 将 `discouraged` 转成真实搜索 penalty；
- 为高风险场景增加最小 item capability；
- 保留 hard safety，但避免关键词误杀；
- 新增 watching basketball、basketball then dinner、professional training、yoga/cycling/badminton 等测试。

---

## P1-10 当前公共 provider routes 仍只有 IP 限流，测试现场容易互相误伤

Realtime token 当前限制约为：

```text
10 / hour / IP
```

学校 Wi-Fi、I-House、活动现场或蜂窝 NAT 下，多名测试者会共享同一个外网 IP。之前的 429 很可能再次出现。

反过来，纯 IP 限制也无法有效防止分布式滥用公开的 OpenAI/Photoroom 费用入口。

### 修复

- 使用服务端签名的匿名 installation/session ID + IP abuse ceiling；
- 各 bucket 采用不同 burst/window；
- 比赛期间结合 OpenAI spend limit 与平台 WAF；
- 不直接信任任意客户端传入 ID；
- 增加同 IP 多设备、同设备重复 connect、攻击性多 IP 的测试模型。

---

# 四、P2：应在公开 Beta 前收口

## P2-1 `discouraged` 与 action state 的 UI 语义不完整

- `handle_outfit_turn` 不论是 revise、confirm、undo、random 或 no_change，controller 只看到 toolName，统一显示 `revising`；
- 用户可能在确认或背景噪音时看到“Updating your outfit”；
- 应将 action type 传给 product state，分别显示 confirming、undoing、choosing 或 no visible mutation。

## P2-2 VoiceCore 动画仍是固定循环，不是输入/输出能量驱动

当前使用 Motion 是正确选择，但：

- Listening/Speaking 只是固定 keyframe；
- Connecting 动画完成有限次数后可能在慢连接中静止；
- Revising 只有一次 0.5 秒 pulse，长工具调用时随后静止；
- 没有读取 input/output audio level。

这不影响功能，但还没有达到“Live、自然响应”的最终目标。应使用 transport/analyser 暴露的安全音量值驱动 motion value，并保留 reduced-motion 路径。

## P2-3 Ranking board 会静默漏画衣物

`board-renderer.ts` 在本地 cutout 和 demo sprite mapping 都不存在时直接 `continue`，仍然把残缺 board 发给视觉模型；同时所有 personal outfit 也先加载 demo sprite。

应：

- 缺少任何候选 item 图像时 fail closed 到 deterministic fallback；
- 只在确实有 demo item 时加载 sprite；
- 记录 `BOARD_ITEM_IMAGE_MISSING`；
- 测试 item record/image record 不一致。

## P2-4 Visual ranking 的图片与 candidate ID 关联仍是隐式顺序

Prompt 先列出所有 candidate metadata，再连续附图。模型只能依赖数组顺序推断图与 ID 的对应关系。建议每张图前加入明确的 `Candidate <ID>` 文本段，或将 ID 安全渲染到 board 非主体区域。

## P2-5 Weather migration 可能继续使用旧 Demo cache

从 fixed-demo 升级到 device-location 后，6 小时内的旧 Demo weather 仍可能作为有效 cache 返回，推迟定位请求；session weather 也没有 source 字段，恢复时可能被误标成 open-meteo。

应按 current mode 过滤 cache，并在 DailySession weather 保存 source。

## P2-6 衣物保存事务没有覆盖 experience-mode 更新

item 与 image 在一个事务中写入，随后单独 `setExperienceMode("personal")`。若第二步失败，衣物实际已保存，但 UI 显示保存失败，用户重试可能创建重复物品。

应把个人模式切换和 item/image 写入放在一个可恢复事务，或失败后检测已保存 item 并继续。

## P2-7 processingJobs 永久累积

每次上传写入一条 processing job，完成/失败后只改状态，不清理。应保留有限诊断窗口，启动时清理过期记录。

## P2-8 Route Gate 检查期间是完全空白

IndexedDB 正常时很短，但数据库卡顿、迁移或 Safari 异常时会出现无限白屏。应增加延迟后才出现的安静 loading，以及明确的本地存储错误恢复路径。

## P2-9 `stableOutfitId` 仍使用 32-bit FNV

小衣橱碰撞概率低，但 ID 同时参与去重、shown history、random 和 version identity。内部应使用 canonical signature 或稳定 128-bit digest，而不是把 32-bit hash 填成 UUID 外观。

## P2-10 直接 push 不会自动执行完整 release-candidate 套件

CI 的 full suite 只在 PR 或手动 dispatch 时运行；普通 push 只执行 core test/build。正式 redeploy 前必须手动 dispatch release-candidate 或走 PR，确保 E2E、motion、audit 与 bundle analysis 真正执行。

---

# 五、已验证为正确方向的部分

以下部分本轮没有发现需要推翻的架构问题：

- constraint-first 候选生成；
- required/excluded/availability；
- targeted preservation；
- optional slot explicit removal；
- versioned mutation、base-version 与 operation-generation CAS；
- exact Undo；
- user/assistant transcript 分离；
- initial tool 与 follow-up tool 分阶段；
- VAD 由 low/high 改为 auto，关闭自动 response interruption；
- near-field input noise reduction；
- Terra 失败后的 manual review；
- Photoroom response bytes/pixels/format 边界；
- board image metadata 的服务端真实解码验证；
- onboarding demo/personal 数据隔离主体逻辑；
- location denial 时不再伪造 `58°`；
- API key 未出现在当前 tracked public repository。

---

# 六、最终建议执行顺序

## 发布前必须完成

1. 修复最终 archive secret scan；
2. 初次推荐的 semantic wardrobe anchor 本地解析；
3. 修复 follow-up item resolver 的正负语义；
4. Fine-tune Voice 接入统一 controller/tool-required；
5. 手动 interrupt 等真实 audio stop 后再 unmute；
6. Today 本地 hydration 与 weather 解耦；
7. Weather provider timeout/retry/privacy；
8. 明确解决 raw HEIC；
9. 将 Sharp smoke 纳入 Linux CI + post-deploy；
10. 运行生产 `/api/health/image`、真实 wardrobe、真实 visual rank。

## 随后完成

11. Situation participation/multi-segment/discouraged policy；
12. 匿名 installation rate-limit；
13. board image fail-closed 与 candidate-image association；
14. transaction、job cleanup、stable ID；
15. Voice energy-driven motion 与 action-specific states。

---

# 七、最终验收清单

正式判定 RC 前，至少获得以下真实证据：

```text
Linux CI: lint/typecheck/unit/property/race/build/verify:sharp
Chromium + WebKit E2E
motion/reduced-motion suite
final archive secret scan
Vercel /api/health/image = 200
真实 JPEG upload = complete
真实 iPhone HEIC upload = complete 或明确先转码
Photoroom success + Terra success
Photoroom success + Terra manual-review fallback
/api/outfits/rank source=live，不是 silent fallback
两台干净设备 onboarding 与数据隔离
location allow/deny/timeout/provider-failure/retry
首次 “wear my navy hoodie” anchor
follow-up remove sunglasses/no jewelry
watch basketball 与 play basketball 不同结果
Confirm 后继续修改
Speaking 手动打断无 audio-tail false start
Fine-tune voice 确实写入 preference 后停止/进入明确下一轮
```

## 最终结论

最新代码已经跨过了“功能原型”阶段，主体架构明显成熟；但仍有几处会直接破坏核心承诺的缺口，尤其是：

```text
首次指定衣物没有本地解析
follow-up resolver 可能反向 anchor
Fine-tune Voice 仍是假交互风险
天气阻塞首屏与坐标隐私
raw HEIC 支持并不成立
Sharp smoke 未进入正式门禁
情境层仍是关键词补丁而非完整语义架构
最终归档扫描仍可能再次泄密
```

这些问题修复并完成生产 smoke 后，才适合宣布 YiYi 已完成最终轮技术验收。
