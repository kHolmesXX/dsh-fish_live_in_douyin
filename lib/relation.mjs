/**
 * lib/relation.mjs —— 「她记得人」那一层（2026-10-27）
 * ============================================================================
 * 参考 dsh-world 的记忆设计（原文按天归档 + 每人档案 + 日记/自述），这里先做 P0：
 *
 *   ① 归档：`memory/archive/YYYY-MM-DD.jsonl`，一天一个文件，一行一句原话。
 *      私信和群都写进去；同一条（渠道|谁|谁发的|正文）只留一份。
 *      → 为什么要它：dm-<sec_uid>.json 只留最近 80 条，再往前就永久丢了；
 *        有了按天归档，想不起以前的事能翻回来（插件不主动喂，需要时再读）。
 *
 *   ② 每人档案：`memory/profile-<sec_uid>.json`
 *      { nick, call, stage: 生|熟|自己人, impression, likes[], avoid[],
 *        lastTopic, promises[], facts[], firstSeenAt, lastSeenAt, rounds }
 *      → 「记住一部分人」靠的不是记住所有原话，而是**阶段 + 雷点 + 上次聊到哪**。
 *
 *   ③ 群印象：`memory/group-<群名>.json`
 *      { title, impression, members: { 名字: { impression, quotes[], seen } } }
 *      → 群里人不多、都是自己人：只留大概印象，不逐句记忆。
 *        名字来源只能是消息里出现的 @昵称 / 「名字：」前缀 —— 拿不到就不硬猜。
 *
 * ⚠️ 全部是本机文件，不上传；写失败一律吞掉（记忆坏了不能影响回话）。
 * ============================================================================
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const MAX_TEXT = 200
const MAX_FACTS = 20
const MAX_QUOTES = 12

const safeKey = (s) => String(s || '').replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 60) || 'unknown'
const dayOf = (iso) => {
  const t = iso ? new Date(iso) : new Date()
  if (Number.isNaN(t.getTime())) return new Date().toISOString().slice(0, 10)
  // 北京时间
  const bj = new Date(t.getTime() + 8 * 3600_000)
  return bj.toISOString().slice(0, 10)
}

function ensure(dir) {
  try { if (!existsSync(dir)) mkdirSync(dir, { recursive: true }) } catch { /* 建不了就算了 */ }
}

function readJson(file, fallback) {
  try { return JSON.parse(readFileSync(file, 'utf8')) } catch { return fallback }
}

function writeJson(file, value) {
  try {
    ensure(dirname(file))
    writeFileSync(file, JSON.stringify(value, null, 1), 'utf8')
    return true
  } catch { return false }
}

export const memoryRoot = (home) => join(home, 'memory')
export const archiveDir = (home) => join(memoryRoot(home), 'archive')

/* ───────────────────────────── ① 归档 ───────────────────────────── */

const lineKey = (x) => createHash('sha1')
  .update([x.channel || '', x.who || '', x.from || '', String(x.text || '').slice(0, 120)].join('|'))
  .digest('hex')

/**
 * 把一批消息追加进当天的归档。按「渠道|谁|谁发的|前120字」去重，同一批里重复的也去掉。
 * items: [{ at?, channel: 'dm'|'group', who, from: 'me'|'them', text, kind? }]
 */
export function archiveDay(home, items = []) {
  if (!Array.isArray(items) || !items.length) return 0
  const dir = archiveDir(home)
  ensure(dir)
  const byDay = new Map()
  for (const it of items) {
    const text = String(it?.text || '').trim()
    if (!text) continue
    const day = dayOf(it.at)
    if (!byDay.has(day)) byDay.set(day, [])
    byDay.get(day).push({ ...it, text: text.slice(0, MAX_TEXT), _k: lineKey(it) })
  }
  let added = 0
  for (const [day, list] of byDay) {
    const file = join(dir, `${day}.jsonl`)
    const seen = new Set()
    try {
      if (existsSync(file)) {
        for (const line of readFileSync(file, 'utf8').split('\n')) {
          if (!line.trim()) continue
          try { seen.add(lineKey(JSON.parse(line))) } catch { /* 半行坏行跳过 */ }
        }
      }
    } catch { /* 读不出来就当空的 */ }
    const out = []
    for (const it of list) {
      if (seen.has(it._k)) continue
      seen.add(it._k)
      delete it._k
      out.push(JSON.stringify({ at: it.at || new Date().toISOString(), channel: it.channel || '', who: it.who || '', from: it.from || '', kind: it.kind || 'text', text: it.text }))
      added += 1
    }
    if (out.length) { try { appendFileSync(file, out.join('\n') + '\n', 'utf8') } catch { /* 写不进就算了 */ } }
  }
  return added
}

