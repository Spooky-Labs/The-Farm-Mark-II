"""
Pub/Sub Backtrader Data Feed
Consumes market data from Google Cloud Pub/Sub topics and feeds to Backtrader Strategy
"""
import json
import queue
import threading
import time
from collections import deque
from datetime import datetime, timezone
from typing import Optional, Dict, Any
import backtrader as bt
from google.cloud import pubsub_v1
import pandas as pd


class PubSubDataFeed(bt.feeds.DataBase):
    """
    Custom Backtrader data feed that consumes from Google Cloud Pub/Sub
    This is the primary data source for paper trading as described in the architecture
    """

    params = (
        ('project_id', ''),
        ('subscription_name', ''),
        ('symbol', ''),
        ('timeframe', bt.TimeFrame.Minutes),
        ('compression', 1),
        ('name', ''),
        ('max_buffer_size', 1000),
        ('qcheck', 0.5),  # Queue check timeout (seconds) - critical for live feeds
        ('reconnect_timeout', 5),  # Reconnection timeout
        ('max_reconnect_attempts', 10),  # Max reconnection attempts
    )

    def __init__(self):
        super().__init__()

        # Pub/Sub client setup
        self.subscriber_client = pubsub_v1.SubscriberClient()
        self.subscription_path = self.subscriber_client.subscription_path(
            self.p.project_id,
            self.p.subscription_name
        )

        # Thread-safe queue for incoming messages (critical for live feeds)
        self.message_queue = queue.Queue()

        # Data buffer for processed bars
        self.data_buffer = deque(maxlen=self.p.max_buffer_size)
        self.last_bar = None

        # Streaming subscription future
        self._streaming_pull_future = None
        self.running = False
        self._reconnect_attempts = 0

        print(f"Initialized Pub/Sub data feed for {self.p.symbol}")
        print(f"Subscription: {self.subscription_path}")

    def start(self):
        """
        Start consuming messages from Pub/Sub using streaming pull
        """
        super().start()
        print(f"Starting Pub/Sub data feed for {self.p.symbol}")

        self.running = True

        # Start streaming pull subscription
        self._streaming_pull_future = self.subscriber_client.subscribe(
            self.subscription_path,
            callback=self._pubsub_callback,
            flow_control=pubsub_v1.types.FlowControl(max_messages=100)
        )

        # Monitor thread for reconnection
        threading.Thread(target=self._monitor_subscription, daemon=True).start()

        # Process messages from queue to buffer
        threading.Thread(target=self._process_message_queue, daemon=True).start()

    def stop(self):
        """
        Stop consuming messages and clean up
        """
        super().stop()
        print(f"Stopping Pub/Sub data feed for {self.p.symbol}")
        self.running = False

        # Cancel streaming subscription
        if self._streaming_pull_future:
            self._streaming_pull_future.cancel()

        # Close subscriber
        if self.subscriber_client:
            self.subscriber_client.close()

    def _pubsub_callback(self, message):
        """
        Callback function invoked for each Pub/Sub message
        Runs in subscriber thread - must be thread-safe!
        """
        try:
            # Parse message data
            message_data = json.loads(message.data.decode('utf-8'))

            # Filter for our symbol
            if message_data.get('symbol') == self.p.symbol:
                # Put message in queue for processing
                self.message_queue.put(message_data)

            # Acknowledge message
            message.ack()

        except Exception as e:
            print(f"Error in Pub/Sub callback: {e}")
            # Nack the message to allow redelivery
            message.nack()

    def _monitor_subscription(self):
        """Monitor subscription for errors and handle reconnection"""
        while self.running:
            try:
                # Wait for future to complete (with timeout)
                self._streaming_pull_future.result(timeout=1.0)
            except TimeoutError:
                # Normal - still running
                continue
            except Exception as e:
                # Subscription error - attempt reconnection
                print(f"Subscription error: {e}")
                if self.running and self._reconnect_attempts < self.p.max_reconnect_attempts:
                    self._reconnect()
                else:
                    self.running = False
                    break

    def _reconnect(self):
        """Attempt to reconnect to Pub/Sub"""
        self._reconnect_attempts += 1
        print(f"Reconnecting to Pub/Sub (attempt {self._reconnect_attempts})...")

        time.sleep(self.p.reconnect_timeout)

        try:
            self._streaming_pull_future = self.subscriber_client.subscribe(
                self.subscription_path,
                callback=self._pubsub_callback,
                flow_control=pubsub_v1.types.FlowControl(max_messages=100)
            )

            self._reconnect_attempts = 0  # Reset on success
            print("Reconnected successfully")

        except Exception as e:
            print(f"Reconnection failed: {e}")

    def _process_message_queue(self):
        """
        Process messages from queue to buffer
        Runs in separate thread to avoid blocking callback
        """
        while self.running:
            try:
                # Get message from queue with timeout
                message_data = self.message_queue.get(timeout=self.p.qcheck)

                # Process market data message
                bar_data = self._process_market_data_message(message_data)

                if bar_data:
                    # Add to buffer
                    self.data_buffer.append(bar_data)
                    self.last_bar = bar_data

                    print(f"Buffered bar for {self.p.symbol}: "
                          f"{bar_data['close']} at {bar_data['datetime']}")

            except queue.Empty:
                # No messages, continue
                continue
            except Exception as e:
                print(f"Error processing message from queue: {e}")

    def _process_market_data_message(self, message_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Process incoming market data message and convert to bar format
        Expected message format from unified ingester (matches proven Alpaca patterns):
        {
            "type": "bar",
            "symbol": "AAPL",
            "timestamp": "2023-04-09T10:24:31.123456Z",
            "open": 123.45,
            "high": 124.5,
            "low": 123.1,
            "close": 124.25,
            "volume": 1050,
            "source": "alpaca_stock" or "alpaca_crypto"
        }
        """
        try:
            # Validate message type and required fields (following proven patterns)
            if message_data.get('type') != 'bar':
                return None

            required_fields = ['symbol', 'timestamp', 'open', 'high', 'low', 'close', 'volume']
            if not all(field in message_data for field in required_fields):
                print(f"Missing required fields in message: {message_data}")
                return None

            # Parse timestamp
            timestamp_str = message_data['timestamp']
            if isinstance(timestamp_str, str):
                # Parse ISO format timestamp
                dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            else:
                dt = datetime.fromtimestamp(timestamp_str, tz=timezone.utc)

            # Create bar data
            bar_data = {
                'datetime': dt,
                'open': float(message_data['open']),
                'high': float(message_data['high']),
                'low': float(message_data['low']),
                'close': float(message_data['close']),
                'volume': float(message_data['volume']),
                'vwap': float(message_data.get('vwap', message_data['close']))
            }

            return bar_data

        except Exception as e:
            print(f"Error processing market data message: {e}")
            return None

    def _load(self):
        """
        Load next bar from buffer (called by Backtrader)
        This is the key method that feeds data to the Strategy's next() method

        Returns:
            True: Successfully loaded new data
            False: No more data (end of feed)
            None: No data now, but feed is still live (critical for streaming!)
        """
        # Check if we're still running
        if not self.running:
            # Feed is stopped, return False to signal end
            return False

        # Try to get data from buffer
        if not self.data_buffer:
            # No data in buffer, but we're still running
            # Return None to signal "still live, waiting for data"
            return None

        try:
            # Get next bar from buffer
            bar_data = self.data_buffer.popleft()

            # Set Backtrader line values
            # These will be available in the Strategy's next() method
            self.lines.datetime[0] = bt.date2num(bar_data['datetime'])
            self.lines.open[0] = bar_data['open']
            self.lines.high[0] = bar_data['high']
            self.lines.low[0] = bar_data['low']
            self.lines.close[0] = bar_data['close']
            self.lines.volume[0] = bar_data['volume']

            return True  # Successfully loaded data

        except IndexError:
            # Buffer was emptied between check and access
            # Return None since we're still running
            return None if self.running else False
        except Exception as e:
            print(f"Error loading bar data: {e}")
            # Skip this bar but keep running
            return None if self.running else False

    def islive(self):
        """
        Return True to indicate this is a live data feed
        """
        return True

    def haslivedata(self):
        """
        Return True if there's live data available in buffer
        """
        return len(self.data_buffer) > 0

    def _check(self, forcedata=None):
        """
        Called periodically by Cerebro even when no data is available
        Allows sending notifications to strategies
        """
        if self.running and not self.haslivedata():
            # Could notify strategy of status here if needed
            pass

    def get_buffer_status(self) -> Dict[str, Any]:
        """
        Get current buffer status for monitoring
        """
        return {
            'symbol': self.p.symbol,
            'buffer_size': len(self.data_buffer),
            'max_buffer_size': self.p.max_buffer_size,
            'last_bar_time': self.last_bar['datetime'].isoformat() if self.last_bar else None,
            'running': self.running
        }


class MultiSymbolPubSubManager:
    """
    Manager for multiple Pub/Sub data feeds
    Handles subscription to different symbols and data types
    """

    def __init__(self, project_id: str):
        self.project_id = project_id
        self.data_feeds = {}
        self.cerebro = None

    def add_market_data_feed(self, symbol: str, cerebro: bt.Cerebro, timeframe: str = "1Min"):
        """
        Add market data feed for a symbol
        """
        subscription_name = f"market-data-{symbol.lower()}-{timeframe.lower()}"

        data_feed = PubSubDataFeed(
            project_id=self.project_id,
            subscription_name=subscription_name,
            symbol=symbol,
            timeframe=bt.TimeFrame.Minutes,
            compression=1,
            name=symbol
        )

        cerebro.adddata(data_feed)
        self.data_feeds[symbol] = data_feed

        print(f"Added Pub/Sub market data feed for {symbol}")
        return data_feed

    def add_alternative_data_feed(self, data_type: str, cerebro: bt.Cerebro):
        """
        Add alternative data feed (news, economic, etc.)
        """
        subscription_name = f"alternative-data-{data_type}"

        data_feed = PubSubDataFeed(
            project_id=self.project_id,
            subscription_name=subscription_name,
            symbol=data_type,  # Use data_type as symbol for alternative data
            name=f"alt-{data_type}"
        )

        cerebro.adddata(data_feed)
        self.data_feeds[f"alt-{data_type}"] = data_feed

        print(f"Added Pub/Sub alternative data feed for {data_type}")
        return data_feed

    def start_all_feeds(self):
        """
        Start all registered data feeds
        """
        for feed in self.data_feeds.values():
            feed.start()

    def stop_all_feeds(self):
        """
        Stop all registered data feeds
        """
        for feed in self.data_feeds.values():
            feed.stop()

    def get_status(self) -> Dict[str, Any]:
        """
        Get status of all data feeds
        """
        return {
            symbol: feed.get_buffer_status()
            for symbol, feed in self.data_feeds.items()
        }