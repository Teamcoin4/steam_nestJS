# 🔍 Steam NestJS 모니터링 스택

Grafana, Prometheus, Loki, Tempo, AlertManager를 사용한 완전한 관측성(Observability) 스택

## 📦 포함된 도구들

- **Prometheus** (`:9090`) - 메트릭 수집 및 저장
- **Loki** (`:3100`) - 로그 집계 시스템
- **Tempo** (`:3200`) - 분산 트레이싱
- **Grafana** (`:3000`) - 통합 시각화 대시보드
- **AlertManager** (`:9093`) - 알림 관리 및 Slack 연동

## 🚀 빠른 시작

### 1. 모니터링 스택 시작

```bash
cd monitoring
docker compose up -d
```

### 2. 서비스 확인

```bash
docker compose ps
```

### 3. 접속

- Grafana: http://localhost:3000 (admin/admin)
- Prometheus: http://localhost:9090
- AlertManager: http://localhost:9093

## ⚙️ Slack 알림 설정

1. Slack Webhook URL 생성
2. `alertmanager/alertmanager.yml` 파일 수정:

```yaml
global:
  slack_api_url: 'YOUR_SLACK_WEBHOOK_URL_HERE'
```

3. AlertManager 재시작:

```bash
   docker compose restart alertmanager
```

## 📊 Grafana 초기 설정

Grafana 로그인 후:

1. Prometheus, Loki, Tempo 데이터소스 자동 연결됨
2. Explore에서 데이터 확인 가능

## 🛑 중지 및 삭제

```bash
# 중지
docker compose stop

# 중지 및 삭제
docker compose down

# 데이터까지 완전 삭제
docker compose down -v
```

## 📝 NestJS 애플리케이션 연동

다음 단계에서 NestJS 앱에 모니터링 코드를 추가합니다.
