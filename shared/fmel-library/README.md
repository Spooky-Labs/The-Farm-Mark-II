# Spooky Labs FMEL Library

Foundation Model Explainability Layer (FMEL) - A unified Backtrader Analyzer for recording AI trading agent decisions.

## Overview

The FMEL Library provides a comprehensive solution for capturing and storing every decision made by AI trading agents in both backtesting and paper trading environments. It implements a Backtrader Analyzer that automatically records market data, portfolio state, positions, indicators, and agent reasoning at every decision point.

## Key Features

- **Universal Compatibility**: Works with any Backtrader strategy
- **Dual Mode Support**: Automatic detection of backtesting vs paper trading
- **Complete Decision Capture**: Records market data, indicators, portfolio state, and reasoning
- **Real-time Streaming**: Live decision streaming for paper trading
- **Batch Processing**: Efficient bulk storage for backtesting
- **Cloud-Native**: Built for Google Cloud Platform with BigQuery and Firestore
- **Type Safety**: Full type hints and validation

## Installation

```bash
pip install -e /path/to/shared/fmel-library
```

Or install from source:

```bash
cd shared/fmel-library
pip install -e .
```

## Quick Start

### Basic Usage with Backtrader

```python
import backtrader as bt
from spooky_fmel import FMELRecorder

# Your trading strategy
class MyStrategy(bt.Strategy):
    def next(self):
        if self.data.close[0] > self.data.close[-1]:
            self.buy()
        elif self.data.close[0] < self.data.close[-1]:
            self.sell()

# Setup Cerebro
cerebro = bt.Cerebro()
cerebro.addstrategy(MyStrategy)

# Add FMEL Recorder - THIS IS THE KEY LINE
cerebro.addanalyzer(FMELRecorder, _name='fmel')

# Add your data feeds
cerebro.adddata(your_data_feed)

# Run backtest
results = cerebro.run()

# FMEL automatically records everything!
fmel_analysis = results[0].analyzers.fmel.get_analysis()
print(f"Recorded {fmel_analysis['total_decisions']} decisions")
```

### Environment Configuration

The FMEL Recorder uses environment variables for configuration:

```bash
# Required
export AGENT_ID="your-agent-id"
export USER_ID="your-user-id"
export SESSION_ID="your-session-id"
export MODE="BACKTEST"  # or "PAPER"

# Optional
export PROJECT_ID="your-gcp-project"
export GOOGLE_APPLICATION_CREDENTIALS="/path/to/credentials.json"
```

### Adding Strategy Reasoning (Optional)

To capture reasoning from your strategy, implement these optional methods:

```python
class MyIntelligentStrategy(bt.Strategy):
    def __init__(self):
        self.sma = bt.indicators.SimpleMovingAverage(self.data.close, period=20)

    def next(self):
        if self.data.close[0] > self.sma[0]:
            self.buy()

    def get_decision_reasoning(self):
        """Optional: Provide reasoning for the current decision"""
        price = self.data.close[0]
        sma_value = self.sma[0]

        if price > sma_value:
            return f"Price ({price:.2f}) above SMA ({sma_value:.2f}) - bullish signal"
        elif price < sma_value:
            return f"Price ({price:.2f}) below SMA ({sma_value:.2f}) - bearish signal"
        else:
            return f"Price ({price:.2f}) near SMA ({sma_value:.2f}) - no clear signal"

    def get_decision_confidence(self):
        """Optional: Provide confidence score (0.0 to 1.0)"""
        price = self.data.close[0]
        sma_value = self.sma[0]

        # Calculate confidence based on distance from SMA
        if sma_value > 0:
            distance = abs(price - sma_value) / sma_value
            return min(distance * 10, 1.0)  # Scale distance to 0-1
        return 0.5
```

## What Gets Recorded

### Every Decision Point (on each `next()` call):

1. **Market Data**: OHLCV for all instruments
2. **Portfolio State**: Cash, equity, positions, leverage
3. **Position Details**: Size, P&L, market value for each instrument
4. **Indicators**: All Backtrader indicators from the strategy
5. **Agent Reasoning**: If provided by strategy methods
6. **Confidence Score**: If provided by strategy methods
7. **Timestamp**: Precise decision timing

### Order Events:

1. **Order Submission**: Type, size, price, instrument
2. **Order Execution**: Actual execution price, commission, timing
3. **Order Correlation**: Links orders to decision points

### Trade Events:

1. **Trade Closure**: P&L, duration, size
2. **Commission Costs**: Transaction costs
3. **Performance Metrics**: Win/loss tracking

## Data Storage

