# Pocket Lab Implementation Plan
**Goal:** 实现已批准的本地图片压缩微信小程序。
**Architecture:** 原生双页面；文件适配层、可注入导出器的压缩策略和页面队列分离。结果留在当前页面，不持久保存用户照片。
**Tech Stack:** JavaScript/WXML/WXSS、Canvas 2D、Node 内置语法与断言检查。
**Spec:** docs/superpowers/specs/2026-10-19-pocket-lab-design.md
## Global Constraints
9张；默认500KB；不上传、不登录、不覆盖原图；PNG默认透明；失败可重试；阶段完成待用户确认。
## Review Focus
- 超大图片：像素/文件上限与明确提示。
- 透明PNG：输出PNG或经显式切换后白底JPEG。
- EXIF方向：真机覆盖旋转和镜像照片。
- 保存拒绝与部分成功：只统计实际成功数量。
- 页面退出/反复处理：不继续setData，不泄漏临时输出。
## Tasks
- [x] 1. 配置与首页：project.config.json、miniprogram/app.*、pages/home/*，完整路由与已批准视觉。
- [x] 2. utils/compression.js：async compress(original,{targetBytes,mode,format},encode)，返回{path,size,width,height,metTarget,keptOriginal}；检查已经达标、非单调输出、输出增大、无法达标和PNG降尺寸。
- [x] 3. utils/wechat.js：封装wx回调、读大小、预览权限保存；utils/canvas.js：Canvas导出/释放；不删除原图。
- [x] 4. pages/compress/*：选择/移除/补选、参数校验、串行处理、结果/重试/预览/保存、离开取消；安全尺寸与隐私说明。
- [x] 5. node --check所有JS、解析全部JSON、最小策略验证。完成后请求用户确认进入微信工具和真机功能测试。
