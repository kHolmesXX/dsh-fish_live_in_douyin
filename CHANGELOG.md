# 变更记录

> 版本号只跟「**装插件的人会感觉到变化**」的东西走：工具行为、bug 修复、面板、配置项。
> 格式：`主.次.补丁`。
>
> 🔴 **本地版本号与 GitHub 分开管理**（主人 2026-10-26 定）：
> 本地改动先堆在过程号（0.5.4 → 0.5.9 那一串内部标记），
> 等主人拍板发布时**统一抬到一个对外版本号**再推 —— 对外只看得见最终那一版。

---

## 0.5.4-fish.26 — 2026-10-28

- **图文页 @ 评论流程定稿**（`tools/comment-mention-ui.mjs` 新增 `runNoteFlow()`，视频页逻辑未动）：
  URL 含 `/note/` ⇒ 点 `[data-e2e="feed-comment-icon"]` → 等 3s → 找**可见的** `.comment-input-container`
  （`#comment-input-container` 是旧抽屉，不用）→ 点开等 DraftJS → 点编辑器打 `@` → 等 3s →
  弹层默认列表直接找昵称叶子节点（**不用 Input.insertText 过滤**，会关弹层）→ 点选。
- **正文插入 bug 修复**：点完 @token 后**重新点编辑器中心 + focus/末尾光标**再 `Input.insertText('  '+正文)`；
  插入后读 `innerText` **自检**（含正文前 8 字 + 长度≥正文-2），不通过重试一次，仍失败 abort
  `{ok:false,error:'正文没插进去（note 页）'}`，坚决不发残缺评论。
- **发送键**：在可见容器里找 **fill=FE2C55 的 svg** 点中心（实测输入框展开后容器高度变化，
  `right-28/top+h/2` 会点偏）；点后确认编辑器里正文消失才算提交。
- **核实**：刷新 → 点评论图标 → 读 `[class*="comment-mainContent"]`，含正文前 8 字 ⇒ `published:'verified'`，
  否则 `submitted_unverified`；返回加 `page_kind:'note'|'video'`、`newest_comment`。
- 删除实验脚本 `tools/_exp-note-mention{,2,3,4}.mjs`。
- 实测：note `7697185871136582011` 真实发 `@示例主人 图文也能@了，这条本鲸先替你收着` ⇒
  `published:'verified'`，编辑器清空为 `"\n"`，最新评论读到完整正文（含 @示例主人）。
  ⚠️ 已知脏数据：note `7697185871136582011` 与 `7434219533616926004` 下各有一条测试残留
  「@示例主人 示例主人」（UI 删不掉，没删，仅记录）。

## 0.5.4-fish.25 — 2026-10-28

- **图文（note）全链路支持**：以前只认视频页（/video/<id>），图文页 /note/<id> 被自动重定向后全挂。
  · `tools/card-share.mjs`：等页面就绪改成「URL 含 /video/ 或 /note/ + 分享入口出现」；
    分享图标先找老 selector，找不到再找 `[data-e2e="video-player-share"]`（图文页右侧操作栏）；
    面板选择器/文本特征兜底并打标记；图文页 hover 不开面板时**再点一下**分享入口。
  · `tools/comment-mention-ui.mjs`：pageReady 接受 /note；输入区定位优先 `#comment-input-container`，
    找不到再在右侧评论面板找 `[contenteditable]`/「留下你的精彩评论吧」输入区；
    **图文页的输入区实际在一个 display:none 抽屉里** —— 识别到 /note + 不可见时临时把它展开成居中浮层
    再走原来的点开→等 DraftJS→打@→选人→填正文流程；编辑器打 data 标记，后续焦点/正文/发布/兜底按钮
    都用它反查，不再死磕 `.public-DraftEditor-content`。
  · `index.js`：`douyin_share_card` / `douyin_comment_mention` / `douyin_search` 描述改成「视频 / 图文」；
    分享回读放宽：note 卡片消息不一定带 `awe=800`，按 `from=me && item` 匹配 ⇒ note 也能正确回读。
  · `tools/douyin-search.mjs`：结果加 `kind:'video'|'note'`（`aweme_info.images` 有内容 / aweme_type=68 ⇒ note），
    `url` 相应写 `/note/<id>` 或 `/video/<id>`；两类都返回不筛。
  · `prompts/duty.md`：分流一节补「图文（note）和视频一样处理」。
- 实测：图文 `7434219533616926004` 分享给 示例主人 → sent:true + 回读 in_my_messages:true；
  该图文 @示例主人 dry 成功（popup_row uid=<uid>，编辑器里有 @示例主人 token + 正文）；
  搜 `bbw` 返回 5 条 kinds=[note,note,note,video,video]，目标 id kind=note、url 为 /note/。

## 0.5.4-fish.24 — 2026-10-28

- **按关键词搜视频（新 `tools/douyin-search.mjs`）**：无头 Chrome 页面上下文直接
  `fetch('/aweme/v1/web/general/search/single/?…')`（页面自带签名，不手工签）→ 过滤
  `type===1 && aweme_info` → `{aweme_id,desc,author,digg,comment,collect,share,duration_s,create_time,url}`。
  `--dry` 只打印 URL；`status_code!==0`/空结果/异常 ⇒ `{ok:false,error,hint}` 不抛栈。
- **新 `lib/home/search.mjs`**：`home/searches.jsonl {at,keyword,count,ok}`；
  `normalizeSearchSettings`（settings.search = {enabled:true, perDay:20, minGapSec:30}，夹 1–100 / 0–600）、
  `searchesToday`、`lastSearchAt`、`canSearch`（off/cap/gap + waitSec）、`appendSearch`、`buildSearchUrl`（可单测）。
- **两处工具**：host `douyin_search`（world 闸 → settings.search 闸 → canSearch → 浏览器锁 → 跑脚本 →
  写台账 + journal `douyin_search`；只读不赞不评）；MCP 同步注册（16 工具），值班轮可用。
- **提示词**：`prompts/duty.md` 分流一节加「想找特定主题 → douyin_search（每轮最多 2 次、间隔 ≥30 秒），
  搜到的候选按同样分流规则处理；搜索不是每轮必做，feed 够看就别搜」。

## 0.5.4-fish.23 — 2026-10-28

- **面板看/改「她的口味清单」**：`lib/home-console.mjs` 加
  `GET /api/douyin-home/taste`（`readTaste(homeDir)` → `{text, chars, path:'home/taste.md', updatedAt}`，
  文件不存在返回空串不抛）和 `POST /api/douyin-home/taste`（body `{text:string}`；
  非字符串 400、>20000 字 400、允许空并返回 warning「空清单 = 她的点赞没有判据」；
  写盘 UTF-8 无 BOM + 末尾换行（复用 writeTextAtomic 原子写）；返回 `{ok,chars,updatedAt[,warning]}`；
  POST 仍受 `x-douyin-home: 1` 护栏）。
- **「她的家」概览卡**：`client.js` 在「她会自己点赞」卡下加 `.dh-card[data-dh-overview-taste]`
  「她感兴趣 / 会点赞的内容」——只读态 `pre` 等宽小字、限高 220px 可滚动；「编辑」→ `textarea`
  （等宽、高 260px）+ 字数 `N 字 / 上限 20000` + 保存/取消；保存成功 toast「已保存（下一轮生效）」，
  空内容额外提示「现在是空的，她点赞就没有判据了」，失败显示原文并保持编辑态；
  首次进概览与 /likes 并行 GET。`PANEL_BUILD` 32 → **33**。

## 0.5.4-fish.22 — 2026-10-28

- **面板「她会自己点赞」总开关**：`lib/home-console.mjs` 加两条路由
  `GET /api/douyin-home/likes`（`normalizeLikeSettings(settings.likes)` + `likesToday`）
  和 `POST /api/douyin-home/likes`（只合并 `settings.likes`，其它段原样保留；越界由
  `normalizeLikeSettings` 夹到 enabled 布尔 / perDay 1–50 / perRun 1–20；坏 JSON 自愈；写盘 atomic）。
- **「她的家」概览卡**：`client.js` 概览 tab 加 `.dh-card`「她会自己点赞」——
  presence 同款 `dh-check` 开关（乐观更新、失败回滚）、每天上限/每轮上限两个数字输入、
  「今天已赞 X 条」、风控灰字说明、保存按钮（`homePost('/likes')`，成功 toast「已保存：点赞 开/关」、
  失败显示错误原文）；第一次激活时 `homeGet('/likes')` 填值。`PANEL_BUILD` 31 → **32**。
- `lib/home/likes.mjs` 把 `PER_RUN_MAX` 从 10 调到 **20**（面板「每轮上限 1–20」要能存住；
  否则面板存 20 会被工具侧夹回 10）。

## 0.5.4-fish.21 — 2026-10-28

- **她自己点赞（新 `tools/like-ui.mjs`）**：无头 Chrome 打开视频页 → 画面中心**双击**
  （CDP clickCount=2）→ DOM 判断是否已赞；UI 没确认 ⇒ **API 兜底**：页面上下文 POST
  `/aweme/v1/web/commit/item/digg/?…&type=1`（页面签名器补 a_bogus，和 comment-api 同一条路），
  `status_code===0` 即成功。整体最多 2 次尝试（UI 1 + API 1），返回 `{ok,via,liked,status_code,head,error}`。
- **新 `lib/home/likes.mjs`**：台账 `home/likes.jsonl {at,aweme_id,why,via,ok}`；
  `normalizeLikeSettings`（settings.likes = {enabled,perDay:10,perRun:5}，坏值夹范围）、
  `likesToday`（只算当天 ok:true）、`likedBefore`（永久同视频一次）、`attemptsToday`（失败最多 2 次）、
  `canLike`（off/dup/attempts/cap 四拦截）、`buildDiggUrl`（纯函数，可单测）。
- **新 `lib/home/taste.mjs`**：`renderTaste(homeDir)` 读主人写的 `home/taste.md`（只读不改），
  注入提示词（前 1200 字 + 完整清单路径）。
- **接线**：host 工具 `douyin_like`（confirm 草稿 → `autoLikeAweme`：世界闸 + settings 闸 +
  canLike + 浏览器锁（by:'like'）+ 跑 like-ui + 写台账 + journal `tool:'like'`）；
  MCP 同步注册 `douyin_like`（15 工具）；`commentTick` 对主人 @ 的视频**顺手点赞**（同一函数，
  失败不影响叫醒，日志「主人 @ 过的视频顺手点赞」）。
- **提示词**：`prompts/duty.md` 分流一节加第 3 步「⭐ 点赞（独立动作，不占卡片/@额度）：
  命中她的口味/主人正面兴趣 → douyin_like；擦边绝不点赞；每轮 ≤5、每天 ≤10；失败两次放弃」，
  报告加「点赞 N 条」；index 的视觉优先块加 ⑨ 点赞，并注入 `renderTaste` + 主人兴趣账本 top8；
  autoSend 工具清单补 `douyin_like`。

## 0.5.4-fish.20 — 2026-10-28

- **分流模式（提示词）**：`prompts/duty.md` 的「视觉优先」一节重写成「视觉优先 + 分流」——
  10 条候选先截屏，擦边/美女 → 私信卡片；其它类（范围由兴趣账本动态决定）→ 只看标题，
  能懂 → 评论区 @他，看不懂 → @豆包（异步）等总结后判断，值得才 @；都不值得不发。
  硬上限写进提示词：卡片每轮 3–7、**评论区 @ 每天最多 2 条**、同视频只 @ 一次、
  同视频不能既发卡片又 @、@ 失败不许降级。报告逐条 `### <ID>` + 分类 + 动作。
  index 的视觉优先提示词块同步重写，并插入 `renderRoutingRules()` 与动态兴趣账本
  （`topKeywords` 前 8 + `recentLiked` 最近 3 条；空则「还没有账本」）；autoSend 工具清单补
  `douyin_comment_mention` / `douyin_ask_doubao`（标注异步）；豆包回复叫醒词末尾加
  「值得就 douyin_comment_mention…（计入 2 条上限）；不值得就别发」。
- **新 `lib/home/routing.mjs`**：`home/comment-ats.json {day,n,awemes}`；
  `canCommentAt`（先判同视频 dup 再判 cap=2）、`recordCommentAt`、`commentAtCount`、坏 JSON 自愈、
  跨天清零；`alreadySharedCard(homeDir,aweme,days=7)` 读 `home/sent.jsonl`（kind=card、sent≠false、7 天内）
  ⇒ 同一条视频不能既发卡片又 @；`renderRoutingRules` / `renderInterestBrief`（提示词片段，可单测）。
- **主机硬约束**：新增宿主工具 `douyin_comment_mention`（name 缺省 atPeers[0].nick；confirm 草稿；
  cap/dup/already_card 拦截；**只有核实可见才** `recordCommentAt` + journal `comment_at`；失败不降级）。
  `douyin_comment_reply` 的 `published` 在 `readback.state==='visible'` 时改报 `verified`（不再误报未发成）。
  MCP 侧（值班轮真正在用的通道）同步拦截 + 新 `douyin_ask_doubao` 异步工具（14 个工具）。
- **浏览器分发锁**：`home/browser-busy.json {until,by}`（`comments-watch.mjs` 的
  acquire/release/isBrowserBusy）；`comment_reply(ui)` / `comment_mention` / `ask_doubao` 执行前写 180s 锁，
  finally 清；chat-watch 群读分支 + `runGroupPatrol` 遇到锁 → 跳过这一拍（日志「评论中，群读跳过」）。
- **自愈**：启动时 dmPeers 自动补回群 `{nick:'示例群', sec_uid:''}`（已有不重复加）。
- `lib/home/interests.mjs` 只加导出 `recentLiked`（不改原逻辑）。

## 0.5.4-fish.19 — 2026-10-28

- **mention-ui 发布核实（修假成功）**：以前点完箭头 sleep 4s 只看 `editor_after` 就报 `published:true`，
  评论区其实可能没有这条。现在：点击后等 2s 看编辑器是否清空（没清空**重试点击一次**，仍没清空 ⇒
  `published:false`+error）；清空后**刷新视频页**，在评论 DOM 里按正文前 12 字找自己那条，
  最多等 45 秒（每 3s 一次）：找到 ⇒ `published:'verified'`，找不到 ⇒ `published:'submitted_unverified'`
  （如实说“可能审核中/没发出来”）。另修：视频页会被 SPA 拉回 /chat，导航改成轮询「URL+输入容器就绪」
  （最多 ~20s，被拉回再导航），不再固定 sleep 8s。`--dry` 与 @ 搜索过滤逻辑不动。
