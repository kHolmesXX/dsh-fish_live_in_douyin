# FISH.md —— fish 版相对上游改了什么

> **上游**：`NEWJO123/dsh-douyin-scroll`，tag `v0.5.4`（commit `45a85c69`，2026-10-26）。
> **本机没有 git**：差异基线是 `vendor/upstream-0.5.4/`（只读快照，不进包），逐文件清单见 `FISH-PATCHES.md`
> （重新生成：`node scripts/diff-upstream.mjs`）。
>
> 一句话：上游负责「刷抖音 → 筛 → 发」，fish 版在上游之上加了一层 **「她」**——记忆、人设、家、节奏、账本和控制台。
> 运行时身份没动：包名 `dsh-douyin-scroll`、命名空间 `douyin-scroll`、家目录 `douyin-duty`、`dsh.bundle` / `dsh.client` 保持原样。
>
> ⚠️ **和 dsh-world 的关系：只是参考设计，不共享代码、不共享会话、不共享 QQ 桥。**
> dsh-world 是另一个独立插件（它有自己的世界目录、家会话、QQ 桥接）；fish 版只在「按天归档 / 每人档案 / 生活线 / 控制台」这些
> **设计思路**上参考它，代码是抖音插件自己的（`lib/relation.mjs`、`lib/home-console.mjs`、`index.js` 里的家里逻辑）。
> 两者互不 import、互不写对方目录；QQ 桥属于 dsh-world + qq-bridge，不在本插件里。

---

## 1. 记忆四件套 —— `lib/relation.mjs`（fish 新增）

之前只有「私信最近 80 条」的记忆，更早就永久丢了。这一层把「她记得的人」拆成四件：

| 件 | 文件 | 说明 |
|---|---|---|
| 按天归档 | `memory/archive/<日期>.jsonl` | 私信 + 群的原话，一天一个文件，一行一句；同一条去重。想不起以前的事就用 `douyin_archive` 翻。 |
| 每人档案 | `memory/profile-<sec_uid>.json` | `stage`（生/熟/自己人）、`call`、`impression`、`likes[]`、`avoid[]`、`lastTopic`、`promises[]`、`facts[]`、首见/末见时间。不是背原话，是记「阶段 + 雷点 + 上次说到哪」。 |
| 群印象 | `memory/group-<群名>.json` | 群整体印象 + 群友 `{impression, quotes[], seen}`；名字只从 @昵称 / 「名字：」前缀拿，拿不到不硬猜。 |
| 日记 | `memory/diary/<日期>.md` | 每天一篇第一人称关系日记（23:00 前后写），第二天进上下文用。 |

工具：`douyin_relation`（list / get / update）、`douyin_archive`、`douyin_diary`；`douyin_remember` 记的长期事实也落在档案里。
`douyin_im_read` 会把这些**自动带上**（`context` 字段），回话前先看它，别把聊过的事当没说过。

## 2. 六层人设 —— `home/persona.md`

上游的人设是「用户自己写的一段话」；fish 版是**六层**：`## 名字` / `## 她是谁` / `## 性格` / `## 说话方式` / `## 愿景` / `## 补充`。
`index.js` 的 `renderHomePersona()` 按层拼成系统提示；`home/persona.md` 不存在才退回 `$DOUYIN_HOME/persona.md`（旧那份，跟别的程序共用，**只读不写**）。
设置页「她的家 → 人设」可以直接改六层（`POST /api/douyin-home/persona`，写得原子、UTF-8 无 BOM）。
细节规则（红线、称呼边界、群里默认别插嘴）在 `## 补充` 里写，脚本会把这些段一起交给值班会话。

## 3. 她的家 —— 值班会话 + home 文件

- **值班会话**：`DUTY_SESSION_ID = 'douyin-fish-chat-v2'`，独立会话收私信/群转达，不占前台上下文；
  它的 cwd 固定在独立工作区 `HOME_CWD = 'D:\deepseek_work\肥鲸屋'`（fish.4 起；v1 留在旧工作区，不 resume、不删）。
