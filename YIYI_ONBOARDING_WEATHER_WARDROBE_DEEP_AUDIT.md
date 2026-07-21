# YiYi 剩余三组问题深度代码审计

审计对象：公开仓库 `Woebegone-67/YiYi`，默认分支当前提交 `4760b9c7`，并结合此前上传的完整归档、Vercel 日志与本轮真机截图。

## 总结

这三组问题都已经能够定位到明确的代码或部署链路：

1. **并不存在所有用户共用一个服务器账号。**问题是深层链接没有 onboarding 守卫，并且 Today/Wardrobe 会在全新浏览器中自动写入同一套 Demo 衣橱和偏好，因此不同测试者看起来像进入了同一个现成账号。
2. **天气仍为 Demo 是当前客户端明确写死的产品模式。**服务端已经能根据经纬度调用 Open-Meteo，但客户端没有定位权限流程、没有传坐标，也只接受 `fixed-demo` 响应。
3. **衣橱录入当前最主要的阻断是 Vercel 中 Sharp/libvips 原生依赖加载失败。**同一部署的 `/api/outfits/rank` 已被日志明确复现为 `libvips-cpp.so.8.18.3` 缺失，而衣橱处理 route 在模块顶层加载同一个 Sharp，所以会在进入 handler、Photoroom 和 Terra 之前直接崩溃。客户端的超时、盲目重试和过度笼统的错误界面又进一步掩盖了真实根因。

---

# 第一组：测试者跳过 onboarding，像是共用一个账号

## 1. 当前没有账号系统

项目没有登录、用户表、远端衣橱数据库或服务端 preference store。

用户数据保存在当前浏览器内：

- Dexie / IndexedDB：衣物、图片、偏好、DailySession、OutfitVersion、设置；
- localStorage：`yiyi:onboarding-complete` 等少量标记。

所以两台不同手机理论上不会共用个人数据。

## 2. 确定根因：只有根页面检查 onboarding

`src/app/page.tsx` 只在 `/` 页面读取：

```ts
localStorage.getItem("yiyi:onboarding-complete") === "true"
```

然后跳转 `/today`。

但以下页面没有统一访问守卫：

```text
/today
/wardrobe
/wardrobe/add
/preferences
/settings
```

所以如果分享链接是浏览器当前地址：

```text
https://...vercel.app/today
```

新测试者会直接进入主页面，不经过介绍、麦克风权限和 Style Calibration。

## 3. 第二个确定根因：新浏览器会被自动初始化成相同 Demo 用户

Today 页面挂载时会无条件调用：

```ts
seedWardrobe(demoWardrobe)
seedPreferences(...)
```

Wardrobe 页面也会在挂载时调用：

```ts
seedWardrobe(demoWardrobe)
```

`seedWardrobe()` 的默认判断是：

```text
不是 personal 模式
+ 尚未 seed
+ 衣橱为空
+ NEXT_PUBLIC_SEED_DEMO_WARDROBE 不等于 false
→ 自动写入 Demo Wardrobe
```

`.env.example` 当前默认：

```dotenv
NEXT_PUBLIC_SEED_DEMO_WARDROBE=true
```

它还会把 experience mode 写成 `demo`。

因此一个全新浏览器只要直接进入 `/today` 或 `/wardrobe`，就会获得同一套示例衣服和 Demo Preference。这会制造“大家共用一个账号”的强烈错觉。

## 4. 数据状态还存在双重真相

Onboarding 是否完成只写在 localStorage，而 experience mode、profile、wardrobe 又写在 IndexedDB。

可能出现：

```text
localStorage 被清除，但 IndexedDB 还在
IndexedDB 被清除，但 localStorage 还写着 completed
浏览器恢复旧 tab 到 /today
旧版本迁移后标记和数据不一致
```

当前没有 canonical onboarding state，也没有版本字段，因此后续改 onboarding 时很难安全迁移。

## 5. 建议架构

比赛版本不需要现在加入登录系统。设备本地数据符合当前预算和隐私定位。

应改为：

### Canonical onboarding state

在 `appSettings` 写入：

```ts
{
  key: "onboarding",
  value: {
    status: "incomplete" | "complete",
    version: 1,
    completedAt: number | null,
    experienceMode: "demo" | "personal" | null
  }
}
```

localStorage 只用于一次性兼容迁移，不再作为主判断。

### 统一 route gate

为应用主区域建立统一的 client gate/layout：

