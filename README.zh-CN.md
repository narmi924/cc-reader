[English](README.md) · [简体中文](README.zh-CN.md)

# Claude Code 会话阅读器

凭记得的一个项目细节找回旧对话，看清当时怎么问、怎么答，再把那条原话交给下一个 agent。

[![搜索 Parakeet，打开当时的对话，把原文引用粘进新提示词](media/session-reader.gif)](media/session-reader.mp4)

## 我为什么做这个工具

我平时在终端和 VS Code 里用 Claude Code。隔几个星期，我往往还记得一个模型名，甚至记得 Claude 说过半句话，却忘了是哪次会话。以前我会在 VS Code 里打开整个 `.claude` 目录搜 JSONL，有时干脆让 Codex 帮我找。可我搜到那个词，还是想往上翻几句。我们只是提过这个选项，还是当时真的决定这么做了？

| 现有办法 | 能帮我找到什么 | 还缺哪一步 |
| --- | --- | --- |
| Claude Code 的 `/resume` | 预览旧会话，回去接着聊。 | 恢复会话时，已经压进摘要的消息不会逐条载入。想核对摘要之前的原话，还得翻磁盘上的记录。[会话恢复说明](https://code.claude.com/docs/en/sessions#what-a-resumed-session-restores) |
| 在 VS Code 里搜 JSONL | 在所有项目里搜一个词，直接打开命中那一行。 | 两句话中间可能隔着好几条工具调用。我得自己辨认哪些是我的追问、哪些是工具输出，才能把问答读连贯。 |
| claude-history | 在终端搜到消息，按 `y` 就能复制那条原文。 | 这次复制拿到的是 Markdown 正文。文件路径和会话 ID 各有一个复制键，想把原话和出处一起给 Codex，还得自己拼。[查看器快捷键](https://github.com/raine/claude-history#keyboard-navigation-viewer-mode) |
| Claude Code Chat Explorer | 在浏览器里搜消息和工具输出，也能让 agent 通过 MCP 搜到摘录。 | 网页导出的是整段会话，MCP 结果里的资源链接也指向整段记录。我还得标出要让另一个 agent 读的是哪一句。[导出和 MCP 搜索](https://github.com/drewburchfield/claude-code-chat-explorer#conversation-viewer) |

所以我把「复制引用」放在了搜到的每段原文旁边。演示里搜 `Parakeet` 会找到两条消息。子代理在追踪字幕回调，主对话里 Claude 回答了我问的「最后由哪个模型定稿」。点开后者，能连着读到我的问题和 Claude 的回答。复制引用，原话、说话人和它在本地文件里的位置就一起进了剪贴板。我把它贴给 Codex，接着问「现在的代码还按这个分工跑吗？」

## 快速开始

下载或克隆仓库，打开项目目录。需要 **Python 3.9+** 和浏览器。

| 平台 | 启动方式 |
| --- | --- |
| Windows | 双击 **Open Reader.cmd**，或运行 `py -3 reader.py` |
| macOS / Linux | 运行 `python3 reader.py` |

阅读器会自动打开浏览器。界面默认英文，在项目侧栏选择 **简体中文** 即可切换，下次打开会记住你的选择。

**也可以让 agent 帮你启动。** 在这个项目目录里对它说一句：

> 按 README 在这台电脑上启动 Claude Code 会话阅读器，找到我本机的 Claude Code 会话，把浏览器地址给我。

**先试试示例。** 在启动命令后加上 `--demo`，无需本机会话。演示使用独立端口和搜索索引，可以和自己的阅读器同时打开。在「搜索全部项目和会话」里输入 `Parakeet`，点开主对话里的结果，然后点「复制引用」。

macOS 和 Linux 上的真实 Claude Code 会话还没完整试过，遇到问题欢迎提 issue，也欢迎直接发 PR 修复。

## 怎么找回一段对话

- **记得模型名、API 或字段。** 可以搜所有项目，也可以只搜一个项目。结果会列出你、Claude 和子代理说过的原话，点一条就跳到当时的位置。
- **想看为什么这么答。** 上下翻看前后几轮。展开「操作过程」可以看到记录里保存的思考、工具参数和返回结果，也可以从对话菜单切到子代理。
- **想交给另一个 agent。** 「复制 ID」适合让它参考整段会话。「复制引用」会带上记录文件、字节位置、内容块、说话人和原文片段，本地 agent 有文件访问权限就能直接找到那一句。

## 工作原理

![本地 JSONL 的消息正文进入 SQLite 索引供搜索；阅读上下文时，服务按位置读取原始记录并显示在本机浏览器中。](media/architecture-zh.png)

Python 服务读取 `~/.claude/projects/`。设置了 `CLAUDE_CONFIG_DIR` 时，会读取该目录下的 `projects/`。原始会话只读，SQLite 搜索索引保存在当前用户的系统缓存目录。界面和 Markdown 渲染器随项目提供，服务只监听 `127.0.0.1`。

在终端加上 `--serve` 可以只打印地址，加上 `--port 48800` 可以指定端口。

[MIT 许可证](LICENSE) · [内置 markdown-it 许可证](markdown-it.LICENSE)
