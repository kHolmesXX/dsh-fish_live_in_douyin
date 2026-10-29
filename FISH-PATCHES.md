# FISH-PATCHES — 本地 fish 版 vs 上游 0.5.4

> 这个文件由 `scripts/diff-upstream.mjs` 生成，**别手改**；改了运行时代码后重新跑一遍即可。
> 本机没有 git，所以基线用本地只读快照 `vendor/upstream-0.5.4/` 代替 upstream remote。

| 项 | 值 |
|---|---|
| 当前插件版本 | `0.5.4-fish.28` |
| 上游基线 | `v0.5.4`（vendor/upstream-0.5.4） |
| 基线 ref | `refs/tags/v0.5.4` → commit `45a85c69`（2026-10-26） |
| 基线来源 | https://codeload.github.com/NEWJO123/dsh-douyin-scroll/zip/refs/tags/v0.5.4（zip SHA256 `98fb48bcad315f794127b5bf0d181ecd28051f6f68ef0d402ab89c1544dcc0f5`） |
| 生成时间 | 2026-10-28T12:30:19.688Z |
| 统计 | 上游 74 个文件；相同 57；fish 新增 4；其他新增 52；fish 修改 17；本地缺失 0 |
| vendor 是否进包 | 否：`vendor/` 不在 package.json 的 `files` 里，也不该 commit |

## 一、需要关心的差异（fish 新增 + fish 修改 + 本地缺失）

