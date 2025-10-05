"""
Unified Market Data Ingester for Spooky Labs Platform
Based on proven Alpaca Market Data Ingestion patterns
Extends the original implementation to support multiple data sources
Includes market data (stocks + crypto) and news data
"""

import os
import json
import asyncio
import logging
from datetime import datetime
from typing import List, Dict, Any

# Alpaca API
from alpaca.data.live import StockDataStream, CryptoDataStream
from alpaca.data.models import Bar
from alpaca.data import NewsClient

# Google Cloud
from google.cloud import pubsub_v1

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


class UnifiedMarketDataIngestor:
    """
    Unified market data ingester that streams from Alpaca to Pub/Sub
    Supports both stocks and crypto following proven patterns
    """

    def __init__(self):
        """Initialize the unified market data ingester"""

        # Get configuration from environment
        self.alpaca_api_key = os.environ.get('ALPACA_API_KEY')
        self.alpaca_secret_key = os.environ.get('ALPACA_SECRET_KEY')
        self.project_id = os.environ.get('GOOGLE_CLOUD_PROJECT')
        self.market_data_topic = os.environ.get('PUBSUB_TOPIC_NAME', 'market-data')

        if not all([self.alpaca_api_key, self.alpaca_secret_key, self.project_id]):
            raise ValueError("Missing required environment variables")

        # Initialize Pub/Sub client
        self.publisher = pubsub_v1.PublisherClient()
        self.market_data_topic_path = self.publisher.topic_path(self.project_id, self.market_data_topic)
        self.news_data_topic = os.environ.get('NEWS_TOPIC_NAME', 'news-data')
        self.news_data_topic_path = self.publisher.topic_path(self.project_id, self.news_data_topic)

        # Load symbols to track
        self.stock_symbols = self._load_symbols('symbols.txt')
        self.crypto_symbols = self._load_symbols('crypto_symbols.txt')

        # Initialize Alpaca News Client
        self.news_client = NewsClient(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key
        )
        self.news_poll_interval = int(os.environ.get('NEWS_POLL_INTERVAL', '300'))  # 5 minutes default

        # Initialize Alpaca streams
        self.stock_stream = StockDataStream(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key
        )

        self.crypto_stream = CryptoDataStream(
            api_key=self.alpaca_api_key,
            secret_key=self.alpaca_secret_key
        )

        # Set up stream handlers
        self._setup_handlers()

        logger.info(f"Initialized unified ingester for {len(self.stock_symbols)} stocks and {len(self.crypto_symbols)} crypto pairs")

    def _load_symbols(self, filename: str) -> List[str]:
        """Load symbols from file, return empty list if file doesn't exist"""
        try:
            with open(filename, 'r') as f:
                symbols = [line.strip() for line in f if line.strip()]
            logger.info(f"Loaded {len(symbols)} symbols from {filename}")
            return symbols
        except FileNotFoundError:
            logger.warning(f"Symbol file {filename} not found, using empty list")
            return []

    def _setup_handlers(self):
        """Set up stream handlers following proven patterns"""

        # Stock bar handler (matches original implementation)
        async def stock_bar_handler(bar: Bar):
            """Handle stock bar data - matches original Alpaca implementation pattern"""
            try:
                # Create message in exact format from original implementation
                message = {
                    "type": "bar",
                    "symbol": bar.symbol,
                    "timestamp": bar.timestamp.isoformat(),
                    "open": float(bar.open),
                    "high": float(bar.high),
                    "low": float(bar.low),
                    "close": float(bar.close),
                    "volume": int(bar.volume),
                    "source": "alpaca_stock"
                }

                # Add optional fields if available
                if hasattr(bar, 'vwap') and bar.vwap is not None:
                    message["vwap"] = float(bar.vwap)
                if hasattr(bar, 'trade_count') and bar.trade_count is not None:
                    message["trade_count"] = int(bar.trade_count)

                # Publish to Pub/Sub
                await self._publish_message(message, self.market_data_topic_path)
                logger.info(f"Published stock bar for {bar.symbol}: ${message['close']}")

            except Exception as e:
                logger.error(f"Error processing stock bar for {bar.symbol}: {e}")

        # Crypto bar handler (similar pattern for crypto)
        async def crypto_bar_handler(bar: Bar):
            """Handle crypto bar data"""
            try:
                message = {
                    "type": "bar",
                    "symbol": bar.symbol,
                    "timestamp": bar.timestamp.isoformat(),
                    "open": float(bar.open),
                    "high": float(bar.high),
                    "low": float(bar.low),
                    "close": float(bar.close),
                    "volume": float(bar.volume),  # Crypto volume can be decimal
                    "source": "alpaca_crypto"
                }

                if hasattr(bar, 'vwap') and bar.vwap is not None:
                    message["vwap"] = float(bar.vwap)
                if hasattr(bar, 'trade_count') and bar.trade_count is not None:
                    message["trade_count"] = int(bar.trade_count)

                await self._publish_message(message, self.market_data_topic_path)
                logger.info(f"Published crypto bar for {bar.symbol}: ${message['close']}")

            except Exception as e:
                logger.error(f"Error processing crypto bar for {bar.symbol}: {e}")

        # Register handlers
        self.stock_stream.subscribe_bars(stock_bar_handler, *self.stock_symbols)
        self.crypto_stream.subscribe_bars(crypto_bar_handler, *self.crypto_symbols)

    async def _publish_message(self, message: Dict[str, Any], topic_path: str):
        """Publish message to Pub/Sub following original patterns"""
        try:
            # Encode message as JSON
            message_json = json.dumps(message)
            message_bytes = message_json.encode('utf-8')

            # Publish to Pub/Sub
            future = self.publisher.publish(topic_path, message_bytes)

            # Don't wait for the result in the original implementation pattern
            # This allows for high-throughput async publishing

        except Exception as e:
            logger.error(f"Failed to publish message: {e}")

    async def fetch_and_publish_news(self):
        """Fetch news from Alpaca and publish to Pub/Sub"""
        while True:
            try:
                logger.info("Fetching news from Alpaca...")

                # Get recent news (last 50 articles)
                news_articles = self.news_client.get_news(limit=50)

                for article in news_articles:
                    message = {
                        'type': 'news',
                        'symbols': article.symbols if hasattr(article, 'symbols') else [],
                        'headline': article.headline,
                        'summary': article.summary if hasattr(article, 'summary') else '',
                        'author': article.author if hasattr(article, 'author') else '',
                        'url': article.url,
                        'created_at': article.created_at.isoformat() if hasattr(article, 'created_at') else datetime.utcnow().isoformat(),
                        'updated_at': article.updated_at.isoformat() if hasattr(article, 'updated_at') else datetime.utcnow().isoformat(),
                        'source': 'alpaca_news',
                        'ingested_at': datetime.utcnow().isoformat()
                    }

                    await self._publish_message(message, self.news_data_topic_path)

                logger.info(f"Published {len(news_articles)} news articles")

            except Exception as e:
                logger.error(f"Error fetching/publishing news: {e}")

            # Wait for next poll
            await asyncio.sleep(self.news_poll_interval)

    async def run(self):
        """Main run loop following original implementation pattern"""
        try:
            logger.info("Starting unified market data ingestion...")
            logger.info(f"Publishing market data to: {self.market_data_topic_path}")
            logger.info(f"Publishing news data to: {self.news_data_topic_path}")
            logger.info(f"Tracking {len(self.stock_symbols)} stocks: {self.stock_symbols}")
            logger.info(f"Tracking {len(self.crypto_symbols)} crypto pairs: {self.crypto_symbols}")
            logger.info(f"News poll interval: {self.news_poll_interval}s")

            # Start streams concurrently
            tasks = []

            if self.stock_symbols:
                tasks.append(asyncio.create_task(self.stock_stream._run_forever()))
                logger.info("Started stock data stream")

            if self.crypto_symbols:
                tasks.append(asyncio.create_task(self.crypto_stream._run_forever()))
                logger.info("Started crypto data stream")

            # Start news polling
            tasks.append(asyncio.create_task(self.fetch_and_publish_news()))
            logger.info("Started news polling")

            if not tasks:
                logger.warning("No symbols configured, running without active streams")
                # Keep the service alive for monitoring
                while True:
                    await asyncio.sleep(60)
                    logger.info("No active streams - service running in standby mode")

            # Wait for all streams
            await asyncio.gather(*tasks)

        except Exception as e:
            logger.error(f"Error in main run loop: {e}")
            raise

    async def close(self):
        """Clean shutdown following original patterns"""
        try:
            logger.info("Shutting down unified market data ingester...")

            if hasattr(self.stock_stream, 'close'):
                await self.stock_stream.close()
            if hasattr(self.crypto_stream, 'close'):
                await self.crypto_stream.close()

            logger.info("Streams closed successfully")

        except Exception as e:
            logger.error(f"Error during shutdown: {e}")


async def main():
    """Main entry point following original implementation pattern"""
    ingester = None
    try:
        # Create and run the ingester
        ingester = UnifiedMarketDataIngestor()
        await ingester.run()

    except KeyboardInterrupt:
        logger.info("Received interrupt signal")
    except Exception as e:
        logger.error(f"Fatal error: {e}")
        raise
    finally:
        if ingester:
            await ingester.close()


if __name__ == "__main__":
    # Run the async main function
    asyncio.run(main())