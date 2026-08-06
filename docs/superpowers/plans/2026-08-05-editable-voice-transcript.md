# 可编辑语音转写实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**目标：** 在 Today 推荐结果中加入可编辑的最终语音转写卡片，确认修改后重新推荐。

**架构：** 新增独立的转写卡片组件管理编辑状态；`TodayPage` 提供最新转写，并在确认时调用现有推荐流程，失败时保留当前搭配。

**技术栈：** Next.js、React、TypeScript、Vitest、现有 YiYi CSS 和 Lucide 图标。

---

### 任务 1：先写失败测试

**Files:**
- Create: `tests/unit/editable-voice-transcript.test.tsx`
- Create: `src/components/voice/editable-voice-transcript.tsx`

- [ ] 测试展示模式、铅笔进入编辑、勾选提交、取消、空文本校验。
- [ ] 运行聚焦测试，确认组件尚未存在时测试失败。

### 任务 2：实现转写卡片

**Files:**
- Modify: `src/components/voice/editable-voice-transcript.tsx`
- Modify: `src/app/globals.css`

- [ ] 实现可访问的展示/编辑控件和简洁波形。
- [ ] 只有点击勾选后才提交编辑内容。
- [ ] 运行聚焦测试并确认通过。

### 任务 3：接入 Today 推荐流程

**Files:**
- Modify: `src/app/today/page.tsx`

- [ ] 将已确认转写与实时转写分开保存。
- [ ] 有最终转写时，在结果说明下方显示卡片。
- [ ] 点击勾选后，用新文本构建当天意图并调用现有初始推荐流程。
- [ ] 运行聚焦测试、Lint 和生产构建。

### 任务 4：验证完成效果

- [ ] 检查 diff，确认没有无关改动。
- [ ] 运行完整单元测试和生产构建。
- [ ] 验证线上 Today 页面布局及编辑交互。
