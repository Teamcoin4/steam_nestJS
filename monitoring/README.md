# 🔍 Monitoring Stack

완벽한 관측성을 위한 Docker 기반 모니터링 스택

## 📊 Services

| Service          | Port | Description         | URL                   |
| ---------------- | ---- | ------------------- | --------------------- |
| **Grafana**      | 3000 | 시각화 대시보드     | http://localhost:3000 |
| **Prometheus**   | 9090 | 메트릭 수집 및 저장 | http://localhost:9090 |
| **Loki**         | 3100 | 로그 집계           | http://localhost:3100 |
| **Tempo**        | 3200 | 분산 트레이싱       | http://localhost:3200 |
| **AlertManager** | 9093 | 알림 관리           | http://localhost:9093 |

**기본 로그인 (Grafana):** `admin` / `admin`

---

## 🚀 Quick Start

### 1. AlertManager 설정

**Option A: 자동 설정 (PowerShell)**

```powershell
# alertmanager 폴더로 이동
cd monitoring\alertmanager

# 템플릿에서 설정 파일 생성
Copy-Item alertmanager.yml.template alertmanager.yml

# 이제 alertmanager.yml을 열어서 실제 Webhook URL로 수정하세요
notepad alertmanager.yml
```

**Option B: 수동 설정**

1. `monitoring/alertmanager/alertmanager.yml.template` 파일을 복사
2. 같은 폴더에 `alertmanager.yml`로 저장
3. `slack_api_url` 부분에 실제 Slack Webhook URL 입력

**Slack Webhook URL 형식:**

```
https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

### 2. Docker Compose 실행

```bash
# monitoring 폴더에서
docker compose up -d

# 상태 확인
docker compose ps

# 로그 확인
docker compose logs -f
```

---

### 3. 서비스 확인

**Prometheus Targets 확인:**

```
http://localhost:9090/targets
```

→ `steam-nestjs` job이 **UP** 상태인지 확인

**Grafana에서 데이터 확인:**

1. http://localhost:3000 접속
2. 로그인: `admin` / `admin`
3. Explore → Prometheus 선택
4. 쿼리: `http_requests_total`
5. Run query

**Loki 로그 확인:**

1. Grafana Explore → Loki 선택
2. 쿼리: `{app="steam-nestjs"}`
3. Run query

---

## 📱 Slack 알림 설정

### Webhook URL 생성 방법

1. **Slack 워크스페이스**로 이동
2. 좌측 하단 **Apps** 클릭
3. **Incoming Webhooks** 검색
4. **Add to Slack** 클릭
5. 알림을 받을 **채널 선택** (예: #alerts)
6. **Add Incoming WebHooks integration** 클릭
7. **Webhook URL 복사**
8. `monitoring/alertmanager/alertmanager.yml`에 붙여넣기

### 알림 테스트

```bash
# AlertManager 재시작
docker compose restart alertmanager

# 테스트 알림 전송
curl -X POST http://localhost:9093/api/v1/alerts -d '[
  {
    "labels": {
      "alertname": "TestAlert",
      "severity": "warning"
    },
    "annotations": {
      "summary": "테스트 알림입니다",
      "description": "AlertManager 설정이 정상입니다"
    }
  }
]' -H "Content-Type: application/json"
```

Slack 채널에 알림이 오면 성공! ✅

---

## 🔧 Troubleshooting

### 1. Prometheus가 메트릭을 수집하지 못할 때

**증상:** Grafana에서 "No data" 표시

**해결:**

```bash
# Prometheus targets 확인
curl http://localhost:9090/api/v1/targets

# NestJS 메트릭 엔드포인트 직접 확인
curl http://localhost:3001/api/v1/metrics

# Prometheus 재시작
docker compose restart prometheus
```

### 2. Loki에 로그가 안 올 때

**확인:**

- NestJS 앱이 실행 중인지
- `.env`에 `ENABLE_MONITORING=true` 설정되어 있는지
- Loki 컨테이너가 실행 중인지

```bash
docker compose logs loki
```

### 3. AlertManager가 Slack 알림을 안 보낼 때

**확인:**

- `alertmanager.yml`에 올바른 Webhook URL이 있는지
- Slack 채널 이름이 정확한지 (# 포함)
- AlertManager 로그 확인:

```bash
docker compose logs alertmanager
```

---

## 📊 주요 메트릭

### HTTP 메트릭

```promql
# 총 요청 수
http_requests_total

# 초당 요청 수
rate(http_requests_total[1m])

# 경로별 요청 수
sum by (path) (http_requests_total)

# 평균 응답 시간
rate(http_request_duration_seconds_sum[1m]) / rate(http_request_duration_seconds_count[1m])

# 에러율
rate(http_errors_total[1m])

# 활성 연결
http_active_connections
```

### 시스템 메트릭

```promql
# CPU 사용률
rate(process_cpu_seconds_total[1m]) * 100

# 메모리 사용량 (MB)
process_resident_memory_bytes / 1024 / 1024

# 이벤트 루프 지연
nodejs_eventloop_lag_seconds
```

---

## 🗂️ 파일 구조

```
monitoring/
├── docker-compose.yml                    # 모든 서비스 정의
├── README.md                             # 이 문서
├── prometheus/
│   ├── prometheus.yml                    # Prometheus 설정
│   └── rules/
│       └── alerts.yml                    # 알림 규칙
├── alertmanager/
│   ├── alertmanager.yml.template         # AlertManager 템플릿
│   └── alertmanager.yml                  # 실제 설정 (git 제외)
├── grafana/
│   └── provisioning/
│       ├── datasources/
│       │   └── datasources.yml           # 데이터 소스 자동 설정
│       └── dashboards/
│           └── dashboards.yml            # 대시보드 자동 설정
├── loki/
│   └── loki-config.yml                   # Loki 설정
└── tempo/
    └── tempo-config.yml                  # Tempo 설정
```

---

## 🔄 유지보수

### 로그 보기

```bash
# 전체 로그
docker compose logs -f

# 특정 서비스만
docker compose logs -f prometheus
docker compose logs -f grafana
```

### 재시작

```bash
# 전체 재시작
docker compose restart

# 특정 서비스만
docker compose restart prometheus
```

### 정지 및 삭제

```bash
# 정지
docker compose stop

# 삭제 (데이터 보존)
docker compose down

# 완전 삭제 (데이터도 삭제)
docker compose down -v
```

---

## 📚 참고 문서

- [Prometheus 공식 문서](https://prometheus.io/docs/)
- [Grafana 공식 문서](https://grafana.com/docs/)
- [Loki 공식 문서](https://grafana.com/docs/loki/)
- [AlertManager 공식 문서](https://prometheus.io/docs/alerting/latest/alertmanager/)

---

## ✨ 기여

이 모니터링 스택에 대한 개선 사항이나 문제가 있다면 이슈를 열어주세요!
