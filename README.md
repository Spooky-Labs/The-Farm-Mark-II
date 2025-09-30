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

> **The Farm Mark II** is a cloud-native AI trading platform built on Google Cloud Platform. The architecture follows a microservices pattern with event-driven data flow, enabling real-time market data processing, autonomous trading agent execution, and comprehensive decision explainability through our custom FMEL (Foundation Model Explainability Layer).

#### **High-Level System Architecture**

This diagram shows the five main components of the platform and how they interact. Data flows from external markets through our GKE cluster for processing, with the API Gateway serving as the primary interface for users and agents.

```mermaid
graph LR
    subgraph clients["🌐 Client Layer"]
        web["Web<br/>Dashboard"]
        sdk["API<br/>SDKs"]
        bots["Trading<br/>Bots"]
    end

    subgraph gcp["☁️ Google Cloud Platform"]
        gateway[/"🚪 API Gateway<br/><b>Cloud Function Gen2</b>"/]

        subgraph compute["⚙️ Compute - GKE Private Cluster"]
            ingester["📡 Data<br/>Ingester"]
            traders["🤖 Paper<br/>Trading"]
        end

        subgraph dataLayer["💾 Data Services"]
            redis[("⚡ Redis<br/><10ms")]
            pubsub{{"📬 Pub/Sub<br/>Streaming"}}
            bq[("📊 BigQuery<br/>Analytics")]
            firestore[("🔥 Firestore<br/>Real-time")]
        end
    end

    subgraph external["🔌 External APIs"]
        alpaca["💼 Alpaca<br/>Markets"]
        firebase["🔐 Firebase<br/>Auth"]
    end

    web & sdk & bots ==>|HTTPS + JWT| gateway
    gateway -.->|cache| redis
    gateway -->|deploy| traders
    gateway <-.->|auth| firebase

    alpaca ==>|WebSocket| ingester
    ingester ==>|publish| pubsub
    pubsub ==>|subscribe| traders

    traders <===>|orders| alpaca
    traders ==>|FMEL| bq
    traders -.->|sync| firestore

    ingester -.->|archive| bq
    gateway -.->|leaderboard| redis

    classDef clientNode fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef gatewayNode fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef computeNode fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#000
    classDef dataNode fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef externalNode fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff
    classDef subgraphStyle fill:#f9f9f9,stroke:#333,stroke-width:2px

    class web,sdk,bots clientNode
    class gateway gatewayNode
    class ingester,traders computeNode
    class redis,pubsub,bq,firestore dataNode
    class alpaca,firebase externalNode
    class clients,gcp,compute,dataLayer,external subgraphStyle

    linkStyle 0,1,2 stroke:#4A90E2,stroke-width:3px
    linkStyle 3 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
    linkStyle 4 stroke:#7B68EE,stroke-width:2px
    linkStyle 5 stroke:#50C878,stroke-width:2px,stroke-dasharray: 5
    linkStyle 6 stroke:#50C878,stroke-width:3px
    linkStyle 7 stroke:#FF8C42,stroke-width:3px
    linkStyle 8 stroke:#FF8C42,stroke-width:3px
    linkStyle 9 stroke:#50C878,stroke-width:3px
    linkStyle 10 stroke:#FF8C42,stroke-width:3px
    linkStyle 11 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
    linkStyle 12 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
    linkStyle 13 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
```

**Key Components:**
- **Client Applications**: Web dashboards, Python/JavaScript SDKs, and custom trading bots
- **API Gateway**: Serverless Cloud Function handling authentication, routing, and rate limiting
- **GKE Cluster**: Private Kubernetes cluster running data ingesters and trading agents
- **Data Layer**: BigQuery for analytics, Redis for caching, Pub/Sub for event streaming
- **External Services**: Alpaca Markets for trading/market data, Firebase for authentication

#### **Agent Submission Flow (Sequence Diagram)**

This sequence diagram shows the complete lifecycle of submitting a trading agent, from user authentication through deployment in Kubernetes. The process involves multiple systems coordinating to validate, store, and deploy the agent code securely.

