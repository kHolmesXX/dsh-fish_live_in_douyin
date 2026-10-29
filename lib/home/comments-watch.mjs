/**
 * lib/home/comments-watch.mjs —— 评论区「有人 @ 你」巡检（2026-10-28 fish.18）
 * ============================================================================
 * 读能力本来就有：index.js 的 `readAtMe()`（复用 notice-read.py）会返回
 *   `{kind:'@ 了我'|'回复了我的评论', nickname, content, aweme_id, comment_id, root_comment_id, video_url,…}`
 * 这里只做三件纯逻辑的事（方便单测）：
 *   ① 状态文件 `home/comments-watch.json` = {lastAt, seen:[comment_id…]}（seen 最多 200）
 *   ② 过滤「新的 + 主人发的 + kind='@ 了我'」的条目
 *   ③ 拼叫醒词（让她用 douyin_comment_reply mode:"api" 直接回那条评论）
 * ============================================================================
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** 节流默认值（settings.commentsWatch） */
export const DEFAULT_COMMENTS_WATCH = { enabled: true, everyMin: 8 }
/** seen 最多留多少个 comment_id */
export const SEEN_MAX = 200

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const readJsonSafe = (file) => { try { return JSON.parse(stripBom(readFileSync(file, 'utf8'))) } catch { return null } }

export const commentsWatchFile = (homeDir) => join(String(homeDir || ''), 'comments-watch.json')

/** 把 settings.commentsWatch 收成合法值（坏值回默认） */
export function normalizeCommentsWatch(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const n = Number(src.everyMin)
  return {
    enabled: src.enabled !== false,
    everyMin: Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 1440)) : DEFAULT_COMMENTS_WATCH.everyMin,
  }
}

function writeAtomic(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 1)}\n`, 'utf8')
    try { renameSync(tmp, file) } catch {
      try { renameSync(tmp, file) } catch (e) {
        try { rmSync(tmp, { force: true }) } catch { /* ignore */ }
        throw e
      }
    }
    return true
  } catch { return false }
}

/** 读状态；缺文件补默认（不写假 seen），坏 JSON ⇒ 默认、不覆盖 */
export function readCommentsWatch(homeDir) {
  const file = commentsWatchFile(homeDir)
  const j = readJsonSafe(file)
  if (!j) {
    const init = { lastAt: '', seen: [] }
    try {
      const raw = readFileSync(file, 'utf8')
      void raw   // 文件存在但坏 ⇒ 不覆盖
    } catch { writeAtomic(file, init) }
    return init
  }
  return {
    lastAt: typeof j.lastAt === 'string' ? j.lastAt : '',
    seen: (Array.isArray(j.seen) ? j.seen : []).map(String).filter(Boolean).slice(-SEEN_MAX),
  }
}

export function writeCommentsWatch(homeDir, patch = {}) {
  const cur = readCommentsWatch(homeDir)
  const p = patch && typeof patch === 'object' ? patch : {}
  const seen = Array.isArray(p.seen) ? p.seen.map(String).filter(Boolean) : cur.seen
  const next = { ...cur, ...p, lastAt: typeof p.lastAt === 'string' ? p.lastAt : cur.lastAt, seen: seen.slice(-SEEN_MAX) }
  writeAtomic(commentsWatchFile(homeDir), next)
  return next
}

/** 追加 seen（去重、只留最近 SEEN_MAX 个） */
export function addSeen(seen = [], ids = [], cap = SEEN_MAX) {
  const out = (Array.isArray(seen) ? seen : []).map(String).filter(Boolean)
  for (const id of Array.isArray(ids) ? ids : []) {
    const s = String(id || '').trim()
    if (!s || out.includes(s)) continue
    out.push(s)
  }
  return out.slice(-Math.max(1, Number(cap) || SEEN_MAX))
}

/** 是不是主联系人（只认配置里的 dmTo 昵称；配置空 ⇒ 不认人，避免写死任何昵称） */
export function isPrimaryOwner(nick, cfg = {}) {
  const n = String(nick || '').trim()
  if (!n) return false
  const want = String((cfg && cfg.dmTo) || '').trim()
  return Boolean(want && n === want)
}

/**
 * 从 readAtMe() 的 list 里挑出要叫醒的条目。
 * @param {Array} list readAtMe 返回的 list
 * @param {{seen?:string[], primary?:(nick:string)=>boolean, cfg?:object, limit?:number}} opt
 * @returns {{newItems:Array, others:Array}}
 */
export function pickNewAtMe(list = [], { seen = [], primary, cfg = {}, limit = 10 } = {}) {
  const seenSet = new Set((Array.isArray(seen) ? seen : []).map(String))
  const isPrimary = typeof primary === 'function' ? primary : (nick) => isPrimaryOwner(nick, cfg)
  const newItems = []
  const others = []
  for (const it of Array.isArray(list) ? list : []) {
    if (!it || typeof it !== 'object') continue
    const cid = String(it.comment_id || '').trim()
    const aweme = String(it.aweme_id || '').trim()
    if (!cid || !aweme) continue
    if (String(it.kind || '') !== '@ 了我') continue
    if (seenSet.has(cid)) continue
    if (!isPrimary(it.nickname)) {
      others.push({ nickname: String(it.nickname || ''), comment_id: cid, aweme_id: aweme })
      continue
    }
    if (newItems.length >= Math.max(1, Math.min(Number(limit) || 10, 30))) break
    newItems.push({
      nickname: String(it.nickname || '主人'),
      content: String(it.content || '').slice(0, 300),
      aweme_id: aweme,
      comment_id: cid,
      root_comment_id: String(it.root_comment_id || ''),
      video_url: String(it.video_url || `https://www.douyin.com/video/${aweme}`),
    })
  }
  return { newItems, others }
}

