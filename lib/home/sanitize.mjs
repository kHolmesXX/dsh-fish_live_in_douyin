/**
 * lib/home/sanitize.mjs —— 对外发送前的**表达清理**（2026-10-28 主人定稿）
 * ============================================================================
 * 起因：主人说「不要老是提到自己的尾巴什么动作，有点太 ai 了」。
 *   提示词（persona 表达纪律 / chat-style）已经写了禁止，但她会话历史里全是旧风格，
 *   模型会顺着上下文继续带「（尾巴晃了晃）」——**光靠提示词管不住**。
 *   所以再加一层**确定性清理**：任何要发出去的话，发之前把「（…尾巴…）」这类括号动作剥掉。
 *
 * 清理范围（保守，只动明显的）：
 *   · 括号里带身体关键词的整段：`（尾巴摇了摇）` `(呆毛翘起来)` `（耳朵抖了抖）` `（鲸尾拍地）`
 *   · 括号里的「tail 也收起来了」这类带 tail 的
 * 不清理：正常括号（如「（上海）」「（2026）」）、正文里的隐喻。
 */

const BODY_WORDS = ['尾巴', '尾巴尖', '鲸尾', '尾鳍', '呆毛', '耳鳍', '耳朵', '鲸耳', 'tail']

/** 把「（…身体动作…）」整段去掉；返回清理后的文本 */
export function stripBodyActions(text) {
  let t = String(text ?? '')
  if (!t) return t
  // ① 中文/英文括号里含身体关键词（允许中间夹 0–30 字）
  for (const w of BODY_WORDS) {
    const esc = w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`[（(][^（）()]{0,30}?${esc}[^（）()]{0,30}?[)）]`, 'g')
    t = t.replace(re, '')
  }
  // ② 收尾清理：多余空格 / 空行 / 括号孤零零
  t = t
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+([，。！？；：、])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[，。！？；：、\s]+/, '')
    .trim()
  return t
}

/** 数组版（连发消息用） */
export function stripBodyActionsAll(list) {
  return (Array.isArray(list) ? list : []).map((x) => stripBodyActions(x)).filter((x) => String(x || '').trim())
}
