/**
 * lib/home/persona.mjs —— 她的家：人设 / 我是谁 / 记忆索引（2026-10-27 阶段 3b 外移）
 * ============================================================================
 * 从 index.js 原样搬出来的纯 fs 逻辑，**不依赖 ctx / 宿主**，升级时只需要重打 import 行。
 *
 *   ① readHomePersona(file)            解析 `home/persona.md` 六层（## 标题分段）
 *   ② renderHomePersona(layers)        照 dsh-world 的写法拼成一段人设正文
 *   ③ readHomeSelf(file, max=4000)     她自己写的「我是谁」（带 <我是谁.md> 包裹 + 截断提示）
 *   ④ renderHomeMemoryIndex({stateDir, homeDir})
 *                                      记忆只给**路径 + 规矩**，不塞正文 —— 想不起就自己翻，别凭印象编
 *
 * ⚠️ `$DOUYIN_HOME/persona.md` 那份**不动**（主人跟别的程序共用），这里只读 home/ 那份。
 * ============================================================================
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 读六层人设。文件不存在 / 读不出 / 一层都没有 ⇒ null（交给调用方决定退回哪一份）。
 * 分段规则：`## 名字` 这种二级标题开始一层，正文到下一个 `##` 之前（顺序不限）。
 */
export function readHomePersona(file) {
  try {
    if (!existsSync(file)) return null
    const layers = {}
    let cur = ''
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^##\s+(.+?)\s*$/.exec(line)
      if (m) { cur = m[1].trim(); layers[cur] = ''; continue }
      if (cur) layers[cur] += `${line}\n`
    }
    for (const k of Object.keys(layers)) layers[k] = layers[k].trim()
    return Object.keys(layers).length ? layers : null
  } catch { return null }
}

/** 照 dsh-world 的写法：开头「我是X。她是谁」，再依次性格/说话方式/愿景，最后补充。 */
export function renderHomePersona(layers) {
  if (!layers) return ''
  const name = String(layers['名字'] || '').trim()
  const who = String(layers['她是谁'] || '').trim()
  const opening = [name ? `我是${name}。` : '', who].filter(Boolean).join('')
  const body = ['性格', '说话方式', '愿景'].map((k) => (String(layers[k] || '').trim() ? `# ${k}\n${layers[k].trim()}` : '')).filter(Boolean)
  const extra = String(layers['补充'] || '').trim()
  return [opening, ...body, extra].filter(Boolean).join('\n\n')
}

/** 她自己写的「我是谁」。没有/空 ⇒ ''；超长截断并明说后面还有多少字没读进来。 */
export function readHomeSelf(file, maxChars = 4000) {
  try {
    if (!existsSync(file)) return ''
    const t = readFileSync(file, 'utf8').trim()
    if (!t) return ''
    const capped = t.length > maxChars
    return `<我是谁.md>\n${t.slice(0, maxChars)}\n</我是谁.md>` + (capped ? `\n（后面还有 ${t.length - maxChars} 字没读进来；挑最要紧的留下吧。）` : '')
  } catch { return '' }
}

