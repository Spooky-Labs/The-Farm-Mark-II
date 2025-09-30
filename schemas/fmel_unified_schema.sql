-- Unified FMEL Schema for Spooky Labs Platform
-- Supports both backtesting and paper trading modes with unified structure

-- Create FMEL dataset if it doesn't exist (replace PROJECT_ID with actual project)
CREATE SCHEMA IF NOT EXISTS `PROJECT_ID.fmel`
OPTIONS (
  description = "Foundation Model Explainability Layer data",
  location = "US"
);

-- Main trading decisions table - unified for all modes
CREATE OR REPLACE TABLE `PROJECT_ID.fmel.trading_decisions` (
  -- Core identifiers
  decision_id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  agent_id STRING NOT NULL,
  user_id STRING NOT NULL,
  run_id STRING NOT NULL,
  session_id STRING NOT NULL,
  mode STRING NOT NULL, -- 'BACKTEST' or 'PAPER'

  -- Decision metadata
  decision_number INT64,
  decision_type STRING DEFAULT 'decision', -- 'decision', 'execution', 'trade_closed'

  -- Trading action
  symbol STRING,
  action_type STRING, -- 'buy', 'sell', 'hold', 'close'
  quantity INT64,
  price FLOAT64,

  -- Agent reasoning
  confidence FLOAT64, -- 0.0 to 1.0
  reasoning STRING,

  -- Market context (struct for complex data)
  market_context STRUCT<
    current_price FLOAT64,
    volume INT64,
    daily_change FLOAT64,
    portfolio_cash FLOAT64,
    portfolio_equity FLOAT64,
    market_sentiment STRING
  >,

  -- Portfolio state
  portfolio_value FLOAT64,
  position_value FLOAT64,

  -- Indicators (JSON string for flexibility)
  indicators STRING,

  -- Trade performance
  trade_pnl FLOAT64,
  daily_return FLOAT64,

  -- Metadata
  recorded_at TIMESTAMP NOT NULL,

  -- Additional fields for complex decisions
  order_details JSON,
  market_data JSON,
  positions JSON,
  news_sentiment JSON

)
PARTITION BY DATE(timestamp)
CLUSTER BY agent_id, user_id, mode, session_id
OPTIONS (
  description = "Unified FMEL trading decisions for both backtesting and paper trading",
  partition_expiration_days = 365
);

-- Run summaries table
CREATE OR REPLACE TABLE `PROJECT_ID.fmel.run_summaries` (
  -- Core identifiers
  run_id STRING NOT NULL,
  agent_id STRING NOT NULL,
  user_id STRING NOT NULL,
  session_id STRING NOT NULL,
  mode STRING NOT NULL,

  -- Summary statistics
  total_decisions INT64 DEFAULT 0,
  total_decision_points INT64 DEFAULT 0,
  actions_taken INT64 DEFAULT 0,
  trades_closed INT64 DEFAULT 0,
  executions INT64 DEFAULT 0,

  -- Performance metrics
  duration_seconds FLOAT64,
  total_return_percent FLOAT64,
  sharpe_ratio FLOAT64,
  max_drawdown_percent FLOAT64,
  win_rate_percent FLOAT64,

  -- Timestamps
  completed_at TIMESTAMP,
  recorded_at TIMESTAMP NOT NULL

)
PARTITION BY DATE(completed_at)
CLUSTER BY agent_id, mode
OPTIONS (
  description = "Summary statistics for FMEL runs",
  partition_expiration_days = 730
);

-- Create view for easy decision analysis
CREATE OR REPLACE VIEW `PROJECT_ID.fmel.decision_analysis` AS
SELECT
  decision_id,
  timestamp,
  agent_id,
  user_id,
  run_id,
  session_id,
  mode,
  decision_number,
  decision_type,
  symbol,
  action_type,
  quantity,
  price,
  confidence,
  reasoning,
  market_context,
  portfolio_value,
  position_value,
  trade_pnl,
  daily_return,
  recorded_at,

  -- Extract from JSON fields for easier querying
  JSON_EXTRACT_SCALAR(indicators, '$.sma_20') as sma_20,
  JSON_EXTRACT_SCALAR(indicators, '$.rsi') as rsi,
  JSON_EXTRACT_SCALAR(market_data, '$.volume') as volume,
  JSON_EXTRACT_SCALAR(news_sentiment, '$.label') as sentiment_label,

  -- Calculate derived metrics
  DATE(timestamp) as trade_date,
  EXTRACT(HOUR FROM timestamp) as trade_hour,
  CASE
    WHEN confidence >= 0.8 THEN 'high'
    WHEN confidence >= 0.6 THEN 'medium'
    ELSE 'low'
  END as confidence_category

