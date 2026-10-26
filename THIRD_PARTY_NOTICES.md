# 第三方依赖与内容说明

本仓库上传应用源码、依赖清单、测试和构建脚本，不包含动漫视频、海报缓存、观看记录、浏览器用户目录或已打包的第三方运行时。

## 软件依赖

直接依赖的版本以 `package-lock.json` 为准，许可证以各依赖安装包中的原始文件为准：

| 依赖 | 用途 | 上游许可证 |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | 桌面运行时 | MIT，另附其运行时第三方声明 |
| [HLS.js](https://github.com/video-dev/hls.js) | HLS 视频播放 | Apache-2.0 |
| [cheerio](https://github.com/cheeriojs/cheerio) | HTML 解析 | MIT |
| [node-fetch](https://github.com/node-fetch/node-fetch) | Node 网络请求 | MIT |
| [https-proxy-agent](https://github.com/TooTallNate/proxy-agents) | Node 代理连接 | MIT |
| [@electron/get](https://github.com/electron/get) | 开发期运行时下载 | MIT |
| [electron-builder](https://github.com/electron-userland/electron-builder) | 打包 | MIT |

不将 `node_modules` 或生成的 `hls.min.js` 提交到 Git。安装依赖时，`scripts/prepare-assets.js` 会从已安装的 HLS.js 包生成播放资源，并把原始 `LICENSE` 一同复制到 `src/renderer/assets/hls.LICENSE.txt`。打包分发时应保留这些声明，以及 Electron 运行时随附的许可证文件。

## 网络内容

动漫元数据、图像和视频由外部服务提供，其权利归各自权利人所有。源码中的 API 地址、解析器或播放功能不表示这些内容获得了再分发授权。使用及分发相关内容时，应遵守来源服务条款并取得必要授权。

本次发布未替项目自身代码指定新的开源许可证；第三方依赖仍适用各自许可证。公开仓库或加密文件均不能替代第三方内容的使用授权。