/** 归档里按关键词/日期翻（给工具用）。q 可以空 = 只看那天。 */
export function searchArchive(home, { q = '', date = '', limit = 40 } = {}) {
  const dir = archiveDir(home)
  const files = (() => {
    try {
      const all = readdirSync(dir).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().reverse()
      return date ? all.filter((n) => n.startsWith(date)) : all
    } catch { return [] }
  })()
  const kw = String(q || '').trim()
  const hits = []
  for (const f of files) {
    let lines = []
    try { lines = readFileSync(join(dir, f), 'utf8').split('\n') } catch { continue }
    for (const line of lines) {
      if (!line.trim()) continue
      if (kw && !line.includes(kw)) continue
      try { hits.push(JSON.parse(line)) } catch { /* 跳过坏行 */ }
      if (hits.length >= Math.max(1, Math.min(Number(limit) || 40, 200))) return hits
    }
    if (!kw && hits.length) return hits   // 只给日期时，返回最近那一天就够
  }
  return hits
}

/* ───────────────────────────── ② 每人档案 ───────────────────────────── */

const profileFile = (home, secUid) => join(memoryRoot(home), `profile-${safeKey(secUid)}.json`)

const EMPTY_PROFILE = {
  sec_uid: '', nick: '', call: '', stage: '生', impression: '',
  likes: [], avoid: [], lastTopic: '', promises: [], facts: [],
  firstSeenAt: '', lastSeenAt: '', rounds: 0,
}

export function loadProfile(home, secUid) {
  const j = readJson(profileFile(home, secUid), {})
  return { ...EMPTY_PROFILE, ...j, sec_uid: String(secUid || j.sec_uid || '') }
}

export function updateProfile(home, secUid, patch = {}) {
  if (!secUid) return null
  const cur = loadProfile(home, secUid)
  const next = { ...cur }
  for (const k of ['nick', 'call', 'stage', 'impression', 'lastTopic']) {
    if (patch[k] !== undefined && String(patch[k]).trim()) next[k] = String(patch[k]).trim().slice(0, 200)
  }
  for (const k of ['likes', 'avoid', 'promises', 'facts']) {
    if (Array.isArray(patch[k])) {
      const set = [...new Set([...(cur[k] || []), ...patch[k].map((x) => String(x).trim().slice(0, 80)).filter(Boolean)])]
      next[k] = k === 'facts' ? set.slice(0, MAX_FACTS) : set.slice(0, 20)
    }
  }
  if (patch.stage && !['生', '熟', '自己人'].includes(next.stage)) next.stage = '生'
  writeJson(profileFile(home, secUid), next)
  return next
}

/** 读到一批私信后顺手更新：最后说话时间、最后话题、轮数。不猜内容。 */
export function touchProfile(home, secUid, { nick = '', msgs = [] } = {}) {
  if (!secUid) return null
  const cur = loadProfile(home, secUid)
  const now = new Date().toISOString()
  // ⭐ 只拿「对方说的最后一条」当 lastTopic —— 否则会被值班轮发出去的卡片文案污染
  const last = Array.isArray(msgs) ? [...msgs].reverse().find((m) => m && m.from === 'them' && String(m.text || '').trim()) : null
  const next = {
    ...cur,
    sec_uid: String(secUid),
    nick: cur.nick || String(nick || ''),
    firstSeenAt: cur.firstSeenAt || now,
    lastSeenAt: now,
    rounds: (Number(cur.rounds) || 0) + 1,
  }
  if (last && String(last.text || '').trim()) next.lastTopic = String(last.text).trim().slice(0, 60)
  writeJson(profileFile(home, secUid), next)
  return next
}

/** 给转达用的一段人话（空档案就返回空串，绝不编）。 */
export function renderPersonContext(p, { maxFacts = 8 } = {}) {
  if (!p || !p.sec_uid) return ''
  const bits = []
  if (p.call || p.nick) bits.push(`他叫「${p.call || p.nick}」，关系：${p.stage || '生'}`)
  if (p.impression) bits.push(`印象：${p.impression}`)
  if (p.likes?.length) bits.push(`喜欢：${p.likes.slice(0, 6).join('、')}`)
  if (p.avoid?.length) bits.push(`别提：${p.avoid.slice(0, 6).join('、')}`)
  if (p.lastTopic) bits.push(`上次说到：${p.lastTopic}`)
  if (p.promises?.length) bits.push(`答应过：${p.promises.slice(0, 4).join('；')}`)
  const facts = (p.facts || []).slice(0, maxFacts)
  if (facts.length) bits.push(`记得的事：${facts.join('；')}`)
  if (!bits.length) return ''
  const when = p.lastSeenAt ? new Date(p.lastSeenAt).toLocaleString('zh-CN', { hour12: false }) : ''
  return `【关系档案】${bits.join('；')}${when ? `（最近一次接触：${when}）` : ''}`
}

