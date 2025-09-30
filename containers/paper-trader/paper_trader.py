"""
Paper Trading Runner for Kubernetes
Executes live paper trading with real-time FMEL recording
"""
import os
import json
import sys
import time
import threading
import importlib.util
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import backtrader as bt
import pandas as pd
from google.cloud import bigquery, storage, firestore
from flask import Flask, jsonify
import alpaca_trade_api as tradeapi
from spooky_fmel import FMELRecorder
from pubsub_data_feed import MultiSymbolPubSubManager
from alpaca_broker import AlpacaBroker


class PaperTrader:
    """
    Live paper trading execution with real-time FMEL recording
    """

    def __init__(self):
        # Get configuration from environment
        self.project_id = os.environ.get('PROJECT_ID')
        self.session_id = os.environ.get('SESSION_ID')
        self.agent_id = os.environ.get('AGENT_ID')
        self.user_id = os.environ.get('USER_ID')
        self.mode = os.environ.get('MODE', 'PAPER')
        self.fmel_enabled = os.environ.get('FMEL_ENABLED', 'true').lower() == 'true'

        # Parse configuration
        config_str = os.environ.get('CONFIG', '{}')
        self.config = json.loads(config_str)

        # Alpaca credentials
        self.alpaca_api_key = os.environ.get('ALPACA_API_KEY')
        self.alpaca_secret_key = os.environ.get('ALPACA_SECRET_KEY')
        self.alpaca_base_url = os.environ.get('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets')

        # Initialize clients
        self.bq_client = bigquery.Client()
        self.storage_client = storage.Client()
        self.firestore_client = firestore.Client()

        # Initialize Alpaca API
        self.alpaca_api = tradeapi.REST(
            self.alpaca_api_key,
            self.alpaca_secret_key,
            self.alpaca_base_url,
            api_version='v2'
        )

        # Set up cerebro
        self.cerebro = bt.Cerebro()
        self.running = False
        self.strategy_instance = None

        # Pub/Sub data feed manager
        self.pubsub_manager = MultiSymbolPubSubManager(self.project_id)

        # Flask app for health checks
        self.app = Flask(__name__)
        self._setup_health_endpoints()

    def run(self):
        """
        Start paper trading
        """
        try:
            print(f"Starting paper trading for agent {self.agent_id}")
            print(f"Session ID: {self.session_id}")
            print(f"Configuration: {self.config}")

            # Verify Alpaca account
            account = self.alpaca_api.get_account()
            print(f"Alpaca account status: {account.status}")
            print(f"Paper trading: {account.trading_blocked}")

            # Load strategy from storage
            strategy_class = self._load_strategy_from_storage()

            # Add strategy to cerebro
            self.cerebro.addstrategy(strategy_class)

            # Set up Pub/Sub data feeds (per architecture flow)
            self._setup_pubsub_data_feeds()

            # Set up custom Alpaca broker (per architecture flow)
            self._setup_alpaca_broker()

            # Add FMEL recorder if enabled
            if self.fmel_enabled:
                self.cerebro.addanalyzer(FMELRecorder,
                                       session_id=self.session_id,
                                       agent_id=self.agent_id,
                                       user_id=self.user_id,
                                       mode=self.mode)

            # Add analyzers
            self.cerebro.addanalyzer(bt.analyzers.Returns, _name='returns')
            self.cerebro.addanalyzer(bt.analyzers.LiveTrades, _name='live_trades')

            # Start Flask health check server in background
            health_thread = threading.Thread(target=self._run_health_server, daemon=True)
            health_thread.start()

            # Update status to running
            self._update_session_status('running')

            # Run live trading
            print("Starting live paper trading...")
            self.running = True

            # Run cerebro in live mode
            results = self.cerebro.run()
            self.strategy_instance = results[0] if results else None

            # Keep running until stopped
            while self.running:
                time.sleep(1)
                self._update_position_status()

        except Exception as e:
            print(f"Paper trading failed: {str(e)}")
            self._update_session_status('error', str(e))
            raise

    def stop(self):
        """
        Stop paper trading and clean up resources
        """
        print("Stopping paper trading...")
        self.running = False

        # Stop all Pub/Sub data feeds
        self.pubsub_manager.stop_all_feeds()

        self._update_session_status('stopped')

    def _load_strategy_from_storage(self):
        """
        Load strategy from Cloud Storage
        """
        bucket_name = f"{self.project_id}-agent-code"
        blob_path = f"agents/{self.user_id}/{self.agent_id}/strategy.py"

        bucket = self.storage_client.bucket(bucket_name)
        blob = bucket.blob(blob_path)

        # Download strategy code
        strategy_code = blob.download_as_text()

        # Write to local file
        with open('/tmp/strategy.py', 'w') as f:
            f.write(strategy_code)

        # Load strategy class
        spec = importlib.util.spec_from_file_location("strategy", "/tmp/strategy.py")
        strategy_module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(strategy_module)

        # Find the strategy class
        strategy_class = None
        for attr_name in dir(strategy_module):
            attr = getattr(strategy_module, attr_name)
            if (isinstance(attr, type) and
                issubclass(attr, bt.Strategy) and
                attr != bt.Strategy):
                strategy_class = attr
                break

        if not strategy_class:
            raise ValueError("No valid strategy class found")

        return strategy_class

    def _setup_pubsub_data_feeds(self):
        """
        Set up Pub/Sub data feeds as per architecture flow:
        Data Ingestors → Pub/Sub → Custom Data Feeds → Strategy next() method
        """
        symbols = self.config.get('symbols', ['SPY'])
        timeframe = self.config.get('timeframe', '1Min')

        # Add market data feeds for each symbol
        for symbol in symbols:
            data_feed = self.pubsub_manager.add_market_data_feed(
                symbol=symbol,
                cerebro=self.cerebro,
                timeframe=timeframe
            )
            print(f"Added Pub/Sub market data feed for {symbol}")

        # Add alternative data feeds if configured
        alt_data_types = self.config.get('alternative_data_types', [])
        for data_type in alt_data_types:
            self.pubsub_manager.add_alternative_data_feed(
                data_type=data_type,
                cerebro=self.cerebro
            )
            print(f"Added Pub/Sub alternative data feed for {data_type}")

        # Start all feeds
        self.pubsub_manager.start_all_feeds()
        print(f"Started {len(symbols)} market data feeds and {len(alt_data_types)} alternative data feeds")

    def _setup_alpaca_broker(self):
        """
        Set up custom Alpaca broker as per architecture flow:
        Strategy orders → Custom Broker → Alpaca Paper Trading API
        """
        initial_cash = self.config.get('initial_cash', 100000)

        # Create custom Alpaca broker
        alpaca_broker = AlpacaBroker(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key,
            base_url=self.alpaca_base_url,
            cash=initial_cash,
            commission=0.0  # Alpaca is commission-free
        )

        # Set the custom broker in cerebro
        self.cerebro.setbroker(alpaca_broker)

        print(f"Custom Alpaca broker setup: Initial cash: ${initial_cash:,}")
        print(f"Connected to Alpaca Paper Trading API: {self.alpaca_base_url}")

    def _update_session_status(self, status: str, error_message: str = None):
        """
        Update session status in Firestore
        """
        try:
            update_data = {
                'status': status,
                'updated_at': firestore.SERVER_TIMESTAMP
            }

            if error_message:
                update_data['error_message'] = error_message

            if status == 'stopped':
                update_data['stopped_at'] = firestore.SERVER_TIMESTAMP

            self.firestore_client.collection('paper_trading_sessions').document(self.session_id).update(update_data)

        except Exception as e:
            print(f"Error updating session status: {e}")

    def _update_position_status(self):
        """
        Update current positions and P&L
        """
        try:
            if not self.strategy_instance:
                return

            # Get current portfolio value
            current_value = self.cerebro.broker.getvalue()
            initial_cash = self.config.get('initial_cash', 100000)
            total_pnl = current_value - initial_cash

            # Get current positions
            positions = {}
            for data in self.cerebro.datas:
                symbol = getattr(data, 'name', 'unknown')
                position = self.strategy_instance.getposition(data)
                if position.size != 0:
                    positions[symbol] = {
                        'size': float(position.size),
                        'price': float(position.price),
                        'value': float(position.size * data.close[0])
                    }

            # Update Firestore
            self.firestore_client.collection('paper_trading_sessions').document(self.session_id).update({
                'total_pnl': total_pnl,
                'current_value': current_value,
                'current_positions': positions,
                'last_updated': firestore.SERVER_TIMESTAMP
            })

        except Exception as e:
            print(f"Error updating position status: {e}")

    def _setup_health_endpoints(self):
        """
        Set up Flask health check endpoints
        """
        @self.app.route('/health')
        def health():
            return jsonify({
                'status': 'healthy' if self.running else 'stopped',
                'session_id': self.session_id,
                'agent_id': self.agent_id,
                'mode': self.mode,
                'uptime': time.time()
            })

        @self.app.route('/status')
        def status():
            current_value = 0
            positions = {}

            if self.strategy_instance:
                current_value = self.cerebro.broker.getvalue()
                for data in self.cerebro.datas:
                    symbol = getattr(data, 'name', 'unknown')
                    position = self.strategy_instance.getposition(data)
                    if position.size != 0:
                        positions[symbol] = {
                            'size': float(position.size),
                            'price': float(position.price)
                        }

            return jsonify({
                'session_id': self.session_id,
                'agent_id': self.agent_id,
                'running': self.running,
                'current_value': current_value,
                'positions': positions
            })

    def _run_health_server(self):
        """
        Run Flask health check server
        """
        self.app.run(host='0.0.0.0', port=8080, debug=False)


def main():
    """
    Main entry point for paper trading
    """
    trader = PaperTrader()

    # Handle graceful shutdown
    import signal

    def signal_handler(sig, frame):
        print("Received shutdown signal")
        trader.stop()
        sys.exit(0)

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    try:
        trader.run()
    except KeyboardInterrupt:
        trader.stop()
    except Exception as e:
        print(f"Paper trading failed: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()