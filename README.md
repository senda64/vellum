# Vellum

ローカルフォルダの `main.md` を編集し、用紙単位でプレビューする Markdown エディタ（STEP B）。

- CodeMirror 6 による編集
- `settings.json` による用紙サイズ / 余白
- Paged.js によるページ組版プレビュー
- 論理アンカーによる双方向スクロール同期

デモ: [https://senda64.github.io/vellum/](https://senda64.github.io/vellum/)

Chrome / Edge で開き、`example/` フォルダを **Open Folder** で選択してください。

## 開発

```bash
pnpm install
pnpm dev
```

## 公開

`main` へ push すると GitHub Actions が GitHub Pages にデプロイします。
