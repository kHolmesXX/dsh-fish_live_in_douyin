#!/usr/bin/env node
/**
 * tools/mcp-server.mjs —— 把「刷抖音」这套能力开放成 **标准 MCP server**（stdio）
 * ============================================================================
 * 为什么要有它：
 *   插件本体是 DSH 的 bundle —— 只有在 DSH 里才看得见 `douyin_*` 工具。
 *   但使用者可能还想让**别的 agent 工具**（Claude Code / Codex / Cursor / Cline /
 *   另一个 DSH profile …）也能用同一套能力。MCP 是这些工具共同的接口。
 *
 * 🔴 三条设计约束（别改）：
 *   ① **零依赖**：只用 Node 内置模块。这个包没有 node_modules，也不能为了 MCP
 *      再拉一个 SDK 进来（那会把"装插件"变成"装前端工程"）。
 *   ② **stdout 只许出 JSON-RPC**：任何调试信息一律走 stderr。
 *      MCP 的 stdio 传输就是"一行一个 JSON"，多打一个字都会把客户端弄崩。
 *   ③ **和插件共用同一批 tools/* 脚本** —— 不复制业务逻辑，行为跟 DSH 里那份一致。
 *
 * 协议：MCP 2025-06-18（legacy initialize 流程）。
 *   新客户端（如 DSH 的 dsh-mcp-client）会先探一次 `server/discover`（2026-07-28）；
 *   我们明确回 `-32601 Method not found`，它就会自动回落到 legacy —— 这是标准做法。
 *
 * 用法（别的 agent 工具的配置里写）：
 *   command: node
 *   args:    ["<插件目录>/tools/mcp-server.mjs"]
 *   env:     { "DOUYIN_HOME": "<插件家目录>" }
 *
 * 自测（不接任何客户端）：
 *   node tools/mcp-server.mjs --selftest
 * ============================================================================
 */
import { spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'
// ⭐ fish.6：发送失败也要进「她的家 → 故障」面板（跨进程文件级 set/clear）
import { recordFault, clearFault } from '../lib/home/faults.mjs'
// ⭐ fish.29：这里也要清「动作描写」——下面 reach_out / reach_burst / dm 都在调
//   stripBodyActions，但本文件一直没 import 它，于是走到那条分支就
//   ReferenceError: stripBodyActions is not defined（主动开口直接报错发不出去）。
import { stripBodyActions } from '../lib/home/sanitize.mjs'
// ⭐ fish.20：分流硬约束 + 浏览器分发锁 + @豆包 异步提问（值班轮是 MCP 进程在发，硬拦必须在这里也生效）
import { canCommentAt, recordCommentAt, alreadySharedCard, commentAtCount, COMMENT_AT_CAP } from '../lib/home/routing.mjs'
import { acquireBrowserLock, releaseBrowserLock } from '../lib/home/comments-watch.mjs'
import * as doubao from '../lib/home/doubao.mjs'
// ⭐ fish.21：她自己双击点赞（台账/护栏/请求构造）
import {
  DEFAULT_LIKES, normalizeLikeSettings, appendLike, likesToday, canLike,
} from '../lib/home/likes.mjs'
import { isWorldOn } from '../lib/home/world.mjs'
// ⭐ fish.24：按关键词搜视频（台账/护栏；值班轮也可以搜特定主题）
import {
  DEFAULT_SEARCH, normalizeSearchSettings, canSearch, searchesToday, appendSearch,
} from '../lib/home/search.mjs'
// ⭐ fish.25：看懂视频（抽帧看图；台账 home/watch-video.jsonl）
import {
  DEFAULT_WATCH_VIDEO, normalizeWatchSettings, canWatch, watchesToday, appendWatch,
} from '../lib/home/watch-video.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SERVER_NAME = 'douyin-scroll'
const SERVER_VERSION = (() => {
  try { return String(JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version || '0') } catch { return '0' }
})()

/** 插件家目录：DOUYIN_HOME → DSH_HOME/douyin-duty → ~/.dsh/douyin-duty（和 lib/paths.mjs 同一口径） */
const HOME = (() => {
  const fromEnv = String(process.env.DOUYIN_HOME || '').trim()
  if (fromEnv) return resolve(fromEnv)
  const dshHome = String(process.env.DSH_HOME || '').trim()
  return resolve(join(dshHome || join(homedir(), '.dsh'), 'douyin-duty'))
})()

/* ─────────────────────────── 子进程小工具 ─────────────────────────── */

const pyEnv = (extra = {}) => ({
  ...process.env,
  PYTHONUTF8: '1',
  PYTHONIOENCODING: 'utf-8',
  DOUYIN_HOME: HOME,
  ...extra,
})

const venvPython = () => process.platform === 'win32'
  ? join(HOME, '.venv', 'Scripts', 'python.exe')
  : join(HOME, '.venv', 'bin', 'python')

const hasVenv = () => existsSync(venvPython())

const PY = () => (hasVenv() ? venvPython() : (process.platform === 'win32' ? 'python' : 'python3'))

const run = (cmd, args, timeout = 240_000) => {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    timeout,
    // ⭐ fish.2：这个进程自己会记发送账本（卡片/理由/私信/评论）⇒ 关掉被调脚本里的 CLI 记账，
    //    否则同一条消息会记两遍（im-send.mjs 只看 DOUYIN_LEDGER_OFF）。
    env: { ...pyEnv(), DOUYIN_LEDGER_OFF: '1' },
    cwd: HOME,
    windowsHide: true,
  })
  return {
    status: r.status ?? -1,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || r.error || ''),
  }
}

const runNode = (script, args = [], timeout = 240_000) => run(process.execPath, [join(ROOT, 'tools', script), ...args], timeout)
const runPy = (script, args = [], timeout = 240_000) => run(PY(), [join(ROOT, 'tools', script), ...args], timeout)

const readJson = (file, fallback = null) => {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

const pickJson = (s) => {
  const t = String(s || '')
  const i = t.indexOf('{')
  const j = t.lastIndexOf('}')
  if (i < 0 || j <= i) return null
  try { return JSON.parse(t.slice(i, j + 1)) } catch { return null }
}

/** 等一会儿（异步，不占 CPU —— 别用 busy-wait，那会把宿主烤热） */
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))

/**
 * ⭐ 阶段 2 发送账本：`<家>/home/sent.jsonl`，每发一条 / 每试一条 append 一行。
 * 为什么在 MCP 这边也写：值班轮是**这个进程**在发卡片/私信/评论，宿主进程看不到；
 * 而控制台要对账 ⇒ 两边写同一个 append-only 文件（跨进程 append 一行是安全的）。
 * 写失败只打 stderr、绝不抛 —— 账本不能影响发送。
 */
