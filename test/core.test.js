import test from "node:test";
import assert from "node:assert/strict";
import {
  buildWeChatPrompt,
  normalizeSettings,
  sanitizeReply,
  visibleCharacterCount,
} from "../core.js";

test("settings are clamped to safe values", () => {
  const settings = normalizeSettings({
    maxCharacters: "9999",
    maxBubbles: 0,
    historyLimit: "2",
    mainChatLimit: 0,
    assistantDelayMs: -5,
  });

  assert.equal(settings.maxCharacters, 300);
  assert.equal(settings.maxBubbles, 1);
  assert.equal(settings.historyLimit, 4);
  assert.equal(settings.mainChatLimit, 0);
  assert.equal(settings.assistantDelayMs, 0);
});

test("reply is split into short WeChat bubbles without markup prefixes", () => {
  const reply = sanitizeReply("角色：晚上好。\n*轻轻笑*\n要一起吃饭吗？", 12, 3);

  assert.deepEqual(reply, ["晚上好。", "要一起吃饭吗？"]);
  assert.equal(reply.every((line) => visibleCharacterCount(line) <= 12), true);
});

test("reply sanitization removes standalone narration lines", () => {
  const reply = sanitizeReply("（沉默片刻）\n我还在。\n【旁白】窗外下雨了", 55, 3);
  assert.deepEqual(reply, ["我还在。"]);
});

test("reply sanitization removes inline roleplay actions", () => {
  const reply = sanitizeReply("*叹气* 你终于来了。", 55, 3);
  assert.deepEqual(reply, ["你终于来了。"]);
});

test("prompt includes character data, continuity and chat-only rules", () => {
  const prompt = buildWeChatPrompt({
    character: {
      name: "阿澄",
      description: "安静但很细心",
      personality: "克制、温柔",
    },
    userName: "小满",
    history: [{ role: "user", content: "在吗" }],
    mainChat: [{ mes: "我们在车站告别。", is_user: false }],
    settings: normalizeSettings({}),
    userMessage: "今天怎么样？",
    externalMemory: "阿澄记得用户喜欢雨天。",
  });

  assert.match(prompt, /阿澄/);
  assert.match(prompt, /小满/);
  assert.match(prompt, /不要输出旁白/);
  assert.match(prompt, /阿澄记得用户喜欢雨天/);
  assert.match(prompt, /我们在车站告别/);
  assert.match(prompt, /用户：在吗/);
});