```text
/today
/wardrobe
/wardrobe/add
/preferences
/settings
```

Hydration 完成后读取 canonical onboarding state：

```text
未完成 → replace("/")
已完成 → 渲染页面
```

不能通过复制深层链接绕过。

### Demo 只允许用户显式选择

删除 Today/Wardrobe 的自动 `seedWardrobe()`。

只有 onboarding 中用户点击：

```text
Use example wardrobe
```

才执行：

```ts
seedWardrobe(demoWardrobe, { explicit: true })
```

个人模式应保持空衣橱并进入录入流程。

环境变量应默认关闭，或彻底不参与应用页面运行：

```dotenv
NEXT_PUBLIC_SEED_DEMO_WARDROBE=false
```

### 原子完成 onboarding

完成动作应在同一事务或可靠串行流程中保存：

```text
experience mode
preference profile
是否显式使用 Demo
onboarding complete/version
```

最后再导航。

## 6. 必须新增的测试

- 干净浏览器直接访问 `/today` → `/`
- 干净浏览器直接访问 `/wardrobe/add` → `/`
- 浏览器 A 完成 onboarding，不影响浏览器 B
- Personal 模式不会出现 Demo
- Demo 只在显式选择后写入
- 用户删空衣橱后不会重新 seed
- localStorage/IndexedDB 状态冲突时采用可解释迁移
- 分享裸域名始终从正确首屏开始

---

# 第二组：天气始终是 Demo

## 1. 这是客户端明确写死的模式，不是 Open-Meteo 故障

`src/lib/weather/client.ts` 中类型只有：

```ts
type CompetitionWeatherMode = "fixed-demo"
```

任何不是 `fixed-demo` 的环境变量都会被判为 `invalid`。

`fetchConfiguredWeather()` 只会：

```text
GET /api/weather
```

并且只接受响应：

```ts
source: "fixed-demo"
```

`.env.example` 当前也是：

```dotenv
NEXT_PUBLIC_WEATHER_MODE=fixed-demo
```

## 2. 服务端 live weather 已经基本存在

`/api/weather` 当前行为：

```text
无经纬度 → fixed demo
有合法 latitude + longitude → Open-Meteo
```

它已经会：

- 验证坐标成对存在；
- 调用 Open-Meteo；
- 读取未来 12 小时；
- 计算 apparent temperature、降雨概率和风；
- 返回 `source: "open-meteo"`。

因此真正缺失的是前端定位与状态管理。

## 3. Today 还存在第二层硬编码

Today 顶部使用：

```ts
weather?.summary ?? "58° · Light rain"
```

即使 live weather 获取失败，UI 仍会无提示地显示 Demo 文案，使用户误以为这是当前位置天气。

Settings 也写死显示 `Demo weather`。

## 4. 建议的 live-weather 设计

### Weather mode

```ts
type WeatherMode =
  | "device-location"
  | "fixed-demo"
```

生产环境设为：

```dotenv
NEXT_PUBLIC_WEATHER_MODE=device-location
```

### 权限流程

在用户真正进入 Today 或 onboarding 的上下文中解释：

```text
YiYi uses your location only to check today’s weather.
```

随后调用浏览器 Geolocation。

建议：

```ts
{
  enableHighAccuracy: false,
  timeout: 7000,
  maximumAge: 15 * 60 * 1000
}
```

穿搭不需要 GPS 级精度；粗略定位即可。

### 调用

```text
GET /api/weather?latitude=...&longitude=...
```

不要在日志中记录原始坐标。

### 降级顺序

```text
1. 新鲜 live weather
2. 当天 session 中上一次成功天气
3. 最近缓存且仍在合理时间内的天气
4. 明确显示 Weather unavailable
5. 只有比赛演示模式才使用 Demo，并标识为 Demo
```

不能把 Demo 静默伪装成真实天气。

### UI 状态

设置页应显示：

```text
Current location
Updated 12 min ago
Location permission denied
Weather unavailable
Demo weather
```

而不是永久显示 `58° · Light rain`。

### 隐私

只向自己的 `/api/weather` 发送坐标，服务端即时调用 provider，不持久化、不写入诊断日志。客户端只缓存天气结果；若确实缓存坐标，应降低精度并设置短期过期。

## 5. 可以顺便简化服务端

Open-Meteo 支持 `forecast_hours=12`，可以从当前小时直接返回指定小时数，减少服务端自行在两日数组中定位窗口的复杂度。

