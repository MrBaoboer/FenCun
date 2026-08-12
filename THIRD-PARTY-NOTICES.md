# 第三方许可说明

氛寸的源代码采用 [AGPL-3.0-only](LICENSE)。以下第三方内容适用各自的许可。

## 数据

`public/data/` 中的目录、索引和分片派生自 ledecanteur 提供的 Fragrantica 社区数据，不适用项目的 AGPL 许可。版权和使用条件见 [LicenseRef-fragrance-data](LICENSES/LicenseRef-fragrance-data.txt)。

## 字体

字体由 `next/font/google` 在构建时下载，并随构建产物自托管。

| 字体 | 用途 | 许可 |
| --- | --- | --- |
| [Fraunces](https://github.com/undercasetype/Fraunces) | 西文与数字 | SIL Open Font License 1.1 |
| [Noto Serif SC](https://github.com/notofonts/noto-cjk) | 中文 | SIL Open Font License 1.1 |

## 直接依赖

进入浏览器产物的直接依赖均为 MIT：next、react、react-dom、zustand、zod、minisearch，以及生成样式的 tailwindcss。

确切版本、传递依赖与逐包许可见 [`package-lock.json`](package-lock.json)；以各软件包附带的许可文本和版权声明为准。