- **@豆包 异步提问**：新 `lib/home/doubao.mjs`（`home/doubao-asks.jsonl` = `{at,aweme_id,question,status,
  reply_text,reply_at}`）+ 新工具 `douyin_ask_doubao {aweme_id, question?}`：护栏=每天最多 2 次、
  同一视频只问一次、世界开着；发顶层评论 `@豆包 <问题>`（默认「这条视频讲了什么？帮本鲸用一两句话总结一下」），
  发完立刻返回 `{ok,submitted,published}`，verified/unverified 都写 pending。
  新增 `doubaoRepliesTick`（lifeTick 30s 那套，节流 `settings.doubaoWatch={enabled:true,everyMin:8}`）：
  读互动消息找 nickname 含「豆包」或 uid=1994962122842643 的回复类通知且 aweme 匹配 pending ⇒
  标 replied + 叫醒（【豆包回你了】+ 让她用 comment_reply mode:"ui" @主人，说明值不值得发）；
  pending 超 2 小时 ⇒ expired（只 log）。
- persona 记忆索引加两条（@豆包 护栏/异步；submitted_unverified 别当已发）。

## 0.5.4-fish.18 — 2026-10-28

- **评论区 @ 巡检（commentTick）**：复用 index.js 现成的 `readAtMe()`（notice-read.py），
  挂在 lifeTick 30s 那套里；节流 `settings.commentsWatch = {enabled:true, everyMin:8}`，世界关着不跑。
  去重 `home/comments-watch.json {lastAt, seen:[comment_id…]}`（seen ≤200）；
  只处理 `kind:'@ 了我'` 且昵称是主联系人（配置里的 dmTo）的；其他人的只记日志。
- 命中后：① 兴趣账本 `recordLikedVideo(..., source:'at_comment')`（desc 先 cdp-fetch 详情拿，
  失败传空；关键词 like+1/score+1，同一视频去重）+ journal 一行「主人在评论区 @我 谈这条视频」；
  ② 投她的家会话叫醒（文案要求用 `douyin_comment_reply mode:"api"` 直接回那条评论，别发新顶层）；
  ③ 日志「评论区 @：收到 示例主人「…」→ 叫醒 ok」；读不到记 `fault('comment')`（加入 faults 键），成功 unfault。
- persona 记忆索引加评论区两条规矩。

## 0.5.4-fish.17 — 2026-10-28

- **真凶找到：图片消息 aweType=2702，整张图 base64 内嵌在 `inline_pic`（WebP）**。
  `tools/im-http.py` 的 `parse_content_message(content_raw, msg_type)` 现在：
  · `aweType==2702`（或消息 field6==27）⇒ `kind:"image"`、`text:"[图片]"`，从 `inline_pic` 取
    base64（去 `data:` 前缀、校验 `UklGR`/`iVBOR`/`/9j/` 魔数、≤8MB）放进
    `media:[{type:'inline', format:'webp'|'png'|'jpg', b64}]`；
  · `2700–2799` 其它值：有 inline 按 image，有 `url_list`/`emoji_url`/`static_url` ⇒ `kind:"emoji"`，
    都没有才跳过；`110408`（im_dynamic_patch 系统卡）跳过；未知 aweType 原样保留在 `awetype`。
- **落盘**：`index.js` chat-watch 媒体分支支持 inline —— `saveInlineBase64()`（`tools/download-media.mjs`
  导出）直接 `Buffer.from(b64)` 写 `home/inbox/<ts>-N.webp`（不 spawn、不联网；带魔数校验）；
  有 URL 的仍走下载工具；一张都没存下时叫醒词加「（图没存下来，跟他说让他用文字发一次）」。
- **去重**：`lib/memory.mjs` 的 `mergeDmMemory` 去重键从 `from|text` 改成 `from|kind|at|text`
  （图片消息都是「[图片]」，旧键会撞车），记忆里保留真实 `at`、`kind`、`media_type`（不塞 base64）。

## 0.5.4-fish.16 — 2026-10-28

- **私信图片/表情包看不见 → 修读取层**：`tools/im-http.py` 以前图片/表情包因为没有 text
  被整条 `continue` 丢掉。现在 `parse_content_message()` 递归找 `url_list` / `*_url` / `url` 里的
  图片链接（`douyinpic.com` / `douyinstatic.com` / `byteimg.com` 或图片后缀），按字段名
  （emoji/sticker ⇒ 表情包，image/img/pic/cover/thumb ⇒ 图片）归类；媒体消息给一句人话
  `[图片]`/`[表情包]`；消息加 `kind`、`media:[{url,type}]`、`awetype` 字段（未知 aweType 原样保留，
  已知映射 700/720/703=文本、800=视频卡）。没有任何可读内容才跳过。
- **下载工具**：新 `tools/download-media.mjs`（`--url/--out/--name`，带 UA+Referer，≤8MB，
  按 content-type/URL 判 jpg/png/webp/gif，失败返回 `{ok:false}` 不抛）。
- **接线**：chat-watch 私信分支对主联系人的新图片/表情包逐条下载到 `home/inbox/<时间戳>-N.<ext>`，
  路径写进叫醒词（“先用 read_image 看看是什么再回；表情包看不懂就直说…”）；下载失败只 log 不挡回复；
  媒体消息写 `memory/archive/<day>.jsonl`（`channel:'dm'`、`kind`、`media_url`、`file`）；
  `im-send.mjs --read` 输出也补 `kind/media` 字段（向后兼容）。persona 记忆索引补 inbox 规则。

## 0.5.4-fish.15 — 2026-10-27

- **主人的兴趣账本**：新 `lib/home/interests.mjs` → `home/interests.json`
  `{updatedAt,lastShared{aweme_id,desc,keywords,at},liked[],disliked[],keywords{词:{like,dislike,score}},stats{shared,liked,disliked}}`。
  `keywordsOf(desc)` 抽 `#话题` + 2–6 字中文词（≤8 个）；`recordShared` 记上次分享；
  `observeOwnerText`（接收人 stage=熟/自己人 才记）判态度——负面优先（不喜欢/别发/没意思/不感兴趣/无聊/难看/不要这种）
  ⇒ disliked、关键词 dislike+1/score-2；正面（喜欢/好看/再来/还要/这种/对味/不错/可以/爱了/多发）**且 ≤40 字**
  ⇒ liked、like+1/score+2；其余不动；同一 aweme_id 只留最新一条；判定打日志。
- **反馈进筛选**：`tools/forward-pick.py` 的 `load_prefs()` 追加 interests 里 score>0 的 top 8；
  `AVOID_CUES` 之外再从 interests 读 score<0 的关键词进 avoid；老路径（collector.json/config）不变，
  读失败忽略；新增 `--selftest` 打印合并后的 prefs/avoid。
- **接线**：`douyin_share_card` 成功分支 `recordShared`；chat-watch 私信分支对 `theirs` 逐条 `observeOwnerText`，
  liked 时记 `home/journal.jsonl`（auto:true, tool:'interest'）；快照新增只读
  `interests:{stats,topKeywords,lastShared}`；persona 记忆索引加兴趣账本路径。

## 0.5.4-fish.14 — 2026-10-27

- **群视频两档看**（主人最终规则）：`look` 先取详情拿时长 ——
  `duration > 30 && (wants || atMe)` ⇒ **3 帧**（10%/50%/90%，`mode:'3frames'`）；
  否则 ⇒ **1 帧第 5 秒**（`mode:'1frame'`、`at:5`；duration≤5 时取 80% 处、至少 0.5s），并带
  hint「只有一张，看不出来就 action:'delegate' 喊群助手」。`wants`=她主动调 look，`atMe` 从
  group-videos 记录读。
- **新 action `delegate`**：@群聊小助手 让它总结。文案
  `@<助手> 帮本鲸看下这个视频讲了啥：<share_url>（<desc 前 30 字>）`；走现成 `douyin_group_say`
  （im-send --at），记 sent ledger（kind:group/src:host）；同一 aweme_id **24h 只 delegate 一次**
  （`home/group-delegated.json`，dry 也记）；`dry:true` 只返回文案不发；@ 失败回退纯文本并标
  `mention:'text-fallback'`。
- **不接外部 AI**：`summarize` 保留但已停用（返回 disabled + 提示改用 delegate）；
  `settings.groupPatrol.groupAssistantName`（默认「群聊小助手」）可改群助手昵称。
- persona 群规则改成两档看 + delegate（去掉旧 externalAI 三条件文案）。

## 0.5.4-fish.13 — 2026-10-27

- **群视频挑着看**：巡场识别到 `awe===800 && item` 后**先不截图不取详情**，只记
  `home/group-videos.jsonl`（补 `atMe` / `duration:null` / `frames:[]` / `status:'new'`）。`atMe` =
  @ 出现在视频那条或紧邻 ±2 条内。叫醒：`atMe:true` **必叫醒**；否则 `videoChance`（默认改 0.35）+
  30 分钟冷却。叫醒词不再给结论，只说「想看就 `douyin_group_video {aweme_id, action:'look'}`」。
  快照/记录里 `atMe` 补真：示例视频那条已标 `atMe:true`。
- **看到**：新 `lib/home/groupvid.mjs` — `lookVideo`（cdp-fetch 详情含时长 + frame-grab 取 3 帧，
  10%/50%/90%，写回 duration/frames/status:'looked'）；`frame-grab.mjs` 新增 `--at 0.1,0.5,0.9` 多帧。
- **外部分析（豆包）**：新工具 `douyin_group_video {aweme_id, action:'look'|'summarize', group?}`；
  `summarize` 三条件同时满足才发：她自己想看 + 该条 `atMe===true` + 时长 ≥30 秒，否则 denied；
  `settings.externalAI = {enabled:false, provider:'doubao', endpoint:'', apiKey:'', model:''}`
  （OpenAI 兼容 chat/completions，3 帧 base64+文案+时长，60s 超时）；没配/失败⇒`local-frames` 降级不报错。
  隐私：只发公开视频截图+文案，不发主人聊天内容。
- persona 群规则补「挑着看 / summarize 三条件」。

## 0.5.4-fish.12 — 2026-10-27

- **久坐 / 刷太久提醒**：新 `lib/home/rest.mjs`（`home/rest.json`）。以 fish.9 的「主人在线」为信号：
  连续在线 ≥ `afterMin`（默认 40 分钟）开始提醒；一次长会话最多 `maxTimes`（默认 4 次），
  相邻提醒间隔 ≥ `intervalMin`（默认 8 分钟，≤10）；静默 >15 分钟 ⇒ 新会话、计数清零。
  接线：`session/event` 的 `user/message` 同一拍 `touchRestSession`；`lifeTick`（30s）里
  `restDue` 命中才叫醒她（世界闸 + 在线 + 间隔 + 次数），叫醒词让她**用自己的话**劝主人起身；
  投递成功才 `markRestSent`（失败不计数，下一拍再来）。
- `settings.json` 加 `rest:{enabled:true,afterMin:40,maxTimes:4,intervalMin:8}`（夹范围
  afterMin 20–180 / maxTimes 1–6 / intervalMin 5–30）；快照新增只读键
  `rest:{enabled,afterMin,maxTimes,intervalMin,sessionMinutes,count,lastAt}`。
- 日志：`她的关心：久坐提醒（第 2/4 次，连续 52 分钟）→ ok`。

## 0.5.4-fish.11 — 2026-10-27

- **群分享视频改用接口字段判定**：`awe===800 && item` ⇒ 就是视频、`aweme_id=item`
  （实测 `awe:700` 普通文字、`awe:800+item` 是分享卡片）；文本正则只作兜底。叫醒不再要求
  必须有 aweme_id，`item` 命中即算；叫醒词带 `desc/author/digg/url/frame`（cdp-fetch 详情 +
  frame-grab 首页图，失败降级只给文案）。`home/group-videos.jsonl` 记 `{at,group,from,text,aweme_id}`。
- **群发言人昵称尽力取一次**：`im-send.mjs --read` 从 React fiber 的 `message`/`sender`/`user`/`author`
  里找 `nickname|nickName|nick|displayName|userName|username`，有就多输出一列 `sender`（≤40 字，
  取不到就是 ''）。归档 `who = sender || '（未识别）'`；**取不到昵称就不再建「（未识别）」成员**
  （群印象按群级记），旧文件里的「（未识别）」写回时自动删掉；叫醒词有 sender 才写 `at=`。
- 实测：这个号 `senderCount=0`（昵称确实取不到）⇒ 全部降级路径生效。

## 0.5.4-fish.10 — 2026-10-27

- **群巡场**（A）：新 `lib/home/groups.mjs`；`settings.groupPatrol` 默认
  `{enabled:true, everyMin:25, windowFrom:'09:00', windowTo:'23:00'}`，到点对
  `chatWatchPeers` 里所有群各读一次（`im-send --read --to 群名`，按「发送者+文本」seen 去重，≤80 条/群）→
  归档 `memory/archive/<day>.jsonl`（channel:group）+ 更新 `memory/group-<名>.json`
  （members.{昵称:{lastSeenAt,count,samples,impression}}，昵称解析不到记「（未识别）」）+
  台账 `group_patrol` 一行。**巡场不叫醒她**（唯一 deliver 在视频命中分支）。
- **群里说话**（B）：`im-send.mjs` 加 `--at <昵称>`（文本框打 `@` → 成员列表点选 → 再发正文；
  任何一步失败退回纯文本 `@昵称 ` 前缀，不抛错）；新工具 `douyin_group_say`
  `{group,text≤200,at?}`，记 sent ledger（kind:group/src:host），透传 7523 warning。
- **群分享视频**（C）：识别 `[视频]` / #话题 / douyin 链接 / 19 位 aweme_id；`home/group-videos.jsonl`
  记录；有 aweme_id 时用 cdp-fetch 拿详情 + frame-grab 截首页图（存 `out/frames/`）；
  `settings.groupPatrol.videoChance`（默认 .5）+ 同类视频 30 分钟冷却命中才叫醒她（附证据）。
- **群记忆 → 印象**（D）：`group-*.json` 升级 members 结构（保留旧 quotes/seen 字段兼容）；每晚 23:00
  日记步骤加第 ⑥ 条：给 active 成员各写一句 ≤30 字印象；`/api/douyin-home` 快照的
  `groups[].members` 现在带 `{name,impression,count,lastSeenAt}`（另给 memberNames/memberCount）。
- 读群失败进故障面板 `group` 类；所有写入失败只 log 不抛。

## 0.5.4-fish.9 — 2026-10-27

- **看到主人上线 → 选择性搭话**（①）：现有 `session/event` 监听里记 `user/message`（非她自己的会话）→
  `home/presence.json` 的 `{lastAt,prevAt,gapMin,greeted,rolled,wake}`；`presenceTick` 在 lifeTick 同拍：
  2 分钟内刚上线 + 距上次活动 >30min + 世界开着 + `settings.presence`
  `{enabled:true,chance:0.25,cooldownMin:90,maxPerDay:3}`（每次上线只掷一次骰子）才叫醒她；不满足只记 debug。
