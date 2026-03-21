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
- 웹 대시보드
- 공개 텔레그램 채널 입력 수집
- 소스 상태 및 수집 헬스 체크

## 빠른 시작

현재 환경처럼 `venv` 생성이 어려운 경우를 기준으로 안내합니다.

```bash
./scripts/install-local.sh
cp .env.example .env
./scripts/run-local.sh
```

기본 웹 주소는 `http://127.0.0.1:8000` 입니다.

## 환경 변수

`.env.example` 파일을 참고하세요.

## 테스트

```bash
PYTHONPATH=./src:./.packages python3 -m pytest -q
```

## GitHub / Render 배포 준비

- 이 저장소에는 `render.yaml`이 포함되어 있어서 Render에서 바로 웹 서비스로 가져갈 수 있습니다.
- 기본 배포는 `pip install .` 후 `uvicorn`으로 앱을 실행합니다.
- `NEWSBOT_TELEGRAM_INPUT_ENABLED`는 기본적으로 `false`로 두었습니다.
- 로컬 비밀값 파일인 `.env`, 텔레그램 세션 파일, 로컬 패키지 폴더는 Git에서 제외됩니다.
