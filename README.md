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

### **Architecture Highlights:**

```mermaid
flowchart TB
    subgraph clients["🌐 Client Layer"]
        direction LR
        web["Web Dashboard<br/>React SPA"]
        api_clients["API Clients<br/>Python/JS SDK"]
        traders["Trading Agents<br/>Custom Strategies"]
    end

    subgraph gcp["☁️ Google Cloud Platform"]
        subgraph compute["Compute Layer"]
            direction TB
            gateway["🚪 API Gateway<br/>Cloud Function Gen2<br/>━━━━━━━━━━<br/>POST /api/agents/submit<br/>POST /api/broker/create<br/>GET /api/leaderboard<br/>GET /api/fmel/decisions"]

            subgraph gke["⚙️ GKE Private Cluster"]
                direction LR
                ingester["📡 Unified Ingester<br/>Deployment 24/7<br/>━━━━━━━━━━<br/>• Alpaca WebSocket<br/>• Stock quotes<br/>• Crypto quotes<br/>• News feed"]

                subgraph trading["🤖 Paper Trading"]
                    direction TB
                    trader1["Agent Pod 1<br/>StatefulSet<br/>━━━━━━━━━━<br/>• Backtrader engine<br/>• FMEL recorder<br/>• Strategy execution"]
                    trader2["Agent Pod 2<br/>StatefulSet"]
                    trader3["Agent Pod N<br/>StatefulSet"]
                end
            end
        end

        subgraph data["💾 Data Layer"]
            direction TB
            redis[("⚡ Memorystore Redis<br/>━━━━━━━━━━<br/>• Leaderboard cache<br/>• Session management<br/>• Rate limiting<br/><10ms latency")]

            pubsub["📬 Pub/Sub Topics<br/>━━━━━━━━━━<br/>• market-data-stocks<br/>• market-data-crypto<br/>• news-feed<br/>• trading-signals"]

            bq[("📊 BigQuery<br/>━━━━━━━━━━<br/>• fmel_decisions table<br/>• market_data table<br/>• agent_performance table<br/>Partitioned by date<br/>Clustered by agent_id")]

            firestore[("🔥 Firestore<br/>━━━━━━━━━━<br/>• User accounts<br/>• Agent metadata<br/>• Real-time positions")]

            storage[("📦 Cloud Storage<br/>━━━━━━━━━━<br/>• Agent code bundles<br/>• Backtest results<br/>• Log archives")]
        end

        subgraph external["🔌 External Services"]
            direction TB
            alpaca["💼 Alpaca Markets<br/>━━━━━━━━━━<br/>• Paper trading API<br/>• Market data stream<br/>• Order execution"]

            firebase["🔐 Firebase Auth<br/>━━━━━━━━━━<br/>• User authentication<br/>• JWT validation<br/>• API key mgmt"]
        end
    end

    %% Client connections
    web --> gateway
    api_clients --> gateway
    traders --> gateway

    %% API Gateway connections
    gateway <-->|"Cache R/W"| redis
    gateway -->|"Store decisions"| bq
    gateway <-->|"User auth"| firebase
    gateway -->|"Trigger deployment"| trading

    %% Ingester connections
    alpaca -->|"WebSocket stream"| ingester
    ingester -->|"Publish quotes"| pubsub
    ingester -->|"Archive data"| bq

    %% Pub/Sub fan-out
    pubsub -->|"Market data"| trader1
    pubsub -->|"Market data"| trader2
    pubsub -->|"Market data"| trader3
    pubsub -->|"Batch insert"| bq

    %% Trading agent connections
    trader1 <-->|"Orders & positions"| alpaca
    trader2 <-->|"Orders & positions"| alpaca
    trader3 <-->|"Orders & positions"| alpaca

    trader1 -->|"FMEL records"| bq
    trader2 -->|"FMEL records"| bq
    trader3 -->|"FMEL records"| bq

    trader1 -->|"Store strategy code"| storage
    trader1 <-->|"Real-time state"| firestore

    %% Styling
    classDef clientStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef computeStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef externalStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff
    classDef gkeStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:2px,color:#333

    class web,api_clients,traders clientStyle
    class gateway,ingester,trader1,trader2,trader3 computeStyle
    class redis,pubsub,bq,firestore,storage dataStyle
    class alpaca,firebase externalStyle
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