- **三段常驻系统提示**（create/resume 时装一次，text 用函数 ⇒ 改文件即生效）：
  `douyin-home-persona`（六层人设）、`douyin-home-self`（`home/whoami.md` 她的自述）、`douyin-home-memory`（记忆索引 + stage 规矩）。
- **家的文件**（`$DSH_HOME/douyin-duty/home/`）：`persona.md`、`life.json`（闹钟/最后活动）、`room/`（她的房间，归她）、`journal.jsonl`（活动台账）、`reach.json`（主动联系额度）、`rounds/<日期>.jsonl` 与 `sent.jsonl`（控制台两本真账）。
- 她收到的东西在「她的家」里，不往主人的会话里塞人设和分寸（那些已经是她家的系统提示）。

## 4. 闹钟 —— `douyin_plan_next` / `check` / `cancel`

她可以给自己定下一件事：`at="11:00"`（今天过了就明天）或 `after_minutes=30`，`note` 写要做什么。
**只存一个待办**（`home/life.json` 的 `plan`），定新的替掉旧的；到点插件叫醒她的家，叫醒词里带「这期间转达了几条私信 / 跑了几轮值班」
（从 `duty.log` 数出来，不是听她自己说）。什么都没定，第二天 **09:00 兜底叫醒一次**。
⚠️ 写 `life.json` 一律「写前重读再合并」（`patchLife`）——以前先读、`await` 投递几秒、再把旧快照写回，会静默吞掉期间定的待办。

## 5. 主动联系 —— `douyin_reach_out`

不是回复，是她自己想开口（想他了 / 刷到他在意的东西 / 有句话想说）。
护栏：只能找 `stage=熟/自己人`；每天最多 **3 条**（`home/reach.json`）；**00:00–08:00 不发**。
发完在报告/台账里留痕，不重复解释自己。

## 6. 账本 —— `home/journal.jsonl` + rounds/sent

- 她做完一件事用 `douyin_note_activity` 记一行（「我刚翻了三天的档案，把李四的喜好补上了」）——这是她的日记素材，也是叫醒时对账的一半。
- 控制台读的是两本 append-only 的真账：`home/rounds/<日期>.jsonl`（每开一轮一行：候选/挑中/丢弃原因）、`home/sent.jsonl`（每发/试一条：卡片/文字/回读/错误）。
  `out/<日期>.md` 是模型写的报告，**不是账**；只在账本缺失时兜底，并标 `degraded`。

## 7. 控制台 —— `lib/home-console.mjs` + `client.js`

设置页新增**独立 section**「她的家」（`id: douyin-home`，`order: 32`；「刷抖音」是 31），样式前缀 `.dh-*` / `data-dh-*`，和刷抖音段互不引用。

后端（`index.js` 里 `createHomeConsole({ stateDir, log, dayKey, accountRefresh })` 挂 `/api/douyin-home/*`）：

| 接口 | 用途 |
|---|---|
| `GET /snapshot` | 一次读全：六层人设 / life / reach / 台账 / 日记 / 归档 / 关系档案 / 群印象 / 健康 / 房间 |
| `GET /today` | 今天这一轮的真账：轮次 / 发了什么 / 候选证据 / 私信进出 / 她的台账（缺账才退回 out，标 degraded） |
| `GET /account` | 登录态 / 账号 / Cookie / 聊天模式 / 无头 Chrome / 健康（默认不探活，`?refresh=1` 才真探） |
| `GET /chat` `GET /diary` `GET /journal` `GET /archive` | 只读本地文件，**绝不**调发送/读私信接口 |
| `POST /persona` `POST /plan` `POST /profile` | 三处写入（六层人设 / 闹钟 / 关系档案） |

规矩：除三个 POST 外只读；写盘先写 `.tmp` 再 rename，UTF-8 无 BOM；POST 必须带 `x-douyin-home: 1` 头、body ≤ 64KB、未知字段忽略；
三个只读接口不联网、不 spawn，5 秒内存缓存（POST 写完 invalidate）。**绝不写** `$DOUYIN_HOME/persona.md` 那份旧的。

## 8. 登录复用 —— `loginStore`