当前实现并非错误，但采用 `forecast_hours=12` 会更直接。

## 6. 必须新增的测试

- 定位允许 → source 为 open-meteo
- 定位拒绝 → 推荐仍可运行，显示明确状态
- 定位超时 → 使用 session/cached weather
- API 失败 → 不显示伪造的 58°
- 经纬度只提供一个 → 400
- 未来 12 小时而不是当天前 12 小时
- 同一会话不反复请求权限
- Safari/PWA/地址栏模式下均可工作

---

# 第三组：衣橱扫描后失败

## 1. 当前部署的首要根因已经被真实日志确认

同一 Vercel deployment 的 `/api/outfits/rank` 反复返回 500：

```text
Could not load the "sharp" module using the linux-x64 runtime

ERR_DLOPEN_FAILED:
libvips-cpp.so.8.18.3:
cannot open shared object file
```

项目直接依赖：

```json
"sharp": "0.35.3"
```

`/api/outfits/rank` 和 `/api/wardrobe/process` 都在 route 顶层：

```ts
import sharp from "sharp";
```

因此同一部署中的 wardrobe route 极可能在模块加载阶段就失败：

```text
Route module import
→ Sharp native binding loads
→ libvips shared library missing
→ handler never starts
```

这发生在：

- multipart validation；
- Photoroom；
- Terra；
- structured diagnostics；

之前。

所以用户只看到笼统错误，Vercel 也看不到 route 内部 provider 日志。

## 2. 为什么当前 dependency tree 风险高

项目使用：

```text
Next 16.2.10
Sharp 0.35.3
pnpm 11.9.0
```

Next 自身依赖链可能使用另一个 Sharp 版本，锁文件中存在多组 Sharp/libvips native package。

Sharp 0.35 系列使用新的 libvips 组合。跨 macOS 开发与 Linux x64 部署时，必须确保：

```text
@img/sharp-linux-x64
@img/sharp-libvips-linux-x64
```

及其正确版本都进入最终 Vercel Function bundle。

当前错误说明 binding 被找到，但它依赖的 `.so` 没有进入或无法被解析。

## 3. 最稳妥的 RC 修复路径

### 第一步：统一 Sharp 版本

优先把直接依赖固定为与当前 Next 链路兼容、部署更成熟的：

```bash
pnpm add sharp@0.34.5 --save-exact
```

目标不是盲目认为旧版一定更好，而是：

- 消除项目内两套 Sharp native stack；
- 避开当前日志明确失败的 0.35.3 / libvips 8.18.3 组合；
- 先恢复比赛版最关键的两个图像 API。

如果 Codex 选择保留 0.35.3，必须提供最终 Function 中 binding 与 libvips 文件均存在的证据。

### 第二步：跨平台 pnpm 配置

在 `pnpm-workspace.yaml` 中明确支持：

```yaml
supportedArchitectures:
  os:
    - current
    - linux
  cpu:
    - current
    - x64
  libc:
    - current
    - glibc
```

具体语法以当前 pnpm 11 文档和实际 lockfile 验证为准。

同时确保 optional dependencies 没有被关闭。

### 第三步：检查 Next/Vercel file tracing

先检查生产 trace。若 native 文件仍未包含，针对两个 route 增加最窄范围的：

```ts
outputFileTracingIncludes: {
  "/api/wardrobe/process": [
    "./node_modules/sharp/**/*",
    "./node_modules/@img/**/*"
  ],
  "/api/outfits/rank": [
    "./node_modules/sharp/**/*",
    "./node_modules/@img/**/*"
  ]
}
```

不要直接对所有 route 添加宽泛 glob。

### 第四步：无缓存部署

```text
删除本地 .next
重新 pnpm install
运行生产 build
推送 lockfile
Vercel Redeploy without build cache
```

否则旧 native artifact 可能继续被复用。

### 第五步：增加两个 smoke

Build-time：

```bash
node -e "const sharp=require('sharp'); console.log(sharp.versions)"
```

Runtime：

```text
内部 health endpoint
→ 加载 Sharp
→ 生成 1×1 WebP
→ 返回 ready/version
```

不返回环境路径或敏感信息。

## 4. Route 还需要提高可观测性

将静态顶层 import 封装为中央 lazy loader：

```ts
async function loadSharp()
```

若 runtime 加载失败，返回：