```mermaid
sequenceDiagram
    autonumber
    actor User as 👤 User/Bot
    participant Web as 🌐 Web Client
    participant Gateway as 🚪 API Gateway
    participant Auth as 🔐 Firebase Auth
    participant Redis as ⚡ Redis Cache
    participant Storage as 📦 Cloud Storage
    participant K8s as ⚙️ Kubernetes API
    participant Pod as 🤖 Agent Pod
    participant Alpaca as 💼 Alpaca API

    User->>Web: Upload strategy.py + requirements.txt
    Web->>Gateway: POST /api/agents/submit<br/>(multipart/form-data + JWT)

    rect rgb(200, 220, 255)
        Note over Gateway,Auth: Authentication & Rate Limiting
        Gateway->>Auth: Validate JWT token
        Auth-->>Gateway: Token valid + user_id
        Gateway->>Redis: Check rate limit (user_id)
        Redis-->>Gateway: Within limit (9/10 today)
    end

    rect rgb(255, 220, 200)
        Note over Gateway,Storage: Code Storage & Validation
        Gateway->>Gateway: Validate Python syntax
        Gateway->>Gateway: Check for malicious imports
        Gateway->>Storage: Upload agent bundle<br/>(gs://farm-agents/user123/agent456.zip)
        Storage-->>Gateway: Upload complete (URL)
    end

    rect rgb(220, 255, 220)
        Note over Gateway,Pod: Kubernetes Deployment
        Gateway->>K8s: Create StatefulSet<br/>(agent-user123-456)
        K8s-->>Gateway: StatefulSet created
        K8s->>Pod: Start container<br/>(Python 3.11 image)
        Pod->>Storage: Download agent code
        Storage-->>Pod: Code bundle
        Pod->>Pod: pip install requirements.txt
        Pod->>Alpaca: Create paper account ($25k)
        Alpaca-->>Pod: Account ID: PAPER123
    end

    rect rgb(255, 255, 220)
        Note over Pod: Agent Execution Begins
        Pod->>Pod: Initialize Backtrader engine
        Pod->>Pod: Load strategy from user code
        Pod->>Pod: Subscribe to Pub/Sub (market data)
        Pod->>Pod: Start trading loop
    end

    Gateway-->>Web: 201 Created<br/>{agent_id, status: "deploying"}
    Web-->>User: ✅ Agent submitted!<br/>Deploying to Kubernetes...

    Note over Pod: Agent now runs 24/7<br/>until user stops or deletes it
```

**Flow Highlights:**
- **Steps 1-6**: User authentication and rate limiting (prevents abuse)
- **Steps 7-10**: Code validation and secure storage in Cloud Storage
- **Steps 11-17**: Kubernetes deployment with automatic environment setup
- **Steps 18-21**: Agent initialization and trading loop start
- **Total Time**: ~30-60 seconds from submission to first trade

#### **Agent Lifecycle (State Diagram)**

Trading agents progress through multiple states from submission to termination. This state diagram shows all possible transitions and the conditions that trigger them.

```mermaid
stateDiagram-v2
    [*] --> Submitted: User uploads code

    Submitted --> Validating: Gateway receives request
    Validating --> ValidationFailed: ❌ Syntax error or malicious code
    Validating --> StoringCode: ✅ Code passes checks
    ValidationFailed --> [*]

    StoringCode --> Deploying: Upload to Cloud Storage complete
    Deploying --> DeploymentFailed: ❌ K8s API error
    Deploying --> Starting: StatefulSet created
    DeploymentFailed --> [*]

    Starting --> InitializationFailed: ❌ pip install fails
    Starting --> Initializing: Container running
    InitializationFailed --> [*]

    Initializing --> Running: Backtrader engine ready

    state Running {
        [*] --> Subscribing: Connect to Pub/Sub
        Subscribing --> WaitingForData: Subscribed to market-data-*
        WaitingForData --> Analyzing: Market data received
        Analyzing --> Holding: No signal
        Analyzing --> PlacingOrder: Buy/sell signal
        PlacingOrder --> WaitingForFill: Order submitted to Alpaca
        WaitingForFill --> Recording: Order filled
        Recording --> Holding: FMEL record written to BigQuery
        Holding --> Analyzing: Next market data tick
    }

    Running --> Paused: User pauses agent
    Paused --> Running: User resumes agent
    Paused --> Stopping: User deletes agent

    Running --> Error: Runtime exception
    Error --> Running: Auto-restart (3 attempts)
    Error --> Failed: Max retries exceeded

    Running --> Stopping: User deletes agent
    Running --> Stopping: Account depleted
    Stopping --> CleaningUp: Graceful shutdown
    CleaningUp --> [*]: Resources released

    Failed --> [*]

    note right of Running
        Most agents spend 99% of
        their time in Running state,
        executing the inner loop
    end note

    note right of Validating
        Security checks:
        - No os.system() calls
        - No file system access
        - No network except approved APIs
    end note
```