const appendSent = (row) => {
  try {
    const dir = join(HOME, 'home')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'sent.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), ...row })}\n`, 'utf8')
  } catch (e) {
    try { process.stderr.write(`[douyin-mcp] 发送账本写不进去：${e?.message ?? e}\n`) } catch { /* 连 stderr 都没有就算了 */ }
  }
  // ⭐ fish.6：顺手维护故障面板的 `send`（值班轮是**这个进程**在发，宿主看不见）
  try {
    const dir = join(HOME, 'home')
    if (row && row.sent === false) {
      recordFault(dir, 'send', `值班轮发送失败：${String(row.error || '原因未知').slice(0, 120)}（看「连接」登录态/网络；403 就等十分钟再试）`, (m) => { try { process.stderr.write(`[douyin-mcp] ${m}\n`) } catch { /* ignore */ } })
    } else if (row && row.sent === true) {
      clearFault(dir, 'send')
    }
  } catch { /* 故障表坏了不能影响发送 */ }
}

const dayKey = (d = new Date()) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** ⭐ fish.20：评论区 @ 成功记一行到 home/journal.jsonl（和宿主同一格式） */
const appendJournal = (summary, tool = 'comment_at') => {
  try {
    const dir = join(HOME, 'home')
    mkdirSync(dir, { recursive: true })
    appendFileSync(join(dir, 'journal.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), auto: true, tool, summary: String(summary || '').slice(0, 120) })}\n`, 'utf8')
  } catch { /* 台账失败不影响发送 */ }
}

const config = () => readJson(join(HOME, 'config.json'), {}) || {}

const cookieOk = () => {
  try { return existsSync(join(HOME, 'douyin_cookie.txt')) && readFileSync(join(HOME, 'douyin_cookie.txt'), 'utf8').trim().length > 0 } catch { return false }
}

const PICK_RE = /^#{2,3}[ \t]*(\d{15,25})/gm
const countPicks = (file) => {
  try {
    const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
    const ids = new Set()
    for (const m of text.matchAll(PICK_RE)) ids.add(m[1])
    return ids.size
  } catch { return 0 }
}

/* ─────────────────────────── 工具实现 ─────────────────────────── */

const needSetup = () => {
  if (!hasVenv()) return { ok: false, error: '还没装运行环境', hint: '在 DSH 设置页「刷抖音 → ② 装主依赖」点一下（建 venv，装 curl_cffi + httpx）' }
  return null
}

const needLogin = () => {
  if (!cookieOk()) return { ok: false, error: '还没有登录', hint: '在 DSH 设置页扫码，或命令行跑 node tools/qr-login.mjs start；也可以直接粘 Cookie' }
  return null
}

const TOOLS = [
  /* ── 体检 / 状态 ── */
  {
    name: 'douyin_status',
    title: '刷抖音 · 今日状态',
    description: '看今天跑了没跑、挑了几条、额度剩多少、报告在哪、登录/环境是否就绪。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const cfg = config()
      const st = readJson(join(HOME, 'state.json'), {}) || {}
      const report = join(HOME, 'out', `${dayKey()}.md`)
      return {
        ok: true,
        home: HOME,
        loggedIn: cookieOk(),
        venvReady: hasVenv(),
        perDay: Number(cfg.perDay ?? 5),
        pickedToday: countPicks(report),
        lastRunAt: st.lastRunAt || null,
        lastWhy: st.lastWhy || null,
        report,
        hasReport: existsSync(report),
        note: '这只是状态；要真的刷一轮，请让使用者在 DSH 设置页点「现在跑一轮」，或调 douyin_forward 取候选。',
      }
    },
  },
  {
    name: 'douyin_doctor',
    title: '刷抖音 · 环境体检',
    description: '检查家目录、Node、Python、venv、Cookie、浏览器、CDP、关键文件、人设。装完插件第一件事就跑它。只读。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const r = runNode('doctor.mjs', ['--json'], 90_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '体检脚本没返回可解析结果', stderr: String(r.stderr || '').slice(0, 300) }
      return { ...j, hint: (j.must_fix || []).length ? '先把 must_fix 里的修掉' : '没有硬伤' }
    },
  },
  {
    name: 'douyin_whoami',
    title: '刷抖音 · 登录状态',
    description: '看抖音登录还在不在、当前是哪个号。只读，不影响登录态。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      const bad = needLogin()
      if (bad) return bad
      const r = runPy('session-guard.py', ['check'], 90_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '体检没返回结果', stderr: String(r.stderr || '').slice(0, 300) }
      return { ok: true, logged_in: j.alive === true, ...j }
    },
  },

  /* ── 取候选 ── */
  {
    name: 'douyin_forward',
    title: '刷抖音 · 取一轮候选',
    description: '拉推荐流候选并打分，返回清单（含官方分享链接 share_url）。只用只读接口，不碰写接口，不影响登录态。',
    inputSchema: {
      type: 'object',
      properties: {
        top: { type: 'number', description: '返回前几条（默认 10，最多 30）' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const top = Math.max(1, Math.min(Number(args?.top) || 10, 30))
      const r = runPy('forward-pick.py', ['--limit', String(top)], 300_000)
      if (r.status !== 0) return { ok: false, error: '取候选失败', stderr: String(r.stderr || '').slice(0, 400) }
      const picked = readJson(join(HOME, 'forward-pick.json'), {}) || {}
      const rows = (Array.isArray(picked.rows) ? picked.rows : []).slice(0, top)
      return {
        ok: true,
        picked: rows.length,
        sources: picked.meta || [],
        dropped: picked.dropped || {},
        list: rows.map((x) => ({
          aweme_id: x.aweme_id,
          desc: x.desc,
          author: x.author,
          duration_s: x.duration_s,
          age_h: x.age_h,
          digg: x.digg,
          comment: x.comment,
          collect: x.collect,
          share: x.share,
          share_url: x.share_url,
          web_url: x.web_url,
        })),
      }
    },
  },
  {
    name: 'douyin_comments',
    title: '刷抖音 · 读评论',
    description: '取一个作品下的评论（签名的只读接口，带楼中楼）。判断「好不好玩」的主要文本依据。',
    inputSchema: {
      type: 'object',
      properties: { aweme_id: { type: 'string', description: '作品/图文 ID' } },
      required: ['aweme_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const id = String(args?.aweme_id || '').trim()
      if (!id) return { ok: false, error: '缺 aweme_id' }
      const r = runPy('api-comments.py', [id], 300_000)
      const lines = String(r.stdout || '').split('\n')
      const items = lines.filter((l) => /^\s{2}cid=|^\s{6}└ /.test(l)).map((s) => s.replace(/^\s+/, ''))
      if (r.status !== 0) return { ok: false, error: '拉评论失败', stderr: String(r.stderr || '').slice(0, 300) }
      return {
        ok: true,
        aweme_id: id,
        count: items.filter((s) => s.startsWith('cid=')).length,
        comments: items,
      }
    },
  },
  {
    name: 'douyin_notices',
    title: '刷抖音 · 互动通知',
    description: '读抖音互动通知：谁 @ 了你（含别人评论区里的 @）、谁关注/评论/点赞。只读，不改已读状态。',
    inputSchema: {
      type: 'object',
      properties: { raw: { type: 'boolean', description: '连原始条目一起返回（默认 false）' } },
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const argv = [join(ROOT, 'tools', 'notice-read.py')]
      if (args?.raw) argv.push('--raw')
      const r = run(venvPython(), argv, 150_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '没读到通知', stderr: String(r.stderr || '').slice(0, 300) }
      return j
    },
  },

  /* ── 发送（全部要 confirm） ── */
  {
    name: 'douyin_share_card',
    title: '刷抖音 · 分享卡片给好友',
    description: '把视频以抖音分享卡片发给好友（不是文字链接 —— 文字链接在抖音里点不开）。'
      + '先发卡片、隔几秒再发 reason。🔴 必须先问使用者，他点头后传 confirm:true。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '视频 ID（19 位）；不给就用最近一轮清单里的' },
        to: { type: 'string', description: '好友昵称（只用于显示）；留空用配置 dmTo' },
        to_id: { type: 'string', description: '好友稳定 id（sec_uid）；重名时必须给；留空用配置 dmToId' },
        top: { type: 'number', description: '不给 aweme_id 时发清单前 N 条（默认 1，最多 3）' },
        reason: { type: 'string', description: '卡片之后单独发的一条正文：为什么值得看（≤300 字）' },
        reason_delay_sec: { type: 'number', description: '卡片发出后隔几秒再发 reason（默认 5）' },
        confirm: { type: 'boolean', description: '🔴 必须由使用者当场同意后传 true，否则只回预览' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const cfg = config()
      const to = String(args?.to || cfg.dmTo || '').trim()
      const toId = String(args?.to_id || cfg.dmToId || '').trim()
      if (!to && !toId) return { ok: false, error: '不知道发给谁', hint: '传 to / to_id，或让使用者在设置里填「私信发给谁」+「稳定 ID」' }
      let ids = []
      if (args?.aweme_id) ids = [String(args.aweme_id).trim()]
      else {
        const rows = readJson(join(HOME, 'forward-pick.json'), {})?.rows || []
        ids = rows.slice(0, Math.max(1, Math.min(Number(args?.top) || 1, 3))).map((r) => String(r.aweme_id))
      }
      if (!ids.length) return { ok: false, error: '没有可用视频 ID', hint: '先调 douyin_forward 拉一轮' }
      if (args?.confirm !== true) {
        const rows = readJson(join(HOME, 'forward-pick.json'), {})?.rows || []
        return {
          ok: true, sent: false, needsConfirm: true, to, count: ids.length,
          preview: ids.map((id) => {
            const r = rows.find((x) => String(x.aweme_id) === id) || {}
            return { aweme_id: id, desc: String(r.desc || '').slice(0, 60), author: r.author || '', share_url: r.share_url || '' }
          }),
          reason: String(args?.reason || '').trim() || undefined,
          note: '没发送 —— 先把预览给使用者看，他点头后再用 confirm:true 调一次',
        }
      }
      const sent = []
      for (let i = 0; i < ids.length; i++) {
        const argv = [ids[i], to]
        if (toId) argv.push('--to-id', toId)
        const r = runNode('card-share.mjs', argv, 200_000)
        const j = pickJson(r.stdout) || { ok: false, aweme_id: ids[i], stderr: String(r.stderr || '').slice(0, 200) }
        sent.push(j)
        if (!(j && j.ok)) break
        if (i < ids.length - 1) await sleep(2200)
      }
      const okN = sent.filter((x) => x && x.sent).length
      const reasonText = String(args?.reason || '').trim()
      let reason = null
      if (okN && reasonText) {
        const gap = Math.max(0, Math.min(Number(args?.reason_delay_sec ?? 5) || 0, 60))
        if (gap > 0) await sleep(gap * 1000)
        const rArgs = []
        if (to) rArgs.push('--to', to)
        if (toId) rArgs.push('--to-id', toId)
        rArgs.push('--text', reasonText)
        const r3 = runNode('im-send.mjs', rArgs, 240_000)
        reason = pickJson(r3.stdout) || { ok: false, error: '理由那一条没返回可解析结果' }
      }
      /* ⭐ 阶段2：发送账本 —— 卡片逐张记（失败也记），理由单独一条。
       * ⚠️ MCP 版没做回读（见下面 note）⇒ readback 恒为 false，别把它当"没发出去"。 */
      for (const x of sent) {
        if (!x || !x.aweme_id) continue
        appendSent({
          aweme_id: String(x.aweme_id), to, to_id: toId, kind: 'card',
          sent: Boolean(x.sent), readback: false,
          error: x.sent ? '' : String(x.error || x.stderr || '卡片没发出去').slice(0, 200),
          src: 'mcp',
        })
      }
      if (reason) {
        appendSent({
          aweme_id: ids.length === 1 ? String(ids[0]) : '', to, to_id: toId, kind: 'reason',
          sent: Boolean(reason.sent), readback: false,
          error: reason.ok ? '' : String(reason.error || '理由没发出去').slice(0, 200),
          src: 'mcp',
        })
      }
      return {
        ok: okN === ids.length && (!reason || reason.ok),
        sent: okN, total: ids.length, to,
        results: sent.map((x) => ({ aweme_id: x.aweme_id, ok: !!x.ok, sent: !!x.sent, error: x.error })),
        reason: reason || undefined,
        note: '卡片是否真的落地，请让使用者自己在抖音里看一眼（这个 MCP 版没做回读）',
      }
    },
  },
  {
    name: 'douyin_dm',
    title: '刷抖音 · 发私信',
    description: '发一条私信给抖音好友（无头浏览器，页面自己签名）。🔴 先问使用者，confirm:true 才发。'
      + '要给视频请用 douyin_share_card（先卡片后文字）。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '好友昵称（只用于显示）；留空用配置 dmTo' },
        to_id: { type: 'string', description: '好友稳定 id（sec_uid）；留空用配置 dmToId' },
        text: { type: 'string', description: '私信正文' },
        dry: { type: 'boolean', description: '只验证通道，不真发' },
        confirm: { type: 'boolean', description: '🔴 必须由使用者当场同意后传 true，否则只回草稿' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const cfg = config()
      const to = String(args?.to || cfg.dmTo || '').trim()
      const toId = String(args?.to_id || cfg.dmToId || '').trim()
      if (!to && !toId) return { ok: false, error: '不知道发给谁', hint: '传 to / to_id，或让使用者在设置里填私信对象' }
      const text = stripBodyActions(String(args?.text || '').trim())
      if (!text) return { ok: false, error: '正文为空' }
      if (args?.confirm !== true) {
        return { ok: true, sent: false, needsConfirm: true, to, to_id: toId || undefined, draft: text.slice(0, 1500), len: text.length, note: '没发送 —— 先把草稿给使用者看' }
      }
      const argv = []
      if (to) argv.push('--to', to)
      if (toId) argv.push('--to-id', toId)
      argv.push('--text', text)
      if (args?.dry) argv.push('--dry')
      const r = runNode('im-send.mjs', argv, 240_000)
      const j = pickJson(r.stdout) || { ok: false, error: '发送器没返回可解析结果', stderr: String(r.stderr || '').slice(0, 300) }
      // ⭐ 阶段2：私信进账本（dry 不算真发；失败也记）
      if (!args?.dry) {
        const okSent = Boolean(j.ok && j.sent)
        appendSent({
          aweme_id: '', to: String(j.to || to), to_id: String(j.to_sec_uid || toId || ''),
          kind: 'text', sent: okSent, readback: Boolean(j.readback),
          error: okSent ? '' : String(j.error || j.note || '没发出去').slice(0, 200), src: 'mcp',
        })
      }
      return j
    },
  },
  {
    name: 'douyin_comment_reply',
    title: '刷抖音 · 发评论 / 回复评论',
    description: '在评论区发一条评论，或回复某条评论（一条 fetch，不点 UI，不弹短信验证，1 秒）。'
      + '⚠️ 这条发的是**普通评论/回复**：正文里的「@昵称」只是文字，对方收不到 @ 通知；'
      + '但**回复**会让对方收到「回复了我的评论」通知。'
      + '⭐ 对方那条在**楼中楼**里（别人楼下）时，还要传 root_comment_id（楼根）—— '
      + '不然通知会发给楼主而不是他。楼根从 douyin_notices / douyin_at_me 的返回里直接拿。'
      + '🔴 要真 @ 用 douyin_comment_mention。🔴 先问使用者，confirm:true 才发。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '作品/图文 id' },
        text: { type: 'string', description: '评论正文（≤500 字）' },
        comment_id: { type: 'string', description: '要回复的评论 cid；留空 = 发顶层评论。可以是顶层评论，也可以是楼中楼里的某条' },
        root_comment_id: {
          type: 'string',
          description: '【可选】楼根 cid（这栋楼第一条顶层评论）。回复**楼中楼**时用；'
            + '不给会自动判，判不出来会拒绝发送（不会瞎猜）。',
        },
        confirm: { type: 'boolean', description: '🔴 必须由使用者当场同意后传 true，否则只回草稿' },
      },
      required: ['aweme_id', 'text'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const aweme = String(args?.aweme_id || '').trim()
      const text = stripBodyActions(String(args?.text || '').trim())
      const replyTo = String(args?.comment_id || '').trim()
      const rootCid = String(args?.root_comment_id || '').trim()
      if (!aweme) return { ok: false, error: '缺 aweme_id' }
      if (!text) return { ok: false, error: '正文是空的' }
      if (text.length > 500) return { ok: false, error: `正文太长（${text.length} 字）` }
      if (args?.confirm !== true) {
        return {
          ok: true, sent: false, needsConfirm: true, aweme_id: aweme,
          comment_id: replyTo || '(顶层评论)',
          root_comment_id: rootCid || '(自动判)',
          draft: text, len: text.length,
          how: replyTo
            ? (rootCid ? `楼中楼回复：reply_id=${rootCid}、reply_to_reply_id=${replyTo}`
              : `楼中楼回复：楼根自动判、reply_to_reply_id=${replyTo}`)
            : '顶层普通评论：**不会通知任何人**',
          note: '没发送 —— 先把草稿给使用者看',
        }
      }
      const argv = ['--aweme', aweme, '--text', text]
      if (replyTo) argv.push('--reply', replyTo)
      if (rootCid) argv.push('--root', rootCid)
      const r = runNode('comment-api.mjs', argv, 260_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '发送器没返回可解析结果', stderr: String(r.stderr || '').slice(0, 300) }
      if (j.need_root) {
        return {
          ok: false, need_root: true, ...j,
          hint: '这条 cid 在楼中楼里，但判不出楼根 ⇒ **没发出**。'
            + '先 douyin_notices / douyin_at_me 读一次拿 root_comment_id，再传进来。',
        }
      }
      // 核实"真的进了楼没有"（脚本发完会重读那一楼）
      if (j.ok && j.placement && j.placement.ok === false) {
        j.warning = j.placement.warn
      }
      // ⭐ 阶段2：评论/回复也进发送账本（kind=comment；回读只认 placement 明确 ok）
      appendSent({
        aweme_id: aweme, to: '', to_id: '', kind: 'comment', comment_id: replyTo || '',
        sent: Boolean(j.ok),
        readback: Boolean(j.placement && j.placement.ok === true),
        error: j.ok ? '' : String(j.error || '没发出去').slice(0, 200), src: 'mcp',
      })
      // ⭐ fish.20：placement 明确进楼（level=2）⇒ published:'verified'；否则如实 submitted_unverified。
      //   以前只给 placement/readback，值班侧以为"没发成"又重发。
      const published = j.ok
        ? ((j.placement && j.placement.ok === true) ? 'verified' : 'submitted_unverified')
        : false
      return { ...j, published }
    },
  },

  /* ── 读私信 / 说明 ── */
  {
    name: 'douyin_im_read',
    title: '刷抖音 · 读私信',
    description: '读最近一个会话的消息，每条带 from（me/them/unknown），能分清谁说的。只读。'
      + '⭐ 会自动带上记忆（context）：之前聊过什么、这个人的长期事实。回话前先看它。',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: '会话昵称；留空用配置 dmTo' },
        to_id: { type: 'string', description: '稳定 id（sec_uid）；重名时给' },
        limit: { type: 'number', description: '返回最近几条（默认 30，最多 60）' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const cfg = config()
      const to = String(args?.to || cfg.dmTo || '').trim()
      const toId = String(args?.to_id || cfg.dmToId || '').trim()
      if (!to && !toId) return { ok: false, error: '不知道读谁的会话' }
      const argv = ['--read']
      if (to) argv.push('--to', to)
      if (toId) argv.push('--to-id', toId)
      const r = runNode('im-send.mjs', argv, 240_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '读不到会话', stderr: String(r.stderr || '').slice(0, 300) }
      if (!j.ok) return j
      const all = Array.isArray(j.messages) ? j.messages : []
      const limit = Math.max(1, Math.min(Number(args?.limit) || 30, 60))
      return {
        ok: true, to: j.to, to_sec_uid: j.to_sec_uid, count: j.count,
        mine: j.mine, them: j.them, unknown: j.unknown,
        messages: all.slice(-limit),
        their_latest: all.filter((m) => m.from === 'them').slice(-3).reverse(),
      }
    },
  },
  {
    name: 'douyin_at_me',
    title: '刷抖音 · 谁在评论区 @ 了我',
    description: '把「谁 @ 的 / 在哪个视频 / 说了什么 / 我回过没有」整理好，带记忆上下文。只读。'
      + '想回就用返回里的 aweme_id + comment_id 调 douyin_comment_reply。',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: '最多看几条（默认 10，最多 30）' },
        include_seen: { type: 'boolean', description: '连已经回过的也列出来' },
      },
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const argv = [join(ROOT, 'tools', 'notice-read.py'), '--raw']
      const r = run(venvPython(), argv, 150_000)
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '没读到通知', stderr: String(r.stderr || '').slice(0, 300) }
      const ats = (Array.isArray(j.items) ? j.items : []).filter((x) => x && (x.type === 45 || x.type === 46))
      const limit = Math.max(1, Math.min(Number(args?.limit) || 10, 30))
      return {
        ok: true,
        at_n: ats.length,
        list: ats.slice(0, limit).map((a) => ({
          nickname: a.nickname || '', content: String(a.content || '').slice(0, 300),
          aweme_id: a.aweme_id || undefined, comment_id: a.comment_id || undefined,
          video_url: a.video_url || undefined,
        })),
        hint: ats.length ? '要回：douyin_comment_reply { aweme_id, comment_id, text }，先给用户看草稿' : '最近没有新的 @',
      }
    },
  },
  {
    /**
     * ⭐⭐ 真 @ 评论（2026-10-23 加，因使用者反馈"@ 不出来"）
     *
     * 🔴 背景：抖音的 @ 只有**UI 点选**才作数 —— API 直发时服务端会把 mention 的
     *    sec_uid 剥掉（名字变蓝、点开空页、对方收不到通知）。
     *    所以 `douyin_comment_reply` 只能发普通评论；**真 @ 必须走这个工具**，
     *    它内部跑 tools/comment-mention-ui.mjs：滚输入框 → 真实点开 DraftJS →
     *    CDP 键盘打 @ → 真实鼠标点弹层里那一行 → 补正文 → 点红色箭头发布。
     *
     * ⚠️ 前提：必须已登录、必须装了 Chrome（要起无头浏览器）、昵称要能在弹层里搜到。
     */
    name: 'douyin_comment_mention',
    title: '刷抖音 · 评论区真 @（UI 点选）',
    description: '在别人视频的评论区发一条**真正 @ 到某人**的评论（名字可点、对方收到通知）。'
      + '⚠️ 比普通评论慢（要起无头 Chrome 点选弹层），且要求昵称能在 @ 弹层里搜到。'
      + '🔴 先问使用者，confirm:true 才发。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '作品/图文 id' },
        name: { type: 'string', description: '要 @ 的人的抖音昵称（必须和对方昵称完全一致）' },
        text: { type: 'string', description: '评论正文（≤500 字；不用自己写 @昵称，工具会自动加）' },
        confirm: { type: 'boolean', description: '🔴 必须由使用者当场同意后传 true，否则只回草稿' },
        dry: { type: 'boolean', description: 'true = 只走到点选完就停（不发布），用于验证昵称搜不搜得到' },
      },
      required: ['aweme_id', 'name', 'text'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const aweme = String(args?.aweme_id || '').trim()
      const cfg = config()
      // ⭐ fish.20：name 缺省用配置 atPeers[0].nick（提示词会传，但兜底）
      const name = String(args?.name || (Array.isArray(cfg.atPeers) && cfg.atPeers[0] && cfg.atPeers[0].nick) || cfg.mentionName || cfg.dmTo || '').trim()
      const text = stripBodyActions(String(args?.text || '').trim())
      if (!aweme) return { ok: false, error: '缺 aweme_id' }
      if (!name) return { ok: false, error: '缺 name（要 @ 的昵称；配置 atPeers[0].nick 也没设）' }
      if (!text) return { ok: false, error: '正文是空的' }
      if (text.length > 500) return { ok: false, error: `正文太长（${text.length} 字）` }
      if (args?.confirm !== true && args?.dry !== true) {
        return {
          ok: true, sent: false, needsConfirm: true, aweme_id: aweme, mention: name,
          draft: `@${name} ${text}`, len: text.length,
          note: '没发送 —— 先把草稿给使用者看；想先验证昵称能不能 @ 到，可传 dry:true（只点选不发布）',
        }
      }
      // ⭐ fish.20：dry 只验证昵称，不占用上限、不记计数
      if (args?.dry !== true) {
        const capCheck = canCommentAt(HOME, { aweme })
        if (!capCheck.ok) {
          return {
            ok: false, reason: capCheck.reason,
            error: capCheck.reason === 'cap'
              ? `今天评论区@已经满 ${COMMENT_AT_CAP} 条`
              : '这条视频已经 @ 过了（同一条视频只 @ 一次）',
            count_today: commentAtCount(HOME), remaining: capCheck.remaining,
          }
        }
        const cardSent = alreadySharedCard(HOME, aweme)
        if (cardSent) {
          return {
            ok: false, reason: 'already_card',
            error: '这条视频已经私信发过卡片了 —— 分流规矩：同一条视频不要既发卡片又 @',
            card_at: String(cardSent.at || ''), card_to: String(cardSent.to || ''),
          }
        }
      }
      const argv = ['--aweme', aweme, '--name', name, '--text', text]
      if (args?.dry === true) argv.push('--dry')
      let r = null
      if (args?.dry !== true) acquireBrowserLock(HOME, { by: 'comment' })
      try {
        r = runNode('comment-mention-ui.mjs', argv, 300_000)
      } finally {
        if (args?.dry !== true) releaseBrowserLock(HOME, { by: 'comment' })
      }
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '真 @ 执行器没返回可解析结果', stdout: String(r.stdout || '').slice(0, 400), stderr: String(r.stderr || '').slice(0, 300) }
      // ⭐ 阶段2：真 @ 评论也是对外发的一条（dry 不记；UI 路径拿不到 cid ⇒ readback 只能 false）
      if (args?.dry !== true) {
        const verified = Boolean(j.ok === true && (j.published === 'verified' || j.verified === true))
        appendSent({
          aweme_id: aweme, to: '', to_id: '', kind: 'comment', mention: name,
          sent: Boolean(j.ok), readback: verified,
          error: j.ok ? '' : String(j.error || '没发出去').slice(0, 200), src: 'mcp',
        })
        // ⭐ fish.20：只有核实可见才计入每日 2 条 + 记台账
        if (verified) {
          recordCommentAt(HOME, { aweme })
          appendJournal(`评论区@主人：${String(text).slice(0, 30)}`)
        }
      }
      return { ...j, count_today: args?.dry === true ? undefined : commentAtCount(HOME), cap: COMMENT_AT_CAP }
    },
  },
  {
    /* ⭐ fish.20：@豆包 异步提问（发完立刻返回；豆包回了由宿主 doubaoRepliesTick 叫醒） */
    name: 'douyin_ask_doubao',
    title: '刷抖音 · @豆包 让它总结（异步）',
    description: '在视频评论区发一条 `@豆包 <问题>` 的顶层评论，**发完立刻返回，不等它回**。'
      + '护栏：每天最多 2 次、同一视频只问一次。'
      + '⭐ 这是异步的：不要等回复；豆包回了插件会来叫你（【豆包回你了】），到时候再判断值不值得让主人看。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '要问的那条视频 id' },
        question: { type: 'string', description: '要问的问题（默认「这条视频讲了什么？帮本鲸用一两句话总结一下」）' },
      },
      required: ['aweme_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const aweme = String(args?.aweme_id || '').trim()
      const question = String(args?.question || '').trim() || '这条视频讲了什么？帮本鲸用一两句话总结一下'
      if (!aweme) return { ok: false, error: '缺 aweme_id' }
      const today = doubao.asksToday(HOME)
      if (today >= doubao.DOUBAO_MAX_PER_DAY) {
        return { ok: false, error: `今天已经问豆包 ${today} 次了（每天最多 ${doubao.DOUBAO_MAX_PER_DAY} 次），明天再问` }
      }
      const prev = doubao.alreadyAsked(HOME, aweme)
      if (prev) return { ok: false, error: '这条视频已经问过豆包了（同一视频只问一次）', at: prev.at, status: prev.status }
      const text = `@豆包 ${question}`
      acquireBrowserLock(HOME, { by: 'comment' })
      let r = null
      try {
        r = runNode('comment-mention-ui.mjs', ['--aweme', aweme, '--name', '豆包', '--text', text], 300_000)
      } finally {
        releaseBrowserLock(HOME, { by: 'comment' })
      }
      const j = pickJson(r.stdout)
      if (!j) return { ok: false, error: '@豆包 发送器没返回可解析结果', stderr: String(r.stderr || '').slice(0, 300) }
      const published = String(j.published || (j.ok ? 'submitted_unverified' : 'false'))
      const submitted = Boolean(j.ok === true && (published === 'verified' || published === 'submitted_unverified'))
      appendSent({
        aweme_id: aweme, to: '', to_id: '', kind: 'comment', mention: '豆包',
        sent: submitted, readback: Boolean(j.verified),
        error: submitted ? '' : String(j.error || '没发出去').slice(0, 200), src: 'mcp',
      })
      if (!submitted) {
        return { ok: false, error: String(j.error || 'mention-ui 未提交成功').slice(0, 300), published, verified: Boolean(j.verified) }
      }
      doubao.appendAsk(HOME, { at: new Date().toISOString(), aweme_id: aweme, question, status: 'pending' }, (m) => { try { process.stderr.write(`[douyin-mcp] ${m}\n`) } catch { /* ignore */ } })
      return {
        ok: true, submitted: true, published, verified: Boolean(j.verified), aweme_id: aweme, question,
        note: published === 'submitted_unverified'
          ? '编辑器清空但评论区没核实到（可能审核中）——别当已发；已记 pending，豆包回了会叫你'
          : '已提交；已记 pending，豆包回了会叫你（**不要等**，该干嘛干嘛）',
      }
    },
  },
  {
    /* ⭐ fish.21：她自己的点赞（UI 双击 → API 兜底；台账 home/likes.jsonl） */
    name: 'douyin_like',
    title: '刷抖音 · 她自己点赞',
    description: '给一条视频点一次赞（她自己觉得好 / 跟主人一起喜欢的才点）。'
      + '执行：无头 Chrome 打开视频 → 画面中心双击 → DOM 确认；没确认就 API 兜底（页面签名器）。'
      + '🔴 护栏：settings.likes.enabled / 每天最多 10 / 同一条只赞一次 / 失败最多试 2 次；'
      + '点赞不是任务：她自己判断。AI/DSH/工具/插件/编程类 → 有意思就点赞 + 评论区 @主人；擦边/颜值向 → 私信卡片（点赞可选，不 @）；政治/带货/标题党/已赞过不点。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '要点赞的视频 id' },
        why: { type: 'string', description: '一句话：为什么赞（如「鲸鱼/机房梗/主人喜欢的节目效果」）' },
        confirm: { type: 'boolean', description: '🔴 必须确认后才传 true；否则只回草稿' },
      },
      required: ['aweme_id'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const aweme = String(args?.aweme_id || '').trim()
      const why = String(args?.why || '').trim().slice(0, 200)
      if (!aweme) return { ok: false, error: '缺 aweme_id' }
      if (args?.confirm !== true) {
        return {
          ok: true, sent: false, needsConfirm: true, aweme_id: aweme, why,
          draft: why ? `点赞 ${aweme}（${why}）` : `点赞 ${aweme}`,
          note: '没点赞 —— 先把这条给用户看，他点头后再用 confirm:true 调一次',
        }
      }
      const homeDir = join(HOME, 'home')
      if (!isWorldOn(homeDir)) return { ok: false, reason: 'world_off', error: '世界暂停中（去「她的家」点开始）——先不点赞' }
      let st = {}
      try { st = readJson(join(homeDir, 'settings.json'), {}) || {} } catch { st = {} }
      const likeSettings = normalizeLikeSettings(st.likes)
      const chk = canLike(homeDir, { aweme_id: aweme, settings: likeSettings })
      if (!chk.ok) return { ...chk, error: chk.error || '不能赞' }
      acquireBrowserLock(homeDir, { by: 'like' })
      let r = null
      try {
        r = runNode('like-ui.mjs', ['--aweme', aweme, '--why', why], 240_000)
      } finally {
        releaseBrowserLock(homeDir, { by: 'like' })
      }
      const j = pickJson(r.stdout)
      const ok = Boolean(j && j.ok === true)
      const via = String((j && (j.via || j.published)) || '')
      appendLike(homeDir, { at: new Date().toISOString(), aweme_id: aweme, why, via, ok }, (m) => { try { process.stderr.write(`[douyin-mcp] ${m}\n`) } catch { /* ignore */ } })
      if (ok) appendJournal(`点赞：${why || aweme}（${aweme}）`, 'like')
      const count = likesToday(homeDir)
      return {
        ok, via: via || undefined, aweme_id: aweme, why: why || undefined,
        error: ok ? undefined : String((j && j.error) || '点赞没成').slice(0, 240),
        count_today: count, per_day: likeSettings.perDay, remaining: Math.max(0, likeSettings.perDay - count),
      }
    },
  },
  {
    /* ⭐ fish.24：按关键词搜抖音视频（只读；找特定主题用） */
    name: 'douyin_search',
    title: '刷抖音 · 按关键词搜视频',
    description: '按关键词搜抖音视频（只读：不点赞、不评论、不发卡片）。'
      + '用途：找**特定主题**（主人的兴趣 / 你自己关心的 DSH、AI 工具、插件）。'
      + '返回候选列表（aweme_id / desc / author / 互动数 / 视频链接），后续按正常分流规则处理。'
      + '护栏：settings.search（每天最多 20 次、两次间隔 ≥30 秒、世界关着不搜）。',
    inputSchema: {
      type: 'object',
      properties: {
        keyword: { type: 'string', description: '搜索关键词（例如 "DeepSeek Harness" / "AI插件"）' },
        count: { type: 'number', description: '要几条（默认 10，最多 20）' },
        offset: { type: 'number', description: '翻页偏移（默认 0）' },
      },
      required: ['keyword'],
      additionalProperties: false,
    },
    handler: (args) => {
      const bad = needLogin() || needSetup()
      if (bad) return bad
      const keyword = String(args?.keyword || '').trim().slice(0, 60)
      if (!keyword) return { ok: false, error: '缺 keyword（要搜什么）' }
      const homeDir = join(HOME, 'home')
      if (!isWorldOn(homeDir)) return { ok: false, reason: 'world_off', error: '世界暂停中（去「她的家」点开始）——先不搜' }
      let st = {}
      try { st = readJson(join(homeDir, 'settings.json'), {}) || {} } catch { st = {} }
      const searchSettings = normalizeSearchSettings(st.search)
      if (!searchSettings.enabled) return { ok: false, reason: 'off', error: '搜索开关关着（settings.search.enabled=false）' }
      const chk = canSearch(homeDir, { settings: searchSettings })
      if (!chk.ok) {
        return {
          ok: false, reason: chk.reason,
          error: chk.reason === 'cap'
            ? `今天已经搜了 ${chk.count} 次（每天最多 ${chk.perDay} 次）`
            : chk.reason === 'gap' ? `搜得太快：等 ${chk.waitSec} 秒再搜（两次至少隔 ${searchSettings.minGapSec} 秒）` : '搜索被拦',
          waitSec: chk.waitSec, count_today: chk.count, per_day: chk.perDay,
        }
      }
      const count = Math.max(1, Math.min(Math.trunc(Number(args?.count) || 10), 20))
      const offset = Math.max(0, Math.trunc(Number(args?.offset) || 0))
      acquireBrowserLock(homeDir, { by: 'search' })
      let r = null
      try {
        r = runNode('douyin-search.mjs', ['--keyword', keyword, '--count', String(count), '--offset', String(offset)], 180_000)
      } finally {
        releaseBrowserLock(homeDir, { by: 'search' })
      }
      const j = pickJson(r.stdout)
      const ok = Boolean(j && j.ok === true)
      appendSearch(homeDir, { at: new Date().toISOString(), keyword, count: ok ? Number(j.count) || 0 : 0, ok }, (m) => { try { process.stderr.write(`[douyin-mcp] ${m}\n`) } catch { /* ignore */ } })
      if (!ok) {
        return { ok: false, error: String((j && j.error) || '搜索没成').slice(0, 240), reason: 'error' }
      }
      appendJournal(`搜「${keyword}」→ ${Number(j.count) || 0} 条`, 'douyin_search')
      return {
        ok: true, keyword, count: Number(j.count) || 0, offset,
        items: Array.isArray(j.items) ? j.items : [],
        count_today: searchesToday(homeDir), per_day: searchSettings.perDay,
      }
    },
  },
  {
    /* ⭐ fish.25：看懂视频 —— 主人分享视频后用它抽帧看内容（只读） */
    name: 'douyin_watch_video',
    title: '刷抖音 · 看懂视频（抽帧看图）',
    description: '主人分享视频后用它抽帧看内容：下载视频 → ffmpeg 量测（切点/运动）→ 抽 **6–12 张关键帧**。'
      + '返回 frames（单帧 png 的本地路径）。'
      + '⭐ 只传 aweme_id；拿到后必须用 read_image 看 frames（6–12 张）再回答，别只看 1 张、别空口猜。'
      + '只读：不点赞 / 不评论 / 不发消息。护栏：settings.watchVideo（默认开、每天 10 条）。',
    inputSchema: {
      type: 'object',
      properties: {
        aweme_id: { type: 'string', description: '视频 id（19 位，从分享卡片 / 私信 / 链接里拿）' },
        video_url: { type: 'string', description: '没有 aweme_id 时的视频直链（http/https mp4）' },
        confirm: { type: 'boolean', description: '可选；这一步不发任何东西，不传也会执行' },
      },
      additionalProperties: false,
    },
    handler: async (args) => {
      const aweme = String(args?.aweme_id || '').trim()
      const vurl = String(args?.video_url || '').trim()
      if (!aweme && !vurl) return { ok: false, error: '缺 aweme_id（或 video_url）' }
      if (vurl && !/^https?:\/\//i.test(vurl)) return { ok: false, error: 'video_url 要是 http/https 直链' }
      const homeDir = join(HOME, 'home')
      if (!isWorldOn(homeDir)) return { ok: false, reason: 'world_off', error: '世界暂停中（去「她的家」点开始）——先不看' }
      let st = {}
      try { st = readJson(join(homeDir, 'settings.json'), {}) || {} } catch { st = {} }
      const watchSettings = normalizeWatchSettings(st.watchVideo)
      if (!watchSettings.enabled) return { ok: false, reason: 'off', error: '看视频开关关着（settings.watchVideo.enabled=false）' }
      const chk = canWatch(homeDir, { aweme_id: aweme, settings: watchSettings })
      if (!chk.ok) return { ok: false, reason: chk.reason, error: chk.error || '不能看' }
      acquireBrowserLock(homeDir, { by: 'watch' })
      let r = null
      try {
        r = runNode('vw-watch.mjs', aweme ? ['--aweme', aweme] : ['--url', vurl], 600_000)
      } finally {
        releaseBrowserLock(homeDir, { by: 'watch' })
      }
      const j = pickJson(r.stdout)
      const ok = Boolean(j && j.ok === true)
      appendWatch(homeDir, { at: new Date().toISOString(), aweme_id: aweme, ok }, (m) => { try { process.stderr.write(`[douyin-mcp] ${m}\n`) } catch { /* ignore */ } })
      if (!ok) {
        return {
          ok: false, reason: 'error',
          error: String((j && j.error) || '看视频没成').slice(0, 240),
          hint: String((j && j.hint) || '先跑 python vendor/vw.py doctor 确认「必需项就绪」').slice(0, 240),
        }
      }
      const nFrames = Array.isArray(j.frames) ? j.frames.length : 0
      appendJournal(`看视频 ${aweme || j.aweme_id}：${nFrames} 帧`, 'douyin_watch_video')
      return {
        ...j,
        hint: '用 read_image 看 frames 里的图（一般 6-12 张），再回答；图版 sheet_png 看整体节奏。',
        count_today: watchesToday(homeDir), per_day: watchSettings.perDay,
      }
    },
  },
  {
    name: 'douyin_guide',
    title: '刷抖音 · 使用说明',
    description: '返回这个插件给别的 agent 看的使用说明（工具清单、安全红线、MCP 配置）。第一次接进来先读它。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    handler: () => {
      try {
        return { ok: true, doc: readFileSync(join(ROOT, 'AI-USAGE.md'), 'utf8') }
      } catch (e) {
        return { ok: false, error: '找不到 AI-USAGE.md（插件包不完整）', detail: String(e?.message ?? e) }
      }
    },
  },
]

