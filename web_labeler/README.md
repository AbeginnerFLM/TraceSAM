# TraceSAM Web Labeler

浏览器版 OBB 标注器，先实现：

- `YOLO OBB` 标签读写
- `SAM` 点击式智能标注
- 其他格式接口预留：`YOLO HBB`、`LabelImg OBB`、`DOTA`

## 启动

```bash
cd /projects/TraceSAM
python -m venv .venv
source .venv/bin/activate
pip install -r web_labeler/requirements.txt
uvicorn web_labeler.app.main:app --host 0.0.0.0 --port 8081 --reload
```

然后打开：

```text
http://localhost:8081
```

## 说明

- 默认扫描目录来自环境变量 `TRACE_SAM_DATA_ROOT`，未设置时使用 `/projects/TraceSAM/projects`
- `LABELIMG_SAM_MODEL` 可指定本地 SAM 权重
- 图片标签默认保存为同名 `.txt`
