# The Farm Mark II - Spooky Labs Trading Platform

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
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
graph TB
    subgraph "Application Layer"
        A[Unified API Gateway<br/>Cloud Function<br/>• Agent submission<br/>• Account mgmt<br/>• Leaderboards]
        B[Data Ingestion<br/>GKE 24/7<br/>• WebSocket conn<br/>• Market data<br/>• News feed]
        C[Paper Trading<br/>GKE StatefulSets<br/>• Alpaca broker<br/>• Strategy exec<br/>• FMEL recording]
    end

    subgraph "Data & Infrastructure Layer"
        D[Memorystore Redis<br/>Sub-10ms<br/>• Leaderboards<br/>• Session cache]
        E[Pub/Sub<br/>Streaming<br/>• Market data<br/>• Alternative data]
        F[BigQuery<br/>FMEL Storage<br/>• Decisions<br/>• Analytics]
    end

    B --> E
    E --> C
    A --> D
    E --> F
    C --> F

    style A fill:#e1f5fe
    style B fill:#f3e5f5
    style C fill:#e8f5e9
    style D fill:#fff3e0
    style E fill:#fce4ec
    style F fill:#f1f8e9
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

## 📄 **License**

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 **Support**

- **Issues:** [GitHub Issues](https://github.com/Spooky-Labs/The-Farm-Mark-II/issues)
- **Documentation:** [Project Documentation](./)
- **Email:** support@spookylabs.com

---

**Built with ❤️ by the Spooky Labs team**