| 文件 | 状态 | 行数差 | 一句话说明 |
|---|---|---|---|
| `lib/home-console.mjs` | fish 新增 | +1474 | fish 新增：/api/douyin-home/* 控制台后端（快照 + 三处写入） |
| `lib/relation.mjs` | fish 新增 | +391 | fish 新增：记忆四件套（按天归档 / 每人档案 / 群印象 / 日记） |
| `scripts/diff-upstream.mjs` | fish 新增 | +303 | fish 新增（工程脚本）：本差异清单生成器，不进发布包 |
| `tools/frame-grab.mjs` | fish 新增 | +135 | fish 新增：无头 Chrome 截视频首帧（带一次跑一轮的清图） |
| `FISH.md` | 新增（本地） | +102 | fish 版说明：相对上游改了什么（记忆/人设/家/节奏/控制台/登录复用的边界） |
| `INSTALL.md` | 新增（本地） | +133 | fish 版安装/验证/打包/排障（三条安装路、数据目录表、常见坑） |
| `lib/home/anxious.mjs` | 新增（本地） | +212 | 待补说明 |
| `lib/home/comments-watch.mjs` | 新增（本地） | +205 | 待补说明 |
| `lib/home/compactions.mjs` | 新增（本地） | +132 | 待补说明 |
| `lib/home/doubao.mjs` | 新增（本地） | +226 | 待补说明 |
| `lib/home/faults.mjs` | 新增（本地） | +141 | 待补说明 |
| `lib/home/groups.mjs` | 新增（本地） | +503 | 待补说明 |
| `lib/home/groupvid.mjs` | 新增（本地） | +347 | 待补说明 |
| `lib/home/interests.mjs` | 新增（本地） | +329 | 待补说明 |
| `lib/home/ledger.mjs` | 新增（本地） | +154 | 待补说明 |
| `lib/home/life.mjs` | 新增（本地） | +172 | 待补说明 |
| `lib/home/likes.mjs` | 新增（本地） | +149 | 待补说明 |
| `lib/home/memory.mjs` | 新增（本地） | +171 | 待补说明 |
| `lib/home/persona.mjs` | 新增（本地） | +112 | 待补说明 |
| `lib/home/presence.mjs` | 新增（本地） | +209 | 待补说明 |
| `lib/home/reach.mjs` | 新增（本地） | +247 | 待补说明 |
| `lib/home/rest.mjs` | 新增（本地） | +160 | 待补说明 |
| `lib/home/routing.mjs` | 新增（本地） | +186 | 待补说明 |
| `lib/home/search.mjs` | 新增（本地） | +135 | 待补说明 |
| `lib/home/selfdrive.mjs` | 新增（本地） | +64 | 待补说明 |
| `lib/home/settings.mjs` | 新增（本地） | +216 | 待补说明 |
| `lib/home/taste.mjs` | 新增（本地） | +36 | 待补说明 |
| `lib/home/tools.mjs` | 新增（本地） | +663 | 待补说明 |
| `lib/home/usage.mjs` | 新增（本地） | +186 | 待补说明 |
| `lib/home/watch-video.mjs` | 新增（本地） | +101 | 待补说明 |
| `lib/home/world.mjs` | 新增（本地） | +142 | 待补说明 |
| `pnpm-lock.yaml` | 新增（本地） | +36 | 本地 devDependencies 锁文件（上游未入库） |
| `RELEASE-0.5.4.md` | 新增（本地） | +61 | 上游 main 的 0.5.4 发布说明（tag 之后一个 commit，本地保留） |
| `tools/_exp-mention-fresh.mjs` | 新增（本地） | +132 | 待补说明 |
| `tools/aweme-detail.mjs` | 新增（本地） | +75 | 待补说明 |
| `tools/douyin-search.mjs` | 新增（本地） | +114 | 待补说明 |
| `tools/download-media.mjs` | 新增（本地） | +132 | 待补说明 |
| `tools/like-ui.mjs` | 新增（本地） | +195 | 待补说明 |
| `tools/video-watch-plus/.gitattributes` | 新增（本地） | +16 | 待补说明 |
| `tools/video-watch-plus/.gitignore` | 新增（本地） | +30 | 待补说明 |
| `tools/video-watch-plus/LICENSE` | 新增（本地） | +38 | 待补说明 |
| `tools/video-watch-plus/NOTICE` | 新增（本地） | +57 | 待补说明 |
| `tools/video-watch-plus/patches/vw-windows-fixes.patch` | 新增（本地） | +46 | 待补说明 |
| `tools/video-watch-plus/README.en.md` | 新增（本地） | +294 | 待补说明 |
| `tools/video-watch-plus/README.md` | 新增（本地） | +562 | 待补说明 |
| `tools/video-watch-plus/references/verification.md` | 新增（本地） | +136 | 待补说明 |
| `tools/video-watch-plus/references/windows-setup.md` | 新增（本地） | +240 | 待补说明 |
| `tools/video-watch-plus/references/with-browser-skill.md` | 新增（本地） | +108 | 待补说明 |
| `tools/video-watch-plus/scripts/asr_hallucination_check.py` | 新增（本地） | +163 | 待补说明 |
| `tools/video-watch-plus/scripts/audio_probe.py` | 新增（本地） | +292 | 待补说明 |
| `tools/video-watch-plus/scripts/build_testclip.py` | 新增（本地） | +163 | 待补说明 |
| `tools/video-watch-plus/scripts/setup-windows.ps1` | 新增（本地） | +203 | 待补说明 |
| `tools/video-watch-plus/SKILL.md` | 新增（本地） | +214 | 待补说明 |
| `tools/video-watch-plus/verification/record-2026-09-30.md` | 新增（本地） | +156 | 待补说明 |
| `tools/vw-watch.mjs` | 新增（本地） | +553 | 待补说明 |
| `tools/vw-watch.mjs.fish27` | 新增（本地） | +385 | 待补说明 |
| `.gitignore` | fish 修改 | +10 | 本地新增 vendor/、dist/ 忽略；顺手把上游文件尾部 GBK 注释修正为 UTF-8 |
| `CHANGELOG.md` | fish 修改 | +539 | 本地变更记录（顶部 0.5.4-fish.1 段是本 fork 的对外说明） |
| `client.js` | fish 修改 | +3024 | 设置页：新增「她的家」独立 section（id=douyin-home, order=32）+ 共享登录卡 |
| `index.js` | fish 修改 | +1889 | 宿主半端：她的家/记忆工具/闹钟/值班会话/视觉优先等 25 处插桩（详见正文） |
| `lib/chrome.mjs` | fish 修改 | +29 | 新增 openTab()，给截图取证用（统一开/关标签页） |
| `lib/memory.mjs` | fish 修改 | +17 | 记忆层小改（供关系档案/控制台复用） |
| `package.json` | fish 修改 | +13 | 版本号 0.5.4-fish.1 / files 增补 / dsh.compatibility / fish 字段 |
| `prompts/duty.md` | fish 修改 | +104 | 值班章程：偏好优先 / 只分享不总结 / 视觉优先 / 擦边与点赞分布口径 |
| `selfcheck.mjs` | fish 修改 | +4 | 本地预检：加群聊/值班/私信口径的回归断言 |
| `tools/at-me-watch.mjs` | fish 修改 | +22 | 本地改动（上游升级时需重打） |
| `tools/card-share.mjs` | fish 修改 | +81 | 本地改动（上游升级时需重打） |
| `tools/comment-mention-ui.mjs` | fish 修改 | +601 | 本地改动（上游升级时需重打） |
| `tools/forward-pick.py` | fish 修改 | +229 | 打分：偏好加权、宠物降权、点赞太热丢弃、点赞分布权重、证据字段 |
| `tools/im-http.py` | fish 修改 | +173 | 本地改动（上游升级时需重打） |
| `tools/im-send.mjs` | fish 修改 | +120 | 私信发送：readback 修复（头像左右判定假阴性） |
| `tools/mcp-server.mjs` | fish 修改 | +372 | MCP server：跟随 fish 工具/家目录的小改（升级时逐行对照） |
| `tools/panel-render-check.mjs` | fish 修改 | +7 | 面板渲染检查：跟随新增「她的家」section 的小改 |

## 二、与上游一致（升级时不用管，列出来是为了对账）

共 57 个文件：

<details><summary>展开文件清单</summary>

- `.gitattributes`
- `.githooks/pre-commit`
- `.githooks/pre-push`
- `.npmignore`
- `AGENTS.md`
- `AI-USAGE.md`
- `check-client.mjs`
- `cordis.patch.yml`
- `GUIDE.md`
- `lib/credential.mjs`
- `lib/hostdeps.mjs`
- `lib/notify.mjs`
- `lib/paths.mjs`
- `lib/pet-brain.mjs`
- `lib/pet-observe.mjs`
- `lib/pet-relay.mjs`
- `lib/state.mjs`
- `lib/toast.mjs`
- `lib/uvfetch.mjs`
- `LICENSE`
- `prompts/persona.default.md`
- `prompts/sample-candidates.json`
- `PUBLISH.md`
- `README.md`
- `requirements.txt`
- `tools/_home.py`
- `tools/.npmignore`
- `tools/api-comments.py`
- `tools/api-reply.py`
- `tools/cdp-fetch.mjs`
- `tools/cdp.mjs`
- `tools/chat-watch.mjs`
- `tools/check-ps1-syntax.ps1`
- `tools/comment-api.mjs`
- `tools/comment-delete.mjs`
- `tools/comment-read-dom.mjs`
- `tools/comment-reply.mjs`
- `tools/doctor.mjs`
- `tools/doctor.py`
- `tools/dy-signer.mjs`
- `tools/forward-run.mjs`
- `tools/memory-test.mjs`
- `tools/mk-msg.mjs`
- `tools/notice-read.py`
- `tools/pet-relay-test.mjs`
- `tools/pet-session-repair.mjs`
- `tools/pet-session-verify.mjs`
- `tools/psd-dump.py`
- `tools/psd-export.py`
- `tools/qr-login.mjs`
- `tools/release-audit.cjs`
- `tools/release-smoke.cjs`
- `tools/release-upgrade.cjs`
- `tools/reload-panel.mjs`
- `tools/session-guard.py`
- `tools/signer-setup.mjs`
- `tools/smoke.py`

</details>

## 三、升级上游时的操作顺序（没有 git 的版本）

1. 把新版源码解到 `vendor/upstream-<新版本>/`，改 `package.json` 的 `fish.base`。
2. 跑 `node scripts/diff-upstream.mjs`，看「需要关心的差异」表。
3. 只处理状态为 fish 修改 / 本地缺失的行：新文件（fish 新增）一般原样保留即可。
4. 跑 `node selfcheck.mjs`，再按需要跑 `node tools/release-smoke.cjs`（如环境有 npm/pnpm）。
5. 重新打包（见 `INSTALL.md` 的打包段），版本号按 `主.次.补丁-fish.N` 抬。

> ⚠️ 说明边界：`home/`、`memory/`、`douyin_cookie.txt` 这些**运行时数据在 `$DSH_HOME/douyin-duty/`**，
> 不在插件目录里；本表只对比插件源码包。`home/` 目前只存在于运行时家目录，包内没有；
> 以后若把她的家模板放进包内（`home/`），脚本会自动把它标成「fish 新增」。