/* ───────────────────── 浏览器分发锁（fish.20）─────────────────────
 * 评论操作（@ 评论 / @豆包 / 回复 UI）要占无头 Chrome 几十秒；
 * 这期间群巡检如果也去开浏览器，会把视频页顶掉 ⇒ 群读先看这把锁，忙就跳过这一拍。 */
export const BROWSER_BUSY_FILE = 'browser-busy.json'
export const BROWSER_BUSY_MS = 180_000

export const browserBusyFile = (homeDir) => join(String(homeDir || ''), BROWSER_BUSY_FILE)

/** 写锁：{until, by} */
export function acquireBrowserLock(homeDir, { by = 'comment', ms = BROWSER_BUSY_MS, now = new Date() } = {}) {
  const until = new Date(now.getTime() + Math.max(1, Number(ms) || BROWSER_BUSY_MS)).toISOString()
  const ok = writeAtomic(browserBusyFile(homeDir), { until, by: String(by || 'comment') })
  return { ok, until, by: String(by || 'comment') }
}

/** 清锁（只清自己那把；by 不匹配就不动，避免把别人的锁清掉） */
export function releaseBrowserLock(homeDir, { by = 'comment' } = {}) {
  try {
    const j = readJsonSafe(browserBusyFile(homeDir))
    if (j && String(j.by || '') && by && String(j.by) !== String(by)) return false
    rmSync(browserBusyFile(homeDir), { force: true })
    return true
  } catch { return false }
}

/** 锁是否还在有效期内（坏 JSON / 过期都算不忙） */
export function isBrowserBusy(homeDir, now = new Date()) {
  const j = readJsonSafe(browserBusyFile(homeDir))
  if (!j || typeof j !== 'object') return { busy: false, until: '', by: '' }
  const until = String(j.until || '')
  const t = Date.parse(until)
  if (!Number.isFinite(t) || t <= now.getTime()) return { busy: false, until, by: String(j.by || '') }
  return { busy: true, until, by: String(j.by || '') }
}

/**
 * 叫醒词（照 Lead 定的文案；让她直接回复那条评论，别发新顶层）。
 * 兼容 camelCase 与 readAtMe 的 snake_case 字段（index.js 直接传 it）。
 */
export function renderCommentWake({
  nickname = '主人',
  awemeId = '', aweme_id = '',
  content = '',
  videoUrl = '', video_url = '',
  commentId = '', comment_id = '',
  rootCommentId = '', root_comment_id = '',
} = {}) {
  const aid = String(awemeId || aweme_id || '').trim()
  const cid = String(commentId || comment_id || '').trim()
  const root = String(rootCommentId || root_comment_id || '').trim()
  const url = String(videoUrl || video_url || '').trim() || (aid ? `https://www.douyin.com/video/${aid}` : '')
  const lines = [
    `【评论区有人 @ 你】${nickname} 在视频 ${aid} 的评论里 @ 你：「${String(content || '').slice(0, 200)}」`,
    `视频：${url}`,
    `要回就 douyin_comment_reply：{ aweme_id: "${aid}", comment_id: "${cid}"${root ? `, root_comment_id: "${root}"` : ''}, text, mode:"api" }——`,
    '这是**直接回复他的评论**（他会收到「回复了我的评论」），不要用 @ 顶层，也不要发新顶层评论。',
    /**
     * ⭐ 2026-10-28 实测：@ 通知里的 cid 常常**翻不到顶层评论列表**（热度排序/接口只给前几页），
     *   comment-api 会以 need_root 拒绝发送。这类 @ 通知的评论**绝大多数是顶层评论**，
     *   所以给它一条明确的兜底：把同一个 cid 当楼根再试一次。仍然失败就停，别硬凑。
     */
    '⚠️ 如果返回 need_root（判不出楼根）：把 root_comment_id 设成**同一个 comment_id** 再试一次——',
    '   @ 通知里的评论绝大多数是顶层评论，这样会挂成「回复他那条」。',
    '⚠️ 如果返回 too-fast / too-fast-any / cooldown（本地闸）：按里面的 wait_sec **等够秒数**再发，别连点重试——',
    '   几条评论之间至少隔 45 秒；连着点只会一直被拦（看起来像限流，其实一条都没发出去）。',
    '回一两句就够：像你自己说话（可锐评/接梗），别写成工单；看不懂视频内容就直说，别装懂。',
    '这条他 @ 你 的视频已记进你的兴趣账本（他感兴趣）。',
  ]
  return lines.join('\n')
}
