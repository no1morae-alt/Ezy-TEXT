[README.md](https://github.com/user-attachments/files/30368592/README.md)
# Easy TEXT — Cloudflare 배포 가이드

이 폴더는 GitHub + Cloudflare Pages로 바로 올릴 수 있도록 준비된 버전이에요.

```
cloudflare-deploy/
├── public/
│   └── index.html        ← 실제 웹앱 (Claude 전용 기능을 Cloudflare용으로 교체함)
└── functions/
    └── api/
        ├── storage.js     ← 회원/게시판/기본정보 저장 (Cloudflare KV 사용)
        └── generate.js    ← ✨ AI 문구 생성 버튼 (Anthropic API 프록시)
```

원래 파일에서 바뀐 부분은 딱 두 가지뿐이에요:
1. `window.storage` (Claude 전용 저장소) → `/api/storage`를 호출하도록 교체 (기존 코드는 하나도 안 건드렸어요)
2. AI 생성 버튼이 Anthropic API를 직접 호출하던 것 → `/api/generate`를 거치도록 교체 (API 키를 브라우저에 노출하지 않기 위함)

---

## 1단계. GitHub에 올리기

터미널에서 이 폴더 그대로 새 저장소에 올려주세요.

```bash
cd cloudflare-deploy
git init
git add .
git commit -m "Easy TEXT - Cloudflare 배포용"
git branch -M main
git remote add origin https://github.com/내계정/저장소이름.git
git push -u origin main
```

(GitHub 홈페이지에서 "New repository"로 빈 저장소를 먼저 만들어두셔야 해요.)

---

## 2단계. Cloudflare에서 KV 네임스페이스 만들기

1. [Cloudflare 대시보드](https://dash.cloudflare.com) 로그인
2. 왼쪽 메뉴 **Workers & Pages** → **KV** 클릭
3. **Create a namespace** 클릭 → 이름은 원하는 대로 (예: `instructor-email-kv`) → 생성

---

## 3단계. Cloudflare Pages 프로젝트 만들기 (GitHub 연동)

1. **Workers & Pages** → **Create application** → **Pages** 탭 → **Connect to Git**
2. 방금 만든 GitHub 저장소 선택
3. 빌드 설정:
   - **Build command**: 비워두기 (그대로 두세요)
   - **Build output directory**: `public`
4. **Save and Deploy** 클릭 → 몇 분 안에 첫 배포가 완료돼요 (이 시점엔 아직 저장/AI 기능은 안 돼요, 다음 단계에서 연결)

---

## 4단계. KV 네임스페이스 연결하기

1. 방금 만든 Pages 프로젝트 → **Settings** → **Functions** → **KV namespace bindings**
2. **Add binding** 클릭
   - **Variable name**: `STORAGE_KV`  ← 반드시 이 이름 그대로 입력해주세요
   - **KV namespace**: 2단계에서 만든 네임스페이스 선택
3. 저장

---

## 5단계. Anthropic API 키 등록하기

✨ AI 생성 버튼을 쓰려면 Anthropic API 키가 필요해요. [console.anthropic.com](https://console.anthropic.com)에서 발급받으세요 (사용한 만큼 과금되는 유료 API예요).

1. Pages 프로젝트 → **Settings** → **Environment variables**
2. **Add variable** 클릭
   - **Variable name**: `ANTHROPIC_API_KEY`  ← 반드시 이 이름 그대로
   - **Value**: 발급받은 키 붙여넣기
   - **Encrypt** 체크 (비밀값이니 꼭 암호화해주세요)
3. 저장

---

## 6단계. 다시 배포하기

4~5단계에서 설정을 바꾸면, Pages 프로젝트 → **Deployments** 탭에서 가장 최근 배포 옆 **⋯** → **Retry deployment**를 눌러 재배포해주세요 (환경변수는 재배포해야 반영돼요).

배포가 끝나면 `https://저장소이름.pages.dev` 같은 주소로 바로 접속 가능해요. 원하시면 **Custom domains** 메뉴에서 갖고 계신 도메인도 연결할 수 있어요.

---

## 참고: Claude 버전과 달라지는 점

- **저장 범위**: "개인 데이터"(임시저장, 기본정보 등)는 이제 **브라우저(기기) 단위**로 저장돼요. 예전 Claude 버전과 동일하게, 다른 기기·다른 브라우저로 접속하면 그 데이터는 안 보여요 (로그인 여부와 무관). 회원가입/로그인 자체는 이 앱이 자체적으로 관리하는 기능이라 그대로 동작해요.
- **AI 생성 버튼**: 이제 Anthropic API 사용량만큼 실제 비용이 발생해요 (버튼 누를 때마다 소액 과금).
- **관리자 비밀번호**(`oiji2026`)나 게시판·회원 관련 로직은 전혀 안 바뀌었어요.

문제가 생기면 브라우저 개발자도구(F12) → Console 탭에서 에러 메시지를 확인해서 알려주시면 도와드릴게요.
