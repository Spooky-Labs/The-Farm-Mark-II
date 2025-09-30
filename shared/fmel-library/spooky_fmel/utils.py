"""
FMEL Utils - Utility functions for FMEL calculations and data processing
"""

import math
import statistics
from typing import List, Optional, Union, Any
from datetime import datetime, timedelta


class FMELUtils:
    """
    Utility functions for FMEL data processing and calculations
    """

    @staticmethod
    def calculate_percentage_change(current: float, previous: float) -> Optional[float]:
        """Calculate percentage change between two values"""
        if previous == 0 or previous is None or current is None:
            return None

        try:
            return ((current - previous) / previous) * 100
        except (ZeroDivisionError, TypeError):
            return None

    @staticmethod
    def calculate_sma(values: List[float], period: int) -> Optional[float]:
        """Calculate Simple Moving Average"""
        if not values or len(values) < period or period <= 0:
            return None

        try:
            recent_values = values[-period:]
            return sum(recent_values) / len(recent_values)
        except (TypeError, ValueError):
            return None

    @staticmethod
    def calculate_volatility(values: List[float]) -> Optional[float]:
        """Calculate volatility (standard deviation of returns)"""
        if not values or len(values) < 2:
            return None

        try:
            # Calculate returns
            returns = []
            for i in range(1, len(values)):
                if values[i-1] != 0:
                    returns.append((values[i] - values[i-1]) / values[i-1])

            if len(returns) < 2:
                return None

            return statistics.stdev(returns) * 100  # Return as percentage
        except (ValueError, TypeError, ZeroDivisionError):
            return None

    @staticmethod
    def calculate_sharpe_ratio(returns: List[float], risk_free_rate: float = 0.02) -> Optional[float]:
        """Calculate Sharpe ratio from list of returns"""
        if not returns or len(returns) < 2:
            return None

        try:
            mean_return = statistics.mean(returns)
            std_return = statistics.stdev(returns)

            if std_return == 0:
                return None

            # Annualized Sharpe ratio
            excess_return = mean_return - (risk_free_rate / 252)  # Daily risk-free rate
            return (excess_return / std_return) * math.sqrt(252)
        except (ValueError, TypeError, ZeroDivisionError):
            return None

    @staticmethod
    def calculate_max_drawdown(portfolio_values: List[float]) -> Optional[float]:
        """Calculate maximum drawdown from portfolio values"""
        if not portfolio_values or len(portfolio_values) < 2:
            return None

        try:
            max_drawdown = 0
            peak = portfolio_values[0]

            for value in portfolio_values[1:]:
                if value > peak:
                    peak = value
                else:
                    drawdown = (peak - value) / peak
                    max_drawdown = max(max_drawdown, drawdown)

            return max_drawdown * 100  # Return as percentage
        except (TypeError, ValueError, ZeroDivisionError):
            return None

    @staticmethod
    def calculate_win_rate(pnl_values: List[float]) -> Optional[float]:
        """Calculate win rate from list of P&L values"""
        if not pnl_values:
            return None

        try:
            winning_trades = sum(1 for pnl in pnl_values if pnl > 0)
            total_trades = len(pnl_values)

            if total_trades == 0:
                return None

            return (winning_trades / total_trades) * 100
        except (TypeError, ValueError):
            return None

    @staticmethod
    def normalize_timestamp(timestamp: Union[str, datetime]) -> str:
        """Normalize timestamp to ISO format"""
        if isinstance(timestamp, str):
            try:
                dt = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
                return dt.isoformat()
            except ValueError:
                return datetime.utcnow().isoformat()
        elif isinstance(timestamp, datetime):
            return timestamp.isoformat()
        else:
            return datetime.utcnow().isoformat()

    @staticmethod
    def safe_divide(numerator: float, denominator: float, default: float = 0.0) -> float:
        """Safely divide two numbers"""
        try:
            if denominator == 0:
                return default
            return numerator / denominator
        except (TypeError, ValueError):
            return default

    @staticmethod
    def extract_symbol_from_data_name(data_name: str) -> str:
        """Extract clean symbol from Backtrader data name"""
        if not data_name:
            return 'UNKNOWN'

        # Remove common prefixes/suffixes
        clean_name = data_name.replace('data_', '').replace('_data', '')

        # Handle format like "AAPL-USD" or "AAPL.USD"
        if '-' in clean_name:
            clean_name = clean_name.split('-')[0]
        elif '.' in clean_name:
            clean_name = clean_name.split('.')[0]

        return clean_name.upper()

    @staticmethod
    def calculate_portfolio_allocation(positions: dict, total_value: float) -> dict:
        """Calculate portfolio allocation percentages"""
        if not positions or total_value <= 0:
            return {}

        allocations = {}
        for symbol, position in positions.items():
            market_value = position.get('market_value', 0)
            if total_value > 0:
                allocations[symbol] = (market_value / total_value) * 100
            else:
                allocations[symbol] = 0

        return allocations

    @staticmethod
    def detect_market_regime(returns: List[float], window: int = 20) -> str:
        """Detect market regime based on recent returns"""
        if not returns or len(returns) < window:
            return 'unknown'

        try:
            recent_returns = returns[-window:]
            mean_return = statistics.mean(recent_returns)
            volatility = statistics.stdev(recent_returns)

            # Simple regime detection logic
            if mean_return > 0.001 and volatility < 0.02:  # Positive returns, low volatility
                return 'bull_stable'
            elif mean_return > 0.001 and volatility >= 0.02:  # Positive returns, high volatility
                return 'bull_volatile'
            elif mean_return < -0.001 and volatility < 0.02:  # Negative returns, low volatility
                return 'bear_stable'
            elif mean_return < -0.001 and volatility >= 0.02:  # Negative returns, high volatility
                return 'bear_volatile'
            else:
                return 'sideways'

        except (ValueError, TypeError):
            return 'unknown'

    @staticmethod
    def format_currency(value: float, currency: str = 'USD') -> str:
        """Format currency value for display"""
        if value is None:
            return f"N/A {currency}"

        try:
            if abs(value) >= 1000000:
                return f"${value/1000000:.2f}M {currency}"
            elif abs(value) >= 1000:
                return f"${value/1000:.2f}K {currency}"
            else:
                return f"${value:.2f} {currency}"
        except (TypeError, ValueError):
            return f"N/A {currency}"

    @staticmethod
    def generate_decision_id(agent_id: str, run_id: str, decision_number: int) -> str:
        """Generate unique decision ID"""
        timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S_%f')[:-3]  # Microseconds to milliseconds
        return f"{agent_id}_{run_id}_{decision_number}_{timestamp}"

    @staticmethod
    def validate_fmel_data(decision: dict) -> tuple[bool, List[str]]:
        """Validate FMEL decision data structure"""
        errors = []
        required_fields = [
            'decision_id', 'timestamp', 'agent_id', 'user_id', 'mode'
        ]

        # Check required fields
        for field in required_fields:
            if field not in decision or decision[field] is None:
                errors.append(f"Missing required field: {field}")

        # Validate timestamp format
        if 'timestamp' in decision:
            try:
                datetime.fromisoformat(decision['timestamp'].replace('Z', '+00:00'))
            except (ValueError, AttributeError):
                errors.append("Invalid timestamp format")

        # Validate mode
        if 'mode' in decision and decision['mode'] not in ['BACKTEST', 'PAPER']:
            errors.append("Invalid mode, must be 'BACKTEST' or 'PAPER'")

        # Validate numeric fields
        numeric_fields = ['confidence', 'portfolio_value', 'trade_pnl']
        for field in numeric_fields:
            if field in decision and decision[field] is not None:
                try:
                    float(decision[field])
                except (ValueError, TypeError):
                    errors.append(f"Invalid numeric value for {field}")

        return len(errors) == 0, errors

    @staticmethod
    def calculate_risk_metrics(decisions: List[dict]) -> dict:
        """Calculate comprehensive risk metrics from decisions"""
        if not decisions:
            return {}

        portfolio_values = []
        returns = []
        trade_pnls = []

        for decision in decisions:
            # Extract portfolio values
            if 'portfolio' in decision and isinstance(decision['portfolio'], dict):
                portfolio_value = decision['portfolio'].get('value')
                if portfolio_value is not None:
                    portfolio_values.append(float(portfolio_value))

            # Extract trade PnLs
            if 'trade_pnl' in decision and decision['trade_pnl'] is not None:
                trade_pnls.append(float(decision['trade_pnl']))

        # Calculate returns from portfolio values
        for i in range(1, len(portfolio_values)):
            if portfolio_values[i-1] != 0:
                return_pct = (portfolio_values[i] - portfolio_values[i-1]) / portfolio_values[i-1]
                returns.append(return_pct)

        # Calculate metrics
        metrics = {}

        if portfolio_values:
            metrics['max_drawdown'] = FMELUtils.calculate_max_drawdown(portfolio_values)
            metrics['total_return'] = FMELUtils.calculate_percentage_change(
                portfolio_values[-1], portfolio_values[0]
            ) if len(portfolio_values) >= 2 else None

        if returns:
            metrics['volatility'] = FMELUtils.calculate_volatility([r * 100 for r in returns])
            metrics['sharpe_ratio'] = FMELUtils.calculate_sharpe_ratio(returns)

        if trade_pnls:
            metrics['win_rate'] = FMELUtils.calculate_win_rate(trade_pnls)
            metrics['avg_trade_pnl'] = statistics.mean(trade_pnls)
            metrics['total_pnl'] = sum(trade_pnls)

        return metrics