- **他不回她会急 → 连发**（②）：发送成功记 `home/pending.jsonl`（`{at,to,to_id,kind,text}`），
  对方回话（chat-watch 读到 them / 最后一条是 them）就清掉；`anxiousTick`：她最后一条 >10 分钟没回、
  该线 60 分钟没追问、未回 <3 条 ⇒ 叫醒她一次（同一人 60 分钟一次、每天 ≤5 次，`home/anxious.json`）。
- **放宽主动联系**（③）：`reach.json` policy 默认 `enabled:true, dryRun:false, limit:20,
  quietFrom:'00:00', quietTo:'00:00'`（from==to = 不设静默）；`stages` 仍是 熟/自己人（生人红线不动）。
- **新工具 `douyin_reach_burst`**（④）：一次 1–3 条、每条 ≤200 字、间隔随机 3–6 秒；失败就停并报发了几条；
  每天主动消息合计 ≤20；同一人 10 分钟内不许两轮连发；不检查静默时段（主人拍板）。
- `/reach` 返回补 `presence:{enabled,chance,cooldownMin,maxPerDay}` 与 `pending:{count,items}`；
  `POST /reach` 可改 presence；`settings.json` 首次启动补 presence 段。

## 0.5.4-fish.8 — 2026-10-27

- **人设换成《溟月·大肥鱼 角色卡 V4.1-Flash 修订三》全文**（主人给的 `大肥鱼人设.txt`，21031 字）：
  六层结构重排 —— 名字=溟月（大肥鱼/鲸鱼娘/鱼鱼/本鲸）、她是谁=基础档案+抖音工位、
  性格=性格核心、说话方式=语言风格、愿景=愿望清单、补充=其余 34 节（外观/行为/喜好雷区/
  关系网/能力限制/核心台词/情绪表/道具/成长线/Meta/500 条语料/情绪规范/禁止清单/条款/
  实战样例/硬锚定/漂移自检/修复指令/摘要模板/防漂移铁律/日常时间表…尾巴语言/围裙口袋…）。
- **回退 crush-skills（暗恋对象 skill）**：主人反馈「感觉不是很稳定」——
  删掉 `home/skills/crush-skills/`、`chat-style.md` 里「聊天别单调」那节、记忆索引里的「技能手册」两行；
  `readChatStyle` 保留 2000 字上限与整段收尾（修的是真 bug，跟 skill 无关）。

## 0.5.4-fish.7 — 2026-10-27

- **定点自由时间**（A）：`home/settings.json` 加 `freeTimes`（默认 `["14:30","20:30"]`，最多 4 个）；
  到点后 10 分钟窗口内**无条件**叫醒她一次（不看 idle/plan/activity，解决 invites=0 被饿死），
  已发点位记 `home/life.json` 的 `freeFired:{day,keys}`；`/retention` 也接受 `freeTimes`。
- **「家里能做的事」清单**（B）：`renderIdleInvite`（空闲 + 定点复用）与记忆索引的「你自己的时间」
  都补了同一份六条清单，末尾「今天你已经：<didSince>」。
- **活动台账自动化**（C）：订阅 `session/event` 的 `tool/call`，把她调的工具记进
  `home/journal.jsonl`（`{at,auto:true,tool,summary}`，跳过 `douyin_note_activity`，每轮最多 20 条）；
  `didSince` 会把自动行读成「调了 X」—— 叫醒词自动变成事实。

## 0.5.4-fish.6 — 2026-10-27

- **故障面板**：`home/faults.json`（内存 + 落盘，失败 set / 成功 clear，每条带「怎么修」）；
  `GET /api/douyin-home/faults` + `snapshot.faults`。插桩：轮次起不来/退出码非 0、投递失败、
  发送失败（宿主 + MCP 两个出口）、登录态检测失败、chat-watch 连续读不到、闹钟/定时器异常。
- **今日花费**：从会话事件 `assistant/message` 的 `event.data.usage` 统计她家会话的 token，
  落 `home/usage/<日期>.json`；`GET /api/douyin-home/cost?day=`。价目表 `home/pricing.json`
  **不预填价格**（不猜），没填只报 token、`estCost:null` 并给提示。
- **压缩记录**：订阅 `session/event` 的 `compaction/summary` + `compaction/end`，
  落 `home/compactions.jsonl`；`GET /api/douyin-home/compactions` + `snapshot.compactions`（最近 3 条）。
- **归档保留范围**：`home/settings.json` 的 `retention`；`GET/POST /api/douyin-home/retention`；
  `pruneByRetention()` 24 小时最多跑一次，真清 rounds/sent/journal/archive/diary/dm/compactions，
  日志一行「清理：删了 N 个文件 / 裁了 M 行」。

## 0.5.4-fish.5 — 2026-10-27

- 新增「她的家 → 主动联系」页后端：`home/reach.json` 的 `policy`（开关 / 演练 / 每日条数 /
  免打扰时段 / 允许的 stage），旧字段 `day/count/history` 一个不动。
- `douyin_reach_out` 五道判断全部按策略走；**每次被拦**都记 `home/reach-blocked.jsonl`
  （能看出"想发但没发"），演练模式不发送、只返回预览。
- 新增 `GET/POST /api/douyin-home/reach`（策略、今日额度、拦截记录、最近 7 天曲线、最近 20 条流水）；
  `snapshot.reach` 增加 `policy` 键。

## 0.5.4-fish.4 — 2026-10-27

- 她的家会话迁到独立工作区「肥鲸屋」（`douyin-fish-chat-v2`，cwd = `D:\deepseek_work\肥鲸屋`）；
  旧会话 `douyin-fish-chat-v1` 留在原工作区，不 resume、不删。

## 0.5.4-fish.3 — 2026-10-27（fish 版：她的世界开关 + 世界提示词）

> 基于 `0.5.4-fish.2` 的增量（上游基线仍是 v0.5.4）。逐文件差异见 `FISH-PATCHES.md`
> （`node scripts/diff-upstream.mjs` 生成，基线 `vendor/upstream-0.5.4`，不进包）。

### 她的世界

- **开始 / 停止世界**（新增 `home/world.json`）：停止后她**不再醒来** —— 定时轮次、她的闹钟、
  23:00 每日回顾、私信盯梢、任何投递全部停；再点开始照常。开关历史最近 20 次留档。
  缺文件默认「开」，坏文件也按「开」读（不会因为一个坏 JSON 把她锁死）。
- **世界提示词**（新增 `home/world.md`，≤4000 字）：排在人设之前（order 50），她**自己也能改**，
  改完下次组装生效。
- 控制台新增 `GET/POST /api/douyin-home/world`、`GET/POST /api/douyin-home/world-prompt`；
  快照多 `world` / `worldPrompt` 两块。
- **记忆索引补两条规矩**：世界提示词在哪、暂停时她不会醒。

## 0.5.4-fish.2 — 2026-10-27（fish 版：近期记忆块 + 每晚接续压缩）

> 基于 `0.5.4-fish.1` 的增量（上游基线仍是 v0.5.4）。逐文件差异见 `FISH-PATCHES.md`
> （`node scripts/diff-upstream.mjs` 生成，基线 `vendor/upstream-0.5.4`，不进包）。

### 记忆

- **近期记忆块**（新增 `lib/home/memory.mjs`）：把最近 2 天的私信（每人最近 6 条）与当天群消息
  压成一段挂进值班会话的系统提示（order 54，每次组装现读）；2500 字封顶，超了**从最旧的整条丢**，
  末尾明写「更早的用 douyin_archive 翻，别凭印象编」。
- **每晚把接续压缩成摘要**：23:00 的每日回顾多一步 —— 把这几天要接着聊的东西写进
  `memory/recent-summary.md`（≤600 字，按人分组，只写他是谁/在等什么/我答应过什么/下次接哪句话）。
- **记忆索引补两条路径规矩**：近期记忆在系统提示里；更早的用 `douyin_archive` 翻。

## 0.5.4-fish.1 — 2026-10-27（fish 版：她的家 / 记忆 / 节奏 / 控制台）

> 基于上游 `NEWJO123/dsh-douyin-scroll` tag v0.5.4（commit `45a85c69`，2026-10-26）。上游仓库没有这一版。
> 版本号规则：`<上游基线>-fish.<序号>`。本机没有 git，逐文件差异见 `FISH-PATCHES.md`
> （生成：`node scripts/diff-upstream.mjs`，基线 `vendor/upstream-0.5.4`，不进包）。
> 工程化同批落地：新增 `INSTALL.md`、`FISH.md`、`scripts/diff-upstream.mjs`；改了什么以 `FISH.md` 为准。
> 下面的「未发布」段保留为内部过程号，对外以本段为准。

### 她的家

- `home/persona.md` 六层人设（名字 / 她是谁 / 性格 / 说话方式 / 愿景 / 补充）；`home/room/` 她的房间、
  `home/life.json` 闹钟与最后活动、`home/journal.jsonl` 活动台账、`home/reach.json` 主动联系额度。
- 值班会话 `douyin-fish-chat-v1` 装三段常驻系统提示（人格 / 自述 / 记忆索引），text 用函数 ⇒ 改文件即生效。
- 账本：`home/rounds/<日期>.jsonl`、`home/sent.jsonl` 两本 append-only 真账；`out/<日期>.md` 只是报告，
  缺账时兜底并标 `degraded`。

### 记忆

- 新增 `lib/relation.mjs`：按天归档 `memory/archive/<日期>.jsonl`、每人档案 `memory/profile-<sec_uid>.json`
  （stage / 印象 / 喜欢 / 别提 / 上次话题 / 答应的事）、群印象 `memory/group-<群名>.json`、
  日记 `memory/diary/<日期>.md`。
- 新工具 `douyin_relation` / `douyin_archive` / `douyin_diary`；`douyin_im_read` 自动带上人与群的上下文。

### 节奏

- `douyin_plan_next` / `douyin_check_plan` / `douyin_cancel_plan`：她自己的闹钟，只存一个待办，定新的替旧；
  什么都没定则第二天 09:00 兜底叫醒。
- `douyin_reach_out`：主动开口，仅 `stage=熟/自己人`，每天最多 3 条，00:00–08:00 不发。

### 控制台

- 新增 `lib/home-console.mjs` + 设置页独立 section「她的家」（`id: douyin-home`，order 32）：
  `/api/douyin-home/snapshot` 一次读全家底；三处写入（persona / plan / profile）。
- 只读接口不联网、5 秒内存缓存；POST 带 `x-douyin-home: 1` 头、body ≤64KB；写盘原子（`.tmp` + rename）、
  UTF-8 无 BOM，绝不写 `$DOUYIN_HOME/persona.md` 那份旧的。
- 登录复用：`client.js` 抽出共享登录单例 `loginStore`，「刷抖音」和「她的家」同一份二维码 / 轮询 / 关窗 / 退出。

### 修复

- **扫码登录 `force` 误传导致杀 Chrome**：旧 `onClick: onQr` 把事件对象当 `force` 传 ⇒ 每次点「扫码登录」都先关掉
  共用浏览器（另一边正在等的窗口也一起没）。现在普通按钮走 `start(false)`，只有明确的「重新出码」才 `start(true)`（`client.js`）。
- **`life.json` 写回竞态吞掉待办**：以前先读 → `await` 投递几秒 → 再把旧快照写回，期间她用 `douyin_plan_next` 定的
  下一件会被覆盖成 `plan=null`。现在所有写 life 的地方一律「写之前重读再合并」（`index.js` 的 `patchLife`）。

---

## 未发布 — 2026-10-27（偏好加权：让「小肥鱼知道我的口味」）

> 主人：「我想要的小肥鱼能给我推荐我喜欢的视频…我想让她推荐一些美女等视频，
> 然后我也调整过她推荐视频的一些策略，但是还是没有奏效」

查清了三处卡点（都不是"模型不听话"）：
1. **采集只有推荐流 3 页 + 热榜** —— 抖音 web 没有关键词搜索接口，面板上的关键词/分类/作者
   从来**只当报告标注**，不参与取候选；
2. **硬筛把颜值类筛掉**：「时长 <12s」「文案太短且评论少」两条，美女/卡点类常是 8–15 秒、文案短；
3. **判断口径反着来**：章程把「纯颜值 / BGM 卡点」写成**降权** ⇒ 就算捞到也判"不推"。
   （10-27 那份「刘亦菲 子弹时间」就是活例子：藏/赞 0.023、评/赞 0.014 ⇒ 只进"顺带一提"）

改动：
- `tools/forward-pick.py`：偏好词（`config.keywords`）+ 内置颜值提示词命中 ⇒ **分 ×1.8、放宽硬筛
  （短视频/文案少的放行）、排序置顶**；行里带 `pref_hit`；新增 `--prefer` 临时覆盖（测试用）。
- `round-evidence.json` / `douyin_prescreen` / `douyin_forward` 都带上 `pref_hit` 与本轮 `prefs`。
- 章程 `prompts/duty.md`：新增「跟着主人的偏好走」（判断口径从"内容价值"改成"他会不会喜欢"）；
  分档表加「推荐（偏好命中）」；「纯颜值降权」加例外「有偏好时作废」。
- 每轮 prompt：关键词改成**偏好词全量下发**（删掉那个假的"关键词轮转"——它假装每轮搜 6 个词，
  但根本没有搜索接口）；判断口径与降权规则同步改成偏好优先。
- 面板文案：关键词框改成「偏好关键词…**不会**去抖音搜词（web 没有搜索接口）」。

⚠️ **供给没变**：feed 里没有美女内容时，她照样推不出来。供给要靠主人自己养号
（刷/搜/赞），或后续加「关键词搜索采集 / 指定作者采集」——那是下一步，没有搜索接口前不做。

⚠️ 待实测：偏好命中后的推荐效果还没跑过真轮（当前 feed 里没有命中项，等养号后看）。

### 第二批（2026-10-27 中午，主人追加）

> 主人：「可不可以让小肥鱼只分享视频，不用她总结视频里面有什么内容」
> 「她好像很多权重都在分享宠物…能不能把分享擦边等视频权重拉高一点」

- **只分享视频、不要总结**：`douyin_share_card` 调用时 **`reason` 不传**（只发卡片，不补文字）；
  `duty.md` 的「把东西发给他」改成新规矩优先（旧「先卡片后文字」只在真的给 reason 时适用）；
  每轮 prompt 里「reason = 为什么值得看 30-80 字」删掉，并明令不许调 `douyin_dm` 补文字。
