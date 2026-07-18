# PRISM をネット公開してメンバーに共有する手順（Render・無料）

このフォルダ（`prism-deploy`）を無料クラウド **Render** に上げると、
メンバーは **スマホでURLを開くだけ** で Gemini の本物AI版を使えます。
APIキーはサーバー側の環境変数に隠れるので、ファイルには一切出ません（安全）。

このフォルダの中身：
- `index.html` … PRISM本体（最新版）
- `server.js` … Gemini/Claudeへ中継するサーバー
- `package.json` … 起動設定（`node server.js`）
- `.gitignore` … `.env` や node_modules を上げない設定

---

## 手順（10〜15分）

### 1. GitHubにこのフォルダを上げる
（GitHubアカウント `4shii7564hp-ctrl` は既にある前提）
1. GitHubで **New repository** →名前を `prism`（Publicでよい）→ Create。
2. このPCで、`prism-deploy` フォルダを push する。
   ※ 手伝ってほしければ「prismをGitHubにpushして」と言えば、その場でPAT（public_repoスコープ）をもらってこちらで実行します。

### 2. Renderでアカウント作成（無料）
1. https://render.com を開く → **Get Started** → **GitHubでサインアップ**。
2. メールなどの確認を済ませる。

### 3. Web Serviceとして公開
1. Renderのダッシュボードで **New +** → **Web Service**。
2. さっきの `prism` リポジトリを選ぶ（初回はGitHub連携の許可を求められる）。
3. 設定：
   - **Name**: 好きな名前（例 `prism`）→ これがURLになる（`https://prism-xxxx.onrender.com`）
   - **Region**: Singapore など近いところ
   - **Build Command**: 空でOK（依存パッケージなし）
   - **Start Command**: `node server.js`
   - **Instance Type**: **Free**
4. 下の **Environment Variables** で1つ追加：
   - **Key**: `GEMINI_API_KEY`
   - **Value**: あなたのGeminiキー（`4nin-soudan/.env` に入っているものと同じ）
5. **Create Web Service** を押す → 1〜3分でデプロイ完了。
6. 発行された **`https://〜.onrender.com`** をメンバーにLINE等で共有。

---

## 動作確認
- URLを開いてヘッダーに「**・AI稼働中（Gemini）**」と出ればOK。
- 「・オフラインdemo」と出る場合は、手順3-4の `GEMINI_API_KEY` が未設定/打ち間違い。Renderの環境変数を直して **Manual Deploy → Deploy latest commit**。

## 知っておくべきこと
- **無料枠は15分アクセスが無いとスリープ**し、次の最初のアクセスだけ起動に約30〜60秒かかります（2回目以降は速い）。発表直前に一度自分で開いて温めておくと安心。
- 公開URLなので、理屈上はURLを知る人が誰でもAIを使えます（あなたのGeminiキーの無料枠を消費）。メンバー限定共有なら実害は小さいですが、心配なら**簡易パスワード**を付けられます（「パスワード付けて」と言ってください）。
- キーが心配になったら、Google AI Studioでキーを**無効化→再発行**し、Renderの環境変数を差し替えるだけでリセットできます。

## 更新のしかた
PRISM本体を直したら、`prism.html` を このフォルダの `index.html` に上書きコピー → GitHubにpush → Renderが自動で再デプロイします。
