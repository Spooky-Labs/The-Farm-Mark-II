# The Farm Mark II - Spooky Labs Trading Platform

[![Google Cloud](https://img.shields.io/badge/Google%20Cloud-Platform-blue.svg)](https://cloud.google.com/)
[![Kubernetes](https://img.shields.io/badge/Kubernetes-Ready-326CE5.svg)](https://kubernetes.io/)
[![Terraform](https://img.shields.io/badge/Terraform-Infrastructure-623CE4.svg)](https://terraform.io/)

**Enterprise-grade AI trading platform with explainable decision recording and real-time paper trading capabilities.**

## 🚀 **What This Platform Does**

Spooky Labs is a complete trading platform that enables AI agents to make autonomous trading decisions while providing full explainability through our **Foundation Model Explainability Layer (FMEL)**. Every decision, from market analysis to trade execution, is captured, analyzed, and made transparent.

### **Core Capabilities:**
- 🤖 **AI Agent Trading** - Deploy custom trading algorithms with full autonomy
- 📊 **Real-time Market Data** - Live streaming from Alpaca Markets via WebSocket
- 🔍 **Complete Explainability** - Every trading decision recorded and analyzed
- 📈 **Paper Trading** - Risk-free testing with $25,000 virtual accounts
- 🏆 **Performance Analytics** - Comprehensive backtesting and live performance metrics
- 🔐 **Enterprise Security** - Private GKE cluster with Workload Identity

### **Architecture Overview:**

#### **High-Level System Architecture**
```mermaid
flowchart LR
    clients["🌐 Clients<br/>━━━━━━━━<br/>Web Dashboard<br/>API Clients<br/>Trading Bots"]

    gateway["🚪 API Gateway<br/>━━━━━━━━<br/>Cloud Function<br/>Authentication<br/>Rate Limiting"]

    gke["⚙️ GKE Cluster<br/>━━━━━━━━<br/>Data Ingestion<br/>Paper Trading<br/>Strategy Execution"]

    data["💾 Data Services<br/>━━━━━━━━<br/>BigQuery<br/>Redis<br/>Pub/Sub"]

    external["🔌 External APIs<br/>━━━━━━━━<br/>Alpaca Markets<br/>Firebase Auth"]

    clients -->|"HTTPS/REST"| gateway
    gateway <-->|"Cache & Queue"| data
    gateway -->|"Deploy agents"| gke
    gke <-->|"Market data & orders"| external
    gke <-->|"Store & Stream"| data
    external -->|"WebSocket stream"| gke

    classDef clientStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef gatewayStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef computeStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#fff
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef externalStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff

    class clients clientStyle
    class gateway gatewayStyle
    class gke computeStyle
    class data dataStyle
    class external externalStyle
```

#### **API Gateway & Client Layer**
```mermaid
flowchart TB
    subgraph clients["🌐 Client Applications"]
        web["Web Dashboard<br/>━━━━━━━━<br/>React SPA<br/>User management<br/>Agent monitoring"]
        sdk["API Clients<br/>━━━━━━━━<br/>Python SDK<br/>JavaScript SDK<br/>REST API"]
        agents["Trading Agents<br/>━━━━━━━━<br/>Custom strategies<br/>Backtest results<br/>Code submission"]
    end

    gateway["🚪 API Gateway<br/>Cloud Function Gen2<br/>━━━━━━━━━━━━━━"]

    subgraph endpoints["API Endpoints"]
        agent_api["POST /api/agents/submit<br/>GET /api/agents/list<br/>DELETE /api/agents/:id"]
        broker_api["POST /api/broker/create<br/>POST /api/broker/fund<br/>GET /api/broker/balance"]
        leaderboard["GET /api/leaderboard<br/>GET /api/leaderboard/user/:id"]
        fmel["GET /api/fmel/decisions<br/>GET /api/fmel/analytics"]
    end

    auth["🔐 Firebase Auth<br/>━━━━━━━━<br/>JWT validation<br/>User sessions"]

    redis[("⚡ Redis Cache<br/>━━━━━━━━<br/>Leaderboard<br/>Rate limits<br/><10ms")]

    web --> gateway
    sdk --> gateway
    agents --> gateway

    gateway --> agent_api
    gateway --> broker_api
    gateway --> leaderboard
    gateway --> fmel

    gateway <-->|"Validate tokens"| auth
    gateway <-->|"Cache reads"| redis

    classDef clientStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef gatewayStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef endpointStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:2px,color:#fff
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef authStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff

    class web,sdk,agents clientStyle
    class gateway gatewayStyle
    class agent_api,broker_api,leaderboard,fmel endpointStyle
    class redis dataStyle
    class auth authStyle
```

#### **Data Ingestion Pipeline**
```mermaid
flowchart LR
    alpaca["💼 Alpaca Markets<br/>━━━━━━━━━━<br/>WebSocket API"]

    ingester["📡 Unified Ingester<br/>GKE Deployment<br/>━━━━━━━━━━<br/>24/7 streaming<br/>Multi-symbol support"]

    subgraph pubsub["📬 Pub/Sub Topics"]
        stocks["market-data-stocks<br/>Real-time quotes"]
        crypto["market-data-crypto<br/>Digital assets"]
        news["news-feed<br/>Market news"]
    end

    bq[("📊 BigQuery<br/>━━━━━━━━<br/>market_data table<br/>Partitioned by date")]

    traders["🤖 Trading Agents<br/>━━━━━━━━<br/>Strategy execution<br/>Live subscriptions"]

    alpaca -->|"WebSocket<br/>streaming"| ingester
    ingester -->|"Publish"| stocks
    ingester -->|"Publish"| crypto
    ingester -->|"Publish"| news

    stocks -->|"Subscribe"| traders
    crypto -->|"Subscribe"| traders
    news -->|"Subscribe"| traders

    stocks -->|"Batch insert"| bq
    crypto -->|"Batch insert"| bq
    news -->|"Batch insert"| bq

    classDef externalStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff
    classDef computeStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef pubsubStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef dataStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#fff

    class alpaca externalStyle
    class ingester computeStyle
    class stocks,crypto,news pubsubStyle
    class bq dataStyle
    class traders computeStyle
```

#### **Paper Trading & FMEL Recording**
```mermaid
flowchart TB
    gateway["🚪 API Gateway<br/>━━━━━━━━<br/>Agent submission"]

    subgraph gke["⚙️ GKE Private Cluster"]
        direction TB

        subgraph agents["🤖 Paper Trading StatefulSets"]
            trader1["Agent Pod 1<br/>━━━━━━━━<br/>Backtrader engine<br/>Strategy execution<br/>Position tracking"]
            trader2["Agent Pod 2<br/>━━━━━━━━<br/>Different strategy"]
            trader3["Agent Pod N<br/>━━━━━━━━<br/>Scalable"]
        end

        fmel["📝 FMEL Library<br/>━━━━━━━━<br/>Decision recorder<br/>Backtrader analyzer<br/>Explainability layer"]
    end

    pubsub["📬 Pub/Sub<br/>━━━━━━━━<br/>Market data feed"]

    alpaca["💼 Alpaca API<br/>━━━━━━━━<br/>Paper trading<br/>Order execution"]

    bq[("📊 BigQuery<br/>━━━━━━━━<br/>fmel_decisions<br/>agent_performance")]

    storage[("📦 Cloud Storage<br/>━━━━━━━━<br/>Agent code<br/>Backtest results")]

    firestore[("🔥 Firestore<br/>━━━━━━━━<br/>Real-time positions<br/>Agent metadata")]

    gateway -->|"Deploy new agent"| agents
    gateway -->|"Upload code"| storage

    pubsub -->|"Stream quotes"| trader1
    pubsub -->|"Stream quotes"| trader2
    pubsub -->|"Stream quotes"| trader3

    trader1 --> fmel
    trader2 --> fmel
    trader3 --> fmel

    trader1 <-->|"Place orders<br/>Get positions"| alpaca
    trader2 <-->|"Place orders<br/>Get positions"| alpaca
    trader3 <-->|"Place orders<br/>Get positions"| alpaca

    fmel -->|"Record decisions<br/>Market context<br/>Performance"| bq

    trader1 <-->|"Update state<br/>Real-time sync"| firestore

    classDef gatewayStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef computeStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef fmelStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#fff
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef externalStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff

    class gateway gatewayStyle
    class trader1,trader2,trader3 computeStyle
    class fmel fmelStyle
    class pubsub,bq,storage,firestore dataStyle
    class alpaca externalStyle
```

#### **Data Storage & Analytics**
```mermaid
flowchart TB
    subgraph sources["Data Sources"]
        ingester["📡 Data Ingester<br/>Market data stream"]
        traders["🤖 Trading Agents<br/>FMEL decisions"]
        gateway["🚪 API Gateway<br/>User actions"]
    end

    subgraph storage["💾 GCP Data Services"]
        bq[("📊 BigQuery<br/>━━━━━━━━━━")]

        subgraph tables["BigQuery Tables"]
            market["market_data<br/>• Partitioned by date<br/>• Clustered by symbol<br/>• Real-time quotes"]
            fmel["fmel_decisions<br/>• Partitioned by timestamp<br/>• Clustered by agent_id<br/>• Decision records"]
            perf["agent_performance<br/>• Daily aggregations<br/>• Returns & metrics<br/>• Leaderboard source"]
        end

        redis[("⚡ Memorystore Redis<br/>━━━━━━━━━━<br/>• Sorted sets leaderboard<br/>• Session cache<br/>• Rate limit counters<br/>• Sub-10ms latency")]

        firestore[("🔥 Firestore<br/>━━━━━━━━━━<br/>• User accounts<br/>• Agent metadata<br/>• Real-time positions<br/>• Live updates")]

        gcs[("📦 Cloud Storage<br/>━━━━━━━━━━<br/>• Agent code bundles<br/>• Backtest archives<br/>• Log files<br/>• Lifecycle policies")]
    end

    subgraph consumers["Data Consumers"]
        analytics["📈 Analytics<br/>Backtesting & reports"]
        leaderboard["🏆 Leaderboard<br/>Rankings & stats"]
        monitoring["📊 Monitoring<br/>Alerts & dashboards"]
    end

    ingester -->|"Stream insert"| market
    traders -->|"Batch insert"| fmel
    traders -->|"Batch insert"| perf
    gateway -->|"Write-through"| redis
    traders -->|"Real-time sync"| firestore
    gateway -->|"Upload objects"| gcs

    bq --> tables

    market --> analytics
    fmel --> analytics
    perf --> leaderboard

    redis --> leaderboard

    bq --> monitoring

    classDef sourceStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef tableStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:2px,color:#fff
    classDef consumerStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff

    class ingester,traders,gateway sourceStyle
    class bq,redis,firestore,gcs dataStyle
    class market,fmel,perf tableStyle
    class analytics,leaderboard,monitoring consumerStyle
```

## 🎯 **Quick Start**

### **Prerequisites:**
- Google Cloud Platform account with billing enabled
- `gcloud`, `terraform`, `kubectl` installed
- Alpaca Markets API keys ([Get them here](https://alpaca.markets/))

### **1. Clone & Configure**
```bash
git clone https://github.com/Spooky-Labs/The-Farm-Mark-II.git
cd The-Farm-Mark-II

# Set up environment
cp .env.example .env
# Edit .env with your Alpaca API keys and GCP project
```

### **2. Deploy Infrastructure**
```bash
# Deploy GCP infrastructure with Terraform (8-10 min)
cd terraform
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars with your project_id

# Initialize and deploy (single file, 400 lines)
terraform init -backend-config="bucket=YOUR_PROJECT-terraform-state"
terraform plan   # Review what will be created
terraform apply  # Deploy: GKE, Redis, BigQuery, Pub/Sub, Storage

# Get credentials
gcloud container clusters get-credentials farm-cluster --region us-central1
```

### **3. Deploy Services**
```bash
# Deploy all cloud functions and containers
bash scripts/deploy.sh

# Verify deployment
bash scripts/test-deployment.sh
```

### **4. Submit Your First Agent**
```bash
curl -X POST https://REGION-PROJECT.cloudfunctions.net/api-gateway/api/agents/submit \
  -H "Authorization: Bearer YOUR_FIREBASE_TOKEN" \
  -F "agentName=MyFirstAgent" \
  -F "file=@my_strategy.py"
```

## 📁 **Project Structure**

```
The-Farm-Mark-II/
├── cloud-functions/
│   └── api-gateway/         # Unified API Gateway (consolidates all routes)
├── data-ingesters/
│   └── unified-ingester/    # Single ingester (stocks + crypto + news)
├── containers/
│   └── paper-trader/        # GKE paper trading StatefulSets
├── kubernetes/              # GKE manifests (data ingestion + paper trading)
├── terraform/               # Infrastructure as Code (single main.tf)
│   ├── main.tf             # All resources (400 lines)
│   ├── variables.tf        # 5 simple variables
│   └── README.md           # Deployment guide
├── scripts/                 # Deployment automation
├── tests/                   # Comprehensive test suite
├── shared/
│   └── fmel-library/        # Shared FMEL (Backtrader Analyzer)
├── schemas/                 # BigQuery table schemas
└── docs/                    # Complete documentation
    ├── architecture/        # Architecture docs (ARCHITECTURE.md, FMEL_COMPLETE.md, etc.)
    ├── deployment/          # Deployment guides (DEPLOYMENT.md, etc.)
    ├── operations/          # Operations guides (OPERATIONS.md, SECURITY.md, etc.)
    └── reference/           # Reference materials (ENDPOINTS.md, MEMORY.md, etc.)
```

## 🔧 **Key Components**

### **🌐 API Gateway (`cloud-functions/api-gateway/`)**
- **Purpose:** Single unified Cloud Function for all API operations
- **Routes:**
  - `/api/agents/*` - Agent submission and management
  - `/api/broker/*` - Account creation and funding
  - `/api/paper-trading/*` - Paper trading control
  - `/api/leaderboard` - Redis-cached rankings (<10ms)
  - `/api/fmel/*` - Decision analytics
- **Features:**
  - Firebase Authentication (supports both `Bearer token` and raw `token` formats)
  - Rate limiting per user/operation
  - Redis-backed caching for performance
  - Legacy endpoint compatibility for existing website

### **🤖 Trading Agents (`containers/paper-trader/`)**
- **Purpose:** Autonomous trading execution in Kubernetes
- **Features:** Real-time market data, order execution, position management
- **Integration:** Alpaca broker API, FMEL recording, Pub/Sub messaging

### **📊 FMEL Recording (`shared/fmel-library/`)**
- **Purpose:** Complete decision explainability and audit trail
- **Features:** Real-time decision capture, market context recording, performance analytics
- **Storage:** BigQuery for analytics, Firestore for real-time access

### **💾 Data Pipeline (`data-ingesters/unified-ingester/`)**
- **Purpose:** Unified market data ingestion (stocks + crypto + news)
- **Deployment:** GKE Kubernetes (24/7 WebSocket streaming)
- **Flow:** Alpaca WebSocket → Pub/Sub → BigQuery + Paper Trading Agents
- **Cost:** ~$15/month for small pod (0.25 CPU, 512MB RAM)

### **🏗️ Infrastructure (`terraform/`)**
- **Purpose:** Complete GCP infrastructure provisioning with monitoring
- **Structure:** Single `main.tf` file (~1100 lines, easy to understand)
- **Components:** Private GKE cluster, Pub/Sub topics, BigQuery datasets + tables, IAM policies, Cloud Monitoring
- **BigQuery:** 3 datasets, 3 tables with partitioning and clustering optimizations
- **Monitoring:** Alert policies, dashboards, notification channels (when `alert_email` is set)
- **Security:** Workload Identity, network policies, private endpoints
- **Deployment:** 8-10 minutes
- **Architecture:** Single file, 2 service accounts, predefined IAM roles

## 🛡️ **Security Features**

- **🔐 Private GKE Cluster** - All workloads isolated from public internet
- **🎫 Workload Identity** - Secure GCP service account binding
- **🚧 Network Policies** - Pod-level traffic isolation
- **🔑 Secret Management** - Alpaca credentials stored in Kubernetes secrets
- **🛡️ Authentication** - Firebase token-based API security

## 📈 **Performance & Monitoring**

- **📊 Prometheus Metrics** - Real-time performance monitoring
- **🚨 Alert Policies** - Proactive issue detection
- **📈 BigQuery Analytics** - Historical performance analysis
- **🏆 Leaderboards** - Public agent performance rankings

## 🧪 **Testing Strategy**

```bash
# Run all tests
bash scripts/verify-system.sh      # System verification (48 tests)
bash tests/test_terraform_quick.sh # Terraform validation (17 tests)
node tests/test_api_gateway.js     # API Gateway tests
python tests/test_data_flow.py     # Data flow integration tests
bash scripts/test-integration.sh   # Integration tests
```

## 📚 **Documentation**

All documentation is organized in the `docs/` directory:

### Architecture
- **[Architecture Guide](docs/architecture/ARCHITECTURE.md)** - Complete system design
- **[FMEL Guide](docs/architecture/FMEL_COMPLETE.md)** - Explainability layer documentation
- **[Agent Runtime](docs/architecture/AGENT_RUNTIME.md)** - Agent execution environment
- **[Data Platform](docs/architecture/DATA_PLATFORM.md)** - Data infrastructure details

### Deployment
- **[Deployment Guide](docs/deployment/DEPLOYMENT.md)** - Complete deployment guide with step-by-step instructions

### Operations
- **[Operations Guide](docs/operations/OPERATIONS.md)** - Operational runbook
- **[Security Guide](docs/operations/SECURITY.md)** - Security implementation details
- **[Roadmap](docs/operations/ROADMAP.md)** - Development roadmap

### Reference
- **[API Reference](docs/reference/ENDPOINTS.md)** - Complete API documentation
- **[Project Memory](docs/reference/MEMORY.md)** - Project evolution, history, and key decisions
- **[Redis Leaderboard](docs/reference/REDIS_LEADERBOARD_SETUP.md)** - Leaderboard implementation

## 🛣️ **Development Roadmap**

- **Phase 1:** ✅ Core platform with paper trading
- **Phase 2:** 🚧 Advanced analytics and ML insights
- **Phase 3:** 📋 Multi-broker support and live trading
- **Phase 4:** 📋 Public marketplace for trading agents

## 🤝 **Contributing**

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Run tests (`npm test && bash test-deployment.sh`)
4. Commit your changes (`git commit -m 'Add amazing feature'`)
5. Push to the branch (`git push origin feature/amazing-feature`)
6. Open a Pull Request

## 🆘 **Support**

- **Issues:** [GitHub Issues](https://github.com/Spooky-Labs/The-Farm-Mark-II/issues)
- **Documentation:** [Project Documentation](./)
- **Email:** support@spookylabs.com

---

**Built with ❤️ by the Spooky Labs team**