/* ───────────────────────────── ③ 群印象 ───────────────────────────── */
const groupFile = (home, title) => join(memoryRoot(home), `group-${safeKey(title)}.json`)

export function loadGroup(home, title) {
  const j = readJson(groupFile(home, title), {})
  return { title: String(title || ''), impression: '', members: {}, updatedAt: '', ...j }
}

export function updateGroup(home, title, patch = {}) {
  if (!title) return null
  const cur = loadGroup(home, title)
  const next = { ...cur, title: String(title), updatedAt: new Date().toISOString() }
  if (patch.impression !== undefined && String(patch.impression).trim()) next.impression = String(patch.impression).trim().slice(0, 300)
  // members: { 名字: { impression?, quote? } }
  if (patch.members && typeof patch.members === 'object') {
    next.members = { ...(cur.members || {}) }
    for (const [name, v] of Object.entries(patch.members)) {
      const key = String(name || '').trim().slice(0, 40)
      if (!key) continue
      const prev = next.members[key] || { impression: '', quotes: [], seen: 0 }
      const merged = { ...prev, seen: (Number(prev.seen) || 0) + 1 }
      if (v?.impression && String(v.impression).trim()) merged.impression = String(v.impression).trim().slice(0, 160)
      if (v?.quote && String(v.quote).trim()) merged.quotes = [...(prev.quotes || []), String(v.quote).trim().slice(0, 120)].slice(-MAX_QUOTES)
      next.members[key] = merged
    }
  }
  writeJson(groupFile(home, title), next)
  return next
}

/** 从群消息里能确定的名字：@昵称 / 「名字：」/ 「名字说」这类。拿不到就返回空。 */
export function extractMentions(text) {
  const t = String(text || '')
  const names = new Set()
  for (const m of t.matchAll(/@([^\s@:：，,。]{1,20})/g)) names.add(m[1].trim())
  const head = /^([^\s:：]{1,12})[:：]/.exec(t)
  if (head) names.add(head[1].trim())
  return [...names].filter((n) => n && n !== '所有人')
}

/** 给转达用的一段群印象（空就返回空串）。 */
export function renderGroupContext(g) {
  if (!g) return ''
  const bits = []
  if (g.impression) bits.push(`群印象：${g.impression}`)
  const members = Object.entries(g.members || {}).filter(([, v]) => v?.impression)
  if (members.length) {
    bits.push('群里的人：' + members.slice(0, 8).map(([n, v]) => `${n}（${v.impression}）`).join('；'))
  }
  if (!bits.length) return ''
  return `【群档案】${bits.join('｜')}`
}

/* ───────────────────────────── ④ 列出来（工具用） ───────────────────────────── */

export function listProfiles(home) {
  const dir = memoryRoot(home)
  let names = []
  try { names = readdirSync(dir).filter((n) => /^profile-.*\.json$/.test(n)) } catch { return [] }
  return names.map((n) => readJson(join(dir, n), null)).filter(Boolean)
    .map((p) => ({ sec_uid: p.sec_uid, nick: p.nick, call: p.call, stage: p.stage, impression: p.impression, lastSeenAt: p.lastSeenAt, rounds: p.rounds }))
    .sort((a, b) => String(b.lastSeenAt || '').localeCompare(String(a.lastSeenAt || '')))
}

export function listGroups(home) {
  const dir = memoryRoot(home)
  let names = []
  try { names = readdirSync(dir).filter((n) => /^group-.*\.json$/.test(n)) } catch { return [] }
  return names.map((n) => readJson(join(dir, n), null)).filter(Boolean)
    .map((g) => ({ title: g.title, impression: g.impression, members: Object.keys(g.members || {}), updatedAt: g.updatedAt }))
}

/** 按昵称找档案（找不到返回 null）。 */
export function findProfileByNick(home, nick) {
  const want = String(nick || '').trim()
  if (!want) return null
  return listProfiles(home).find((p) => p.nick === want || p.call === want) || null
}

/* ───────────────────────────── ⑤ 日记（P1：一天一篇） ───────────────────────────── */

export const diaryRoot = (home) => join(memoryRoot(home), 'diary')

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function diaryDates(home) {
  try {
    return readdirSync(diaryRoot(home))
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.md$/.test(n))
      .map((n) => n.slice(0, 10)).sort().reverse()
  } catch { return [] }
}

export function readDiary(home, date) {
  const d = String(date || '').trim()
  if (!DATE_RE.test(d)) return ''
  try { return readFileSync(join(diaryRoot(home), `${d}.md`), 'utf8') } catch { return '' }
}