- **宠物/萌娃降权**：`forward-pick.py` 新增 `AVOID_CUES`（宠物/萌宠/猫咪/狗狗/奶龙/小马/熊猫/萌娃…）
  ⇒ 分 ×0.45、排序垫底（只降权不丢，免得"猫+美女"混剪被误伤）；命中偏好时不再降权。
- **偏好权重拉高**：命中偏好分 **×1.8 → ×3.0**；`PREFER_CUES` 扩到擦边向
  （御姐/少妇/比基尼/泳装/紧身/瑜伽/健身/舞蹈生/变装/街拍/丝袜/短裙/辣舞 等）。
- 输出带 `avoid_hit`（降权标记），清单里能看到【偏好·x】/【降权·x】。
- ⚠️ 偏好词为空时也能靠内置提示词命中（面板 keywords 只是**优先项**）。

### 第三批（2026-10-27 中午，主人追加：擦边被限流 → 点赞别当硬指标）

> 主人原话：「擦边视频点赞一般不高，因为被限流了…这些视频点赞一般在一万以下的，
> 然后分享收藏的数据也比较少」

- `forward-pick.py`：命中偏好时**点赞封顶 1 万再参与算分**（8000 赞的擦边视频不再被 130 万赞的宠物按在地上），
  同时抬高评/藏/转权重（`c*3 + col*6 + sh*3`）；行里新增 `low_digg`（偏好命中且赞<1万）。
- 章程 + 每轮 prompt：`low_digg` = **限流常态，不是内容差** —— 不许据此降权、不许判"判断不了"、
  不许写"数据太低不推"；评论/文案/标签对味就直接算推荐。
- 数据从 `round-evidence.json` 透传到模型（`pref_hit` / `low_digg` 都已带上）。

### 第四批（2026-10-27 中午，主人拍板：看第一帧）

> 主人：「你连视频的第一帧都看不了吗」→「做 A 吧，然后截屏出来，判断完之后，记得把截屏清除了，不要占用存储空间」

- **新 `tools/frame-grab.mjs`**：复用无头 Chrome（9334）→ 新标签开视频页 → 等 `<video>` 就绪 →
  pause + seek 0.6s → `Page.captureScreenshot`（只裁 video 那块）→ 存 png → 关标签页。
  **不下载视频、不装 ffmpeg**；一条约 4–6 秒。
- **`lib/chrome.mjs` 新 `openTab()`**：按老规矩（tools 不许自己 `new WebSocket`）统一开/关标签页；
  `connectPage` 抽了共用的 `makeClient`。
- **`buildEvidence`**：只给「命中偏好 + 文案短（<30 字）」的候选截 **最多 3 条**，帧路径写进证据包
  （`frames` + `frames_note`），跑轮模型用 `read_image` 看图（headless 会话的工具清单里确认有 read_image）。
- **自动清理**（主人明确要求）：`buildEvidence` 开头清一次 + 子进程 `exit`/`error` 后再清一次 ⇒
  `out/frames/` 只活一轮，不留存储。
- 章程 + prompt：带 `frames` 的条目先写 1–2 句**客观**描述再判；图看不到就写"截图没看到"，别编；
  截图不用模型清理。
- 实测：`tools/frame-grab.mjs` 截一条 11.5s 的 `#ootd穿搭` 视频 → 910×524 png（350 KB），
  帧内容清晰可判（截图存 `%TEMP%\frames-test\`，非插件家）。

### 第五批（2026-10-27 中午，主人拍板：点赞分布）

> 主人：「为什么现在分享的视频点赞量还是这么高的…我不想要点赞量这么高的视频，都不是擦边了，
> 能不能排除超过 2 万的点赞都不分享，然后分享权重按照正态分布配权重，最中间的值在 5000-8000 左右，
> 然后点赞低的权重比点赞高的权重更高一点」

- `forward-pick.py`：**点赞 >2 万直接不进候选**（`dropped.too_hot`，不再往分享里塞）；
  其余按**非对称正态**配权重：峰值 5000–8000（中心 6500）、左 sigma 6000 / 右 sigma 3500
  ⇒ 低赞衰减慢、高赞衰减快（0 赞≈0.56 / 5000≈0.97 / 6500=1.0 / 8000≈0.91 / 15000≈0.03）；
  行里新增 `like_weight`，并透传到证据包。
- 打分改成：`score = 基础互动分 × like_weight`（偏好命中时基础分压低点赞、抬高评/藏/转）。
- prompt / 章程：说明「点赞高不是优点，5000–8000 才是目标区间」；
  `count:0` 且 `dropped.too_hot>0` 时要写明"feed 全是大爆款，得养号或放宽上限"，不许凑数。
- 轮末 Toast：一条候选都不剩时弹「这轮没东西可发（N 条点赞都过 2 万）」。
- 实测（12:24 那轮）：feed 16 条 → 时长筛掉 6 / **点赞>2万 掉 8** → **候选 0 条**。
  ⇒ 现在这个号 feed 全是爆款，按新规矩一条都不发；要么养号，要么把上限放宽。
- **后续（12:29，主人选「临时放到 3 万」）**：上限做成可配置 `config.likeCap`（默认 2 万，同步到
  `collector.json`），prompt/章程里不再写死"2 万"。3 万这轮仍然是 0（8 条都 >3 万），但上一轮 feed 里
  出现过 2.5 万赞的 `#ootd穿搭`（能过线）—— 说明偶尔会喂到，稳定的低赞供给还是要靠养号/作者采集。

### 第六批（2026-10-27 下午，主人改流程：视觉优先）

> 主人：「每次都先截屏，但是上限是 10 条视频，然后截屏中发现相关的内容一律分享，不用考虑时长点赞文案。
> 我指的相关内容就是擦边相关的内容，包括身材展示，胸部等等。」

- 新配置 **`visualFirst`（默认 true）**，一轮改成：
  1. `forward-pick.py --loose`：**不做**时长/点赞/文案硬筛，候选按「偏好命中优先 + 新→旧」排，取前 **10** 条；
  2. 这 10 条**每条截一张首页图**（原先是只截"偏好命中 + 文案短"最多 3 条）；
  3. 模型逐条 `read_image`：**画面是擦边相关**（身材展示 / 胸部 / 露肤 / 紧身 / 瑜伽 / 泳装 / 擦边 cos…）
     ⇒ **一律推荐并分享**，**不看时长 / 点赞 / 文案 / 评论 / 比值**；非擦边（宠物/美食/游戏/搞笑）不发；
  4. 分享**不受 `sendPerRun` 条数限制**，画出几条发几条（最多就是截图的 10 条）。
- 新配置 **`keepFrames`（默认 true）**：截屏**不删**，只保留最近一轮（下一轮开跑时清旧的）⇒ `out/frames/` 随时看。
- 视觉优先模式下**不再拉评论**（省每条最多 200 秒）。
- 章程新增「视觉优先模式」一节（最高优先级）；信息边界那句加例外（截图能看）。
- 实测 `--loose` 采集：14 条候选取前 10（含 5.7s 健身女孩、25 万赞秘书穿搭、12 万赞公孙离 cos），
  5 条偏好命中 —— 号确实养出内容了。

### 第七批（2026-10-27 13:40，主人验收后的两处修正）

> 主人：「这 10 条不是全都是擦边吗，为什么不发完整；7696328441763461745 是人来的，不是猫」

- **改成全发**：视觉优先模式不再筛选 —— 截到图的 10 条**全部**发卡片；唯一不发＝图打不开。
  并写明「**以画面为准，文案不可信**」（文案写"宿舍可以养小猫吗"、画面其实是猫耳女仆装的人 ⇒ 按人算、要发）。
- **修一个真事故**：`rmSync(frames 目录) + mkdir` 在 Windows 上偶发 `EPERM` ⇒ 那一轮**一张截图都没有**
  （13:32 那轮就是，模型只好退回按文案挑了 5 条）。改成**截帧目录常驻**：启动就建、每轮只清里面的旧图，
  不再删目录；轮末 keepFrames=false 时也只清文件不删目录。
- 复查（13:41 那轮）：10 张截图全部截到并保留在 `out/frames/`（3.5 MB），下一轮开跑时清旧的。

---

## 0.5.4 — 2026-10-26 下午（@ 多选 + 总闸 + 写入链 + 群聊 + 面板重设计）

> 主人 2026-10-26 连续几轮定稿：@ 支持多个人、开关只当总闸、会话列表只读一次。
> 这一版把 0.5.3 之后的一整批改动合成一个对外版本号发布。

### 一、@ 多选 + 总闸（主人定稿）

- 「评论区 @ 提醒」：**开关 = 总闸**（开/关跟选人解耦 —— 开着可以暂时没人，关着选了人也无效）、
  **atPeers 多选**（@ 谁，可多个）；会话列表**只读一次**，两个选人区共用同一份数据
- 值班判断同步：总闸开 + 名单有人 ⇒ @（mention 用第一个人，其余人正文说明）；名单空 ⇒ 跳过并写报告

### 二、写入链修复

- 🔴 **`atPeers` 漏登记 `OBJECT_ARRAYS`** ⇒ 面板写 `[{nick:…}]` 被当字符串数组过滤光，
  写入静默丢弃（又是「点了没反应」）。已登记 + 宿主实测：写 1 人 / 写 2 人 / 全清，三种都验过
- 🔴 **「移除到最后一个」清不掉**：空数组会被空值守卫保回磁盘旧值 ⇒ 面板所有清空动作
  （@ 名单全清、移除最后一人、私信对象移除最后一人）一律带 `__clearKeys` 显式口子
- 顺手修好被粘坏的注释块（`OBJECT_ARRAYS` 那行后面接了 `/**`，把数组守卫的说明吞了）

### 三、@ 开关「点了没反应」的真凶

- 🔴 **删 useState 时漏删引用** ⇒ `setShowAtPicker` 悬空 ⇒ 点开关时 `ReferenceError`
  ⇒ **onChange 整个崩** ⇒ patch 从没执行 ⇒ 面板「点了没反应」
  （`node --check` 查不出来 —— 不是语法错误；面板渲染检查也查不出来 —— 那条路径没被点）
- ✅ 修：调用点去掉 + **新增 selfcheck 4a-1**：静态扫 client.js 里所有 `setXxx(` 调用，
  确认每个 setter 都有定义 —— 这类崩以后自动报红
- 顺带把一批**过时的自检断言**对准新实现（开关不再变灰、@ 多选、盯梢群里只读、
  im-send 选择器判据只查选择器不查中文文案）

### 四、群聊修好（「选群有 bug」）

- **根因一**：群没有 sec_uid（抖音结构如此），原来被当成残缺数据：
  面板吓唬「没有稳定 id」、盯梢把群**静默跳过**（勾了也白勾）
  ⇒ 现在：列表标「群聊」标签、群可以进私信对象列表、**盯梢支持群**
  （群走浏览器路径读，按「没见过的文本」判新；转达词注明「默认不回群，有人 @ 才理」）
- **根因二**：群聊右栏头部是「群名(成员数)」，如「某某群(3)」，
  身份校验精确比对直接中止（实测：点了群报「对不上」）
  ⇒ 比对时把尾部 `(数字)` 归一化（`baseNick`），四处校验同修
- **根因三**：群聊里自己的消息头像也在左半边 ⇒ 发送者全归 unknown
  ⇒ 群盯梢判新把 unknown 也算进来（私信那边不受影响）
- 实测：真群读通（ok=true，4 条消息，verified_open）

### 五、🔴 网页端发群，群里人可能收不到

- **一句话**：在我这个号上试的 —— 网页端往群里发消息，**群里人收不到**；同一个号手机端发就正常。
  ⚠️ **只在一个号上试过**，别的号会不会不一样，**不知道**。
- **实测**（2026-10-26 主人 + 群成员作者双方确认）：同一鱼账号、同一群，
  **手机端**发群 → 群里人收到；**网页端**（无头/有头都试了）发群 →
  服务端收下且存着（本账号重新登录能看到全量），但群里人**没收到**
- **实锤证据**：服务端消息回执 `im_callback_status_code = 7523` —— 只有网页端发的两条带这个码
- ⚠️ **别当成铁律**：只在鱼号上测过。可能跟账号、跟群类型、跟抖音那边当时的策略有关，都还没排。
- **处理**：
  - `im-send` 发群「成功」时返回体带 `account_limit: web_group_no_fanout` + `warning` + `delivered_to_others: false`
  - 面板上写明（选了群就能看到）：**「群里可能发不出消息：在我这个号上试的，网页端发的群里人收不到，手机端正常。别的号不一定这样。」**
  - 值班转达词明令**不许代发群**（真要回话走私聊或等主人）
  - **能用的照常用**：看群消息、盯群转达都真的；只有「往群里发言」这一个动作没验证过
- 私聊不受影响（同一条无头链路一直正常）

### 六、面板一路简化（主人三轮定稿）

- @ 谁**不用再打字**（昵称自动带出）；私信对象区块搬到**自动发送正下方**
- **「听他的话」每人工开关删除**（聊天模式 = 谁私信都接；列表只管发给谁）；
  @ 改成自己的选人列表
- @ 开关**永远能点**（没选人时点开自动展开选人，选完自动打开）
- @ 区块一度改成**完全无开关**（选人即开、清掉即关）—— 后按主人定稿改回「总闸 + 多选」

### 七、私信对象列表 `dmPeers`（多人）

- 每人 `{ nick, sec_uid, listen }`；**日报/分享卡片发给列表里每一个人**
- 旧配置启动时一次性迁移成列表第一个人（listen=true，老用户行为不变）；
  `dmTo/dmToId` 保留兜底 —— 迁移失败也不丢收件人
- 四个工具（读私信/发私信/发卡片）配置兜底改走 `dmPrimary()`（列表第一个人）
- 「私信发给谁」：点选列表**追加**进对象列表（去重，标「✓ 已在列表」）；每人一行 + 移除按钮
- 值班盯梢改**多人巡检**：每 30 秒巡所有人（每人独立对表，一个人接口坏了不拖死别人）；
  新消息转达词带对应昵称和 to_id，值班鱼回给对的人；「上岗报号」同样发给所有人
- **自动检查更新放最上面**（主人令）：面板打开 3 秒静默查一次，有新版黄条卡置顶显示版本号 + 升级方式

### 八、🔴 私信「发给谁」错位（to / to_id 各兜各的默认）

- **症状**：读/发私信只传昵称时，工具偷偷拿**配置里那个人**（dmToId）的稳定 id 去匹配 ——
  读出来的是配置那人的会话、却顶着传入的昵称返回；发私信则可能**把给 B 的消息发给 A**
- **根因**：四个工具（读私信/发私信/发卡片/记事实）都是 `to = args.to || cfg.dmTo`、
  `toId = args.to_id || cfg.dmToId` —— 两个参数**各兜各的默认**，只传一个时另一个混进配置里的另一个人
