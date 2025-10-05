#!/usr/bin/env python3
"""
Backtest Runner for Spooky Labs Trading Platform
Executes trading strategies in isolated environment with FMEL recording
"""

import os
import sys
import json
import logging
import importlib.util
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

import backtrader as bt
import pandas as pd
from google.cloud import storage, firestore
import firebase_admin
from firebase_admin import credentials, db

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Add FMEL to path
sys.path.insert(0, '/app/fmel-library')
from spooky_fmel import FMELRecorder


class BacktestRunner:
    """
    Orchestrates backtesting of trading strategies with FMEL recording
    """

    def __init__(self):
        """Initialize the backtest runner"""
        # Get configuration from environment
        self.agent_id = os.environ.get('AGENT_ID')
        self.user_id = os.environ.get('USER_ID')
        self.session_id = os.environ.get('SESSION_ID')
        self.project_id = os.environ.get('PROJECT_ID')

        # Backtest parameters
        self.start_date = os.environ.get('START_DATE', '2023-01-01')
        self.end_date = os.environ.get('END_DATE', '2023-12-31')
        self.initial_cash = float(os.environ.get('INITIAL_CASH', '100000'))
        self.symbols = os.environ.get('SYMBOLS', 'SPY,QQQ').split(',')
        self.timeframe = os.environ.get('TIMEFRAME', '1Day')

        # Initialize Firebase
        if not firebase_admin._apps:
            firebase_admin.initialize_app()

        # Initialize clients
        self.storage_client = storage.Client()
        self.firestore_client = firestore.Client()

        logger.info(f"Initialized BacktestRunner for agent {self.agent_id}")
        logger.info(f"Backtest period: {self.start_date} to {self.end_date}")
        logger.info(f"Symbols: {self.symbols}")

    def load_strategy(self) -> type:
        """
        Load the strategy from the agent directory
        """
        strategy_path = '/app/strategies/strategy.py'

        # Alternative path from mounted volume
        if not os.path.exists(strategy_path):
            strategy_path = '/app/agent/strategy.py'

        if not os.path.exists(strategy_path):
            raise FileNotFoundError(f"Strategy file not found at {strategy_path}")

        logger.info(f"Loading strategy from {strategy_path}")

        # Load the module dynamically
        spec = importlib.util.spec_from_file_location("agent_strategy", strategy_path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        # Find the strategy class (should inherit from bt.Strategy)
        strategy_class = None
        for name in dir(module):
            obj = getattr(module, name)
            if isinstance(obj, type) and issubclass(obj, bt.Strategy) and obj != bt.Strategy:
                strategy_class = obj
                break

        if not strategy_class:
            raise ValueError("No valid Strategy class found in agent code")

        logger.info(f"Loaded strategy class: {strategy_class.__name__}")
        return strategy_class

    def load_data(self, symbol: str) -> bt.feeds.PandasData:
        """
        Load historical data for a symbol
        IMPORTANT: Only uses real CSV data - no synthetic data generation
        """
        # Load from local data directory - no fallback to synthetic data
        data_file = f'/app/data/{symbol}.csv'

        if not os.path.exists(data_file):
            raise FileNotFoundError(
                f"Data file not found for {symbol} at {data_file}. "
                f"Real market data CSV required - synthetic data is not allowed."
            )

        logger.info(f"Loading data from {data_file}")
        df = pd.read_csv(data_file, index_col='Date', parse_dates=True)

        # Validate data has required columns
        required_columns = ['Open', 'High', 'Low', 'Close', 'Volume']
        missing_columns = set(required_columns) - set(df.columns)
        if missing_columns:
            raise ValueError(f"CSV file missing required columns: {missing_columns}")

        # Convert to backtrader data feed
        data = bt.feeds.PandasData(
            dataname=df,
            fromdate=datetime.strptime(self.start_date, '%Y-%m-%d'),
            todate=datetime.strptime(self.end_date, '%Y-%m-%d'),
            name=symbol
        )

        return data

    def run_backtest(self) -> Dict[str, Any]:
        """
        Execute the backtest
        """
        try:
            # Create Cerebro engine
            cerebro = bt.Cerebro()

            # Set initial cash
            cerebro.broker.set_cash(self.initial_cash)

            # Load strategy
            strategy_class = self.load_strategy()
            cerebro.addstrategy(strategy_class)

            # Load data for each symbol
            for symbol in self.symbols:
                data = self.load_data(symbol)
                cerebro.adddata(data)

            # Add FMEL analyzer
            cerebro.addanalyzer(FMELRecorder,
                              session_id=self.session_id,
                              agent_id=self.agent_id,
                              user_id=self.user_id,
                              mode='BACKTEST')

            # Add standard analyzers
            cerebro.addanalyzer(bt.analyzers.SharpeRatio, _name='sharpe')
            cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')
            cerebro.addanalyzer(bt.analyzers.DrawDown, _name='drawdown')
            cerebro.addanalyzer(bt.analyzers.TradeAnalyzer, _name='trades')

            # Set commission
            cerebro.broker.setcommission(commission=0.001)  # 0.1%

            # Run backtest
            logger.info("Starting backtest execution...")
            initial_value = cerebro.broker.getvalue()
            results = cerebro.run()
            final_value = cerebro.broker.getvalue()

            # Extract results
            strat = results[0]

            # Get analyzer results
            sharpe = strat.analyzers.sharpe.get_analysis()
            returns = strat.analyzers.returns.get_analysis()
            drawdown = strat.analyzers.drawdown.get_analysis()
            trades = strat.analyzers.trades.get_analysis()

            # Compile results
            backtest_results = {
                'session_id': self.session_id,
                'agent_id': self.agent_id,
                'user_id': self.user_id,
                'status': 'completed',
                'initial_value': initial_value,
                'final_value': final_value,
                'total_return': (final_value - initial_value) / initial_value,
                'sharpe_ratio': sharpe.get('sharperatio', 0),
                'max_drawdown': drawdown.get('max', {}).get('drawdown', 0),
                'total_trades': trades.get('total', {}).get('total', 0),
                'winning_trades': trades.get('won', {}).get('total', 0),
                'losing_trades': trades.get('lost', {}).get('total', 0),
                'parameters': {
                    'start_date': self.start_date,
                    'end_date': self.end_date,
                    'symbols': self.symbols,
                    'initial_cash': self.initial_cash
                },
                'timestamp': datetime.utcnow().isoformat()
            }

            logger.info(f"Backtest completed successfully")
            logger.info(f"Final value: ${final_value:,.2f}")
            logger.info(f"Total return: {backtest_results['total_return']:.2%}")

            return backtest_results

        except Exception as e:
            logger.error(f"Backtest failed: {str(e)}")
            return {
                'session_id': self.session_id,
                'agent_id': self.agent_id,
                'user_id': self.user_id,
                'status': 'failed',
                'error': str(e),
                'timestamp': datetime.utcnow().isoformat()
            }

    def save_results(self, results: Dict[str, Any]):
        """
        Save backtest results to Firebase and Cloud Storage
        """
        try:
            # Save to Firestore
            doc_ref = self.firestore_client.collection('backtestResults').document(self.session_id)
            doc_ref.set(results)
            logger.info(f"Results saved to Firestore: backtestResults/{self.session_id}")

            # Save to Firebase Realtime Database (for website compatibility)
            rtdb = firebase_admin.db
            ref = rtdb.reference(f'/creators/{self.user_id}/agents/{self.agent_id}/backtest/{self.session_id}')
            ref.set(results)
            logger.info(f"Results saved to Firebase RTDB")

            # Save JSON to Cloud Storage
            bucket_name = f"{self.project_id}-backtest-results"
            bucket = self.storage_client.bucket(bucket_name)
            blob = bucket.blob(f"{self.session_id}/results.json")
            blob.upload_from_string(json.dumps(results, indent=2))
            logger.info(f"Results saved to GCS: gs://{bucket_name}/{self.session_id}/results.json")

            # Update agent status
            agent_ref = self.firestore_client.collection('agents').document(self.agent_id)
            agent_ref.update({
                'lastBacktest': self.session_id,
                'lastBacktestTime': datetime.utcnow(),
                'backtestCount': firestore.Increment(1)
            })

        except Exception as e:
            logger.error(f"Failed to save results: {str(e)}")
            raise

    def run(self):
        """
        Main execution method
        """
        logger.info("=" * 50)
        logger.info("Starting Spooky Labs Backtest Runner")
        logger.info("=" * 50)

        # Run the backtest
        results = self.run_backtest()

        # Save results
        self.save_results(results)

        # Write results to stdout for Cloud Build
        print(json.dumps(results, indent=2))

        logger.info("Backtest runner completed")

        # Exit with appropriate code
        if results.get('status') == 'completed':
            sys.exit(0)
        else:
            sys.exit(1)


if __name__ == "__main__":
    runner = BacktestRunner()
    runner.run()