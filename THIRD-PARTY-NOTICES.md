# 第三方许可

氛寸自身的源代码以 AGPL-3.0-only 授权（见 [LICENSE](LICENSE)）。下列内容随构建产物一并分发，适用各自的许可。

## 字体

字体文件由 `next/font` 在构建时取回并自托管，随站点分发。

| 字体 | 用途 | 许可 |
| --- | --- | --- |
| [Fraunces](https://github.com/undercasetype/Fraunces) | 西文与数字 | SIL Open Font License 1.1 |
| [Noto Serif SC](https://github.com/notofonts/noto-cjk) | 中文 | SIL Open Font License 1.1 |

## 数据

`public/data/` 下的目录、索引与分片派生自 ledecanteur / Fragrantica 社区数据，版权归原始来源，不随代码按 AGPL 授权。原始数据集不在本仓库分发。

## 依赖

进入浏览器产物的直接依赖均为 MIT：next、react、react-dom、zustand、zod、minisearch，以及生成样式的 tailwindcss。逐包许可见 `package-lock.json`。