FROM `PROJECT_ID.fmel.trading_decisions`
WHERE decision_type = 'decision';

-- Performance analytics view
CREATE OR REPLACE VIEW `PROJECT_ID.fmel.performance_analytics` AS
WITH agent_performance AS (
  SELECT
    agent_id,
    user_id,
    mode,
    session_id,

    -- Basic counts
    COUNT(*) as total_decisions,
    COUNT(CASE WHEN action_type IN ('buy', 'sell') THEN 1 END) as total_trades,

    -- Performance metrics
    COUNT(CASE WHEN trade_pnl > 0 THEN 1 END) as winning_trades,
    COUNT(CASE WHEN trade_pnl < 0 THEN 1 END) as losing_trades,

    -- Portfolio metrics
    MIN(portfolio_value) as min_portfolio_value,
    MAX(portfolio_value) as max_portfolio_value,
    FIRST_VALUE(portfolio_value) OVER (
      PARTITION BY agent_id, session_id
      ORDER BY timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as initial_portfolio_value,
    LAST_VALUE(portfolio_value) OVER (
      PARTITION BY agent_id, session_id
      ORDER BY timestamp
      ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
    ) as final_portfolio_value,

    -- Confidence metrics
    AVG(confidence) as avg_confidence,
    STDDEV(confidence) as confidence_stddev,

    -- Time metrics
    MIN(timestamp) as start_time,
    MAX(timestamp) as end_time,

    -- Recent activity
    MAX(recorded_at) as last_activity

  FROM `PROJECT_ID.fmel.decision_analysis`
  GROUP BY agent_id, user_id, mode, session_id
)
SELECT
  *,

  -- Calculate derived performance metrics
  SAFE_DIVIDE(winning_trades, winning_trades + losing_trades) * 100 as win_rate_percent,

  SAFE_DIVIDE(final_portfolio_value - initial_portfolio_value, initial_portfolio_value) * 100 as total_return_percent,

  SAFE_DIVIDE(max_portfolio_value - min_portfolio_value, min_portfolio_value) * 100 as max_gain_percent,

  TIMESTAMP_DIFF(end_time, start_time, SECOND) as duration_seconds

FROM agent_performance;

-- Leaderboard view for public rankings
CREATE OR REPLACE VIEW `PROJECT_ID.fmel.public_leaderboard` AS
SELECT
  pa.agent_id,
  pa.mode,

  -- Performance metrics
  pa.total_return_percent,
  pa.win_rate_percent,
  pa.total_trades,
  pa.avg_confidence,
  pa.last_activity,

  -- Agent metadata (to be joined with Firestore data)
  'public' as visibility_filter -- Only show public agents

FROM `PROJECT_ID.fmel.performance_analytics` pa
WHERE pa.total_trades >= 5 -- Minimum trades for leaderboard inclusion
  AND pa.last_activity >= TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 90 DAY) -- Active in last 90 days
ORDER BY pa.total_return_percent DESC;

-- Market data tables (for unified ingestion service)
CREATE OR REPLACE TABLE `PROJECT_ID.market_data.bars` (
  symbol STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  timeframe STRING NOT NULL, -- '1Min', '5Min', '15Min', '1Hour', '1Day'
  open FLOAT64,
  high FLOAT64,
  low FLOAT64,
  close FLOAT64,
  volume INT64,
  trade_count INT64,
  vwap FLOAT64,
  ingested_at TIMESTAMP NOT NULL,
  source STRING NOT NULL -- 'alpaca', etc.
)
PARTITION BY DATE(timestamp)
CLUSTER BY symbol, timeframe
OPTIONS (
  description = "Market data bars from various sources",
  partition_expiration_days = 2555 -- ~7 years
);

