import {
  DEFAULT_SETTINGS,
  buildWeChatPrompt,
  characterDisplayName,
  characterKey,
  normalizeSettings,
  sanitizeReply,
  visibleCharacterCount,
} from "./core.js";

const MODULE_NAME = "wechat_sim";
const CHAT_STORAGE_KEY = "st-wechat-sim:chats:v1";
const MAX_STORED_MESSAGES = 300;

const runtime = {
  activeCharacterKey: "",
  chats: loadStoredChats(),
  generating: false,
  isOpen: false,
  settings: normalizeSettings({}),
};

function getContext() {
  return globalThis.SillyTavern?.getContext?.() ?? null;
}

function loadStoredChats() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch (error) {
    console.warn("[WeChat Sim] 无法读取本地聊天记录", error);
    return {};
  }
}

function saveSettings() {
  if (runtime.settings.persistHistory) {
    saveStoredChats();
  }
  getContext()?.saveSettingsDebounced?.();
}

function saveStoredChats() {
  if (!runtime.settings.persistHistory) {
    return;
  }

  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(runtime.chats));
  } catch (error) {
    console.warn("[WeChat Sim] 无法保存本地聊天记录", error);
    showToast("聊天记录保存失败，可能是浏览器存储空间不足。", "error");
  }
}

function getSettings() {
  const context = getContext();
  const settingsStore = context?.extensionSettings;
  if (!settingsStore) {
    runtime.settings = normalizeSettings(runtime.settings);
    return runtime.settings;
  }

  settingsStore[MODULE_NAME] ??= {};
  settingsStore[MODULE_NAME] = normalizeSettings(settingsStore[MODULE_NAME]);
  return settingsStore[MODULE_NAME];
}

function getActiveCharacter() {
  const context = getContext();
  if (!context) {
    return null;
  }

  const characterId = context.characterId ?? context.this_chid;
  const character = context.characters?.[characterId] ?? context.character ?? null;
  if (!character) {
    return null;
  }

  const card = context.getCharacterCardFields?.() ?? {};
  return {
    ...character,
    description: character.description ?? card.description,
    personality: character.personality ?? card.personality,
    scenario: character.scenario ?? card.scenario,
    mes_example: character.mes_example ?? card.mesExamples,
    system_prompt: character.system_prompt ?? card.system,
    post_history_instructions:
      character.post_history_instructions ?? card.jailbreak,
  };
}

function getActiveThread() {
  const character = getActiveCharacter();
  const context = getContext();
  const key = characterKey(
    character,
    `chat-${context?.chatId || context?.getCurrentChatId?.() || "default"}`,
  );
  runtime.activeCharacterKey = key;
  runtime.chats[key] ??= [];
  return runtime.chats[key];
}

function createElement(tagName, className, text) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  if (text !== undefined) {
    element.textContent = text;
  }
  return element;
}

