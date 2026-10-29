/**
 * lib/home/interests.mjs —— 主人的兴趣账本（2026-10-27 fish.15）
 * ============================================================================
 * 主人对「她分享的视频」的反应，直接决定下一轮筛什么（forward-pick.py 会读这个文件）：
 *
 *   `$DOUYIN_HOME/home/interests.json`
 *   {
 *     updatedAt: ISO,
 *     lastShared: { aweme_id, desc, keywords:[…], at } | null,
 *     liked:   [ { aweme_id, desc, keywords:[…], at, source:'reply'|'explicit'|'like' } ],
 *     disliked:[ { …同上 } ],
 *     keywords: { "关键词": { like:0, dislike:0, score:0 } },
 *     stats: { shared:0, liked:0, disliked:0 }
 *   }
 *
 * 规则：
 *   · recordShared()      —— 发出分享卡片后记 lastShared + stats.shared++
 *   · observeOwnerText()  —— 主人回话时判断态度：
 *       负面（不喜欢|别发|没意思|不感兴趣|无聊|难看|不要这种）⇒ disliked，关键词 dislike+1 / score-2；
 *       正面（喜欢|好看|再来|还要|这种|对味|不错|可以|爱了|多发）**且 ≤40 字** ⇒ liked，like+1 / score+2；
 *       都不是 ⇒ 不动（返回 changed:false）。
 *     同一 aweme_id 在 liked/disliked 只留一条（最新）；判定会回调 log（不偷偷记）。
 * ============================================================================
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const INTEREST_FILE = (homeDir) => join(String(homeDir || ''), 'interests.json')
const MAX_ENTRIES = 100
const MAX_KEYWORDS = 8
/** 正面判定要求「消息短」：≤40 字 */
export const POSITIVE_MAX_CHARS = 40

/** 负面：先判（「不错」「不喜欢」里都含「喜欢」，顺序不能反） */
export const NEGATIVE_RE = /(不喜欢|别发|没意思|不感兴趣|无聊|难看|不要这种)/i
export const POSITIVE_RE = /(喜欢|好看|再来|还要|这种|对味|不错|可以|爱了|多发)/i

const STOP_WORDS = new Set([
  '我们', '你们', '他们', '这个', '那个', '什么', '可以', '就是', '没有', '不是', '还是',
  '一个', '一下', '真的', '已经', '因为', '所以', '然后', '现在', '今天', '视频', '抖音',
])

const stripBom = (s) => {
  const t = String(s ?? '')
  return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t
}
const localNow = (at = new Date()) => (at instanceof Date && !Number.isNaN(at.getTime()) ? at : new Date()).toISOString()

/** 空账本（首次创建用；绝不写假数据） */
export function emptyInterests() {
  return {
    updatedAt: '',
    lastShared: null,
    liked: [],
    disliked: [],
    keywords: {},
    stats: { shared: 0, liked: 0, disliked: 0 },
  }
}

/** 归一化：坏字段回默认，保留已有数据 */
export function normalizeInterests(j) {
  const src = j && typeof j === 'object' && !Array.isArray(j) ? j : {}
  const out = emptyInterests()
  out.updatedAt = typeof src.updatedAt === 'string' ? src.updatedAt : ''
  const ls = src.lastShared
  if (ls && typeof ls === 'object' && String(ls.aweme_id || '')) {
    out.lastShared = {
      aweme_id: String(ls.aweme_id),
      desc: String(ls.desc || '').slice(0, 300),
      keywords: Array.isArray(ls.keywords) ? ls.keywords.map(String).slice(0, MAX_KEYWORDS) : [],
      at: String(ls.at || ''),
    }
  }
  const list = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => x && typeof x === 'object' && String(x.aweme_id || '')).map((x) => ({
    aweme_id: String(x.aweme_id),
    desc: String(x.desc || '').slice(0, 300),
    keywords: Array.isArray(x.keywords) ? x.keywords.map(String).slice(0, MAX_KEYWORDS) : [],
    at: String(x.at || ''),
    source: String(x.source || 'reply'),
  })).slice(0, MAX_ENTRIES)
  out.liked = list(src.liked)
  out.disliked = list(src.disliked)
  const kws = src.keywords && typeof src.keywords === 'object' && !Array.isArray(src.keywords) ? src.keywords : {}
  for (const [w, v] of Object.entries(kws)) {
    const word = String(w || '').trim()
    if (!word) continue
    out.keywords[word] = {
      like: Math.max(0, Number(v && v.like) || 0),
      dislike: Math.max(0, Number(v && v.dislike) || 0),
      score: Number(v && v.score) || 0,
    }
  }
  const st = src.stats && typeof src.stats === 'object' ? src.stats : {}
  out.stats = {
    shared: Math.max(0, Number(st.shared) || 0),
    liked: Math.max(0, Number(st.liked) || 0),
    disliked: Math.max(0, Number(st.disliked) || 0),
  }
  return out
}

