# WebApp

## Purpose

当前 `WebApp` 是为 WebRL 保留的最小 Web 侧运行模块。

它只负责 4 件事：
- 提供 Receiver 页面与静态资源。
- 通过 WebSocket 完成 WebRTC 信令。
- 通过 DataChannel 回传浏览器输入与场景控制命令。
- 提供 `WebTinkerRL` 本地训练启动接口。

## Directory Roles

```text
WebApp/
|- .gitignore                     # 忽略安装产物与日志
|- package.json                   # Node 依赖与启动脚本
|- run.bat                        # Windows 下的 build + start 辅助脚本
|- tsconfig.json                  # TypeScript 编译配置
|- tsconfig.build.json            # 构建入口配置
|- src/                           # Node/Express 服务端
|  |- index.ts                    # 进程入口，解析命令行参数并启动 HTTP/HTTPS 与 WebSocket
|  |- server.ts                   # 静态资源、/config、/api/tinker/local-session 路由装配
|  |- websocket.ts                # WebSocket 信令服务入口
|  |- tinkerlocalsession.ts       # 本地训练 Session API 路由
|  |- log.ts                      # 轻量日志工具
|  |- class/
|  |  |- options.ts               # 服务配置结构
|  |  |- websockethandler.ts      # connect / offer / answer / candidate 转发逻辑
|  |- application/session/
|  |  |- localtinkersessionservice.ts # 本地训练脚本启动、状态轮询与日志记录
|- client/
|  |- public/                     # 浏览器可直接访问的静态文件
|  |  |- index.html               # 根入口说明页
|  |  |- js/config.js             # 拉取 /config 并生成 RTC 配置
|  |  |- js/stats.js              # 连接状态统计展示
|  |  |- js/videoplayer.js        # 视频播放、全屏与输入绑定
|  |  |- receiver/
|  |     |- index.html            # WebRL 当前主入口页
|  |     |- js/main.js            # 页面编排、场景切换、Tinker 状态与控制
|  |     |- js/app/               # Receiver 的应用层辅助模块
|  |     |- js/protocol/          # DataChannel 协议封装
|  |     |- js/transport/         # RTC 控制通道适配
|  |     |- js/ui/                # 面板 UI 渲染
|  |- src/                        # WebRTC / 输入系统基础模块
|     |- renderstreaming.js       # Peer 与 signaling 的桥接层
|     |- signaling.js             # WebSocket-only signaling 客户端
|     |- peer.js                  # WebRTC PeerConnection 生命周期与协商
|     |- sender.js                # 输入采集与发送
|     |- inputremoting.js         # 输入消息封装与派发
|     |- inputdevice.js           # 输入设备数据结构
|     |- gamepadhandler.js        # 手柄轮询
|     |- pointercorrect.js        # 鼠标坐标映射
|     |- logger.js                # 浏览器端日志
|     |- memoryhelper.js          # 输入消息 Buffer 辅助
|     |- charnumber.js / keymap.js / mousebutton.js / gamepadbutton.js / touchflags.js / touchphase.js
|                                   # 输入协议枚举与映射表
```

## What Was Removed

本次瘦身删除了以下内容：
- `build/` 与 `node_modules/`：纯生成产物，不应提交。
- `.editorconfig`、`.eslintrc.cjs`、`client/.eslintrc.json`：原源码仓库的开发配置残留。
- `src/signaling.ts`：旧的 HTTP 轮询信令入口。
- `src/class/httphandler.ts`、`offer.ts`、`answer.ts`、`candidate.ts`：只服务旧信令链路的类型与处理器。
- `src/protocol/command.ts`、`src/protocol/envelope.ts`：当前服务端未引用的孤儿协议文件。
- 旧示例页面中的上游文档链接、源码仓库链接与过时文案。
- `client/public/images/receiver-bench-bg.png`：仅用于装饰的大体积背景图。
- 旧的 `package-lock.json`：与当前精简后的依赖集合不一致，避免误导后续维护。

## Runtime

首次拉起：

```bash
npm install
npm run build
npm run start
```

开发模式：

```bash
npm install
npm run dev
```

Windows 下也可以直接运行：

```bat
run.bat
```

## Notes

- 当前版本只保留 WebSocket 信令，不再保留旧的 HTTP 轮询信令路径。
- 当前主入口是 `client/public/receiver/index.html`。
- 如果重新执行 `npm install`，会自动生成新的 `package-lock.json`。