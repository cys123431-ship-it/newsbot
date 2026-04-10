# newsbot

개인용 뉴스 모음 프로그램입니다. 아래 범주의 공개 뉴스를 한곳에서 모아 봅니다.

- 코인
- 미국 경제/금융
- 테크(IT)
- 군사
- 한국 사회

## 기능

- RSS/API/공개 페이지 기반 뉴스 수집
- URL/제목 기반 중복 제거
- 한국 사회 분류 강화
- 압축형 단일 화면 뉴스 피드
- 소스 상태 및 수집 헬스 체크
- GitHub Pages용 정적 사이트 생성

## 실행 방식

이 저장소는 두 가지 방식으로 사용할 수 있습니다.

- 로컬 서버 모드: FastAPI로 로컬에서 계속 확인
- 정적 배포 모드: 같은 정적 빌드를 GitHub Pages와 Vercel에 각각 배포

## 로컬 서버 빠른 시작

현재 환경처럼 `venv` 생성이 어려운 경우를 기준으로 안내합니다.

Linux/macOS:

```bash
./scripts/install-local.sh
cp .env.example .env
./scripts/run-local.sh
```

Windows PowerShell:

```powershell
.\scripts\install-local.ps1
Copy-Item .env.example .env
.\scripts\run-local.ps1
```

PowerShell 보조 스크립트는 `py -3.12`를 기준으로 동작합니다. 로컬에 Python 3.12가 없으면 스크립트가 명확한 오류를 내고 중단되며, 이 경우 마지막 검증은 GitHub Actions CI를 기준으로 확인합니다.

기본 웹 주소는 `http://127.0.0.1:8000` 입니다.

## 정적 사이트 빌드

GitHub Pages에 올릴 결과물은 아래 명령으로 만듭니다.

Linux/macOS:

```bash
./scripts/build-static.sh
```

Windows PowerShell:

```powershell
.\scripts\build-static.ps1
```

결과물은 `site-dist/`에 생성됩니다.

GitHub Pages용 코드 배포 워크플로는 `.github/workflows/pages.yml`에 들어 있습니다.

뉴스 갱신용 GitHub Pages 보조 워크플로는 `.github/workflows/news-refresh.yml`에 들어 있습니다.

별도 운영면으로 Vercel도 지원합니다.

- Vercel build output: `site-dist/`
- Vercel build/cache settings: `vercel.json`
- 운영 설정 가이드: [`docs/vercel-ops.md`](docs/vercel-ops.md)

권장 운영 구조는 아래와 같습니다.

- GitHub Pages: 기존 공개본/백업
- Vercel: 새 메인 운영면
- cron-job.org: 12분 주기로 Vercel Deploy Hook 호출

## 환경 변수

`.env.example` 파일을 참고하세요.

정적 사이트 빌드에서 특히 중요한 값은 아래입니다.

- `NEWSBOT_NAVER_CLIENT_ID`
- `NEWSBOT_NAVER_CLIENT_SECRET`
- `NEWSBOT_TELEGRAM_API_ID`
- `NEWSBOT_TELEGRAM_API_HASH`
- `NEWSBOT_TELEGRAM_SESSION_STRING`
- `NEWSBOT_TELEGRAM_NEWS_CHANNELS`
- `NEWSBOT_STATIC_MIN_ARTICLES_TO_PUBLISH`
- `NEWSBOT_STATIC_MAX_ARTICLES_PER_SOURCE`
- `NEWSBOT_STATIC_MAX_TOTAL_ARTICLES`
- `NEWSBOT_MARKETS_ENABLED`
- `NEWSBOT_FMP_API_KEY`
- `NEWSBOT_COINGECKO_API_KEY`

`NEWSBOT_TELEGRAM_NEWS_CHANNELS`에는 추가로 읽고 싶은 공개 텔레그램 채널을 쉼표나 줄바꿈으로 넣을 수 있습니다. `@channel_name` 또는 `https://t.me/channel_name` 형식을 지원합니다.

## 테스트

Linux/macOS:

```bash
PYTHONPATH=./src:./.packages python3 -m pytest -q
```

Windows PowerShell:

```powershell
.\scripts\test-local.ps1
```

## GitHub Pages 배포 메모

- 공개 배포에서는 낮은 신뢰도의 발견용 소스만 제외합니다. 텔레그램 채널 기사도 정적 사이트에 포함됩니다.
- GitHub Actions에서 텔레그램 채널을 읽으려면 `NEWSBOT_TELEGRAM_API_ID`, `NEWSBOT_TELEGRAM_API_HASH`, `NEWSBOT_TELEGRAM_SESSION_STRING` 시크릿을 설정해야 합니다.
- Markets 탭의 미국주식 데이터는 `NEWSBOT_FMP_API_KEY`가 있으면 FMP를 우선 사용하고, 키가 없거나 요청이 실패하면 public Finviz fallback으로 계속 채웁니다.
- 빌드 결과 기사 수가 너무 적으면 워크플로를 실패시켜 기존 Pages 배포본을 유지합니다.
- 로컬 비밀값 파일인 `.env`, 텔레그램 세션 파일, 로컬 패키지 폴더는 Git에서 제외됩니다.

## Vercel 운영 메모

- Vercel은 GitHub Pages와 별개로 같은 저장소를 읽는 별도 프로젝트로 붙입니다.
- 코인 라이브 화면은 Binance 브라우저 조회를 그대로 쓰고, 정적 fallback만 동일 빌드 산출물을 재사용합니다.
- 코인 fallback manifest 경로는 더 이상 `/newsbot/...` 절대 경로에 고정되지 않으며, GitHub Pages와 Vercel 양쪽에서 같은 스크립트로 동작합니다.
- 실제 설정 절차는 [`docs/vercel-ops.md`](docs/vercel-ops.md)를 참고하세요.