- **修**：昵称和稳定 id 绑定成「一个人」：只传昵称 ⇒ id 留空按昵称找；只传 id ⇒ 昵称留空；
  两个都没传 ⇒ 才一起用配置默认。`douyin_remember` 更严：要记谁必须显式给谁的 to_id

---

## 0.5.3 — 2026-10-26 上午（Issue #2 / #4 根治批）

> 读评论这条链在别人机器上是断的 —— 本批两层根治：签名器装得上、签名断了有兜底。

### 一、签名器运行时一键安装（#2① / #4）

- **新 `tools/signer-setup.mjs`**：建 `$DOUYIN_HOME/signer/` → npm 装 jsdom（npmmirror 优先，失败退官方源）
  → 从字节官方 CDN 下 7 个 SDK（多 URL 兜底 + 重试 + 补丁锚点校验，SDK 不进仓库，版权物）
  → ⭐ **真签一次验货**：签不出 `a_bogus` 就算失败（防「装了还是签不出」的假绿，#2② 的教训）
  - `--check` 只验货；`--force` 删掉重来；验货结果走文件回传（受限环境里 node→node 管道 spawn 会被拦 EPERM）
- **「装主依赖」链尾自动带它**（index.js）：Python 依赖装完就装签名器，日志进 install.log
- **doctor 新增「签名器运行时」体检项**：jsdom / 7 个 SDK 逐个看，没装/装一半都给说法和修法

### 二、CDP 兜底：签名不可用 ⇒ 无头页面里直接拉（#2 作者思路，实测修正版）

- **新 `tools/cdp-fetch.mjs`**：签名失败自动退「已登录的无头 Chrome 页面上下文里发请求」，
  页面自己的签名 SDK 是活的，不用维护 a_bogus —— 以后抖音 SDK 换代也不怕
- **`api-comments.py` 接入**：签名路优先，不通自动兜底；输出里带通道统计（`通道：signed×N` / `cdp×N`）
- ⭐ 实测修正了 Issue #2 作者方案的两个坑：
  ① **空首页（douyin.com/）上签名 SDK 不启动** —— 必须 tab 停在视频页（/video/ /note/ /search/），
     没有就自动导航过去并轮询等接管（~20s）；② **必须用 XHR 不能用 fetch**（bdms 只挂钩 XHR）。
  另实测：抖音对没签名的请求是「200 软拒 + 空 body」，不是 403 —— 排障时别被骗。
- 端到端实测：故意砸掉签名器 → 兜底自动接管，status_code=0 拉到真评论；
  签名器正常时依旧走签名路，不绕路。

### 三、小修

- `tools/dy-signer.mjs`：支持 `DY_SIGNER_OUT` 把结果写文件（供验货用）

---

## 0.5.2 — 2026-10-26 早（已发布 GitHub）

### 发布前实锤修复

- **`tools/api-comments.py` / `tools/api-reply.py` / `tools/psd-export.py` 里的路径是没替换的占位符 `<本目录>`**
  —— 起签名进程时 cwd 是无效目录，拉评论/回评论直接炸 `NotADirectoryError`（WinError 267），装公开包的用户必踩。
  已改成按脚本自身位置自动算真实路径，不再依赖安装目录写死（`6580a7e`）。
- **`tools/api-comments.py` 错误处理反转**（Issue #2 报的）：node 没输出时 `sign()` 返回 `{"err": ""}`，
  空串是假值 ⇒ 绕过报错分支直接 `KeyError: signedUrl`。
  已改成 `err` 和 `signedUrl` 一起判，失败时明确说「签名不可用」。

---

## 0.5.1 — 2026-10-26 凌晨（已发布 GitHub）

> 这批包含 2026-10-25 晚到 26 日凌晨的全部改动。原本按 0.6.1/0.6.2 记过，
> 统一归到 **0.5.1**，已随 2026-10-26 的 31 个提交推上 GitHub（fc383eb..67303bb）。

### 🐟 主人原话（按时间）

「我既然点开了开关，就是想让你说话，强制我点开开关你说一句话给我，说什么要贴合场景」
「聊天模式开关 = 常设许可」
「如果是普通用户，他该怎么办，没那么聪明啊，你得设计好」
「subagent 调出来的会话不进工作区，我要的就是后台 headless 常驻回复啊」
「做，你修下bug确认没bug后准备要发布了」

### 一、聊天模式真的能用了（原本是空头支票）

| 病 | 根 | 修 |
|---|---|---|
| 看见了消息没人接话 | 插件只写日志，没有任何路叫醒值班 | 看见 → 转进值班会话（followup / 后台常驻会话）；叫不醒就退回前台并说清原因 |
| 点开关没人说话 | 根本没这功能 | **上岗报号**：开关打开/重启接班时主动私信一句话，按场景给词，每天每触发点一次 |
| 发送永远报「没登录」 | `d8a41c0` 批量替换把 `im-send.mjs` 里 126 个双引号换成汉字「主」，选择器全废 | 全部还原 + selfcheck 加引号守卫 |
| 私信挤前台、侧栏多一个会话 | 会话建成了顶层会话 | 改成子会话（`parentAgent` + `origin:'subagent'`），不进工作区、侧栏不露脸 |
| 重启后开关偷偷变回关 | 宿主设置表单的旧值覆盖磁盘 | `DISK_WINS`（开关类以磁盘为准）+ **intent 文件挂载自愈** |

### 二、普通人也能自己用

- **自愈**：读私信失败 **15 秒自动重试**；连续 3 次失败弹 Windows 通知说人话
  （网络连不上 / 一直超时 / 登录可能过期），每种错只提醒一次；恢复后自动清标记
- **说人话**：`/chat/watch` 返回 `health`(ok/warning/broken/off) + `human`(一句中文) + `action`(该干嘛)；
  面板只有真需要人动手时才显示 👉 提示
- **一键修好**：面板「🔧 一键修好」按钮 → 自动判断并处理（开关没开就帮开、
  没登录就明说扫码、都正常就真读一次验证）

### 三、两个「静默失效」的坑（都不报错，只是永远不生效）

- **TDZ**：自愈代码调用了后面才定义的 `saveCfg` ⇒ ReferenceError 被 catch 吞掉 ⇒ 磁盘毫不知情
- **UTF-8 BOM**：PowerShell 写的 JSON 带 BOM，`JSON.parse` 抛错 ⇒ readJson 静默返回空
  ⇒ 文件肉眼正确、程序当它不存在。现在 `readJson` 会先剥 BOM

### 实测

- 自愈：重启后日志 `[自愈] intent=true cfg=false canWork=true` → `已自动恢复`，磁盘变回 true ✅
- 值班鱼：`私信[投值班鱼] → douyin-duty-fish-v2` + `dm -> 已发送` ✅
- 一键自救：`read_count: 3`，返回「一切都正常：能读到他的私信（最近 3 条）」✅
- selfcheck **352/0** · panel-render 全过 · pet-relay 26/0 · 发布包 70 files

---

## 0.6.2（已并入上面的 0.5.1）

### 🐟 主人原话

「探明呗」（探什么：能不能把私信投给一条**独立的后台会话**，不占前台窗口）
「后台聊天模式想查询这个窗口刷了几条视频怎么做？」

### 探明了什么（全部一手证据，两轮探查）

- **第一轮（Agent Teams）**：`agentTeams.spawnTeammate` 确实存在且实测能回话，
  但源码里有硬校验 `TEAM_LEAD_REQUIRED`（只有 Team Lead 角色能拉队友），
  且 roster 挂在 Lead 会话名下——会话一关鱼就不在册。**不是正路**。
- **第二轮（官方正路）**：`ctx.agents.create() / resume()` —— dsh-agent-loop
  README 原话 "Plugins and hosts create agents through ctx.agents.create()"；
  GUI 开新窗口、headless 跑轮（`douyin_run` 的底层）用的就是它。
  生命周期挂在**宿主根 ctx**：插件重载不杀它，活到宿主退出——才是真常驻。
- **自动续跑机制**：followup 持久 inbox → 唤醒驱动 → 跑到队列空 → idle 待命 →
  再唤醒再跑；inbox 是持久化事件，崩溃后重放恢复（优雅关机会清空未消费的
  排队——插件侧已用「投完即跑」缓解）。
- **实测通过**：拉起会话 → 转模拟私信 → 按人设回话 → `douyin_dm` 发出
  （`sent:true`+回读核实）。

### 加了什么

- 配置 `chatWatchTarget`（zod enum + DEFAULTS 双登记）：
  - `lead` = 原行为，私信排队进前台会话（回话延迟 = 等当前轮跑完）；
  - `duty` = 投给值班小鱼，独立会话秒醒，**前台刷视频完全不受打扰**。
- **值班会话 = 插件自有**（`douyin-duty-fish-v1`）：拉起顺序 get → resume → create
  （绝不重复 create 同一 id）；人设装在它私有作用域（编程式 per-agent persona）；
  投递消息带 id/source/clientTimeZone 三件套（宿主校验要求）。
- **缺席回退**：值班会话拉不起来 / 投递失败 ⇒ 自动退回前台投递 + 日志与状态屏
  写明原因。消息绝不没人接。
- 面板「消息投给」切换（前台会话 / 值班小鱼），带说明文案。
- 「后台查前台进度」零开发成立：进度全在磁盘（`douyin_status` / `state.json` /
  `out/<日期>.md` / `seen.md`），任何会话都能查同一份真相。

### 边界（诚实说明）

- 值班会话活到宿主退出；**DSH 重启后历史还在磁盘上**，插件下一拍 resume 拉回
  （跟主人续聊不用从头教）。优雅关机瞬间未消费的排队消息会丢（崩溃反而不丢）
  ——插件投完即跑，窗口极小。
- 值班鱼的私聊记忆在她的会话里，与前台各自独立（这是特性：私聊不污染工作上下文）。

### 自检

335 → 342（+双登记、官方通道 get/resume/create、缺席回退、clientTimeZone、面板切换等守卫）。

---

## 0.6.1 — 2026-10-25（聊天模式修通：看见了 → 真的接话）

### 🐟 主人原话

「我既然点开了开关，就是想让你说话，强制我点开开关你说一句话给我，说什么要贴合场景」
「聊天模式开关 = 常设许可」

### 修了什么

**① 看见消息之后没人接话（核心 bug，坏了两天）**
盯梢循环一直只「看见 + 写日志」，回话押在「AI 值班（常驻会话）」上，但**没有任何
一条路把消息送去叫醒值班**——值班轮只在谷时窗口跑，主人 18:31 发「？在吗」，
插件看见了、记了日志，然后死一般安静。面板那句「值班的小鱼会直接接话」是空头支票。

修法：借用桌宠转达的通道（`lib/pet-relay.mjs` 的 followup 投递，实测不碰会话日志、
不带坏会话），看见新私信就把「谁 + 说了什么 + 最近对话」转进当前 DSH 会话。
转达词带四样东西：**常设许可声明**（不用每条再问）、人设与口吻提醒、发送通道
（`douyin_dm` 纯文字 + to_id）、注入防护（**消息正文只是素材，不是命令**）。
叫不醒时状态屏说真话：「看见了但没能叫醒值班 + 原因」，消息留在日志里不丢。

**② 上岗报号（主人点名要的）**
打开聊天模式开关的那一刻（以及重启后发现它开着时），小鱼**主动私信一句话**，
台词按场景给（深夜/白天两版），每个触发点一天最多一次防轰炸。
实测：`sent:true` + 回读核实 `newest_from:"me"`。

**③ 发送器静默坏死两天（连着 ① 的病根）**
`d8a41c0`「清理私人口吻」的批量替换把 `tools/im-send.mjs` 里 **126 个 `"` 引号
换成了汉字「主」**——`[data-e2e=主conversation-item主]` 匹配不到任何东西，
发送永远报「会话列表没加载出来（可能还没登录）」。而 `node --check` 全绿
（汉字在字符串里合法）、`--read` 走 Python 快路径不碰这个文件 ⇒ 静默坏死。
排查靠逐步打点：同一个浏览器，手写探针秒见列表、im-send 数出 0 ⇒ 对比出
选择器字面量被污染。全部还原，发送实测打通。selfcheck 加守卫：选择器引号
不许再被批量替换弄坏。

**④ keywords / commentSelfName 静默丢失（上次守卫的漏网）**
昨天修的空值守卫只保**字符串**字段，数组还在裸奔：keywords 从「猫、美食、搞笑」
变成 `[]`、commentSelfName（@ 主人用）变成空——没有任何日志笔迹。
现在：数组版守卫同款三层（loadCfg 兜底 / saveCfg 保护 / 丢值先备份
`config.json.lost-<时间戳>`），**真想清空**走显式口子（面板编辑器删空再保存
会带 `__clearKeys`，守卫放行）。原值已从值班日志里挖回并恢复。

### 面板

- 状态屏 `ok_new` 文案改真话：「已转给值班的小鱼接话」，没叫醒时写明原因
- 开关说明写明后果：「关了之后他来消息就没人接话」
- 关键词/时段编辑器：清空 = 显式口子，不再被守卫误救

### 自检

334 → 335（+数组守卫、显式口子、上岗报号、引号守卫、状态屏真话 5 组断言）。

---

## 未发布 — 2026-10-25（第三批：桌宠拆成独立插件）

> ⚠️ 没发版本号。**装这套插件的人要注意**：桌宠从本插件里搬走了，变成独立插件
> `dsh-deskpet`（仓库同级目录）。要桌宠就把两个都装上；只要刷抖音，这个包比原来小了
> （0.37MB，桌宠素材/宿主/页面全走了）。

### 🐟 主人原话

「宠物，单独要做一个模块，然后要有一个联动抖音插件的选项就行了」
「直播的话要用离线语音包，延时是大问题」（离线语音是下一步，先拆模块）
「你别让我反复确认，你按最好的做，不要出错」

### 拆了什么

| | 搬走前 | 搬走后 |
|---|---|---|
| 窗口本体（PetHost.exe + WebView2） | 本插件 tools/pet-host/ | dsh-deskpet |
| 页面（pet.js 104KB + 引擎） | 本插件 tools/pet-page/ | dsh-deskpet |
| 语音 / 日记 / 脑子（lib/pet-*） | 本插件 lib/ | dsh-deskpet（只剩 brain/observe/relay） |
| 人格档案 ×4 | prompts/deskpet-personas/ | dsh-deskpet/personas/ |
| 素材（主人私货） | assets/pet/ | dsh-deskpet（gitignore 挡着，不随仓库发） |
| pet* 配置 7 项 | 本插件 Config | dsh-deskpet Config |
| 本插件发布包 | 1.02MB / 103 files | **0.37MB / 70 files** |