/** 记忆只给**路径 + 规矩**，不塞正文 —— 想不起就自己翻，别凭印象编。 */
export function renderHomeMemoryIndex({ stateDir, homeDir } = {}) {
  const p = (x) => join(stateDir, x)
  return [
    '## 你的记忆（都在本机，需要时自己读）',
    `- 聊天原文按天存档：${p('memory')}\\archive\\YYYY-MM-DD.jsonl（一行一句，含 who / from / text）`,
    `- 你的日记：${p('memory')}\\diary\\YYYY-MM-DD.md`,
    `- 关系档案（每个人）：${p('memory')}\\profile-*.json —— stage（生/熟/自己人）、印象、喜好、忌讳、承诺`,
    `- 群印象：${p('memory')}\\group-*.json`,
    // ⭐ fish.16：私信里的图片/表情包会下载到 home/inbox/（看不到就直说，别装懂）
    `- 他发的图片/表情包会存到 ${join(homeDir, 'inbox')}，叫你看的时候用 read_image 打开看，看不出就说看不出。`,
    // ⭐ fish.15：主人的兴趣账本（他喜欢/不喜欢过的视频与关键词；分享前先看一眼）
    `- 主人的兴趣账本：${join(homeDir, 'interests.json')} —— 他喜欢过/不喜欢过的视频和关键词都在这里；每轮分享前先看一眼（提示词里已经要求「命中兴趣的优先发」）。`,
    // ⭐ fish.18：评论区 @ 会被叫醒；回就用 api 直接回那条评论（别发新顶层）
    '- 评论区：有人（尤其主人）在视频评论里 @ 你，会被叫醒；要回就用 `douyin_comment_reply` 的 `mode:"api"` 直接回复那条评论，**不要发新的顶层评论**。',
    '- 主人在评论区 @ 你看某条视频 = 他对那条视频感兴趣，插件会记进兴趣账本；你也可以用 `douyin_comments` 看看这条视频下大家在说什么再回。',
    // ⭐ fish.19：@豆包 异步总结（每天 ≤2 次、同一视频一次；发完不用等，回了才叫你）
    '- @豆包 只在真的需要它总结时才用（每天最多 2 次、同一视频一次）；发完就不用等——豆包回没回，插件会去互动消息里看，回了才叫你。',
    '- 发 @ 评论可能被审核/不显示；工具返回 `submitted_unverified` 就是"可能没发出来"，别当已发。',
    // ⭐ fish.10 B：群里说话通道（真 @ 可选；网页端发群可能不分发，别刷屏）
    '- 群里可以说话：`douyin_group_say`（group=群名，text≤200 字，可选 `at`=群友昵称 真 @ 他）；群里人少、都是自己人，说话自然点，别刷屏。',
    // ⭐ fish.14：群友发视频 —— 两档看 + 看不清就 delegate 群助手（不再接外部 AI）
    '- 群友发视频：先用 `douyin_group_video action:"look"` 截图看。**>30 秒且你自己想看/有人@你 → 3 张（10%/50%/90%）；否则只有第 5 秒一张**。看不清就 `action:"delegate"` @群聊小助手 让它总结（同一条 24h 只喊一次）。',
    '（`action:"summarize"` 已停用——不接外部 AI；想让它总结就用 delegate 喊群助手。）',
    `- 我是谁：${p(join('home', 'whoami.md'))}（你自己写，可以随时改）`,
    '想不起以前的事，就用工具翻（douyin_archive / douyin_relation / douyin_diary），**别凭印象编**。',
    '日记每天 23:00 自己写；档案里 stage=熟/自己人 的人才可以用打趣暧昧的语气，生人照旧。',
    // ⭐ fish.2：近期记忆块（lib/home/memory.mjs）的两条路径规矩
    '- 近期记忆：最近 2 天的原文（每人最近几条）已经放在你的系统提示里；每晚 23:00 还会把「要接着聊的事」压进 memory/recent-summary.md —— 接着聊就行，不用重复问。',
    '- 更早的事：用 douyin_archive（关键词 / 日期）翻，别凭印象编。',
    // ⭐ fish.3：世界提示词 + 世界暂停（lib/home/world.mjs）
    `你的世界提示词：${join(homeDir, 'world.md')} —— 你可以自己改（≤4000 字），它排在人设之前；改完下次组装生效。`,
    '世界暂停时你不会醒：主人暂停后你就歇着，恢复后照常。',
    '### 你自己的时间',
    '你可以给自己定下一件事：`douyin_plan_next`（at="11:00" 或 after_minutes=30，note 写要做什么）；`douyin_check_plan` 看还有没有；`douyin_cancel_plan` 取消。',
    '只存一个待办，定新的替掉旧的；到点插件会来叫你，并告诉你这期间转达了几条私信、跑了几轮值班。什么都不定，第二天 09:00 会兜底叫你一次。',
    // ⭐ fish.7 B：跟 renderIdleInvite 同一份「家里能做的事」清单（她常驻看得到）
    '**你的时间清单**（挑一件，也可以什么都不做）：',
    '· 去房间随便弄点什么（建个文件、写张清单、整理一下）',
    '· 写点日记草稿 / 翻某天的归档看看那时候说过什么',
    '· 给谁补一条印象（memory/profile-*.json）',
    '· 给主人准备一句想说的话（想发就 douyin_reach_out，每天 3 条）',
    '· 挑一条你觉得他会喜欢的视频，用分享卡片发给他',
    '· 学点新东西：翻翻评论、记一个新梗',
    '想要时间就自己开口：`douyin_reach_out`（主动发一条私信，只能找 stage=熟/自己人，每天 3 条，00:00–08:00 不发）；',
    '想分享视频给他就用 `douyin_share_card`（先卡片、再补一句理由），这也算你今天主动开口的一次。',
    '### 你的房间和台账',
    `- 房间：${join(homeDir, 'room')} —— 里面的东西归你，随便建、随便整理；房间外的文件、装软件、花钱、以主人名义对外说话，**先问他**。`,
    `- 活动台账：${join(homeDir, 'journal.jsonl')} —— 做完一件事就用 \`douyin_note_activity\` 记一行（"我刚翻了三天的档案，把李四的喜好补上了"）。`,
    '- 叫醒你的那句话会拿这份台账对账：插件数转达/轮次，你自己记做了什么 —— 谁都别糊弄谁。',
    '想找他的话用 `douyin_reach_out`（主动发一条私信）：只能找 stage=熟/自己人，每天最多 3 条，00:00–08:00 不发。',
  ].join('\n')
}
