2026-04-16 00:00 UTC
- 问题: 现有项目只有桌面版 `labelimg_OBB`，无法在浏览器中进行 OBB 标注，也没有适合后续扩展多种 YOLO 标签格式的 Web 结构。
- 原因: 标注逻辑和界面深度耦合在 PyQt 主窗口中，浏览器端缺少独立的后端 API、前端画布和格式注册层。
- 解决: 新增 `web_labeler/` 浏览器版模块，拆分为 FastAPI 后端、静态前端、`YOLO OBB` 格式读写器、SAM 智能标注服务，并为 `YOLO HBB`、`LabelImg OBB`、`DOTA` 预留统一格式接口。