function avatarMarkup(character) {
  const name = characterDisplayName(character);
  const context = getContext();
  const avatar = character?.avatar
    ? context?.getThumbnailUrl?.("avatar", character.avatar) ||
      `/thumbnail?type=avatar&file=${encodeURIComponent(character.avatar)}`
    : "";
  const initial = Array.from(name)[0] || "微";

  return `
    <span class="wechat-avatar-fallback" aria-hidden="true">${escapeHtml(initial)}</span>
    ${
      avatar
        ? `<img class="wechat-avatar-image" src="${escapeHtml(avatar)}" alt="${escapeHtml(name)}">`
        : ""
    }
  `;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function createUi() {
  if (document.getElementById("wechat-sim-root")) {
    return;
  }

  const root = createElement("div", "wechat-sim-root");
  root.id = "wechat-sim-root";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="wechat-sim-backdrop" data-wechat-close="true"></div>
    <section class="wechat-phone" role="dialog" aria-modal="true" aria-label="微信模拟聊天">
      <div class="wechat-statusbar" aria-hidden="true">
        <span class="wechat-clock"></span>
        <span class="wechat-status-icons">● ●● ▰</span>
      </div>
      <header class="wechat-header">
        <button class="wechat-icon-button" type="button" data-wechat-close="true" aria-label="关闭">‹</button>
        <div class="wechat-contact">
          <div class="wechat-contact-avatar">${avatarMarkup(getActiveCharacter())}</div>
          <div>
            <strong class="wechat-contact-name">角色</strong>
            <span class="wechat-contact-status">微信好友</span>
          </div>
        </div>
        <div class="wechat-header-actions">
          <button class="wechat-icon-button" type="button" data-wechat-call aria-label="语音通话">☎</button>
          <button class="wechat-icon-button" type="button" data-wechat-more aria-label="聊天设置">•••</button>
        </div>
      </header>
      <main class="wechat-messages" aria-live="polite">
        <div class="wechat-empty">
          <div class="wechat-empty-icon">微</div>
          <p>开始和角色私聊吧</p>
          <span>回复会复用当前酒馆角色、预设和近期上下文</span>
        </div>
        <div class="wechat-message-list"></div>
        <div class="wechat-typing" hidden>
          <span></span><span></span><span></span>
        </div>
      </main>
      <footer class="wechat-composer">
        <div class="wechat-composer-tools">
          <button type="button" class="wechat-tool-button" data-wechat-voice disabled title="语音输入将在第二阶段接入">🎙</button>
          <button type="button" class="wechat-tool-button" data-wechat-image disabled title="图片发送将在第三阶段接入">▧</button>
          <span class="wechat-character-count">0 / 0</span>
        </div>
        <div class="wechat-input-row">
          <textarea class="wechat-input" rows="1" maxlength="2000" placeholder="发消息…"></textarea>
          <button type="button" class="wechat-send-button" data-wechat-send>发送</button>
        </div>
      </footer>
      <div class="wechat-settings-sheet" hidden>
        <div class="wechat-sheet-handle"></div>
        <div class="wechat-sheet-heading">
          <div>
            <strong>微信聊天设置</strong>
            <span>只影响微信模拟器</span>
          </div>
          <button type="button" class="wechat-sheet-close" data-wechat-sheet-close aria-label="关闭设置">×</button>
        </div>
        <label class="wechat-setting-row">
          <span><b>单次回复字数</b><small>限制模型的纯对话长度</small></span>
          <input data-setting="maxCharacters" type="number" min="12" max="300">
        </label>
        <label class="wechat-setting-row">
          <span><b>最多气泡数</b><small>换行会被拆成多条微信消息</small></span>
          <input data-setting="maxBubbles" type="number" min="1" max="8">
        </label>
        <label class="wechat-setting-row">
          <span><b>微信上下文条数</b><small>读取最近的独立微信聊天记录</small></span>
          <input data-setting="historyLimit" type="number" min="4" max="200">
        </label>
        <label class="wechat-setting-row">
          <span><b>参考酒馆主聊天</b><small>保留剧情连续性，但提醒模型不要使用小说腔</small></span>
          <input data-setting="useMainChatContext" type="checkbox">
        </label>
        <label class="wechat-setting-row">
          <span><b>保存聊天记录</b><small>按角色保存在本机浏览器 localStorage</small></span>
          <input data-setting="persistHistory" type="checkbox">
        </label>
        <button type="button" class="wechat-danger-button" data-wechat-clear>清空当前角色的微信记录</button>
        <p class="wechat-stage-note">当前版本：文字微信 MVP。语音通话、图片生成和柏宝书写入适配将在后续阶段接入。</p>
      </div>
    </section>
    <div class="wechat-toast" role="status"></div>
  `;

  document.body.append(root);
  bindUiEvents(root);
}

function bindUiEvents(root) {
  root.querySelectorAll("[data-wechat-close]").forEach((button) => {
    button.addEventListener("click", closeWeChat);
  });

  root.querySelector("[data-wechat-send]")?.addEventListener("click", sendCurrentMessage);
  const input = root.querySelector(".wechat-input");
  input?.addEventListener("input", () => {
    syncComposerState();
  });
  input?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendCurrentMessage();
    }
  });

  root.querySelector("[data-wechat-more]")?.addEventListener("click", openSettingsSheet);
  root.querySelector("[data-wechat-sheet-close]")?.addEventListener("click", closeSettingsSheet);
  root.querySelector("[data-wechat-call]")?.addEventListener("click", () => {
    showToast("语音通话需要麦克风、语音识别、角色模型和 TTS 服务链路，第二阶段接入。");
  });
  root.querySelector("[data-wechat-clear]")?.addEventListener("click", clearCurrentThread);

  root.querySelectorAll("[data-setting]").forEach((control) => {
    control.addEventListener("change", () => {
      const settingName = control.dataset.setting;
      runtime.settings[settingName] =
        control.type === "checkbox" ? control.checked : Number(control.value);
      runtime.settings = normalizeSettings(runtime.settings);
      const context = getContext();
      if (context?.extensionSettings) {
        context.extensionSettings[MODULE_NAME] = runtime.settings;
      }
      syncSettingsUi();
      saveSettings();
    });
  });
}

function getRoot() {
  return document.getElementById("wechat-sim-root");
}

function updateHeader() {
  const root = getRoot();
  const character = getActiveCharacter();
  if (!root || !character) {
    return;
  }

  const name = characterDisplayName(character);
  root.querySelector(".wechat-contact-name").textContent = name;
  root.querySelector(".wechat-contact-avatar").innerHTML = avatarMarkup(character);
}

function openWeChat() {
  createUi();
  const root = getRoot();
  runtime.activeCharacterKey = "";
  runtime.isOpen = true;
  root.classList.add("is-open");
  root.setAttribute("aria-hidden", "false");
  updateHeader();
  renderCurrentThread();
  syncSettingsUi();
  setTimeout(() => root.querySelector(".wechat-input")?.focus(), 120);
}

function closeWeChat() {
  const root = getRoot();
  runtime.isOpen = false;
  root?.classList.remove("is-open", "is-settings-open");
  root?.setAttribute("aria-hidden", "true");
}

function renderCurrentThread() {
  const root = getRoot();
  if (!root) {
    return;
  }

  updateHeader();
  const thread = getActiveThread();
  const list = root.querySelector(".wechat-message-list");
  const empty = root.querySelector(".wechat-empty");
  list.replaceChildren();
  empty.hidden = thread.length > 0;

  for (const message of thread) {
    appendMessageElement(list, message, false);
  }
  scrollMessagesToBottom();
  syncSettingsUi();
}

function appendMessageElement(container, message, animate = true) {
  if (!container || !message) {
    return;
  }

  const row = createElement(
    "div",
    `wechat-message-row is-${message.role === "user" ? "user" : "assistant"}`,
  );
  if (animate) {
    row.classList.add("is-new");
  }

  const avatar = createElement("div", "wechat-message-avatar");
  const character = getActiveCharacter();
  if (message.role === "user") {
    avatar.textContent = Array.from(getContext()?.name1 || "我")[0] || "我";
  } else {
    avatar.innerHTML = avatarMarkup(character);
  }

  const body = createElement("div", "wechat-message-body");
  const bubble = createElement("div", "wechat-bubble", message.content);
  body.append(bubble);
  if (message.time) {
    body.append(createElement("time", "wechat-message-time", message.time));
  }

  row.append(avatar, body);
  container.append(row);
}

function appendMessage(message) {
  const root = getRoot();
  const thread = getActiveThread();
  const normalized = {
    role: message.role === "user" ? "user" : "assistant",
    content: String(message.content || "").trim(),
    time: message.time || new Date().toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    }),
  };

  if (!normalized.content) {
    return null;
  }

  thread.push(normalized);
  if (thread.length > MAX_STORED_MESSAGES) {
    thread.splice(0, thread.length - MAX_STORED_MESSAGES);
  }
  saveStoredChats();

  const list = root?.querySelector(".wechat-message-list");
  root?.querySelector(".wechat-empty")?.setAttribute("hidden", "");
  appendMessageElement(list, normalized, true);
  scrollMessagesToBottom();
  return normalized;
}

function scrollMessagesToBottom() {
  requestAnimationFrame(() => {
    const container = getRoot()?.querySelector(".wechat-messages");
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });
}

function syncComposerState() {
  const root = getRoot();
  if (!root) {
    return;
  }

  const input = root.querySelector(".wechat-input");
  const send = root.querySelector("[data-wechat-send]");
  const counter = root.querySelector(".wechat-character-count");
  const count = visibleCharacterCount(input?.value || "");
  const limit = runtime.settings.maxCharacters;

  counter.textContent = `${count} / ${limit}`;
  counter.classList.toggle("is-over-limit", count > limit);
  send.disabled = runtime.generating || count === 0;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
}

function syncSettingsUi() {
  const root = getRoot();
  if (!root) {
    return;
  }

  root.querySelectorAll("[data-setting]").forEach((control) => {
    const value = runtime.settings[control.dataset.setting];
    if (control.type === "checkbox") {
      control.checked = Boolean(value);
    } else {
      control.value = value;
    }
  });
  syncComposerState();
}

function openSettingsSheet() {
  const root = getRoot();
  root?.classList.add("is-settings-open");
  const sheet = root?.querySelector(".wechat-settings-sheet");
  if (sheet) {
    sheet.hidden = false;
  }
  syncSettingsUi();
}

function closeSettingsSheet() {
  const root = getRoot();
  root?.classList.remove("is-settings-open");
  const sheet = root?.querySelector(".wechat-settings-sheet");
  if (sheet) {
    sheet.hidden = true;
  }
}

function clearCurrentThread() {
  const thread = getActiveThread();
  thread.splice(0, thread.length);
  saveStoredChats();
  renderCurrentThread();
  showToast("当前角色的微信聊天记录已清空。");
}

async function sendCurrentMessage() {
  if (runtime.generating) {
    return;
  }

  const root = getRoot();
  const input = root?.querySelector(".wechat-input");
  const text = String(input?.value || "").trim();
  if (!text) {
    return;
  }

  input.value = "";
  syncComposerState();
  appendMessage({ role: "user", content: text });
  await generateWeChatReply(text);
}

function userPersonaText(context) {
  return String(
    context?.powerUserSettings?.persona_description ??
      context?.userPersona ??
      "",
  ).trim();
}

async function generateTavernReply({ systemPrompt, userMessage }) {
  const context = getContext();

  if (typeof context?.generateRaw === "function") {
    return context.generateRaw({
      systemPrompt,
      prompt: userMessage,
      responseLength: 512,
      trimNames: false,
    });
  }

  if (typeof context?.generateQuietPrompt === "function") {
    return context.generateQuietPrompt({
      quietPrompt: systemPrompt,
      skipWIAN: false,
      removeReasoning: true,
      trimToSentence: false,
    });
  }

  if (typeof globalThis.generateQuietPrompt === "function") {
    return globalThis.generateQuietPrompt({
      quietPrompt: systemPrompt,
      skipWIAN: false,
      removeReasoning: true,
      trimToSentence: false,
    });
  }

  const scriptModule = await import("../../../../script.js");
  if (typeof scriptModule.generateQuietPrompt === "function") {
    return scriptModule.generateQuietPrompt({
      quietPrompt: systemPrompt,
      skipWIAN: false,
      removeReasoning: true,
      trimToSentence: false,
    });
  }

  throw new Error(
    "当前 SillyTavern 版本没有提供 generateRaw 或 generateQuietPrompt 接口。",
  );
}

async function collectExternalMemory(charName, userMessage, history) {
  const adapters = Array.isArray(window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__)
    ? window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__
    : [];
  const blocks = [];

  for (const adapter of adapters) {
    if (typeof adapter?.recall !== "function") {
      continue;
    }
    try {
      const result = await adapter.recall({ charName, userMessage, history });
      if (result) {
        blocks.push(String(result));
      }
    } catch (error) {
      console.warn("[WeChat Sim] 长期记忆读取失败", error);
    }
  }
  return blocks.join("\n\n");
}

async function writeExternalMemory(detail) {
  const adapters = Array.isArray(window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__)
    ? window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__
    : [];

  for (const adapter of adapters) {
    if (typeof adapter?.remember !== "function") {
      continue;
    }
    try {
      await adapter.remember(detail);
    } catch (error) {
      console.warn("[WeChat Sim] 长期记忆写入失败", error);
    }
  }

  window.dispatchEvent(new CustomEvent("st-wechat-sim:exchange", { detail }));
}

function setGenerating(generating) {
  runtime.generating = generating;
  const root = getRoot();
  root?.querySelector(".wechat-typing")?.toggleAttribute("hidden", !generating);
  root?.classList.toggle("is-generating", generating);
  syncComposerState();
  if (generating) {
    scrollMessagesToBottom();
  }
}

async function generateWeChatReply(userMessage) {
  setGenerating(true);
  try {
    const context = getContext();
    const character = getActiveCharacter();
    if (!context || !character) {
      throw new Error("请先在酒馆里打开一个角色聊天。");
    }
    const thread = getActiveThread();
    const charName = characterDisplayName(character);
    const externalMemory = await collectExternalMemory(charName, userMessage, thread);
    const prompt = buildWeChatPrompt({
      character,
      userName: context.name1 || "用户",
      userPersona: userPersonaText(context),
      history: thread.slice(0, -1),
      mainChat: context.chat || [],
      settings: runtime.settings,
      userMessage,
      externalMemory,
    });

    const rawReply = await generateTavernReply({
      systemPrompt: prompt,
      userMessage,
    });
    const bubbles = sanitizeReply(
      rawReply,
      runtime.settings.maxCharacters,
      runtime.settings.maxBubbles,
    );

    if (bubbles.length === 0) {
      throw new Error("模型返回了空内容。");
    }

    const replies = [];
    for (const bubble of bubbles) {
      if (runtime.settings.assistantDelayMs > 0) {
        await delay(runtime.settings.assistantDelayMs);
      }
      const message = appendMessage({ role: "assistant", content: bubble });
      if (message) {
        replies.push(message);
      }
    }

    if (replies.length > 0) {
      await writeExternalMemory({
        characterKey: runtime.activeCharacterKey,
        characterName: charName,
        userMessage,
        replies: replies.map((message) => message.content),
        timestamp: Date.now(),
      });
    }
  } catch (error) {
    console.error("[WeChat Sim] 生成失败", error);
    showToast(`生成失败：${error?.message || error}`, "error");
  } finally {
    setGenerating(false);
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

let toastTimer;
function showToast(message, type = "info") {
  createUi();
  const toast = getRoot()?.querySelector(".wechat-toast");
  if (!toast) {
    return;
  }
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.className = `wechat-toast is-visible is-${type}`;
  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, type === "error" ? 6000 : 4200);
}

function createLauncher() {
  const menu = document.getElementById("extensionsMenu");
  if (!menu) {
    return false;
  }
  if (menu.querySelector(".wechat-sim-launcher")) {
    return true;
  }

  const button = createElement(
    "div",
    "list-group-item flex-container flexGap5 interactable wechat-sim-launcher",
  );
  button.tabIndex = 0;
  button.setAttribute("role", "button");
  button.innerHTML = `
    <span class="fa-solid fa-comments wechat-sim-launcher-icon"></span>
    <span>微信模拟器</span>
  `;
  button.addEventListener("click", openWeChat);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openWeChat();
    }
  });
  menu.append(button);
  return true;
}

function watchForExtensionMenu() {
  if (createLauncher()) {
    return;
  }

  const observer = new MutationObserver(() => {
    if (createLauncher()) {
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
  setTimeout(() => observer.disconnect(), 30000);
}

function exposeIntegrationApi() {
  window.__ST_WECHAT_SIM__ = Object.freeze({
    open: openWeChat,
    close: closeWeChat,
    getMessages() {
      return structuredClone(getActiveThread());
    },
    addMemoryAdapter(adapter) {
      window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__ ??= [];
      window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__.push(adapter);
      return () => {
        window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__ =
          window.__ST_WECHAT_SIM_MEMORY_ADAPTERS__.filter((item) => item !== adapter);
      };
    },
  });
}

function handleCharacterOrChatChange() {
  runtime.activeCharacterKey = "";
  if (runtime.isOpen) {
    renderCurrentThread();
  }
}

let eventsBound = false;

function bindSillyTavernEvents() {
  if (eventsBound) {
    return;
  }

  const context = getContext();
  const eventSource = context?.eventSource;
  const eventTypes = context?.eventTypes;
  if (typeof eventSource?.on !== "function" || !eventTypes) {
    setTimeout(bindSillyTavernEvents, 500);
    return;
  }

  runtime.settings = getSettings();
  const refreshEvents = [
    eventTypes.CHAT_CHANGED,
    eventTypes.CHARACTER_SELECTED,
    eventTypes.CHARACTER_EDITED,
  ].filter(Boolean);

  refreshEvents.forEach((eventName) => {
    eventSource.on(eventName, handleCharacterOrChatChange);
  });
  eventsBound = true;
}

function initializeExtension() {
  runtime.settings = getSettings();
  createUi();
  createLauncher();
  watchForExtensionMenu();
  exposeIntegrationApi();
  bindSillyTavernEvents();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializeExtension, {
    once: true,
  });
} else {
  initializeExtension();
}