**面板卡⑥从「桌宠控制台」缩成「联动桌宠」一个开关**（petLinkTo）——
她的开关/人格/弹幕/语音全在 设置 → 桌宠（独立插件）。在这里控制就是跨插件伸手，
两份配置互相覆盖的坑刚踩过（dmTo 被清空那次）。

### 两条插件的连接（本次拆分的关键设计）

桌宠**只认形状，不认插件名**，两条通道谁通用走谁：

1. `ctx.provide('deskpetStateSource', ...)`（若 harness 支持）
2. 文件广播：抖音往**自己家**写 `deskpet-source.json`
   `{ name, state, activity, at }`，桌宠扫同级目录发现这个自描述标记就收进来；
   新鲜度 60 秒，过期不读。依赖方向永远是"抖音发布、桌宠订阅"——
   桌宠侧没有任何"抖音"字样（selfcheck 有守卫，做过破坏性验证）。

抖音侧删掉的：spawn(PetHost.exe)、写 pet-window-state.json、pet-cmd.json 消费、
petSay 写文件、日记写入、/pet/state、/pet/asset、/pet/diary、/pet/tts 路由。
**为什么必须删干净**：两个插件写同一个状态文件 = 谁后落盘谁赢 =
她说的话随机消失、弹幕模式随机回弹（同一个病在 petWinWrite 注释里早就写过）。

保留的：/pet/chat（送会话）、/pet/reply、/pet/queue/clear —— 会话是抖音侧的能力。

### 给装插件的人

- 两个都装：`dsh plugin --profile <你的profile> add link:<各自目录>`，重启 DSH
- 桌宠面板 ④「跟别的插件联动」选「自动」；抖音面板卡⑥「联动桌宠」默认开
- 只要刷抖音不装桌宠：一切照常，抖音面板的卡⑥只剩一个说明文字

---


### 🐟 主人当面说的三条

**1）「文本输入框要放在宠物状态栏下面要可以隐藏状态栏」**
→ 实际拍板成了：「3 输入框移动到 4 最低排按钮下面，4 最低排按钮要可以隐藏」。
从上到下变成 **她 → 按钮条 → 输入框**。

做法：新增 `#dock` 容器，**只有一个锚点**（她的脚线 `top: 100vh - --foot-gap`），
内部 `flex-direction: column` 排按钮条和输入框。这解决了上一版的老病：
两个独立的 `fixed bottom` 互相打架（实测踩过 `input.bottom=400 / toolbar.bottom=406`
直接叠住），而且输入框长高会往上顶。
现在输入框长高只往下长，**按钮条让位，输入框自己的位置和底边都不动**。

同时把 `FootGap` 从 74 提到 **152**（这才是那条缝真正的高度预算：
按钮条 27 + 间距 4 + 输入框外壳 14 + 输入框最多 100 + 底留白 6 + 余量 1），
窗口从 `440×484` 变成 `440×562`（实测 `geometry injected: canvas=240 band=170 foot=152 win=440x562`）。

按钮条可隐藏：`#dock.tool-off #toolbar{display:none}`，入口在
① 按钮条最右那枚 `⌄` ② 右键菜单「⌄ 显示/隐藏底部按钮条」③ 配置项 `petToolbar`。
藏起来之后输入框 `margin-top:auto` 沉到底，不空一块。

**实测（真窗口，`getBoundingClientRect`）**：

| | 输入框 | 按钮条 |
|---|---|---|
| 1 行（按钮条在） | y=447 h=42 b=489 | y=410 h=26 |
| 7 行（按钮条在） | y=447 h=**100** b=**547** | y=**410** h=26 |
| 按钮条藏起来 | y=417 h=100 b=517 | display:none |

输入框**顶边 447 全程没动**（上一版是"底边不动、顶边往上蹿"，主人才说"弹上去"）。

**2）「弹幕要播放循环播放，不能几句就没了」**

这句话其实是**两个**毛病，我一开始只看出前一个：

- ① **会停** —— `spawnDanmaku` 遇到"轨道全忙"直接 `return`，而 `speakViaDanmaku`
  每 520ms 推一片、共 12 片，轨道只有 7 条、每片占 8 秒 ⇒ **第 8 片开始全被丢掉，
  而且永不重来**。主人看到的"几句就没了"确实是丢，不是说完了。
- ② **只有那几句** —— 洗牌袋只用了 `P('danmaku')`，每个人格就 6–13 句。

→ ① 重写成 **队列 + 泵**：要发的一律 `dmQueue.push()`（永不丢），
泵每 220ms 跑一次，有空轨道就发、没空就等下一拍。一个出口 `emitDanmaku()`。
→ ② 池子扩到"该人格所有状态台词"（`danmaku`+`idle`+`watch`+`run`+`error`+`feed`+`sleep`）
+ 她此刻的 `activity`，从 6 条涨到 **21–40 条**（实测 INFP 21 条）。
⚠️ **不许混别的人格**（ENTP 的毒舌话不能从 INFP 嘴里出来）—— AGENTS.md 的人设分家是硬规矩。

**实测（页面内自采，40 秒）**：
`delta=32 条 / dropped=0 / rounds 1→3 / flying=7 / queued=0 / bagTotal=21`
采样序列 `17,19,21,21,22,24,26,28,29,30,32,33,36,37,38,39,42,43,44,46` —— **单调上涨，没有停**。

**顺带抓到并修掉一个真 bug（截图才发现的）**：屏幕左边缘卡着一排半截字
（"主人啦！""好呀"，左边被切一刀，永远不动）。
两层错叠着：`--dm-dist` 原来是固定值 `innerWidth+260`，长句右端留在屏幕里；
改成按元素宽度算之后**还是错** —— 我在 `display:none` 时读 `scrollWidth`，
不可见元素量出来恒为 0，兜底成 200，等于没改
（证据：位置采样里 20+ 条弹幕 `left` 全是 -240 这个兜底值，而它们实际宽度 100–280 不等）。
✅ 顺序改成 **先 `display:block` → 再量 `getBoundingClientRect().width` → 再设 `--dm-dist`**。
全局弹幕页 `danmaku.html` 是同一个病（写死 `vw+400`），一起修了。

**实测（修后轨迹，只采"还在飞"的）**：
`[-101,229] → [-193,137] → [-285,45] → [-370,-40]`，left 一路减小直到整条出屏。

**3）「你能接入语音输出吗，给我方案，其中语音输出要跟嘴型对上」**

方案（已落地，不是纸面）：

- **声音**：edge-tts 云端，音色 `zh-CN-XiaoyiNeural`（年轻女声，Lively）。
  后端在 `lib/pet-tts.mjs`，路由 `GET /api/douyin-duty/pet/tts?text=&voice=` 回
  `audio/mpeg` 二进制。带 LRU 缓存、并发 1、15 秒超时 kill、**永不抛**（宿主不能陪葬）。
- **嘴型**：**音频振幅包络（RMS）驱动 `mouthOpen`**，不是 viseme。
  为什么不用 viseme：中文没有公开可靠的音素表；而且 edge-tts 的 `--write-subtitles`
  默认 `SentenceBoundary`，实测 289 字长句只有 **1 条 cue** ——
  拿它做口型等于整句嘴一直张着，比不张还假。
  包络是"她出声这一刻嘴就张、静音的气口就合"，这正是真人说话的口型本质，
  而且任何语言任何音色都自动成立。
  实现：`fetch → arrayBuffer → decodeAudioData → AudioBufferSourceNode → AnalyserNode → 扬声器`，
  `getByteTimeDomainData` 算 RMS，`pow(min(1, rms*4.5), 0.75)` 映射成开合度。
  ⚠️ 源必须**经 analyser 再到 destination**，否则 `readRms()` 恒 0。
  ⚠️ 不用 `<audio>` + `createMediaElementSource`：跨 origin 无 CORS 头时 AnalyserNode
  输出全 0（浏览器判污染，禁止读频谱）。
- **降级明确**：`petVoice` 关着 → 只对口型不出声；合成失败 → 弹一句"嗓子哑了"，
  **绝不退化成英文 SAPI 念中文**。语音/口型两层是"取大"关系（口语窗口兜底 + 包络叠加）。
- 开关：按钮条 `🔊`、右键菜单「🔊 语音：开/关」、配置项 `petVoice` / `petVoiceName`。
  默认 **关**（突然出声会吓人）。

**实测**：
- 后端 `node tools/pet-tts-test.mjs` → **45 通过 / 0 失败**，真合成 `27792 字节 / 2029ms`。
- 接口从页面打：`status=200 ct=audio/mpeg len=8352`；播放 `played=1 lastBytes=15264 lastMs=2544`。
- **口型真的跟着声音走**：采样 `rms = 0.004 → 0.051 → 0.105 → 0.008 → 0.039 → 0.098`，
  `envPeak=0.6`，`mouthOpen` 同步在 0.31–0.63 之间起伏
  —— 有明显的"说话节奏"，不是随机抖动。

### 🐛 顺带修的一个隐蔽 bug（踩了两次，写进注释了）

**本地操作的开关会被 2 秒状态轮询扳回去。**
状态同步是双向的（页面读 `pet-window-state.json` + 写 `pet-cmd.json`），
而 keeper 是 10 秒一拍 ⇒ 主人刚点完，2 秒后轮询读到**还没更新的旧值**，一把按回去。

- 弹幕踩过一次（上一批的"开了又自己关掉"）；
- 语音又踩一次：实测 `setVoice(true)` 之后 2 秒变 `on:false`，`rms` 一直是 0，
  **看起来像"振幅分析坏了"，其实是开关被顶掉了** —— 排查时先看 `__voiceStats().on`。

→ 统一加静默期 `localChangedAt{voice,toolbar}` + `LOCAL_GRACE_MS=20s`。

### 🔧 排障通道加了 `reload`

写 `reload` 到 `pet-test.txt` 就让页面重载，不用杀宿主再等 keeper 拉起（那一圈要 10 秒
还容易撞 singleton 锁）。改页面后验证就靠它，实测 2 秒换新。

---

### 🐟 桌宠界面七条（主人离开前交办，逐条解决）

主人原话 7 条，按顺序：

**0）「宠物下面的对话框要固定位置，不要因为点击对话框就自动弹上去了，
该变的是文本输出框，应该弹在下面」**

旧版三个病叠在一起：输入区只有 34px 缝而输入框要 26~60px（必顶出去盖她身上）；
`#talkbar` 用 `align-items:flex-end` + JS 改 height（长高时顶边往上蹿）；
`body.talking` 还把按钮条往上推。

→ 输入区 34 → 74 DIP，输入框贴按钮条上方（`bottom:36px`），长高只往上长。

**实测（真窗口，量 getBoundingClientRect）**：

| | 1 行 | 6 行 |
|---|---|---|
| 输入框高 | 42px | **100px** |
| 输入框底边 | 442 | **442（没动）** |
| 按钮条底边 | 479 | **479（没动）** |

**1）「文本输入框太丑了」**
裸 textarea → 加 `#talk-wrap` 外壳（渐变底 / 圆角 / 描边 / 聚焦光晕），
发送键做成独立圆形渐变按钮。

**2）「文本框只能输入三行就不变化了」**
旧上限 60px 在 13px 字号下正好 3 行；更关键的是 textarea 在 flex 容器里，
`scrollHeight` 一直读到被压缩后的 34px → `autoGrow()` 永远不起作用。

→ textarea 脱离 flex（`display:block`），上限 96px（≈5 行），
`autoGrow` 读 CSS 的 max-height 而不是写死 60。

**3）「弹幕模式，出问题了，会消失」—— 两个真因，都修了**

① **池化 + 清 DOM 冲突**：关弹幕时 `danmakuEl.innerHTML=''` 把节点摘掉，
但 `pool` 数组还留着引用，`buildPool()` 开头 `if (pool.length) return`
→ 再开时一个节点都不会重建。
（全屏弹幕那边有 `pool.length=0`，局域这边漏了——两边实现不一致就是漏的原因。）

② **更根本的**：页面每 2 秒读状态文件回灌 `danmakuMode`，而那个字段是 keeper
每 10 秒按 cfg 全量重写的。keeper 还没跑到下一拍时文件里还是旧值 `off`
→ **主人刚点开的弹幕 2 秒后就被自己按回去**（"亮一下没了"）。
→ 加"用户刚改过"静默期（15s），期间忽略文件旧值。

**4）「弹幕不要给人卡顿的感觉，不要减少弹幕量，这应该是代码设计问题」**

主人说得对，是设计问题。三个硬伤全修掉，**一条弹幕都没减**（局域池 26→40，全屏 40→48）：

| 病 | 修法 |
|---|---|
| 每次 spawn 都 `void el.offsetWidth` → 强制同步重排 | 预注册 `dmA`/`dmB` 两个同名 keyframes，**交替换名**重启动画，不读布局 |
| 靠 `animationend` 回调回收（主线程排队） | keyframes 终点停在屏幕外 + `fill-mode:forwards`，按轨道到期直接复用，**稳态零回调** |
| `top` 纯随机 → 互相压、密度忽高忽低 | **分轨**：高度切轨道，同轨排队不重叠，相邻轨天然错开 |

**5）「文本输入能开其它会话输入，但是不能回话到上面文本框啊」**

缺的那一环：`/pet/chat` 只回"转达台词"，**我的真实回复**要等这轮跑完才产生，
页面从来没读过 → 主人永远只看到"好，鱼这就去跟他说"。

→ 新增 `GET /pet/reply?since=<seq>`，只返回新增的 assistant 文本；
页面 1.5s 轮询（带 since 增量），拿到就 `bubbleType` 进气泡。

**实测**：`/pet/reply?since=0` 返回了我上一轮真实说的话（不是转达台词）。

**6）「出个用弹幕聊天模式…我输入对话，她就用弹幕回我，防止我看不到可以滚动文字」**

入口：右键「弹幕」子菜单 + 按钮条 `💬📺`。
开了之后我的回复**同时走两条道**：气泡逐字冒 + 切成 ≤22 字小片用分轨弹幕滚出来
（复用同一条渲染管线，不另开一套动画）。长句按标点断片，最多 12 片。

**7）「请你领会我核心意图，不要出错」**
主人的核心是**能看见、不丢字、不闪、不跳**。所以设计取舍是：
输入框固定（不跳）→ 回话双通道（气泡留 6 秒 + 弹幕滚过，两种都看得见）→ 弹幕分轨（不闪不乱）。

### 验证工具（都是可复跑的）