**State Descriptions:**
- **Submitted → Validating**: Gateway checks Python syntax and security constraints (~2s)
- **Deploying → Starting**: Kubernetes creates pod with persistent volume (~10-20s)
- **Running**: Inner loop processes market data, makes trading decisions, records to FMEL
- **Paused**: Agent stops trading but maintains state (can resume instantly)
- **Error → Running**: Automatic restart with exponential backoff (3 attempts before failing)
- **Average Uptime**: 99.5% for healthy agents, with automatic recovery from transient failures

#### **API Gateway & Client Layer**

The API Gateway serves as the single entry point for all client interactions. It's a Cloud Function Gen2 that handles authentication, rate limiting, request routing, and caching. All endpoints support Firebase JWT authentication and have configurable rate limits per user and operation type.

```mermaid
flowchart TB
    subgraph clients["🌐 Client Applications"]
        direction LR
        web{{"Web Dashboard<br/>━━━━━━━━<br/>React SPA<br/>Real-time updates<br/>Agent monitoring"}}
        sdk[/"Python/JS SDK<br/>━━━━━━━━<br/>Type-safe clients<br/>Async support<br/>Error handling"/]
        agents[\"Custom Trading Bots<br/>━━━━━━━━<br/>Strategy development<br/>Backtest locally<br/>Submit to platform"/]
    end

    gateway[/"🚪 API Gateway<br/>━━━━━━━━━━━━━━<br/>Cloud Function Gen2<br/>Node.js Runtime<br/>Auto-scaling"/]

    subgraph endpoints["📍 RESTful API Endpoints"]
        direction TB
        agent_api["👤 Agent Management<br/>━━━━━━━━<br/>POST /api/agents/submit<br/>GET /api/agents/list<br/>DELETE /api/agents/:id<br/>GET /api/agents/:id/status"]
        broker_api["💼 Broker Operations<br/>━━━━━━━━<br/>POST /api/broker/create<br/>POST /api/broker/fund<br/>GET /api/broker/balance<br/>GET /api/broker/positions"]
        leaderboard["🏆 Leaderboard<br/>━━━━━━━━<br/>GET /api/leaderboard<br/>GET /api/leaderboard/user/:id<br/>GET /api/leaderboard/top/:n"]
        fmel["📊 FMEL Analytics<br/>━━━━━━━━<br/>GET /api/fmel/decisions<br/>GET /api/fmel/analytics<br/>GET /api/fmel/agent/:id"]
    end

    auth>"🔐 Firebase Auth<br/>━━━━━━━━<br/>JWT validation<br/>Token refresh<br/>User sessions"]

    redis[("⚡ Memorystore Redis<br/>━━━━━━━━<br/>Leaderboard cache<br/>Rate limit counters<br/>Session storage<br/>Sub-10ms latency")]

    web ==>|"HTTPS + JWT"| gateway
    sdk ==>|"HTTPS + JWT"| gateway
    agents ==>|"HTTPS + JWT"| gateway

    gateway -->|"Route request"| agent_api
    gateway -->|"Route request"| broker_api
    gateway -->|"Route request"| leaderboard
    gateway -->|"Route request"| fmel

    gateway <-.->|"Validate JWT<br/>Check permissions"| auth
    gateway <===>|"Cache R/W<br/>Rate limiting"| redis

    classDef clientStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:4px,color:#fff
    classDef gatewayStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:4px,color:#fff
    classDef endpointStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#000
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:4px,color:#fff
    classDef authStyle fill:#50C878,stroke:#2E8B57,stroke-width:4px,color:#fff

    class web,sdk,agents clientStyle
    class gateway gatewayStyle
    class agent_api,broker_api,leaderboard,fmel endpointStyle
    class redis dataStyle
    class auth authStyle
```