-- Alternative data table for diverse data sources
CREATE OR REPLACE TABLE `PROJECT_ID.alternative_data.unified_data` (
  data_id STRING NOT NULL,
  timestamp TIMESTAMP NOT NULL,
  data_type STRING NOT NULL, -- 'geospatial', 'census', 'social', 'economic', 'weather', etc.
  data_category STRING, -- More specific categorization
  data_source STRING NOT NULL, -- Provider/API name

  -- Geospatial fields
  location GEOGRAPHY,
  country_code STRING,
  region_code STRING,
  postal_code STRING,

  -- Associated symbols/entities
  symbols ARRAY<STRING>,
  entities ARRAY<STRING>, -- Companies, sectors, etc.

  -- Flexible data storage
  data_values JSON, -- Raw numerical/categorical data
  metadata JSON, -- Source-specific metadata

  -- Processed insights
  insights STRUCT<
    confidence FLOAT64,
    relevance_score FLOAT64,
    trend_direction STRING, -- 'up', 'down', 'stable'
    impact_assessment STRING -- 'positive', 'negative', 'neutral'
  >,

  -- Processing timestamps
  ingested_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(timestamp)
CLUSTER BY data_type, data_source, symbols
OPTIONS (
  description = "Unified alternative data including geospatial, census, social, and economic data",
  partition_expiration_days = 1825 -- 5 years
);

-- News data table
CREATE OR REPLACE TABLE `PROJECT_ID.news_data.articles` (
  article_id STRING NOT NULL,
  published_at TIMESTAMP NOT NULL,
  title STRING,
  summary STRING,
  content STRING,
  url STRING,
  source STRING,
  author STRING,
  symbols ARRAY<STRING>,
  category STRING, -- 'earnings', 'merger', 'regulatory', etc.
  sentiment STRUCT<
    polarity FLOAT64, -- -1.0 to 1.0
    subjectivity FLOAT64, -- 0.0 to 1.0
    label STRING -- 'positive', 'negative', 'neutral'
  >,
  importance_score FLOAT64, -- 0.0 to 1.0
  ingested_at TIMESTAMP NOT NULL,
  processed_at TIMESTAMP NOT NULL
)
PARTITION BY DATE(published_at)
CLUSTER BY symbols
OPTIONS (
  description = "Financial news articles with sentiment analysis",
  partition_expiration_days = 1095 -- 3 years
);

-- Indexes for performance (BigQuery automatically manages these, but documenting for clarity)
-- These are handled by clustering and partitioning above

-- Create materialized views for common queries (cost optimization)
CREATE MATERIALIZED VIEW `PROJECT_ID.fmel.daily_agent_performance`
PARTITION BY trade_date
CLUSTER BY agent_id
AS
SELECT
  agent_id,
  user_id,
  mode,
  DATE(timestamp) as trade_date,

  COUNT(*) as daily_decisions,
  COUNT(CASE WHEN action_type IN ('buy', 'sell') THEN 1 END) as daily_trades,
  AVG(confidence) as avg_daily_confidence,
  SUM(trade_pnl) as daily_pnl,

  LAST_VALUE(portfolio_value) OVER (
    PARTITION BY agent_id, DATE(timestamp)
    ORDER BY timestamp
    ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
  ) as end_of_day_portfolio_value

FROM `PROJECT_ID.fmel.trading_decisions`
WHERE decision_type = 'decision'
GROUP BY agent_id, user_id, mode, DATE(timestamp);

-- Create stored procedures for common analytics

-- Procedure to calculate agent risk metrics
CREATE OR REPLACE PROCEDURE `PROJECT_ID.fmel.calculate_risk_metrics`(
  IN agent_id_param STRING,
  IN start_date DATE,
  IN end_date DATE,
  OUT sharpe_ratio FLOAT64,
  OUT max_drawdown FLOAT64,
  OUT volatility FLOAT64
)
BEGIN
  DECLARE portfolio_values ARRAY<FLOAT64>;
  DECLARE returns ARRAY<FLOAT64>;

  -- Get portfolio values
  SET portfolio_values = (
    SELECT ARRAY_AGG(portfolio_value ORDER BY timestamp)
    FROM `PROJECT_ID.fmel.trading_decisions`
    WHERE agent_id = agent_id_param
      AND DATE(timestamp) BETWEEN start_date AND end_date
      AND portfolio_value IS NOT NULL
  );

  -- Calculate returns, Sharpe ratio, max drawdown, volatility
  -- (Implementation would use BigQuery ML functions or custom logic)

  SET sharpe_ratio = 0.0; -- Placeholder
  SET max_drawdown = 0.0; -- Placeholder
  SET volatility = 0.0; -- Placeholder
END;

-- Grant appropriate permissions (would be done via Terraform)
-- GRANT `roles/bigquery.dataViewer` ON SCHEMA `PROJECT_ID.fmel` TO ...
-- GRANT `roles/bigquery.dataEditor` ON TABLE `PROJECT_ID.fmel.trading_decisions` TO ...