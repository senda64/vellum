# Vellum

ローカルフォルダの `main.md` を編集する Markdown エディタ（STEP A）。

- CodeMirror 6 による編集（ハイライト / 検索置換）
- 右側にライブ HTML プレビュー
- 論理アンカーによる双方向スクロール同期

デモ: [https://senda64.github.io/vellum/](https://senda64.github.io/vellum/)

Chrome / Edge で開き、`main.md` を含むフォルダを **Open Folder** で選択してください。サンプルは `example/` にあります。

## 開発

```bash
pnpm install
pnpm dev
```

## 公開

`main` へ push すると GitHub Actions が GitHub Pages にデプロイします。