**API Features:**
- **Authentication**: Firebase JWT tokens with automatic refresh
- **Rate Limiting**: Redis-backed counters (100 req/min per user, 10 req/min for submissions)
- **Caching**: Leaderboard cached for 30 seconds, reducing BigQuery costs
- **Legacy Support**: Maintains backward compatibility with existing website endpoints

#### **Data Ingestion Pipeline (Sankey Flow)**

The data ingestion system runs 24/7 in Kubernetes, maintaining persistent WebSocket connections to Alpaca Markets. It processes real-time market data (stocks, crypto, news) and publishes to Pub/Sub topics, enabling both real-time consumption by trading agents and batch archival to BigQuery for analytics.

```mermaid
%%{init: {'theme':'base', 'themeVariables': { 'primaryColor':'#50C878','primaryTextColor':'#fff','primaryBorderColor':'#2E8B57','lineColor':'#FF8C42','secondaryColor':'#7B68EE','tertiaryColor':'#9ACD32'}}}%%
graph LR
    subgraph source["🔌 Data Source"]
        alpaca["💼 Alpaca Markets<br/>━━━━━━━━<br/>WebSocket v2 API<br/>~1000 symbols<br/>24/7 streaming"]
    end

    subgraph ingestion["📡 Ingestion Layer - GKE"]
        ingester["Unified Ingester<br/>━━━━━━━━<br/>Python asyncio<br/>Auto-reconnect<br/>~10K msg/sec"]
    end

    subgraph messaging["📬 Message Bus - Pub/Sub"]
        direction TB
        stocks["market-data-stocks<br/>~5000 msg/sec"]
        crypto["market-data-crypto<br/>~1000 msg/sec"]
        news["news-feed<br/>~500 msg/sec"]
    end

    subgraph consumers["📤 Consumers"]
        direction TB
        trader1["🤖 Agent 1"]
        trader2["🤖 Agent 2"]
        traderN["🤖 Agent N"]
        bq["📊 BigQuery<br/>Archive"]
    end

    alpaca ==>|"WSS Connection<br/>JSON stream<br/>Low latency"| ingester

    ingester ==>|"5000/s"| stocks
    ingester ==>|"1000/s"| crypto
    ingester ==>|"500/s"| news

    stocks ==>|"Pull sub"| trader1
    stocks ==>|"Pull sub"| trader2
    stocks ==>|"Pull sub"| traderN
    stocks -.->|"Batch 1000"| bq

    crypto ==>|"Pull sub"| trader1
    crypto ==>|"Pull sub"| trader2
    crypto ==>|"Pull sub"| traderN
    crypto -.->|"Batch 1000"| bq

    news ==>|"Pull sub"| trader1
    news ==>|"Pull sub"| trader2
    news ==>|"Pull sub"| traderN
    news -.->|"Batch 1000"| bq

    classDef sourceStyle fill:#50C878,stroke:#2E8B57,stroke-width:4px,color:#fff
    classDef ingestStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:4px,color:#fff
    classDef pubsubStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:4px,color:#fff
    classDef consumerStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:4px,color:#000

    class alpaca sourceStyle
    class ingester ingestStyle
    class stocks,crypto,news pubsubStyle
    class trader1,trader2,traderN,bq consumerStyle

    linkStyle 0 stroke:#50C878,stroke-width:4px
    linkStyle 1 stroke:#FF8C42,stroke-width:3px
    linkStyle 2 stroke:#FF8C42,stroke-width:3px
    linkStyle 3 stroke:#FF8C42,stroke-width:3px
    linkStyle 4,5,6 stroke:#9ACD32,stroke-width:2px
    linkStyle 7 stroke:#666,stroke-width:2px,stroke-dasharray: 5
    linkStyle 8,9,10 stroke:#9ACD32,stroke-width:2px
    linkStyle 11 stroke:#666,stroke-width:2px,stroke-dasharray: 5
    linkStyle 12,13,14 stroke:#9ACD32,stroke-width:2px
    linkStyle 15 stroke:#666,stroke-width:2px,stroke-dasharray: 5
```