/* ─────────────────────────── JSON-RPC / MCP 传输 ─────────────────────────── */

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const send = (msg) => {
  try { process.stdout.write(JSON.stringify(msg) + '\n') } catch { /* 管道断了就随它去 */ }
}

const reply = (id, result) => send({ jsonrpc: '2.0', id, result })
const fail = (id, code, message, data) => send({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } })

/** 工具结果统一包成 MCP content */
const asContent = (value) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return {
    content: [{ type: 'text', text }],
    isError: value && typeof value === 'object' && value.ok === false ? true : undefined,
  }
}

const handleRequest = async (msg) => {
  const { id, method, params } = msg || {}
  const isNotification = id === undefined || id === null

  switch (method) {
    /* ⭐ 新客户端（2026-07-28）会先探这个；明确回"没有" ⇒ 它自动回落 legacy initialize */
    case 'server/discover':
      return fail(id, -32601, 'Method not found: server/discover (this server speaks MCP 2025-06-18)')

    case 'initialize': {
      const asked = String(params?.protocolVersion || '')
      const version = SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0]
      return reply(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: '刷抖音插件（dsh-douyin-scroll）的 MCP 入口。第一次用先调 douyin_guide 读说明；发任何东西前必须先问使用者，得到同意才传 confirm:true。',
      })
    }

    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined

    case 'ping':
      return reply(id, {})

    case 'tools/list':
      return reply(id, {
        tools: TOOLS.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      })

    case 'tools/call': {
      const name = String(params?.name || '')
      const tool = TOOLS.find((t) => t.name === name)
      if (!tool) return fail(id, -32602, `Unknown tool: ${name}`)
      try {
        const value = await tool.handler(params?.arguments || {})
        return reply(id, asContent(value))
      } catch (e) {
        return reply(id, asContent({ ok: false, error: String(e?.message ?? e) }))
      }
    }

    default:
      if (isNotification) return undefined
      return fail(id, -32601, `Method not found: ${method}`)
  }
}