### Backtesting Mode
- Decisions collected in memory during execution
- Batch uploaded to BigQuery when backtest completes
- Summary statistics stored for quick access

### Paper Trading Mode
- Real-time streaming to BigQuery for immediate analysis
- Live updates to Firestore for monitoring
- Continuous decision tracking for live performance

## BigQuery Schema

### Main Decisions Table: `fmel.trading_decisions`

```sql
CREATE TABLE fmel.trading_decisions (
  decision_id STRING,
  timestamp TIMESTAMP,
  agent_id STRING,
  user_id STRING,
  run_id STRING,
  session_id STRING,
  mode STRING,
  symbol STRING,
  action_type STRING,
  quantity INT64,
  price FLOAT64,
  confidence FLOAT64,
  reasoning STRING,
  market_context STRUCT<...>,
  portfolio_value FLOAT64,
  position_value FLOAT64,
  indicators STRING,
  trade_pnl FLOAT64,
  daily_return FLOAT64,
  recorded_at TIMESTAMP
)
PARTITION BY DATE(timestamp)
CLUSTER BY agent_id, user_id, session_id;
```

## Advanced Usage

### Custom Storage Configuration

```python
from spooky_fmel import FMELRecorder, FMELStorage

# Custom storage configuration
class CustomFMELRecorder(FMELRecorder):
    def __init__(self):
        super().__init__()
        # Override storage with custom settings
        self.storage = FMELStorage(
            mode=self.mode,
            agent_id=self.agent_id,
            user_id=self.user_id,
            run_id=self.run_id,
            stream_realtime=True  # Force streaming even in backtest
        )
```

### Validation and Error Handling

```python
from spooky_fmel import FMELUtils

# Validate decision data
decision = {...}  # Your decision data
is_valid, errors = FMELUtils.validate_fmel_data(decision)

if not is_valid:
    print(f"Validation errors: {errors}")
```

### Risk Metrics Calculation

```python
from spooky_fmel import FMELUtils

# Calculate risk metrics from decisions
decisions = [...]  # List of FMEL decisions
risk_metrics = FMELUtils.calculate_risk_metrics(decisions)

print(f"Sharpe Ratio: {risk_metrics.get('sharpe_ratio')}")
print(f"Max Drawdown: {risk_metrics.get('max_drawdown')}")
print(f"Win Rate: {risk_metrics.get('win_rate')}")
```

## Integration Examples

### Cloud Build (Backtesting with Course-1)

```bash
# Course-1 integration automatically handles FMEL setup
# 1. Cloud Build clones Course-1 repository
git clone https://github.com/Spooky-Labs/Course-1.git

# 2. Uses Course-1's Dockerfile and requirements.txt
# 3. FMEL library is included in Course-1's dependencies

# In your agent code (automatically loaded by Course-1 runner)
from spooky_fmel import FMELRecorder
# FMEL recording happens automatically via Course-1's runner.py
```

### Kubernetes (Paper Trading)

```yaml
# In your StatefulSet
env:
- name: MODE
  value: "PAPER"
- name: AGENT_ID
  value: "${AGENT_ID}"
- name: USER_ID
  value: "${USER_ID}"
- name: SESSION_ID
  value: "${SESSION_ID}"
```

## Performance Considerations

### Backtesting
- Minimal memory overhead
- Efficient batch uploads
- No network I/O during execution

### Paper Trading
- Real-time streaming may add ~10ms per decision
- Firestore updates for monitoring
- Configurable streaming frequency

## Error Handling

The FMEL library is designed to be fault-tolerant:

- Failed uploads don't interrupt trading
- Automatic retries for transient errors
- Graceful degradation if cloud services unavailable
- Comprehensive logging for debugging

## Troubleshooting

### Common Issues

1. **Authentication Errors**
   ```bash
   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
   ```

2. **Missing Environment Variables**
   ```python
   # Check required variables
   required_vars = ['AGENT_ID', 'USER_ID', 'MODE']
   missing = [var for var in required_vars if not os.environ.get(var)]
   if missing:
       raise ValueError(f"Missing environment variables: {missing}")
   ```

3. **BigQuery Permission Errors**
   - Ensure service account has BigQuery Data Editor role
   - Verify project ID and dataset exist

### Debugging

Enable debug logging:

```python
import logging
logging.basicConfig(level=logging.DEBUG)
```

## License

MIT License - see LICENSE file for details.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## Support

For issues and questions:
- GitHub Issues: [Create an issue](https://github.com/Spooky-Labs/The-Farm-Mark-II/issues)
- Documentation: [Full docs](https://docs.spookylabs.com/fmel)
- Email: dev@spookylabs.com