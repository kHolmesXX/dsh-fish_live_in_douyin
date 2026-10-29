# INSTALL —— 安装 / 验证 / 打包 / 排障（fish 版）

> 这个包是 **`dsh-douyin-scroll` 的本地 fish 版**：`0.5.4-fish.28`，基于上游 `NEWJO123/dsh-douyin-scroll` 的 v0.5.4 tag，
> 加了她的家 / 记忆 / 节奏 / 控制台（改了什么见 [FISH.md](FISH.md)，差异清单见 `FISH-PATCHES.md`）。
> **上游仓库里没有这些改动**，所以本文不写「`dsh plugin add dsh-douyin-scroll` 从公网装」这种会装到上游版的命令。
>
> 目标读者：要**给别人装**、或者换台机器**重新装**的人 / agent。照抄命令即可，每一步都给了验证方法。

---

## 0. 三条安装路（先选一条，别混着来）

| 路 | 适合 | 命令（`desktop` 换成实际 profile 名） | 以后怎么升级 |
|---|---|---|---|
| **A. `link:` 本地目录** | 本机开发 / 自用，改完就能生效 | `dsh plugin --profile desktop add link:C:\Users\Administrator\.dsh\plugins\dsh-douyin-scroll` | 改完源码 → **重启 dsh** |
| **B. `file:` 本地 tgz** | 分给别人 / 干净复现 / 留一个可回滚的版本 | `dsh plugin --profile desktop add file:C:\Users\Administrator\.dsh\plugins\dsh-douyin-scroll\dist\dsh-douyin-scroll-0.5.4-fish.28.tgz` | 打新 tgz → `add` 新路径 → 重启 |
| **C. `git+https`** | **以后**把 fish 版推到自己的仓库再用 | `dsh plugin --profile desktop add git+https://github.com/<你的仓库>.git` | 推新 commit → `add` 一次 → 重启 |

⚠️ 关于 C：`package.json` 的 `repository` 目前仍指向上游 `NEWJO123/dsh-douyin-scroll`（我们没 fork）。
所以现在用 `git+https` 只会装到上游版，**不含 fish 改动**；等真有 fork 仓库了再走这条。

⚠️ 三条路装完都**必须重启一次 dsh**（bundle 层要重启才组装设置页）；`tools/*.mjs` 是现读现用的，改完不用重启。

<details>
<summary>如果 `dsh` 不在 PATH（桌面版常见）</summary>

```powershell
# 临时用 DSH 自带的 CLI（路径按你机器上的安装位置改）
& 'D:\common\deepseek\resources\runtime\cli\bin\dsh.cmd' plugin --profile desktop add link:<插件目录>
```

`dsh plugin` 只是把参数转发给 profile 里的 pnpm；不需要本机另装 npm。
</details>

---

## 1. 装完验证（4 条，全过才算装上）

1. **设置页能看到两个 section**：`设置 → 刷抖音`（order 31）和 `设置 → 她的家`（order 32）。
   「她的家」是 fish 版新增的独立控制台；看不到就是 client bundle 没重载（重启 dsh / Ctrl+Shift+R）。
2. **后端接口活着**：用**同源浏览器**打开（不要用 curl，DSH webServer 会校验 Host）
   `http://127.0.0.1:<DSH 端口>/api/douyin-home/snapshot`
   → 返回 JSON，第一层有 `"ok": true`，以及 `persona` / `life` / `journal` / `diary` / `profiles` / `groups` / `archive` / `room` 等字段。
3. **版本号对**：设置页「关于」显示 `v0.5.4-fish.28 · b33`（b 号 = `client.js` 顶部 `PANEL_BUILD`，当前 33）。
   如果显示「宿主 b≠ 浏览器 b」，是浏览器缓存了旧 bundle → Ctrl+Shift+R。
4. **工具在**：让一个 agent 调 `douyin_home`（op=status）和 `douyin_relation`（op=list），都返回 `ok: true`；
   再调 `douyin_plan_next` / `douyin_reach_out` 能列出参数（**别真发**，这两个带发送闸）。