**Pipeline Metrics:**
- **Throughput**: ~6,500 messages/second peak, ~2,000 messages/second average
- **Latency**: <100ms from Alpaca → Pub/Sub → Agent (p95)
- **Availability**: 99.9% uptime with automatic failover and reconnection
- **Cost**: ~$15/month for ingester pod + ~$10/month for Pub/Sub at current volume
- **Data Volume**: ~500GB/month ingested, 30-day retention in BigQuery

#### **Paper Trading & FMEL Recording**

Trading agents run as Kubernetes StatefulSets, each with persistent storage and unique identity. They execute strategies using the Backtrader framework, receive real-time market data via Pub/Sub, and place orders through Alpaca's paper trading API. Every trading decision is captured by our FMEL (Foundation Model Explainability Layer) library and stored in BigQuery for complete transparency.

```mermaid
graph TB
    subgraph deployment["📦 Deployment"]
        gateway["🚪 API Gateway"]
        storage["📦 Cloud Storage"]
    end

    subgraph gke["⚙️ GKE Cluster - Workload Identity"]
        direction LR
        agent1["🤖 Agent 1<br/>StatefulSet"]
        agent2["🤖 Agent 2<br/>StatefulSet"]
        agentN["🤖 Agent N<br/>StatefulSet"]

        fmel["📝 FMEL Analyzer<br/>Backtrader plugin"]
    end

    subgraph data["💾 Data & External"]
        direction TB
        pubsub{{"📬 Pub/Sub<br/>Market Data"}}
        alpaca["💼 Alpaca API<br/>Paper Trading"]
        bq[("📊 BigQuery<br/>FMEL Records")]
        fs[("🔥 Firestore<br/>Live State")]
    end

    gateway -->|"Deploy"| agent1 & agent2 & agentN
    gateway -->|"Upload code"| storage
    storage -.->|"Download"| agent1

    pubsub ==>|"Stream"| agent1 & agent2 & agentN

    agent1 & agent2 & agentN <-->|"Orders"| alpaca
    agent1 & agent2 & agentN -->|"Decisions"| fmel

    fmel ==>|"Batch write"| bq
    agent1 -.->|"Real-time"| fs

    classDef deployStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef agentStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff
    classDef fmelStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:3px,color:#000
    classDef dataStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef externalStyle fill:#50C878,stroke:#2E8B57,stroke-width:3px,color:#fff

    class gateway,storage deployStyle
    class agent1,agent2,agentN agentStyle
    class fmel fmelStyle
    class pubsub,bq,fs dataStyle
    class alpaca externalStyle

    linkStyle 0,1,2 stroke:#4A90E2,stroke-width:2px
    linkStyle 3 stroke:#4A90E2,stroke-width:2px
    linkStyle 4 stroke:#4A90E2,stroke-width:2px,stroke-dasharray: 5
    linkStyle 5,6,7 stroke:#FF8C42,stroke-width:3px
    linkStyle 8,9,10 stroke:#50C878,stroke-width:2px
    linkStyle 11,12,13 stroke:#9ACD32,stroke-width:2px
    linkStyle 14 stroke:#FF8C42,stroke-width:3px
    linkStyle 15 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
```

**Agent Specifications:**
- **Runtime**: Python 3.11, Backtrader 1.9.78, 1 CPU / 2GB RAM per pod
- **Storage**: 10GB PersistentVolume per agent for state and logs
- **FMEL**: Captures every order with full market context (price, volume, indicators, reasoning)
- **Broker**: Alpaca Paper Trading API with $25,000 virtual starting balance
- **Uptime**: 99.5% with automatic restart on failure (3 retry attempts)

