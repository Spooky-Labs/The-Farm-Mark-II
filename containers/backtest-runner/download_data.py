#!/usr/bin/env python3
"""
Download historical market data for backtesting
Uses Alpaca API to fetch historical data
"""

import os
import pandas as pd
from datetime import datetime, timedelta
import alpaca_trade_api as tradeapi
from typing import List
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def download_historical_data(symbols: List[str], start_date: str, end_date: str):
    """
    Download historical data from Alpaca

    Args:
        symbols: List of stock symbols
        start_date: Start date in YYYY-MM-DD format
        end_date: End date in YYYY-MM-DD format
    """
    # Initialize Alpaca API
    api_key = os.environ.get('ALPACA_API_KEY')
    secret_key = os.environ.get('ALPACA_SECRET_KEY')
    base_url = os.environ.get('ALPACA_BASE_URL', 'https://paper-api.alpaca.markets')

    if not api_key or not secret_key:
        logger.error("Please set ALPACA_API_KEY and ALPACA_SECRET_KEY environment variables")
        return

    api = tradeapi.REST(api_key, secret_key, base_url, api_version='v2')

    # Ensure data directory exists
    os.makedirs('data', exist_ok=True)

    for symbol in symbols:
        try:
            logger.info(f"Downloading data for {symbol}...")

            # Get daily bars
            bars = api.get_bars(
                symbol,
                '1Day',
                start=start_date,
                end=end_date,
                adjustment='all'
            ).df

            if bars.empty:
                logger.warning(f"No data found for {symbol}")
                continue

            # Prepare dataframe
            bars = bars.reset_index()
            bars.columns = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume', 'TradeCount', 'VWAP']

            # Select required columns
            bars = bars[['Date', 'Open', 'High', 'Low', 'Close', 'Volume']]

            # Save to CSV
            output_file = f'data/{symbol}.csv'
            bars.to_csv(output_file, index=False)
            logger.info(f"Saved {len(bars)} rows to {output_file}")

        except Exception as e:
            logger.error(f"Failed to download data for {symbol}: {str(e)}")


def load_symbols_from_file(filename: str = 'symbols.txt') -> List[str]:
    """Load symbols from text file"""
    try:
        with open(filename, 'r') as f:
            symbols = [line.strip() for line in f if line.strip()]
        return symbols
    except FileNotFoundError:
        logger.warning(f"Symbols file {filename} not found")
        return ['SPY', 'QQQ']  # Default symbols


if __name__ == "__main__":
    # Load symbols
    symbols = load_symbols_from_file()

    # Set date range (2 years of data)
    end_date = datetime.now().strftime('%Y-%m-%d')
    start_date = (datetime.now() - timedelta(days=730)).strftime('%Y-%m-%d')

    logger.info(f"Downloading data for {len(symbols)} symbols")
    logger.info(f"Date range: {start_date} to {end_date}")

    # Download data
    download_historical_data(symbols, start_date, end_date)

    logger.info("Data download complete!")