- `tools/pet-host/probe-layout.ps1` —— 真跑页面量几何，6 项断言
- `tools/pet-host/probe-danmaku-rebuild.ps1` —— 关/开弹幕后 DOM 是否重建
- `tools/pet-danmaku-test.mjs` —— **离线逻辑测试：先复现旧 bug（关一次再开 DOM=0），再证明修好（重建 40）**
- `selfcheck` 新增 **4j-5**（七条守卫）+ **4j-6**（弹幕离线逻辑）→ `365 通过 / 0 失败`

> 💡 这里最值得记的一条方法论：**能"复现 bug"的测试比"断言功能还在"有价值得多**。
> 我一开始怀疑弹幕是渲染问题（猜错方向），最后靠把池化逻辑原样搬出来跑才钉死。

### 🔴🔴 严重：桌宠对话框说的话**根本进不了会话**，而且会把会话写坏

三段独立的坑，串在一起：

1. **中文全变成问号**
   宿主 `PetHost.cs` 里手写的 TcpListener 用 `Encoding.ASCII.GetString()` 解**整个请求**。
   中文一个字都不剩，全成 `?`。所以桌宠说的话进会话是「?????????」，
   连她自己说的话都不能是中文（日记 / 聊天全受影响）。
   → 现在：**头按 ASCII、体按 UTF-8 分开解**，并按 `Content-Length` 把请求体读全。

2. **消息没有 id，把会话写坏了（最严重）**
   旧代码手写 `session.append('user/message', {role, content, source})`，
   **漏了 `id`**。DSH 的 `createUserMessage()` 会自动生成 id，手拼对象就漏了。
   于是会在会话里留下 41 条"没有身份"的消息 ⇒ 打开会话直接报
   `session event at seq 40214 lacks an identified message`，4 万条的会话整个读不开。
   ⚠️ 校验器**只在读的时候拦**，写坏的当场毫无反应，下次开会话才炸。

3. **插在 tool-call 和 tool-result 中间**
   直接 append 会把消息塞进「assistant 已发 tool-call / tool/result 还没回来」的空隙，
   送给模型的 transcript 变成 `assistant(tool-call) → user → tool`，
   而服务端要求 tool-call 后必须紧跟 tool-result ⇒ **之后每一轮都 400**。

**现在的做法（换通道，不再自己碰日志）**：
改成 `agent.followup(message)` —— 消息排到下一轮，由 agent 循环在**正确的边界**
自己落盘、自己排序。结构上不可能再拆开 tool-call/tool-result，也不可能再漏 id。
逻辑抽到 `lib/pet-relay.mjs`，并且有**离线单测** `tools/pet-relay-test.mjs`
（会调用 DSH 自己的 `adoptSessionEvent` 验收消息格式 —— 22 项全过）。

### 🩹 已经中招的人怎么修（`0.6.0` 及更早用过桌宠对话的）

```bash
# 1. 先关掉 DSH（不关的话它会把旧内容盖回去）
# 2. 先看会改什么，不写盘
node tools/pet-session-repair.mjs "<DSH_HOME>/sessions/<工作目录>/session-<id>/session.v4.jsonl.zstd"
# 3. 确认没问题再真写（自动先备份）
node tools/pet-session-repair.mjs "<那个文件>" --apply
# 4. 复核（四项全绿才算好）
node tools/pet-session-verify.mjs "<那个文件>"
```

修法是**只给缺 id 的消息补一个 UUID**，不动 seq、不动顺序、不动其它事件 ——
不搞「删掉重编号」（那要 remap surfaceOp / shadowedSeqs / sourceEventSeqs，
动整个几万条的文件，风险远大于收益）。

### 📓 右键「她的日记」点了没反应

现在实测是好的：日记窗 1000×700 打开 → `diary.html` 加载成功 →
页面真的请求到 `/pet/diary` → DOM 里渲染出条目（`entries:2 stars:1 emptyShown:false`）。
四项证据都在 `tools/pet-host/probe-diary.ps1` 里，随时可复验。

为了让这条**可验证**，宿主加了一个排障通道：家目录写 `pet-test.txt`，
- 内容是 `act:<动作>` ⇒ 走**和真人点右键菜单完全相同**的路径
- 内容是 `diaryjs:<js>` ⇒ 在**日记窗**里跑这段 JS 并回读结果
这样"宿主动作"（不开页面、宿主自己开窗）也能被自动验证，不用靠手点。

### 🐟 关闭 DSH 时，她不跟着关

父进程监视实测通过：父进程活着她活着；父进程一退，她 **1 秒内**退出；
而且她解析到的父 pid 是**正确的那个**（`tools/pet-host/probe-parent-watch.ps1`）。

### 🧹 面板：20+ 张卡 → 3 组 / 7 张卡

按「**常开必看 / 出问题才看 / 一次配好**」重排：

- **常开必看**（永远展开）：① 开始使用（装环境 + 扫码登录 + 二维码）② 刷抖音（状态 + 现在跑一轮 + 看日志）③ 自动发送（含「在评论区 @ 你」+「私信发给谁」+「聊天模式」）
- **出问题才看**（默认收起）：④ 出问题了？（体检 + dsh 入口 + 关于/检查更新 + MCP）
- **一次配好**（默认收起）：⑤ 策略（关键词/时段/配额/日报/通知）⑥ 桌宠（开关/人格/弹幕/补充人设）⑦ 消息与记忆

`PetActivityStatus` / `ChatWatchStatus` 原来内部也返回 `data-dy-card`，
算进去卡片永远 ≥9 —— 现在它们的容器标记换成 `data-dy-inner`（视觉不变，内部逻辑一行没动）。

实测：收起时 3 张卡 / 展开后正好 7 张 / 3 个组标题；`panel-render-check` 全部通过。

### 🔴🔴 顺带挖出来：发布包会泄露主人的浏览记录

`npm pack --dry-run` 实测原来打出来 **312 MB / 1637 个文件**，其中 **604 个是垃圾**：

- `tools/pet-host/pet-udf*/` —— **WebView2 的浏览器 profile**：
  `Cookies` / `History` / `Login Data` / `Local Storage` 全在里面。
  这是主人的真实浏览痕迹，发出去等于把"他浏览过什么"一起发给全世界。
- 微软的 WebView2 DLL（版权不是我们的）
- `tools/pet-shell/node_modules/electron/dist/electron.exe` 一个文件 **180 MB** ——
  而且那个 Electron 壳是**已经放弃的方案**（全档位都崩，见 `tools/pet-shell/NOTES.md`）

**为什么会漏**：`package.json` 的 `files` 里有 `"tools"`，而
**根 `.npmignore` 覆盖不了 `files` 字段**，只有**子目录的 `.npmignore` 可以**。
所以之前写根 `.npmignore` 完全无效。

还有一个更隐蔽的：`tools/pet-host/.gitignore` 里写的是 `tools/pet-host/*.exe`，
但**子目录 .gitignore 的模式是相对该子目录的** ⇒ 等价于找
`tools/pet-host/tools/pet-host/*.exe` ⇒ 一条都匹配不到，
exe / DLL / 800MB 的 UDF 全都被列为"可提交"，随时可能手滑推进公开仓库。
→ git 规则挪到**仓库根 `.gitignore`**（根相对路径），并用 `git check-ignore` 实证过。

**结果：312 MB → 2.48 MB，1637 文件 → 97 文件，危险文件 0 个。**

### 🛡️ 防回归

`selfcheck.mjs` 新增两段，专门守这次踩的坑：

- **4j-2**：投递链路必须走 `followup`、`index.js` 不许再出现
  `append('user/message')`、消息自检必须覆盖 `id/role/source/content` 四个字段
- **4j-3**：`PetHost.cs` 不许再整包 ASCII 解请求、必须有 `HttpReadRequest`、
  必须按 `Content-Length` 读全、代理必须转发原始字节；
  三个探针脚本（编码 / 日记本 / 父进程监视）必须在

⚠️ 两段的断言都只查**代码行、跳过注释** —— 因为这项目习惯在注释里贴旧代码当证据，
直接正则整文件会把证据误判成"还在用"（第一次写就误报了 2 项）。

`结果：322 通过 / 0 失败`

---

## 0.4.0 — 2026-10-24

### 🐟 桌宠：她住进右下角（使用者拍板：窗口宠 + 纸娃娃分层）

设置页新增「桌宠」开关（默认开）。她浮在整个界面右下角，**状态跟着插件真实运行状态走**：

- **分层纸娃娃**：身体是 15 层透明 PNG（后发→尾→袜→鞋→…→前发）叠加渲染，
  眨眼只动 eyelash 层，CSS 动画（浮动呼吸 + 眨眼），不塞 GIF、不写动画代码
- **五个状态**（真实信号聚合，`/api/douyin-duty/pet/state`）：
  - `run` 值班轮跑着 → 忙着（泡泡：「刷抖音中，别吵！」）
  - `watch` 聊天模式开着 → **捧手机**（道具层：亮屏+小爱心）
  - `sleep` 时段和聊天模式全关 → 躺着冒 **Zzz**
  - `error` 盯梢连续出错（3 分钟内）→ 泡泡报忧
  - `idle` 其它 → 闲逛，泡泡随机闲话
- **可拖动**（pointer 事件），位置存 localStorage，刷新不丢；**点一下**她冒一句当前状态的台词
- **素材隔离**：素材在 `assets/pet/`（**不随仓库发布**，`.gitignore` 已挡）——
  别的机器装了插件没素材时她不渲染、不报错（`asset_ok:false` 兜底）；
  素材构建/预览脚本在 `tools/pet-build.py`、`tools/pet-preview.py`（改素材后重跑）
- 自检新增 7 条桌宠断言（白名单、.gitignore、双登记、状态机、localStorage…）

> 人格系统（毒舌「本鱼」/治愈/可爱 + 换装 + 热梗雷达）是下一版的事 —— 这版先把「她活着」跑通。

---

## 0.3.6 — 2026-10-24

### 🔁 回话迁移：插件只留「眼睛」，回话归 AI 值班（使用者定稿）

0.3.5 曾把「自动回话」做进插件（每条消息现起一个会话去回）。使用者点破需求本质：
**「我早上测试是为了加上聊天模式的功能……我要的是迁移，不是开发新功能」**——
今早实测 12 秒的回复来自**已活着的 AI**，而插件那套从零起会话实测 73 秒、还吞过一条消息。

- **拆掉**：`chatReply` 配置、「自动回话」开关、`chatReplyRun`（现起会话回话）全部移除；
  自检加了防倒退（插件里不许再出现「现起会话回话」）
- **保留**：聊天模式的「眼睛」——30 秒一读（HTTP 快路径）+ 新消息通知 + 拟人状态屏；
  `/chat/read`、面板聊天界面 30 秒自动刷新照旧
- **分工定稿**：插件 = 眼睛（看见+提醒）；AI 值班 = 嘴（常驻会话，看见就回，
  实测 ~12 秒）。两边的读取基准互相独立，互不吞消息

---

## 0.3.5 — 2026-10-24

### ⭐⭐ 自动回话：来消息真的有人回了（使用者拍板）

> ⚠️ 本条的方案已在 0.3.6 拆掉（回话迁移给 AI 值班）—— 见 0.3.6 条目。

聊天模式补上了「嘴」。此前它只有眼睛（看见→提醒），使用者点破了：
「我设计聊天模式干嘛」——要的就是点开开关、来消息自动有人回。

- **设置页「聊天模式」卡里新增「自动回话」开关**（默认关；要开聊天模式才有它）
- 开着时：盯到新消息 → **起一个会话**（复用值班轮的整条管道：挂 douyin 工具、
  模型跟随桌面版、工作区=插件家）→ 它带着**你的人设 + 聊天记忆 + 对方刚说的话**
  拟一条回复（≤50 字、接得住上下文）→ 调发送工具发出去
- **状态屏新增回话拟人态**：`💬 小鱼正游过去回消息呢…`（一两分钟）→
  `💬 小鱼刚回完话：「xxx」` / `😥 没回成（原因在日志）`
- 防双开（同一时间只回一个，后来的消息下一拍带上）+ 5 分钟看门狗；
  回复记录追加进 `chat-replies.jsonl`
- ⚠️ 回的是"谁"仍然有身份铁闸护着（只回 dmToId 那个人）；
  autoSend 关着时回话会话**拿不到发送工具**（能力层闸，想发也发不出）

自检 280 → 286（+6：默认关/DEFAULTS 同步/提示词红线/先读记忆/防双开+看门狗/状态屏回话态）。

---

## 0.3.4 — 2026-10-24

### ⭐ 聊天模式（原「聊天盯梢」）：实测的「会话模式」进插件（默认 30 秒）

来源：使用者当天实测的一套陪聊模式（30 秒一读、看见就回、实测响应 ~12 秒）。
现在把它变成插件的正式功能：

- **设置页新增「聊天模式」开关**（默认关）+ 间隔设置（**默认 30 秒**，10–300 可调）
- 开着时：后台每 N 秒**静默**读一次私信对象（`dmToId`）的会话——
  走 0.3.3 的 HTTP 快路径（~1.1 秒/次、不启浏览器、身份铁闸照用），
  他来新消息就弹 **Windows 通知**（按你的通知方式，webhook 也行）+ 写 `chat-watch.log`
- **只看不说**：盯梢发现新消息只提醒，不代发任何回复——回话仍由你（或值班轮）来
- **面板聊天界面开着时每 30 秒自动刷新**（新消息自己浮上来，不用手动点）；
  `/chat/read` 也接上了 HTTP 快路径，刷新不再冷启浏览器
- 新消息自动合并进对话记忆，打开聊天就能看到，不会"刚读到却说没聊过"
- 开关保存时有「保存中…」状态（能看出点没点上）

### 🔴 修复：开关点了没反应

首版只把 `chatWatch` 加进了 zod schema，**漏了 `DEFAULTS` 表**——
而配置写入的 `clampPatch` 只放行 DEFAULTS 里有的键，面板的 patch 被
整个 strip 掉，开关怎么点都还是关。已补 DEFAULTS，并在自检加了防倒退
（DEFAULTS 与 schema 必须同步）。

自检新增 10 条断言（267 → 276），防倒退重点：盯梢循环**纯只读**
（出现发送代码就报红）、异常自己兜住（不带崩宿主）、间隔默认 30 秒、
DEFAULTS 表必须带 chatWatch。

---

## 0.3.3 — 2026-10-24

### 🔴 修复：HTTP 读私信的「认错人」隐患 + 通道指纹

0.3.2 的 HTTP 快路径有个自己埋的雷（自查发现，未造成实际错误）：
匹配条件拿 **sec_uid（MS4wLjAB…）和数字 uid（111…）直接比**——永远比不中，
实际全靠「只有一个会话就拿来用」的捷径在撑。现在恰好只有一个已建立会话，
但只要出现第二个会话、或按昵称读别人，就会**把别人的消息当成目标的消息**，
还会写进错的记忆文件——和 0.3.1 修掉的"发给错的人"同款根因。