「刷抖音」和「她的家」共用**同一份登录状态**：`client.js` 里抽了共享登录卡单例（`loginStore`），二维码 / 轮询 / 关窗 / 退出只有一份实现。
后端 `/api/douyin-home/account?refresh=1` 复用刷抖音那套真探活（`accountStatus(true)`）。
修掉的 bug：旧代码 `onClick: onQr` 把事件对象当 `force` 传 ⇒ 每次点「扫码登录」都 `force=1` 先杀掉共用浏览器；现在普通按钮 `start(false)`，只有「重新出码」`start(true)`。

## 9. 其它顺手改的

- **视觉优先**：先截每条视频首帧（`tools/frame-grab.mjs`，fish 新增），模型看图后再判；`keepFrames` 控制跑完删不删图。
- **偏好加权**：`tools/forward-pick.py` 命中偏好词 ×3、宠物/萌娃降权、点赞 > `likeCap`（默认 2 万）直接不进候选、点赞分布按非对称正态配权；证据包带 `pref_hit` / `low_digg` / `like_weight` / `frames`。
- **只分享不总结**：`douyin_share_card` 只发卡片，`reason` 默认不传。
- **章程**：`prompts/duty.md` 跟着改成偏好优先 / 视觉优先 / 擦边与低赞口径；每轮 prompt 同步。

## 10. 明确没做的（边界）

- 不改 `name` / `dsh.bundle` / `dsh.client` / `engines`：装法、命名空间、设置页 key、家目录都对上游兼容，旧配置和旧数据直接可用。
- **不发 npm、不 fork 上游**：`repository` / `bugs` / `homepage` 仍指 `NEWJO123/dsh-douyin-scroll`；fish 版只走本地 `link:` / `file:` tgz。
- 不共享 dsh-world 的代码、会话、世界目录、QQ 桥；不接管桌宠（桌宠在独立的 `dsh-deskpet`）。
- `vendor/upstream-*` 不进包、不该 commit；它只是这台没有 git 的机器上的对比基线。


---

## 9. fish.2 – fish.28 新增能力（2026-10-27 ~ 10-28）

> 早期六节写的是 fish.1 的骨架；这一节补上之后陆续加的东西（同一套路由/工具，没改包名与家目录）。

- **记忆增强**：私信图片/表情包自动下载到 `home/inbox/`（她能用 `read_image` 看）；主人分享的视频→兴趣账本；`douyin_remember` 长期事实；记忆索引里补了工具规矩。
- **评论区闭环**：评论区 @ 巡检（每 8 分钟）→ 叫醒她 → `douyin_comment_reply mode:"api"` 直接回复；`douyin_comment_mention` 真 @（UI 点选，支持视频/图文）；发布后核实可见才算成功；同一视频只 @ 一次、每天上限 10 条。
- **图文（note）全链路**：分享卡片、评论区 @ 都支持 `/note/<id>`（不是只认视频）。
- **@豆包 异步总结**：每天最多 2 次、同视频一次；发完不等，互动消息里有回复才叫她。
- **分流模式**：一轮 10 条候选 → 擦边/颜值走私信卡片；其它类（按兴趣账本动态判断）看标题→能懂就评论区 @、看不懂→问豆包；硬上限写死在宿主侧。
- **看懂视频**：`douyin_watch_video` —— 下载 → ffmpeg 量测（切点/运动）→ 抽 6–12 张关键帧（+ 图版）→ 可选音频转写（faster-whisper，带「转写可不可信」判定；>180 秒只抽帧）。只在**主人分享/点名**的视频上用，每天 10 条。
- **抖音搜索**：`douyin_search` 按关键词搜视频/图文（带 `kind`，每天 20 次、间隔 ≥30 秒）。
- **点赞**：`douyin_like` 双击优先 + API 兜底 + 页面状态核实 + 防误取消；有面板开关、每天/每轮上限；账号被风控时会关掉。
- **表达纪律 / 隐私红线 / 动作清理**：不写「（尾巴晃了晃）」这种动作描写；对外发送前自动剥掉括号动作；隐私清单（凭证/个人信息/账号/环境）写进人设，索要一律「不给」。
- **成本治理**：人设压到 4,480 字（原 22,837 字存档到 `home/persona-full.md`）；昵称不再写死在代码里（主联系人认配置的 `dmTo`）。