出问题看 [duty.log](#4-常见坑) 和设置页「她的家 → 健康」那张卡。

---

## 2. 数据放哪（升级 / 重装都不动它们）

全部在 `$DSH_HOME/douyin-duty/`（Windows 默认 `C:\Users\<用户>\.dsh\douyin-duty\`），**不在插件包目录里**：

| 路径 | 是什么 | 丢失后果 |
|---|---|---|
| `home/persona.md` | 六层人设（名字 / 她是谁 / 性格 / 说话方式 / 愿景 / 补充） | 退回 `$DOUYIN_HOME/persona.md` 或默认人设 |
| `home/life.json` | 她的闹钟（只存一个待办）、上次活动、兜底叫醒标记 | 待办丢，但第二天 09:00 会兜底叫醒 |
| `home/room/` | 她的房间（她自己的文件） | 她自己的东西 |
| `home/journal.jsonl` | 活动台账（`douyin_note_activity` 一行一条） | 控制台「台账」空 |
| `home/reach.json` | 主动联系的每天额度 | 当日额度重置 |
| `home/rounds/<日期>.jsonl`、`home/sent.jsonl` | 控制台读的两本真账（每轮 / 每条发送） | 控制台退回 `out/<日期>.md` 并标 `degraded` |
| `memory/archive/<日期>.jsonl` | 按天归档的聊天原文（私信 + 群） | 翻不了旧话 |
| `memory/profile-<sec_uid>.json` | 关系档案（stage / 印象 / 喜欢 / 别提 / 上次话题 / 答应过的事） | 记忆层空 |
| `memory/group-<群名>.json` | 群印象 | 群上下文空 |
| `memory/diary/<日期>.md` | 关系日记 | 日记空 |
| `memory/dm-*.json` | 私信原文（最近若干条，正本在 archive） | 最近上下文 |
| `douyin_cookie.txt` | 登录 Cookie —— **只在本地，不进包、不进日志** | 要重新扫码 |
| `out/` | 日报 / 转发清单（模型写的报告，**不是账**） | 可重建 |
| `duty.log` | 值班日志 | 排查线索 |
| `chrome-profile/` | 无头 / 扫码 Chrome 的 profile（登录态） | 换机要重登 |

> 备份 = 停 dsh 后把整个 `douyin-duty/` 拷走。卸载/升级插件只动插件包，**不要删家目录**。
> 设置页里的配置不在家目录，而在 profile 的 `cordis.patch.yml` 里 `- id: douyin-scroll` 那段（见第 4 节）。

---

## 3. 打包（维护者）

规则：**按 `package.json` 的 `files` 白名单**打进 tar；`node_modules/`、`vendor/`、`dist/`、`.githooks/` 一律不进包。
（`vendor/upstream-0.5.4` 只是本机对比基线，见 `scripts/diff-upstream.mjs`。）

```powershell
# ① 准备 dist\stage\package：只复制 files 白名单里的东西
#    index.js  client.js  cordis.patch.yml  lib\  tools\  prompts\duty.md
#    prompts\persona.default.md  prompts\sample-candidates.json  requirements.txt
#    README.md  GUIDE.md  INSTALL.md  FISH.md  AI-USAGE.md  CHANGELOG.md
#    AGENTS.md  PUBLISH.md  selfcheck.mjs  check-client.mjs  LICENSE
#    ⚠️ 排除 lib/ 里的 node_modules、tools/__pycache__、tools/.npmignore；prompts/persona.md 永远不进包

# ② 打 tar（根目录必须是 package/，profile 用 file: 装时按 npm 包结构解）
tar -czf dist\dsh-douyin-scroll-0.5.4-fish.1.tgz -C dist\stage package

# ③ 看一眼清单 + 解到临时目录验
tar -tzf dist\dsh-douyin-scroll-0.5.4-fish.1.tgz
```

打包后必查：包里有 `package.json`（版本 `0.5.4-fish.28`）、`client.js`、`cordis.patch.yml`、`lib/home-console.mjs`；
**没有** `vendor/`、`dist/`、`node_modules/`、`prompts/persona.md`、`douyin_cookie.txt`。

---

## 4. 常见坑

| 现象 | 真正原因 / 怎么办 |
|---|---|
| 文件写坏了、JSON 读不出、插件启动报错 | **UTF-8 BOM**。手写 `home/persona.md` / `life.json` / 配置时用「UTF-8 无 BOM」；PowerShell 5.1 的 `Set-Content -Encoding UTF8` 会带 BOM，`JSON.parse` 遇到 BOM 直接失败（读出来像空文件）。用编辑器或 `[IO.File]::WriteAllText` 写。 |
| `dsh plugin add` / 检查更新 / 下载 tgz 卡住 | 网络到 GitHub / npm 需要代理，而这台机器的 `git` 不通。优先用 `file:` 本地 tgz + 手动拷文件，别依赖在线源。 |
| 扫码登录出码后浏览器闪退 / 正在等码的窗口被关 | 旧 bug：`onClick` 把事件对象当 `force` 传，每次点「扫码登录」都先杀掉共用浏览器。**本版已修**：普通按钮走 `start(false)`，只有「重新出码」才 `start(true)`。看到窗口被关请确认装的是 fish 版。 |
| 无头 Chrome 起不来 / 端口被占 | 关掉手动开的、用同一个 `chrome-profile/` 的 Chrome；无头走独立 CDP 端口。别在扫码登录进行中手动关窗口。 |
| 到时不自动跑一轮 | 先看设置页 `reportLevel`：**`off` 会掐掉自动轮**（手动「现在跑一轮」不受影响），`brief` 只影响报告形态。再看 `chatWatch` / 窗口（中午、夜间）是否关着。 |
| 改了代码但设置页没变 | bundle / 设置页改动**必须重启 dsh**；浏览器可能还缓存旧 bundle → Ctrl+Shift+R。 |
| 卸载后配置没了 | 设置页写的是 profile `cordis.patch.yml` 里 `- id: douyin-scroll` 那段。卸载时只删依赖和 `dsh.profile.bundles` 里的包名，**保留那段配置**；家目录数据本来就不受卸载影响。 |
| 用 curl 打接口 403 / 空 | DSH webServer 校验 Host，curl 会被挡。用同源浏览器 / 设置页自带的请求。 |
| 「她的家」页空白但「刷抖音」正常 | 两边是**独立 section**，一个挂了不拖累另一个；看 `duty.log` 里 `她的家控制台路由没挂上` / `[douyin-home] 注册失败`。 |

---

## 5. 卸载 / 回滚

```powershell
# 1) 卸依赖（profile 名换成你的）
dsh plugin --profile desktop remove dsh-douyin-scroll

# 2) 从 profile/package.json 的 dsh.profile.bundles 里删掉 "dsh-douyin-scroll"
# 3) profile/cordis.patch.yml 里 - id: douyin-scroll 那段**保留**（配置），想彻底清再删
# 4) 重启 dsh
```

回滚 = 装回上一个 tgz。家目录（`$DSH_HOME/douyin-duty/`）在两次安装之间保持原样。