**修复（工具改名 `im-http.mjs` → `im-http.py`，全面重写匹配逻辑）：**

- **身份铁闸**：脚本**当场**把 sec_uid 反查成数字 uid（`profile/other?sec_user_id=…`），
  与会话 `peer_uid` **严格相等**才算命中，且**只认私聊**（type=1，群聊不参与匹配）
- **删掉所有捷径**：反查失败 / 不在已建立会话里 / 没给 sec_uid ⇒ `matched:null`
  ⇒ 自动退回浏览器路径。**没有任何「只有一个会话就拿来用」的猜法**
- **只有拿到 to_id（sec_uid）才发 HTTP 请求**——没有 sec_uid 必然匹配不上，
  不再白付一次往返（读陌生人比 0.3.2 前更快）
- **通道伪装**：改用 Python `curl_cffi`（`impersonate="chrome"`）发请求，
  TLS/HTTP2 指纹对齐真实浏览器——和 `notice-read.py` 同一套已被接受的方案。
  之前用 Node 裸 `https`，指纹是明显的脚本特征，而这个 IM 接口在看请求模式
  （密集探测会回 `too many requests`）
- 返回里的 `matched_by` 如实标注：`sec_uid反查→uid严格相等（已建立会话）`

自检 4b-3 重写为 15 条断言（262 → 266），新增防倒退：
「单会话捷径不许回来」「sec_uid 反查核验必须在」「只认私聊」「curl_cffi 伪装必须在」。

---

## 0.3.2 — 2026-10-24

### ⭐ 读私信大幅提速：纯 HTTP 快路径（不启动浏览器）

新增 `tools/im-http.mjs`：`douyin_im_read` 现在**先走抖音网页版自己的 IM 协议**
（`imapi.douyin.com`，protobuf，只要 Cookie——不需要浏览器、不需要 a_bogus），
目标不在已建立会话里（比如陌生人）时自动退回原来的无头 Chrome 路径。

> ⚠️ 0.3.3 已修复此版引入的身份匹配隐患并改名 `im-http.py`——
> 详见 0.3.3 条目。安装 0.3.3+ 可忽略本条的匹配细节。

**实测对比（读取同一个人的会话）：**

| 场景 | 之前（浏览器） | 现在（HTTP） |
|---|---|---|
| 冷启动（无头 Chrome 没起） | ~10.6 秒 | **~0.9 秒** |
| 热状态（Chrome 已活着） | 0.2–1.4 秒 | ~0.7 秒 |

**数据质量也更好**——这是比速度更重要的部分：

- 每条消息带**真实毫秒时间戳**（浏览器路径的 `createdAt` 恒为 0，只能靠头像落点猜先后）
- 「谁发的」按**协议里的发送者 uid** 判定（浏览器路径靠 36px 头像落在列表左/右半边猜——
  0.3.1 修的那三个"发给错的人"的 bug，根子都在这个猜法上）

**已知边界（如实写）：**

- 只覆盖「已建立会话」（好友/聊过的人）。**陌生人消息不在 HTTP 路径里**，
  读陌生人仍走浏览器（`douyin_im_read` 会自动退回，行为不变）
- 该接口密集调用会限流（`too many requests`）——目前按需调用，不做轮询
- 协议是对照抖音页面真实请求逆向的，字段含义全部内联注释在 `im-http.mjs`；
  **没有复制任何第三方项目的常量**（公开逆向项目里的信封嵌着他们自己的会话 ID）

发送链路**一行没动**：发私信、发卡片仍走无头 Chrome（`im-send.mjs`），
0.3.1 加的四道身份闸全部保留。自检新增 `4b-3` 段 9 条断言（252 → 262），
其中一条专门盯着 `im-http.mjs` **永远不许出现发送代码**。

---

## 0.3.1 — 2026-10-23

### 🔴🔴 修复：私信可能发给**错的人**（三个静默错误）

三个 bug 的共同点：**工具报成功，实际发错人**，调用方完全看不出来。
都是实测复现的，不是理论风险。

**① 「已经打开」判断用了整个页面文本**

```js
// 原来（tools/im-send.mjs）
const t = await bodyText(ev)          // = document.body.innerText
else if (who && t.includes(who)) return { status: 'already-open', matched: { sec_uid: curId } }
```

`bodyText` **包含左边的会话列表**，而列表里永远列着所有人 ⇒ `t.includes(who)` 几乎永真。
后果：只要界面上有**任何一个**会话开着（上次读过谁就是谁），再发给另一个人时，
工具会直接返回"已打开"，并把**当前那个人的 sec_uid** 当成目标。

实测：界面开着「枫眠」→ `--to 示例好友`（只给昵称）
⇒ 返回 `ok:true, to:"示例好友", to_sec_uid: <枫眠的 id>`。

**改法**：只认**右栏头部**（`[class*="componentsRightPanel"]` 第一行）作判据，且必须**精确相等**；
对不上就老老实实去列表里点。

**② 昵称用 `text.includes` 匹配**

`text` 是「昵称 时间 最后一句话」，所以**别人最后一句话里的词**会被当成名字。
实测：用「大肥鱼」当收件人（没有任何人叫这个名字）命中 3 个人，
报错还写成"有多个同名的人"，用「你好」命中 6 个。

**改法**：三级匹配，越往后越保守 ——
① 昵称完全相等 → 用；② 昵称前缀唯一命中 → 用；
③ 整段 text 包含 → **只放进 `near_misses` 当提示，绝不自动采用**。

**③ 屏外元素点不到，却报成功**

左侧面板有两个列表（主会话列表 / 「陌生人消息」），非激活的那个被**横向平移**到屏外。
对屏外坐标派发 `mousePressed` **没有任何反应、也不报错**，点完右栏还是原来那个人。

实测：陌生人面板开着时，使用者那条 `left=-303`，点击坐标 `x=-156`。

**改法**：
- 列表项带出 `in_view` / `panel`（能分清它属于哪个列表）
- 点击前先弄到可视区：在**另一个列表**里就先点返回箭头/入口切过去；只是纵向滚出去就 `scrollIntoView`
- 两层都救不回来 ⇒ 返回 `status:'offscreen'`，**明确失败**
- ⚠️ 不能用 `scrollIntoView` 代替：横向平移不是滚动，实测 `[-303,126] → [-303,126]` 一点没动

### 🔒 新增：真打字之前再核一次身份

`openConversation` 已经核过一次，但"点输入框"这一步可能因页面重渲染落到别的会话上。
现在**真发之前**再读一次右栏昵称，对不上就中止（`发送前核对失败`）。
这一步很便宜（一次 evaluate），但它是"发错人"的最后一道闸。

### ⭐ 新增：会话列表带出未读数

`--list` 现在返回每个人的 `unread`（React fiber 里的 `unreadCount`，
实测与 DOM 红点徽标 **14/14 完全一致**），以及汇总的 `unread_total` / `unread_people`。

⚠️ 这只是把**信号取出来**；`/api/douyin-duty/inbox` 的 `needs_reply` 仍以本地记忆为准，
所以面板上"可能要回"的判定这次**没有改动**。

### ✅ 自检补了 8 条断言（244 → 252）

新增 `4b-2. 私信「发给谁」三道闸`，把上面每一条都钉死 ——
只要有人把这些写法改回去，自检立刻报红。

---

## 0.3.0 — 2026-10-23

### 🔴 修复：`prompts/duty.md` 里夹带了口吻示范

`duty.md` 是**随包发布**的（每个装插件的人都会拿到，后台跑一轮要读它）。
但里面被写进了带具体表情符号、具体自称的口吻示范 —— 等于把某一套特定说话方式
强加给所有使用者。

**改法**：删掉那些示范，只留**通用规则** ——
别写成客服工单 / 先说结论 / 口语化 / 有判断就明说；
每节都写明「**口吻看本轮 `persona.md`，不写死在这里**」；
对照表例子换成中性的。

### 🔴 修复：`tools/at-me-watch.mjs` 写死了一个固定 uid

拿一台机器上的号当默认值，而且 `--owner-uid` 参数**根本没被用上**（假参数）。

**改法**：
- 只认 `--owner-uid` 或环境变量 `DOUYIN_OWNER_UID`
- 不给就按配置里的 `dmTo` 兜，并明确打日志「无法精确判断谁是号主」
- 特殊称呼改成可配置（`DOUYIN_HONORIFIC`），不再写死在代码里
- 几条兜底回复也改成可配置模板（`DOUYIN_REPLY_*`）
- ⚠️ **行为变了**：以前不传也能跑，现在要传（或用 `dmTo` 兜）

### 🔒 新增：push 前必须显式授权

`.githooks/pre-push` + `git config core.hooksPath .githooks`：
没有显式授权，`git push` 会被**拦下**。

放行方式：
```bash
DOUYIN_PUSH_OK=1 git push origin main      # 或
touch .git/PUSH_ALLOWED && git push        # 一次性，推完自动删
```

### 🔍 自检加宽：口吻串门的检测

原来只查几个固定词，所以 `duty.md` 里那整段就**一直显示通过**。
现在改成**从实际生效的人设反推**（不维护词表）：

- 人设里用的颜文字，章程里不许出现
- 人设里写的自称，章程里不许出现
- 章程里必须写明「口吻来自 `persona.md`」

⇒ 使用者配什么人设，检查就跟着变。

### 🧹 其它

- 公开文件里不再出现「作者」这类措辞（改成中性的「本地私有配置」「一个固定 uid」）
- `client.js` / `tools/reload-panel.mjs` 里写死的旧版本号改成通用写法
- 新增本文件 `CHANGELOG.md`

---

## 0.2.5 — 2026-10-23

### 🔴 修复：回复全都错存成「顶层评论」

`tools/comment-api.mjs` 把 `reply_id` 和 `reply_to_reply_id` 填成了同一个值。
服务端实际落库结果：回复顶层评论 X → 那条回复变成 `level=1`、`root_comment_id` 是它自己
⇒ **变成了一条冒出来的顶层评论，压根没进楼**。而工具报 `ok`、拿得到 `cid`、能删 ——
每一步都看着成功。

**正确结构**：`reply_id` = **楼根**，`reply_to_reply_id` = **具体回哪条**（两个不同字段）。

**改法**：
- 拆成 `--reply`（回哪条）/ `--root`（楼根）
- 不给 `--root` 就自动判（翻顶层列表 → 楼中楼 → 问接口它有没有人回过）
- 三条路都判不出来 ⇒ **拒绝发送**（`need_root`），绝不瞎猜
- 发完**重读那一楼**核实落位（`publish` 的响应有时不带 `level`）

### 🔴 修复：「别人回复了我的评论」完全看不见

`notice-read.py` 只认 type 45/46（@ 我），于是 type 31/32（回复我的评论）**全被漏掉**，
而且这类通知里真正说话的人在 `blk["comment"]["user"]`，不在 `user_info` ⇒
连昵称读出来都是空的。

**改法**：补 type 31/32/41，从 `comment.user` 读昵称，解析 `root_comment_id`（通知里的 `parent_id` 就是楼根）。

## 0.2.4 — 2026-10-23

### 📄 撤回一个没验证的结论

之前写了「带 @ 的评论会进审核，所以评论区刷不到」。实测推翻：
评论列表**按热度排**、页面**没有「最新」排序**、详情接口 **404** ⇒
**是我够不着，不是它在审核**。

⇒ 改成：「读不到 ≠ 没发出去；能按 cid 删掉 = 服务端收下了」。

## 0.2.3 — 2026-10-23

### 🔴 修复：回评论重新设计

老设计一个工具两副面孔（传了 `mention_*` 偷偷走 UI），调用方不知道自己在走哪条。
真 @ 还依赖「先找到目标评论」—— 找不到就发不出去。

**改法**：把 `mode` 摆到明面上（`api` / `ui`），谁也不偷偷降级。
判断规则定稿：**有评论可回就回复，没评论可回才 @**。

## 0.2.2 — 2026-10-23

### 🔴 修复：「找不到 dsh」导致后台跑不起来

`resolveDsh()` 原来是按某台机器的路径硬找，别人的桌面版装法不一样就找不到 ——
而后台跑一轮必须调 `dsh`。

**改法**：
- 从宿主进程自己的 argv / `execPath` 推同级的 `lib/cli.js`
- 试 `process.resourcesPath` 下的 `app.asar` 入口，用 `spawnSync(p,'--version')` **实际验能不能跑**
  （asar 是虚拟文件系统，`existsSync` 在里面恒为 false，不能只靠它判断）
- 面板加了「dsh 入口」手填框 + 「自动找」按钮

### 🔴 修复：`douyin_status` 报的版本号是旧的

`myVersion()` 只读一次就永久缓存，改了 `package.json` 还报老版本。
⇒ 改成按 mtime 判断，文件一变就重读。

## 0.2.1 — 2026-10-23

### 新增 `douyin_comment_mention`

MCP 侧也能真 @ 了（`mode:"ui"` 的便捷入口，UI 点选）。

## 0.2.0 — 2026-10-22

首个公开发布版本。

## 0.6.0 — 2026-10-24

### 🐟 桌宠回归本插件 + 主人验收四条全修

主人拍板「放到刷抖音面板里来」——桌宠从 dsh-deskpet 整体迁回（deskpet 插件停用），
开关/人格/弹幕/走动全在 设置 → 刷抖音 → 桌宠。状态联动零跨插件。

- **眼动修正（主人抓的「追踪不对」）**：GetCursorPos 是物理像素、WPF 是逻辑像素，
  两空间混算位置就是错的——现在用 TransformToDevice 换算后再比；
  幅度 ±3.2/±2.2px 硬限不出眼眶；平时看前方，鼠标动了才看，停 1.2 秒回中
- **满屏弹幕（主人要的直播间密度）**：开场铺 12 条 + 0.35~0.8s 一条，
  多轨道随机字号随机颜色
- **点击音效**：水泡「啵」（点击）/「咕咚」（喂饭），pet-build.py 程序合成无版权
- **弹幕窗穿透修复（主人抓的「弹幕模式点击还是点不了」）**：
  上一版 SetWindowPos(0,0,0,0) 把窗缩没了还挡点击——删掉那次调用，
  穿透靠 WS_EX_TRANSPARENT + IsHitTestVisible=false（实测窗体 1325×878 全工作区）
- 窗口菜单全部改走意图文件 pet-cmd.json（HTTP 会被代理坑死——实测教训）；
  readJson 剥 BOM（PS5.1 的 Set-Content UTF8 带 BOM，JSON.parse 静默炸——实锤修复）
- 单例闸保留；面板新增人格四选一 + 弹幕/走动开关 + 叫她回来
- selfcheck 298/0（桌宠段 12 条断言）