/* ─────────────────────────── 入口 ─────────────────────────── */

if (process.argv.includes('--selftest')) {
  // 不接客户端，自己跑一遍协议握手 + tools/list —— selfcheck.mjs 也用它
  const lines = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '1' } } },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'douyin_status', arguments: {} } },
    { jsonrpc: '2.0', id: 4, method: 'server/discover', params: {} },
  ]
  for (const l of lines) {
    const out = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = (s) => { out.push(String(s)); return true }
    await handleRequest(l)
    process.stdout.write = orig
    const text = out.join('').trim().split('\n')[0] || '{}'
    const j = JSON.parse(text)
    if (j.error) console.log(`#${l.id} ${l.method} -> error ${j.error.code} ${j.error.message.slice(0, 60)}`)
    else if (j.result?.tools) console.log(`#${l.id} ${l.method} -> ${j.result.tools.length} tools: ${j.result.tools.map((t) => t.name).join(', ')}`)
    else console.log(`#${l.id} ${l.method} -> ok ${JSON.stringify(j.result).slice(0, 120)}`)
  }
  process.exitCode = 0
} else {
  process.stderr.write(`[douyin-mcp] ${SERVER_NAME} v${SERVER_VERSION} 已启动（家=${HOME}，${TOOLS.length} 个工具）\n`)
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    const t = String(line || '').trim()
    if (!t) return
    let msg
    try { msg = JSON.parse(t) } catch { process.stderr.write('[douyin-mcp] 收到非 JSON 行，已忽略\n'); return }
    Promise.resolve(handleRequest(msg)).catch((e) => {
      process.stderr.write(`[douyin-mcp] 处理 ${msg?.method} 出错：${e?.message ?? e}\n`)
      if (msg?.id !== undefined) fail(msg.id, -32603, String(e?.message ?? e))
    })
  })
  rl.on('close', () => { process.exitCode = 0 })
}