function readJsonSafe(file) {
  try {
    const raw = readFileSync(file, 'utf8')
    const j = JSON.parse(stripBom(raw))
    return j && typeof j === 'object' && !Array.isArray(j) ? j : null
  } catch { return null }
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

/**
 * 读兴趣账本；文件不存在 ⇒ **创建空结构**（不写假数据）。坏 JSON ⇒ 空结构、不覆盖。
 */
export function readInterests(homeDir) {
  const file = INTEREST_FILE(homeDir)
  const j = readJsonSafe(file)
  if (!j) {
    if (!existsFile(file)) {
      const init = emptyInterests()
      writeAtomic(file, init)
      return init
    }
    return emptyInterests()
  }
  return normalizeInterests(j)
}

const existsFile = (f) => {
  try { readFileSync(f, 'utf8'); return true } catch { return false }
}

export function writeInterests(homeDir, data) {
  const next = normalizeInterests({ ...readInterests(homeDir), ...data })
  writeAtomic(INTEREST_FILE(homeDir), next)
  return next
}

/**
 * 从文案抽取关键词：`#话题` + 文本里 2–6 字的中文词，最多 8 个（话题优先）。
 * @returns {string[]}
 */
export function keywordsOf(desc) {
  const text = String(desc || '').trim()
  if (!text) return []
  const out = []
  const add = (w) => {
    const s = String(w || '').trim()
    if (!s || s.length > 12) return
    if (STOP_WORDS.has(s)) return
    if (!out.includes(s) && out.length < MAX_KEYWORDS) out.push(s)
  }
  // ① #话题（去掉尾巴标点）
  for (const m of text.matchAll(/#([^\s#]{1,20})/g)) {
    add(String(m[1]).replace(/[，。,.!！?？、:：;；]+$/g, ''))
  }
  // ② 正文里的词：只取**短段整体**（≤8 字）和英文/数字词；
  //    长中文串（没有分隔符的句子）**不硬切**——以前按 6 字硬切会切出「薅子被骗去上」「海面试记」这种垃圾词。
  const body = text.replace(/#[^\s#]+/g, ' ')
  for (const seg of body.split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)) {
    const s = String(seg || '').trim()
    if (!s) continue
    if (/^[\u4e00-\u9fa5]{2,8}$/.test(s)) { add(s); continue }
    if (/^[A-Za-z0-9][A-Za-z0-9._-]{1,15}$/.test(s)) { add(s); continue }
  }
  return out.slice(0, MAX_KEYWORDS)
}

/** 分享出去一条视频 ⇒ 更新 lastShared + stats.shared（desc 可为空，以后靠反应补） */
export function recordShared(homeDir, { aweme_id = '', desc = '', now = new Date() } = {}) {
  const id = String(aweme_id || '').trim()
  if (!id) return null
  const at = localNow(now)
  const cur = readInterests(homeDir)
  const keywords = keywordsOf(desc)
  cur.lastShared = { aweme_id: id, desc: String(desc || '').slice(0, 300), keywords, at }
  cur.stats.shared = Math.max(0, Number(cur.stats.shared) || 0) + 1
  cur.updatedAt = at
  writeAtomic(INTEREST_FILE(homeDir), cur)
  return cur.lastShared
}

/** 记关键词权重（like: +1/+2；dislike: +1/-2） */
function bumpKeywords(keywords = {}, words = [], kind) {
  for (const w of words) {
    const word = String(w || '').trim()
    if (!word) continue
    const cur = keywords[word] && typeof keywords[word] === 'object' ? keywords[word] : { like: 0, dislike: 0, score: 0 }
    if (kind === 'like') {
      cur.like = Math.max(0, Number(cur.like) || 0) + 1
      cur.score = (Number(cur.score) || 0) + 2
    } else {
      cur.dislike = Math.max(0, Number(cur.dislike) || 0) + 1
      cur.score = (Number(cur.score) || 0) - 2
    }
    keywords[word] = cur
  }
  return keywords
}

/** 把一条记录插到 liked/disliked：同一 aweme_id 只留最新（两边都先删） */
function putEntry(cur, action, entry) {
  const strip = (arr) => (Array.isArray(arr) ? arr : []).filter((x) => String(x && x.aweme_id) !== entry.aweme_id)
  cur.liked = strip(cur.liked)
  cur.disliked = strip(cur.disliked)
  const target = action === 'liked' ? 'liked' : 'disliked'
  cur[target] = [entry, ...cur[target]].slice(0, MAX_ENTRIES)
  return cur
}

/**
 * 主人回话 ⇒ 判断他对**上次分享**的态度并记账。
 * @param {{homeDir:string, text:string, now?:Date, log?:Function}} opt
 * @returns {{changed:boolean, action?:'liked'|'disliked', entry?:object, reason?:string}}
 */
export function observeOwnerText(homeDir, text, { now = new Date(), log } = {}) {
  try {
    const say = String(text || '').trim()
    if (!say) return { changed: false, reason: '空消息' }
    const cur = readInterests(homeDir)
    const last = cur.lastShared
    if (!last || !last.aweme_id) return { changed: false, reason: '还没有上次分享' }
    // ⚠️ 负面必须先判：「不错」「不喜欢」里都含「喜欢」
    const negative = NEGATIVE_RE.test(say)
    const positive = !negative && POSITIVE_RE.test(say) && say.length <= POSITIVE_MAX_CHARS
    if (!negative && !positive) return { changed: false, reason: '看不出态度' }
    const action = negative ? 'disliked' : 'liked'
    const entry = {
      aweme_id: last.aweme_id,
      desc: last.desc,
      keywords: Array.isArray(last.keywords) ? last.keywords : [],
      at: localNow(now),
      source: 'reply',
    }
    putEntry(cur, action, entry)
    cur.keywords = bumpKeywords(cur.keywords, entry.keywords, action === 'liked' ? 'like' : 'dislike')
    if (action === 'liked') cur.stats.liked = Math.max(0, Number(cur.stats.liked) || 0) + 1
    else cur.stats.disliked = Math.max(0, Number(cur.stats.disliked) || 0) + 1
    cur.updatedAt = localNow(now)
    writeAtomic(INTEREST_FILE(homeDir), cur)
    try { log?.(`兴趣账本：记下${action === 'liked' ? '喜欢' : '不喜欢'}「${String(last.desc || last.aweme_id).slice(0, 30)}」`) } catch { /* ignore */ }
    return { changed: true, action, entry }
  } catch { return { changed: false, reason: '记账出错' } }
}

/**
 * ⭐ fish.18：把一条视频记成「主人喜欢」（评论区 @ 等场景）。
 * 去重规则同 liked/disliked（同一 aweme_id 只留最新）；关键词 like+1 / score+1。
 * @param {{homeDir:string, aweme_id:string, desc?:string, source?:string, now?:Date, log?:Function}} opt
 */
export function recordLikedVideo(homeDir, { aweme_id = '', desc = '', source = 'at_comment', now = new Date(), log } = {}) {
  try {
    const id = String(aweme_id || '').trim()
    if (!id) return null
    const cur = readInterests(homeDir)
    const keywords = keywordsOf(desc)
    const entry = { aweme_id: id, desc: String(desc || '').slice(0, 300), keywords, at: localNow(now), source: String(source || 'at_comment') }
    putEntry(cur, 'liked', entry)
    for (const w of keywords) {
      const word = String(w || '').trim()
      if (!word) continue
      const k = cur.keywords[word] && typeof cur.keywords[word] === 'object' ? cur.keywords[word] : { like: 0, dislike: 0, score: 0 }
      k.like = Math.max(0, Number(k.like) || 0) + 1
      k.score = (Number(k.score) || 0) + 1
      cur.keywords[word] = k
    }
    cur.stats.liked = Math.max(0, Number(cur.stats.liked) || 0) + 1
    cur.updatedAt = localNow(now)
    writeAtomic(INTEREST_FILE(homeDir), cur)
    try { log?.(`兴趣账本：记下喜欢「${String(desc || id).slice(0, 30)}」（${source}）`) } catch { /* ignore */ }
    return { changed: true, entry }
  } catch { return null }
}

/** 关键词排行（score 高的在前，最多 n 个） */
export function topKeywords(homeDir, n = 8) {
  try {
    const cur = readInterests(homeDir)
    const list = Object.entries(cur.keywords || {}).map(([word, v]) => ({ word, score: Number((v && v.score) || 0) }))
    list.sort((a, b) => b.score - a.score || a.word.localeCompare(b.word, 'zh'))
    return list.slice(0, Math.max(1, Math.min(Number(n) || 8, 50)))
  } catch { return [] }
}

/** ⭐ fish.20：最近 liked 条目（提示词「兴趣账本动态下发」用；只读，不改逻辑） */
export function recentLiked(homeDir, n = 3) {
  try {
    const cur = readInterests(homeDir)
    const list = Array.isArray(cur.liked) ? [...cur.liked] : []
    // liked 可能是"新在前"也可能是"旧在前"（历史版本不一）⇒ 按 at 排序，取最近 n 条
    list.sort((a, b) => {
      const ta = Date.parse(String((a && a.at) || '')) || 0
      const tb = Date.parse(String((b && b.at) || '')) || 0
      return tb - ta
    })
    return list.slice(0, Math.max(1, Math.min(Number(n) || 3, 10)))
      .map((x) => ({ aweme_id: String(x.aweme_id || ''), desc: String(x.desc || ''), keywords: Array.isArray(x.keywords) ? x.keywords : [], at: String(x.at || '') }))
  } catch { return [] }
}

/** 快照用：{stats, topKeywords, lastShared:{aweme_id,desc}} */
export function interestsSummary(homeDir) {
  try {
    const cur = readInterests(homeDir)
    const last = cur.lastShared
    return {
      stats: { ...cur.stats },
      topKeywords: topKeywords(homeDir, 8),
      lastShared: last ? { aweme_id: last.aweme_id, desc: last.desc } : null,
    }
  } catch {
    return { stats: { shared: 0, liked: 0, disliked: 0 }, topKeywords: [], lastShared: null }
  }
}