```text
503 IMAGE_RUNTIME_UNAVAILABLE
```

并写入安全诊断。

这不能替代正确打包，但可以避免整个 route 在 handler 之前崩溃。

## 5. 客户端还存在三项独立问题

### 客户端 timeout 比合法服务端链路短

客户端 45 秒后 abort。

服务端可能串行执行：

```text
Photoroom：最多 30 秒
Sharp normalization
Terra：最多约 20 秒
```

合法慢请求可能超过 45 秒，而 route 允许 60 秒。

应：

- 将客户端 deadline 至少对齐 server max 并留缓冲；
- 或缩短 provider budgets；
- 更好地显示 `Removing background / Understanding item` 两阶段状态。

### 对所有 5xx 自动完整重试一次

当前任何 5xx 都会重新上传并再次调用 Photoroom/Terra。

对于 Sharp runtime 缺失、未配置或确定性 invalid output，这只会：

- 重复费用；
- 增加等待；
- 让日志变得更混乱。

只应重试已知 transient network/provider 错误。

### UI 丢失 error code 和 requestId

客户端只保留 `error.message`，最后显示统一：

```text
Something went wrong
```

应解析并保存：

```text
requestId
error.code
retryable
HTTP status
```

用户界面仍可保持简洁，但应提供：

```text
Try again
Diagnostic ID: ...
```

方便在 Vercel Logs 中精确定位。

## 6. 处理链当前是全有或全无

目前：

```text
Photoroom 成功
→ Terra 失败
→ 整次录入失败，抠图结果也被丢弃
```

更稳健的体验：

```text
Photoroom 成功
→ 显示并保留 cutout
→ Terra 失败时进入手动 Review
→ Category / Color / Material 标记 unknown
→ 用户快速补充
```

衣物录入不应因为 AI 标签失败而完全无法保存。

同样，Photoroom 失败时可允许用户保留原图并重试抠图，但比赛版至少应提供明确原因。

## 7. HEIC 是次要风险，不是当前首要根因

iPhone 图片通常会先在客户端通过 `createImageBitmap` 转成 WebP。

若某些 HEIC 无法在 Safari 预处理，并且文件小于上传上限，客户端会把原始 HEIC 传给服务器；服务器随后依赖 Sharp/libvips 解码。

Sharp runtime 修复后，仍应对真实 iPhone：

- Camera HEIC
- Photos HEIC
- JPEG
- orientation
- Live Photo 导出的静态图

逐项测试。

但当前同一部署已经明确存在 Sharp import/libvips 故障，因此不应先把截图失败归因于 HEIC 或 Photoroom。

## 8. 最终验收

必须验证真实生产部署，而不只是 Mock：

```text
/api/health/image → 200
/api/outfits/rank → 不再因 Sharp 500，source 为 live 或明确 provider fallback
/api/wardrobe/process → 实际依次到达 Photoroom 与 Terra
```

真机端：

- JPEG 成功；
- HEIC 成功或给出明确可操作错误；
- Photoroom 成功、Terra 失败时可进入手动 Review；
- timeout 不会在 server 合法窗口前发生；
- requestId 能与 Vercel log 对齐；
- 保存后 Blob/thumbnail 能从 IndexedDB 恢复。

---

# 建议修复顺序

1. 修复 Sharp/libvips 部署，恢复 wardrobe 与 visual rank。
2. 增加 runtime Sharp smoke，并无缓存重新部署。
3. 修复 onboarding route gate，删除页面级自动 Demo seed。
4. 建立 canonical onboarding state 与迁移。
5. 接通 device-location weather，删除硬编码天气伪装。
6. 改善 wardrobe timeout、重试、诊断和 partial-success。
7. 完整运行两台干净设备和真实 iPhone 图片格式验收。

# 置信度边界

- **“共享账号”根因：高置信。**代码明确没有账号系统，且深层链接无 gate、页面会自动 Demo seed。
- **天气根因：100%。**客户端只实现 fixed-demo。
- **衣橱失败的当前主因：极高置信。**同一部署日志已经明确显示 Sharp/libvips runtime 缺失，wardrobe route 顶层使用同一依赖。
- 本轮截图本身没有带对应 `/api/wardrobe/process` requestId，因此无法从这一张请求单独证明它没有在 Sharp 修复后又遇到 Photoroom/Terra 的第二个错误；Sharp 恢复后仍必须继续做 provider smoke。
