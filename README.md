# WeChat Sim / 微信模拟器

一个给 SillyTavern 使用的第三方前端扩展。它会在扩展菜单中增加“微信模拟器”入口，并使用当前酒馆角色、模型、预设和近期聊天上下文进行一对一微信式聊天。

## 当前版本

`0.1.0` 是文字聊天 MVP：

- 按角色隔离并保存微信聊天记录
- 读取当前角色卡与近期酒馆主聊天
- 使用 SillyTavern 当前模型，通过 `generateQuietPrompt` 生成回复
- 提示词强制纯对话，移除常见旁白、动作和 Markdown
- 支持单条字数、气泡数、上下文条数和保存开关
- 为柏宝书等外部记忆插件提供 `recall` / `remember` 适配点

语音通话与角色生图尚未接入真实服务。界面和适配边界已预留，避免在 API 未验证时伪装成可用功能。

## 安装

把整个 `st-wechat-sim` 文件夹放到：

```text
SillyTavern/public/scripts/extensions/third-party/st-wechat-sim
```

刷新酒馆页面，在扩展菜单启用插件。聊天页左侧工具栏的扩展列表里会出现“微信模拟器”。

发布到 GitHub 后，也可以在 SillyTavern 的扩展安装框中输入仓库地址。仓库根目录必须直接包含 `manifest.json`、`index.js` 和 `style.css`。

## 兼容性

目标版本是使用 ES Module 扩展和 `generateQuietPrompt` 的现代 SillyTavern。不同版本可能调整扩展接口；安装前应先在目标酒馆源码中确认：

```text
public/scripts/extensions.js
public/scripts/script.js
public/index.html
```

需要确认的符号包括 `getContext`、`extension_settings`、`saveSettingsDebounced` 和 `generateQuietPrompt`。

## 柏宝书记忆适配

柏宝书内部接口尚未检查，因此当前版本不直接猜测它的数据结构。可以通过浏览器控制台注册适配器：

```js
window.__ST_WECHAT_SIM__.addMemoryAdapter({
  async recall({ charName, userMessage, history }) {
    // 调用柏宝书或酒馆记忆接口，返回一段文字
    return "";
  },
  async remember({ characterName, userMessage, replies }) {
    // 把本轮微信消息写入柏宝书
  },
});
```

每轮完整对话还会触发：

```js
window.addEventListener("st-wechat-sim:exchange", (event) => {
  console.log(event.detail);
});
```

确认柏宝书版本和源码后，可以把这些临时代码收敛为稳定桥接模块。

## 本地检查

```bash
npm test
```

没有构建步骤，也不需要安装依赖。
