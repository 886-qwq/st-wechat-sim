export const DEFAULT_SETTINGS = Object.freeze({
  maxCharacters: 55,
  maxBubbles: 3,
  historyLimit: 30,
  mainChatLimit: 16,
  useMainChatContext: true,
  persistHistory: true,
  assistantDelayMs: 420,
});

const NARRATION_PATTERNS = [
  /^\s*[*＊][^*＊\n]{1,120}[*＊]\s*$/gm,
  /^\s*[（(][^）)\n]{0,120}[）)]\s*$/gm,
  /^\s*[\[【](?:旁白|动作|心声|场景|叹气|笑)[^\]】]*[\]】].*$/gm,
];

export function toPositiveInteger(value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export function normalizeSettings(settings = {}) {
  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    maxCharacters: toPositiveInteger(
      settings.maxCharacters,
      DEFAULT_SETTINGS.maxCharacters,
      12,
      300,
    ),
    maxBubbles: toPositiveInteger(
      settings.maxBubbles,
      DEFAULT_SETTINGS.maxBubbles,
      1,
      8,
    ),
    historyLimit: toPositiveInteger(
      settings.historyLimit,
      DEFAULT_SETTINGS.historyLimit,
      4,
      200,
    ),
    mainChatLimit: toPositiveInteger(
      settings.mainChatLimit,
      DEFAULT_SETTINGS.mainChatLimit,
      0,
      100,
    ),
    useMainChatContext: Boolean(
      settings.useMainChatContext ?? DEFAULT_SETTINGS.useMainChatContext,
    ),
    persistHistory: Boolean(
      settings.persistHistory ?? DEFAULT_SETTINGS.persistHistory,
    ),
    assistantDelayMs: toPositiveInteger(
      settings.assistantDelayMs,
      DEFAULT_SETTINGS.assistantDelayMs,
      0,
      5000,
    ),
  };
}

export function characterDisplayName(character, fallback = "角色") {
  return String(character?.name || character?.data?.name || fallback).trim() || fallback;
}

export function characterKey(character, fallback = "unknown-character") {
  return String(character?.avatar || character?.name || fallback).trim() || fallback;
}

export function visibleCharacterCount(text) {
  return Array.from(String(text ?? "").replace(/\s/g, "")).length;
}

function normalizeContextMessage(message) {
  if (!message || typeof message !== "object" || message.is_system) {
    return null;
  }

  const role = message.is_user ? "用户" : "角色";
  const text = String(message.mes ?? message.content ?? "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) {
    return null;
  }

  return `${role}：${text.slice(0, 500)}`;
}

function formatWeChatHistory(history, limit) {
  return (Array.isArray(history) ? history : [])
    .filter((message) => message && ["user", "assistant"].includes(message.role))
    .slice(-limit)
    .map((message) => {
      const role = message.role === "user" ? "用户" : "角色";
      const text = String(message.content ?? "").replace(/\s+/g, " ").trim();
      return text ? `${role}：${text.slice(0, 500)}` : null;
    })
    .filter(Boolean)
    .join("\n");
}

function formatMainChat(messages, limit) {
  if (!limit) {
    return "";
  }

  return (Array.isArray(messages) ? messages : [])
    .map(normalizeContextMessage)
    .filter(Boolean)
    .slice(-limit)
    .join("\n");
}

function cardField(character, fieldName) {
  const value = character?.[fieldName] ?? character?.data?.[fieldName] ?? "";
  return String(value).trim();
}

