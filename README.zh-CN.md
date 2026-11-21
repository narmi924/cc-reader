[English](README.md) · [简体中文](README.zh-CN.md)

# Claude Code 会话阅读器

凭记得的一个项目细节找回旧对话，看清当时怎么问、怎么答，再把那条原话交给下一个 agent。

[![搜索 Parakeet，打开当时的对话，把原文引用粘进新提示词](media/session-reader.gif)](media/session-reader.mp4)

## 我为什么做这个工具

我平时在终端和 VS Code 里用 Claude Code。过几个星期，可能还记得当时讨论过哪个模型，或者 Claude 说过一句什么话，但很少记得会话叫什么。以前我会在 VS Code 里打开整个 `.claude` 目录，跨文件搜 JSONL，再从一长行记录里辨认是谁说的。有时候干脆让 Codex 或 Claude 帮我找。

我想看到的是当时我问了什么，Claude 为什么这么答。长对话被压缩以后，只要前半段还保存在本机，我也想直接翻回去看。找到以后，复制会话 ID 或那句话的引用给 Claude 或 Codex，就能接着问，不用从头复述一遍。

## 快速开始

下载或克隆仓库，打开项目目录。需要 **Python 3.9+** 和浏览器。

| 平台 | 启动方式 |
| --- | --- |
| Windows | 双击 **Open Reader.cmd**，或运行 `py -3 reader.py` |
| macOS / Linux | 运行 `python3 reader.py` |

阅读器会自动打开浏览器。界面默认英文，在项目侧栏选择 **简体中文** 即可切换，下次打开会记住你的选择。

**也可以让 agent 帮你启动。** 在这个项目目录里对它说一句：

> 按 README 在这台电脑上启动 Claude Code 会话阅读器，找到我本机的 Claude Code 会话，把浏览器地址给我。

**先试试示例。** 在启动命令后加上 `--demo`，无需本机会话。在「搜索全部项目和会话」输入 `Parakeet`，点开主对话里的那条结果。往上看一条，就知道当时为什么问该用哪个模型定稿。点「复制引用」，粘到新的 agent 对话里，接着问：「现在的代码还按这个分工跑吗？」

macOS 和 Linux 上的真实 Claude Code 会话还没完整试过，遇到问题欢迎提 issue，也欢迎直接发 PR 修复。

## 怎么找回一段对话

- **记得模型名、API 或字段。** 可以搜所有项目，也可以只搜一个项目。结果会列出你、Claude 和子代理说过的原话，点一条就跳到当时的位置。
- **想看为什么这么答。** 上下翻看前后几轮。展开「操作过程」可以看到记录里保存的思考、工具参数和返回结果，也可以从对话菜单切到子代理。
- **想交给另一个 agent。** 「复制 ID」适合让它参考整段会话。「复制引用」会带上记录文件、字节位置、内容块、说话人和原文片段，本地 agent 有文件访问权限就能直接找到那一句。

已经知道要继续哪次对话时，我会用 Claude Code 的 `/resume`。想找工具参数或命令输出里的字符串，也可以直接搜 JSONL。我想按一句原话找回当时的决定，再带到另一个任务里时，就打开阅读器。[Claude Code 会话命令](https://code.claude.com/docs/en/sessions)

## 工作原理

![本地 JSONL 的消息正文进入 SQLite 索引供搜索；阅读上下文时，服务按位置读取原始记录并显示在本机浏览器中。](media/architecture-zh.png)

Python 服务读取 `~/.claude/projects/`。设置了 `CLAUDE_CONFIG_DIR` 时，会读取该目录下的 `projects/`。原始会话只读，SQLite 搜索索引保存在当前用户的系统缓存目录。界面和 Markdown 渲染器随项目提供，服务只监听 `127.0.0.1`。

在终端加上 `--serve` 可以只打印地址，加上 `--port 48800` 可以指定端口。

[MIT 许可证](LICENSE) · [内置 markdown-it 许可证](markdown-it.LICENSE)
