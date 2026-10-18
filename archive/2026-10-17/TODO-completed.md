# 已完成待办与核查记录

归档日期：2026-10-17。

## 总体结论

旧待办将存储重构、撤销重做、本地历史及引用整体写为尚未实施，已经不符合当前代码。下面只归档已经接通并有验证依据的部分；箭头、实际拖线引用、草稿保留、资源会话等继续留在 [活动待办](../../TODO.md)。通用撤销不等于所有入口均改为显式业务指令。

## 原文与现状冲突

- 文档明确错误：“等数据结构重新设计后实施”已过时。桌面 SQLite、不可变版本、独立个人历史及异步 worker 已接通；继续按旧状态规划会重复开发。
- 与后续结论冲突：旧要求“历史恢复本身也应能撤销”。当前明确不可撤销，并清空撤销重做队列。归档为已替代要求，不标为已实现。
- 与后续结论冲突：旧要求“为已删除工作区提供历史恢复入口”。当前删除文件及对应个人历史，不提供恢复。归档为已替代要求，不偷偷改回旧行为。
- 高风险推断：“已有引用功能”不证明手动拖线能建立真实引用。拖线目前只添加 edge，仍保留待办。

## 可执行程度

以下已实现条目有入口、实现和测试定位，等级为 4。仅静态检查的行为明确为 E2，未声称本轮手工验证；未决定的交互不作为可执行要求归档。

## 实现现状清单

| ID | 文档要求或声明 | 可执行等级 | 当前状态 | 实现位置或证据 | 缺口与风险 |
|---|---|---:|---|---|---|
| T1 | 工作区使用独立 SQLite，问题回答有稳定 ID、不可变版本与当前选用版本 | 4 | 已实现 | E3：[数据库与测试](../../electron/storage/__tests__/database.test.ts)；E2：[建表](../../electron/storage/database.cjs) | 不将后续新增内容类型一并标为完成 |
| T2 | 图片二进制及版本资产关联保存 | 4 | 已实现 | E3：数据库测试 `stores image bytes once...` | 不表示 Markdown 外链已下载入库 |
| T3 | localStorage 迁移前备份，重启保留数据，失败可重试 | 4 | 已实现 | E3：[worker 测试](../../electron/storage/__tests__/worker.test.ts)；E2：[运行入口](../../src/services/storage/runtime.ts) | 浏览器仍使用 localStorage |
| T4 | 个人历史独立存储，工作区副本不携带个人历史 | 4 | 已实现 | E3：数据库与 worker 测试；E2：[存储服务](../../electron/storage/service.cjs) | 历史与工作区跨文件事务采用 ATTACH 与回滚日志 |
| T5 | 内容栈保存修改前后数据，撤销恢复会话、消息和关系 | 4 | 已实现 | E3：[commands 测试](../../src/services/storage/__tests__/commands.test.ts)；E2：[工具栏入口](../../src/components/ui/StorageControls.tsx) | 不代表所有业务动作已显式指令化 |
| T6 | 布局变化不入内容栈，内容撤销保留更新后的布局 | 4 | 已实现 | E3：commands 与 [runtime 测试](../../src/services/storage/__tests__/runtime.test.ts) | 输入草稿属于另一个待办 |
| T7 | 按工作区、本次运行维护操作栈，新内容操作清空重做 | 4 | 已实现 | E2：[runtime histories Map](../../src/services/storage/runtime.ts)；E3：commands 测试 | 非完整手动多工作区验收 |
| T8 | 流式内容不逐字建历史，保留生成检查点，重做恢复已保存结果 | 4 | 已实现 | E3：数据库与 runtime 测试；E2：runtime 取消生成后回放 | 首次提问及自动标题合并规则另见结论 |
| T9 | 历史按修改、涉及内容、前后差异查看，支持局部及整体原位还原 | 4 | 已实现 | E3：[历史界面测试](../../src/components/history/__tests__/LocalHistoryDialog.test.tsx)、数据库测试；E2：[恢复入口](../../src/services/storage/runtime.ts) | 取回为副本未完成 |
| T10 | 历史容量、期限、次数清理及手动清空 | 4 | 已实现 | E2：[pruneHistory](../../electron/storage/database.cjs)、[历史界面](../../src/components/history/LocalHistoryDialog.tsx) | 静态核查；本轮未专门制造容量边界进行运行验证 |
| T11 | 保存失败保留内存内容并允许重试 | 4 | 已实现 | E3：runtime 测试；E2：[StorageGate](../../src/components/ui/StorageGate.tsx) | 不等同于草稿已经自动持久化 |
| T12 | 固定引用快照、背景摘要缓存及模型读取引用 | 4 | 已实现 | E3：[references 测试](../../src/services/__tests__/references.test.ts)、[引用会话测试](../../src/services/__tests__/referenceConversation.test.ts)；E2：[references](../../src/services/references.ts) | 不是来源最新内容的递归读取 |
| T13 | 复制粘贴引用，发送前可查看移除，分支和多选总结共用引用 | 4 | 已实现 | E3：[剪贴板测试](../../src/services/__tests__/referenceClipboard.test.ts)、引用会话测试；E2：[ChatInput](../../src/components/nodes/ChatInput.tsx)、[Canvas](../../src/components/canvas/Canvas.tsx) | 资源会话、拖线引用不包含在此项 |
| T14 | 跨工作区原文可访问时回溯，失效时用快照兜底 | 4 | 已实现 | E3：runtime 的跨区来源测试；E2：[ReferenceBubble](../../src/components/nodes/ReferenceBubble.tsx) | 回来丢草稿是已反馈、未修复的问题 |
| T15 | 正向问题入口、重叠引用聚合及临时预览 | 4 | 已实现 | E3：[ReferenceBacklinks 测试](../../src/components/nodes/__tests__/ReferenceBacklinks.test.tsx) | 当前仅活动区来源索引；入口设计仍有待讨论部分 |
| T16 | 历史恢复可撤销 | 4 | 与文档冲突 | E3：runtime 测试确认恢复后清空操作栈；E2：历史界面提示不可撤销 | 后续结论已替代旧要求，不作为遗留实现缺口 |
| T17 | 删除工作区后仍能从个人历史恢复 | 4 | 与文档冲突 | E3：worker 测试确认删除文件及个人历史 | 后续结论已替代旧要求，不作为遗留实现缺口 |

## 验证

本轮运行 10 个相关测试文件，共 77 项全部通过：数据库、worker、commands、runtime、LocalHistoryDialog、ReferenceBacklinks、ReferenceSelection、references、referenceConversation、referenceClipboard。测试使用隔离数据，不对用户工作区执行迁移、恢复或删除。

本轮未修改功能代码，没有为文档整理重建安装包，也没有声称全部手工交互通过验收。

## 需要作者决定的问题

拖线引用规则、引用呈现的替代方案、恢复为副本及完整显式指令化范围，保留在活动文档。原待办中“待解决疑问”尚未实现，不因底层已支持恢复而移入完成清单。