/** 写日记：append=true 往后接（一天可写几段），否则覆盖。日期只认 YYYY-MM-DD，防路径穿越。 */
export function writeDiary(home, date, text, { append = true } = {}) {
  const d = String(date || '').trim()
  if (!DATE_RE.test(d)) return { ok: false, error: '日期要 YYYY-MM-DD' }
  const body = String(text || '').trim()
  if (!body) return { ok: false, error: '空日记不写' }
  const dir = diaryRoot(home)
  ensure(dir)
  const file = join(dir, `${d}.md`)
  try {
    if (append && existsSync(file)) appendFileSync(file, `\n\n---\n\n${body}\n`, 'utf8')
    else writeFileSync(file, `# ${d} 小鱼的关系日记\n\n${body}\n`, 'utf8')
    return { ok: true, file, date: d }
  } catch (e) { return { ok: false, error: String(e?.message ?? e) } }
}

/** 转达时带最近几天的日记（每天截一段），让她接得上"上次说过什么"。 */
export function renderDiaryContext(home, days = 2) {
  const dates = diaryDates(home).slice(0, Math.max(0, days))
  if (!dates.length) return ''
  const parts = dates.map((d) => {
    const t = readDiary(home, d).replace(/^#.*$/m, '').trim().slice(0, 400)
    return t ? `${d}：${t}` : ''
  }).filter(Boolean)
  return parts.length ? `【最近日记】\n${parts.join('\n')}` : ''
}

/* ═══════════════════════ fish.6：按保留策略清理记忆 ═══════════════════════ */

const DAY_MS = 86_400_000
const clampDays = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.max(1, Math.min(Math.trunc(n), 3650)) : fb }
const clampCount = (v, fb) => { const n = Number(v); return Number.isFinite(n) ? Math.max(10, Math.min(Math.trunc(n), 2000)) : fb }

/**
 * 清理记忆（由 lib/home/settings.mjs 的 pruneByRetention 调；24h 节流在那边）。
 *   · memory/archive/<日期>.jsonl：日期早于 archiveDays ⇒ 删整份
 *   · memory/diary/<日期>.md     ：日期早于 diaryDays  ⇒ 删整份
 *   · memory/dm-*.json           ：每人只留最近 dmKeepPerPerson 条（裁尾部）
 * 坏文件只跳过、不删除。返回 {files, lines}（lines = 裁掉的 dm 条数）。
 */
export function pruneMemory({ stateDir, retention = {}, now = new Date(), log = () => {} } = {}) {
  const home = String(stateDir || '')
  if (!home) return { files: 0, lines: 0 }
  const archiveDays = clampDays(retention.archiveDays, 30)
  const diaryDays = clampDays(retention.diaryDays, 365)
  const dmKeep = clampCount(retention.dmKeepPerPerson, 80)
  const nowMs = now instanceof Date && !Number.isNaN(now.getTime()) ? now.getTime() : Date.now()
  const cutoffArchive = nowMs - archiveDays * DAY_MS
  const cutoffDiary = nowMs - diaryDays * DAY_MS
  let files = 0
  let lines = 0

  // ① archive：按文件名日期整份删
  try {
    for (const name of readdirSync(archiveDir(home))) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(name)) continue
      const t = Date.parse(`${name.slice(0, 10)}T00:00:00`)
      if (!Number.isFinite(t) || t >= cutoffArchive) continue
      try { rmSync(join(archiveDir(home), name), { force: true }); files += 1 } catch { /* 单份删不掉就跳过 */ }
    }
  } catch { /* 没有 archive/ 就算了 */ }

  // ② diary：按文件名日期整份删
  try {
    for (const name of readdirSync(diaryRoot(home))) {
      if (!/^\d{4}-\d{2}-\d{2}\.md$/.test(name)) continue
      const t = Date.parse(`${name.slice(0, 10)}T00:00:00`)
      if (!Number.isFinite(t) || t >= cutoffDiary) continue
      try { rmSync(join(diaryRoot(home), name), { force: true }); files += 1 } catch { /* 单份删不掉就跳过 */ }
    }
  } catch { /* 没有 diary/ 就算了 */ }

  // ③ dm：每人只留最近 dmKeep 条（messages 是按时间旧→新的）
  try {
    for (const name of readdirSync(memoryRoot(home))) {
      if (!/^dm-.*\.json$/.test(name)) continue
      const file = join(memoryRoot(home), name)
      const j = readJson(file, null)
      if (!j || typeof j !== 'object' || !Array.isArray(j.messages) || j.messages.length <= dmKeep) continue
      const removed = j.messages.length - dmKeep
      const next = { ...j, messages: j.messages.slice(-dmKeep), updatedAt: j.updatedAt || '' }
      try {
        writeFileSync(file, JSON.stringify(next, null, 1), 'utf8')
        lines += removed
      } catch { /* 单个写不进就跳过 */ }
    }
  } catch { /* 没有 memory/ 就算了 */ }

  return { files, lines }
}
