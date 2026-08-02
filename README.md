# 拾题 · 教师题库助手

一个基于“整页渲染 + 多模态视觉模型”的教师题库 MVP。上传 PDF、DOCX 或图片后，浏览器先把原卷转成高清页面图，再调用 OpenAI-compatible 视觉接口提取题干、LaTeX 公式、答案、题图坐标和标签，最后进入人工审核与组卷。

## 已实现

- PDF、DOCX、PNG、JPG、WEBP 浏览器端页面化
- OpenAI-compatible 多模态识题接口，未配置密钥时自动使用演示结果
- 题目 JSON、页面坐标、题图坐标和识别置信度
- 原页对照、题目框、可拖动/缩放题图裁剪框、坐标数值微调
- 题干、选项、答案、解析、分值和标签人工审核
- 题库搜索、题型和标签筛选、多选组卷
- 试卷排序、答案预览、打印或另存为 PDF
- Cloudflare D1 结构化数据模型与 R2 原卷/页面/裁图存储

## 本地运行

    npm install
    npm run dev

打开终端输出的本地地址。首页可直接使用演示卷，也可以上传自己的 PDF、DOCX 或图片。

## 接入真实视觉模型

在部署环境配置以下服务端变量：

- VISION_API_KEY：模型服务密钥
- VISION_API_BASE_URL：OpenAI-compatible API 根地址，例如以 /v1 结尾
- VISION_MODEL：支持图片输入的模型名称

识别适配器位于 app/api/extract/route.ts。密钥只在服务端使用，不会下发浏览器。

## 数据存储

D1 迁移文件位于 drizzle/0000_lean_songbird.sql；原卷和页面图使用 FILES R2 binding。主要实体包括 documents、pages、extraction_runs、questions、question_assets、tags、papers 和 paper_items。

## 当前 MVP 边界

旧版 .doc 无法在浏览器可靠还原，界面会提示先另存为 DOCX 或 PDF。生产部署建议增加 LibreOffice 页面化工作进程；DOCX 中极复杂的浮动对象仍需在审核台复核。