#### **Data Storage & Analytics**

The platform uses a multi-tier storage strategy: BigQuery for analytical workloads and long-term storage, Redis for sub-10ms caching, Firestore for real-time synchronization, and Cloud Storage for binary objects. This architecture optimizes for both cost and performance across different access patterns.

```mermaid
graph LR
    subgraph producers["📥 Producers"]
        ing["📡 Ingester"]
        agents["🤖 Agents"]
        gw["🚪 Gateway"]
    end

    subgraph storage["💾 Storage Layer"]
        direction TB

        subgraph bq["📊 BigQuery (~$50/mo)"]
            t1["market_data<br/>100GB/mo<br/>30d retention"]
            t2["fmel_decisions<br/>50GB/mo<br/>Unlimited"]
            t3["agent_performance<br/>1GB total<br/>Materialized view"]
        end

        redis[("⚡ Redis<br/>━━━<br/>5GB<br/><10ms<br/>$35/mo")]

        fs[("🔥 Firestore<br/>━━━<br/>Real-time<br/>100K reads/day<br/>$1/mo")]

        gcs[("📦 Storage<br/>━━━<br/>500GB<br/>Lifecycle: 90d<br/>$10/mo")]
    end

    subgraph consumers["📤 Consumers"]
        analytics["📈 Analytics<br/>Queries & Reports"]
        leader["🏆 Leaderboard<br/>Top 100"]
        monitor["📊 Monitoring<br/>Alerts & SLO"]
    end

    ing ==>|"Stream"| t1
    agents ==>|"Batch"| t2 & t3
    gw ==>|"Cache"| redis
    agents -.->|"Sync"| fs
    gw ==>|"Upload"| gcs

    t1 & t2 --> analytics
    t3 & redis ==> leader
    bq & redis -.-> monitor

    classDef prodStyle fill:#4A90E2,stroke:#2E5C8A,stroke-width:3px,color:#fff
    classDef storageStyle fill:#FF8C42,stroke:#CC6F33,stroke-width:3px,color:#fff
    classDef tableStyle fill:#9ACD32,stroke:#6B8E23,stroke-width:2px,color:#000
    classDef consumerStyle fill:#7B68EE,stroke:#4B3A9E,stroke-width:3px,color:#fff

    class ing,agents,gw prodStyle
    class redis,fs,gcs storageStyle
    class t1,t2,t3 tableStyle
    class analytics,leader,monitor consumerStyle

    linkStyle 0 stroke:#FF8C42,stroke-width:3px
    linkStyle 1,2 stroke:#9ACD32,stroke-width:3px
    linkStyle 3 stroke:#FF8C42,stroke-width:2px
    linkStyle 4 stroke:#FF8C42,stroke-width:2px,stroke-dasharray: 5
    linkStyle 5 stroke:#4A90E2,stroke-width:2px
    linkStyle 6,7 stroke:#7B68EE,stroke-width:2px
    linkStyle 8,9 stroke:#7B68EE,stroke-width:3px
    linkStyle 10 stroke:#666,stroke-width:2px,stroke-dasharray: 5
```

**Storage Breakdown:**
| Service | Purpose | Size | Latency | Cost/Month |
|---------|---------|------|---------|------------|
| **BigQuery** | Analytics, FMEL records, market data | 150GB | ~2-5s query | ~$50 |
| **Redis** | Leaderboard cache, rate limits | 5GB | <10ms | ~$35 |
| **Firestore** | Real-time positions, agent metadata | <1GB | <50ms | ~$1 |
| **Cloud Storage** | Code bundles, logs, backtests | 500GB | ~100ms | ~$10 |
| **Total** | Complete platform storage | ~650GB | Varies | **~$100** |

**Key Optimizations:**
- BigQuery partitioning reduces query costs by 90%
- Redis cache hit rate >95% for leaderboard
- Firestore real-time listeners for live updates
- Cloud Storage lifecycle moves old data to Archive after 90 days

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