export function buildWeChatPrompt({
  character,
  userName = "用户",
  history = [],
  mainChat = [],
  settings = DEFAULT_SETTINGS,
  userMessage = "",
  externalMemory = "",
}) {
  const safeSettings = normalizeSettings(settings);
  const charName = characterDisplayName(character);
  const description = cardField(character, "description");
  const personality = cardField(character, "personality");
  const scenario = cardField(character, "scenario");
  const examples = cardField(character, "mes_example");
  const systemPrompt = cardField(character, "system_prompt");
  const postHistoryInstructions = cardField(character, "post_history_instructions");
  const recentWeChat = formatWeChatHistory(history, safeSettings.historyLimit);
  const recentMainChat = safeSettings.useMainChatContext
    ? formatMainChat(mainChat, safeSettings.mainChatLimit)
    : "";

  return [
    "你现在正在与用户进行一对一微信私聊。",
    "继续遵守 SillyTavern 当前启用的系统提示词、世界书、角色卡和预设。",
    "当前模式只改变表达形式，不改变角色身份、性格、关系或既有设定。",
    "",
    `角色名：${charName}`,
    `用户名：${userName}`,
    description ? `角色描述：${description}` : "",
    personality ? `角色性格：${personality}` : "",
    scenario ? `角色场景：${scenario}` : "",
    systemPrompt ? `角色系统提示：${systemPrompt}` : "",
    postHistoryInstructions ? `额外角色要求：${postHistoryInstructions}` : "",
    examples ? `角色说话示例：${examples.slice(0, 2500)}` : "",
    "",
    externalMemory ? `长期记忆：\n${externalMemory.slice(0, 5000)}` : "",
    recentMainChat ? `酒馆主聊天中最近发生的事情（只用于保持连续性）：\n${recentMainChat}` : "",
    recentWeChat ? `当前微信聊天记录：\n${recentWeChat}` : "",
    `用户刚刚发来：${String(userMessage).trim()}`,
    "",
    "微信回复规则：",
    "1. 只输出角色直接发给用户的消息，不要输出旁白、动作、场景、心理描写、括号说明或角色名。",
    "2. 不要使用星号、Markdown、标题、列表或剧本格式。",
    "3. 像真实微信聊天一样自然、口语化，通常一条消息只回一句；确有需要时可换行分成最多 " +
      `${safeSettings.maxBubbles} 条短消息。`,
    `4. 整次回复尽量不超过 ${safeSettings.maxCharacters} 个字符，不要为了凑长度而重复。`,
    "5. 保持角色原有说话习惯、关系距离和情绪，但不要突然切换成小说腔。",
    "6. 如果用户要求你发图片而你无法生成图片，就用角色口吻自然说明，不要编造已经发送图片。",
    "7. 直接回复微信内容，不要解释这些规则。",
  ]
    .filter(Boolean)
    .join("\n");
}

export function sanitizeReply(rawReply, maxCharacters = 55, maxBubbles = 3) {
  let text = String(rawReply ?? "").trim();
  if (!text) {
    return [];
  }

  text = text
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-z]*\n?/gi, "").replace(/```/g, ""))
    .replace(/^[ \t]*(?:assistant|character|角色|{{char}})[ \t]*[:：][ \t]*/gim, "")
    .replace(/[*＊][^*＊\n]{1,80}[*＊]/g, "");

  for (const pattern of NARRATION_PATTERNS) {
    text = text.replace(pattern, "");
  }

  const chunks = text
    .split(/\n+/)
    .map((line) =>
      line
        .replace(/^[\s\-–—•]+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter(Boolean);

  const result = [];
  let remaining = toPositiveInteger(maxCharacters, DEFAULT_SETTINGS.maxCharacters, 1, 300);
  const bubbleLimit = toPositiveInteger(maxBubbles, DEFAULT_SETTINGS.maxBubbles, 1, 8);

  for (const chunk of chunks) {
    if (result.length >= bubbleLimit || remaining <= 0) {
      break;
    }

    const characters = Array.from(chunk);
    if (characters.length > remaining) {
      const shortened = characters.slice(0, remaining).join("").trim();
      if (shortened) {
        result.push(shortened);
      }
      break;
    }

    result.push(chunk);
    remaining -= visibleCharacterCount(chunk);
  }

  return result;
}
