"""
FMEL Recorder - Unified Backtrader Analyzer for decision recording
Works in both backtesting and paper trading modes with automatic mode detection
"""

import backtrader as bt
import json
import os
import logging
from datetime import datetime
from typing import Dict, Any, Optional, List

from .storage import FMELStorage
from .utils import FMELUtils


class FMELRecorder(bt.Analyzer):
    """
    Foundation Model Explainability Layer (FMEL) Recorder

    Pure recording Backtrader Analyzer that captures every decision made by trading agents.
    Automatically detects execution mode (BACKTEST vs PAPER) and handles storage accordingly.

    Features:
    - Complete decision capture on every next() call
    - Market data, indicators, portfolio, and position recording
    - Order and trade event recording
    - Real-time streaming for paper trading
    - Batch storage for backtesting
    - Automatic BigQuery and Firestore integration
    """

    def __init__(self):
        """Initialize FMEL Recorder with environment-based configuration"""
        super().__init__()

        # Core state
        self.decisions = []
        self.current_decision = {}
        self.decision_count = 0

        # Environment configuration
        self.agent_id = os.environ.get('AGENT_ID', 'unknown-agent')
        self.user_id = os.environ.get('USER_ID', 'unknown-user')
        self.session_id = os.environ.get('SESSION_ID', 'unknown-session')
        self.mode = os.environ.get('MODE', 'BACKTEST').upper()

        # Unique run identifier
        self.run_id = f"{self.agent_id}_{self.mode}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"

        # Mode-specific settings
        self.stream_realtime = (self.mode == 'PAPER')

        # Initialize storage
        self.storage = FMELStorage(
            mode=self.mode,
            agent_id=self.agent_id,
            user_id=self.user_id,
            run_id=self.run_id,
            stream_realtime=self.stream_realtime
        )

        # Initialize utilities
        self.utils = FMELUtils()

        logging.info(f"FMEL Recorder initialized: mode={self.mode}, agent={self.agent_id}, run={self.run_id}")

    def next(self):
        """
        Record state at each decision point - called by Backtrader on every bar
        This is the core FMEL recording function
        """
        self.decision_count += 1

        # Create comprehensive decision record
        decision = {
            'decision_id': f"{self.run_id}_{self.decision_count}",
            'decision_number': self.decision_count,
            'timestamp': self.strategy.datetime.datetime(0).isoformat(),
            'mode': self.mode,
            'agent_id': self.agent_id,
            'user_id': self.user_id,
            'session_id': self.session_id,
            'run_id': self.run_id,

            # Complete market state capture
            'market_data': self._capture_market_data(),

            # Position and portfolio state
            'position': self._capture_position_state(),
            'portfolio': self._capture_portfolio_state(),

            # All indicator values
            'indicators': self._capture_indicators(),

            # News/sentiment data (paper trading only)
            'news_sentiment': self._capture_news_sentiment() if self.mode == 'PAPER' else None,

            # Strategy reasoning (if provided)
            'reasoning': self._get_strategy_reasoning(),
            'confidence': self._get_strategy_confidence(),

            # Action placeholders (filled by notify_order)
            'action': None,
            'order_details': None,
            'trade_details': None
        }

        # Store current decision for order correlation
        self.current_decision = decision

        # For paper trading, stream immediately
        if self.stream_realtime:
            self.storage.stream_decision(decision)

    def notify_order(self, order):
        """Record order events and correlate with decisions"""
        if not self.current_decision:
            return

        if order.status in [order.Submitted, order.Accepted]:
            # Record the action taken
            action_type = self._determine_action_type(order)
            order_details = self._extract_order_details(order)

            # Update current decision with order information
            self.current_decision.update({
                'action': action_type,
                'order_details': order_details,
                'order_timestamp': datetime.utcnow().isoformat()
            })

            # Store the complete decision
            self.decisions.append(self.current_decision.copy())

            # Stream order update for paper trading
            if self.stream_realtime:
                self.storage.stream_order_update(self.current_decision)

        elif order.status == order.Completed:
            # Record execution details
            execution_record = {
                'decision_id': f"{self.run_id}_{self.decision_count}_execution",
                'decision_number': self.decision_count,
                'timestamp': self.strategy.datetime.datetime(0).isoformat(),
                'type': 'execution',
                'mode': self.mode,
                'agent_id': self.agent_id,
                'user_id': self.user_id,
                'run_id': self.run_id,
                'order_id': order.ref,
                'executed_size': order.executed.size,
                'executed_price': order.executed.price,
                'commission': order.executed.comm,
                'execution_timestamp': datetime.utcnow().isoformat()
            }

            self.decisions.append(execution_record)

            if self.stream_realtime:
                self.storage.stream_execution(execution_record)

    def notify_trade(self, trade):
        """Record trade closure events"""
        if not trade.isclosed:
            return

        trade_record = {
            'decision_id': f"{self.run_id}_{self.decision_count}_trade",
            'decision_number': self.decision_count,
            'timestamp': self.strategy.datetime.datetime(0).isoformat(),
            'type': 'trade_closed',
            'mode': self.mode,
            'agent_id': self.agent_id,
            'user_id': self.user_id,
            'run_id': self.run_id,
            'trade_pnl': float(trade.pnl),
            'trade_pnl_net': float(trade.pnlcomm),
            'commission': float(trade.commission),
            'bars_held': trade.barlen,
            'trade_size': trade.size,
            'entry_price': trade.price,
            'exit_price': trade.price + (trade.pnl / trade.size) if trade.size != 0 else 0,
            'trade_timestamp': datetime.utcnow().isoformat()
        }

        self.decisions.append(trade_record)

        if self.stream_realtime:
            self.storage.stream_trade_close(trade_record)

    def _capture_market_data(self) -> Dict[str, Any]:
        """Capture complete market state for all data feeds"""
        market_data = {}

        for i, data in enumerate(self.strategy.datas):
            symbol = getattr(data, '_name', f"data_{i}")

            # Current bar data
            current_bar = {
                'open': float(data.open[0]),
                'high': float(data.high[0]),
                'low': float(data.low[0]),
                'close': float(data.close[0]),
                'volume': int(data.volume[0]) if len(data.volume) else 0,
            }

            # Historical context (if available)
            historical_context = {}
            for lookback, days in [(1, '1d'), (5, '5d'), (20, '20d')]:
                if len(data) > lookback:
                    historical_context[f'close_{days}_ago'] = float(data.close[-lookback])
                    historical_context[f'change_{days}'] = self.utils.calculate_percentage_change(
                        data.close[0], data.close[-lookback]
                    )

            # Technical indicators (basic)
            technical_data = {}
            if len(data) >= 20:
                closes = [float(data.close[-i]) for i in range(min(20, len(data)))]
                technical_data['sma_20'] = self.utils.calculate_sma(closes, 20)
                technical_data['volatility_20'] = self.utils.calculate_volatility(closes)

            market_data[symbol] = {
                **current_bar,
                **historical_context,
                **technical_data
            }

        return market_data

    def _capture_position_state(self) -> Dict[str, Any]:
        """Capture current position state for all instruments"""
        positions = {}

        for i, data in enumerate(self.strategy.datas):
            symbol = getattr(data, '_name', f"data_{i}")
            position = self.strategy.getposition(data)

            positions[symbol] = {
                'size': position.size,
                'price': float(position.price) if position.size else 0,
                'pnl': float(position.pnl) if position.size else 0,
                'pnl_percent': self.utils.calculate_percentage_change(
                    data.close[0], position.price
                ) if position.size and position.price else 0,
                'market_value': position.size * data.close[0] if position.size else 0
            }

        return positions

    def _capture_portfolio_state(self) -> Dict[str, Any]:
        """Capture complete portfolio state"""
        broker = self.strategy.broker

        portfolio_value = float(broker.getvalue())
        cash = float(broker.getcash())

        return {
            'cash': cash,
            'value': portfolio_value,
            'equity': portfolio_value,  # For compatibility
            'margin_used': max(0, cash - portfolio_value),
            'leverage': (portfolio_value / cash) if cash > 0 else 0,
            'positions_value': portfolio_value - cash,
            'free_margin': cash
        }

    def _capture_indicators(self) -> Dict[str, Any]:
        """Capture all indicator values from the strategy"""
        indicators = {}

        # Introspect strategy for indicators
        for attr_name in dir(self.strategy):
            if attr_name.startswith('_'):
                continue

            attr = getattr(self.strategy, attr_name)

            # Check if it's a Backtrader indicator
            if isinstance(attr, bt.Indicator):
                try:
                    # Handle multi-line indicators
                    if hasattr(attr, 'lines') and len(attr.lines) > 1:
                        for line_name in attr.lines.getlinealiases():
                            key = f"{attr_name}_{line_name}"
                            try:
                                indicators[key] = float(attr.lines[line_name][0])
                            except (IndexError, TypeError, ValueError):
                                indicators[key] = None
                    else:
                        # Single-line indicator
                        try:
                            indicators[attr_name] = float(attr[0])
                        except (IndexError, TypeError, ValueError):
                            indicators[attr_name] = None

                except Exception as e:
                    logging.debug(f"Failed to capture indicator {attr_name}: {e}")
                    indicators[attr_name] = None

        return indicators

    def _capture_news_sentiment(self) -> Optional[Dict[str, Any]]:
        """Capture news sentiment data (paper trading only)"""
        if hasattr(self.strategy, 'news_sentiment'):
            return getattr(self.strategy, 'news_sentiment')
        return None

    def _get_strategy_reasoning(self) -> Optional[str]:
        """Get reasoning from strategy if provided"""
        if hasattr(self.strategy, 'get_decision_reasoning'):
            try:
                return self.strategy.get_decision_reasoning()
            except Exception as e:
                logging.debug(f"Failed to get strategy reasoning: {e}")
                return f"Error getting reasoning: {e}"
        return None

    def _get_strategy_confidence(self) -> Optional[float]:
        """Get confidence score from strategy if provided"""
        if hasattr(self.strategy, 'get_decision_confidence'):
            try:
                confidence = self.strategy.get_decision_confidence()
                return float(confidence) if confidence is not None else None
            except Exception as e:
                logging.debug(f"Failed to get strategy confidence: {e}")
                return None
        return None

    def _determine_action_type(self, order) -> str:
        """Determine action type from order"""
        if order.isbuy():
            return 'buy'
        elif order.issell():
            return 'sell'
        elif hasattr(order, 'isclose') and order.isclose():
            return 'close'
        else:
            return 'unknown'

    def _extract_order_details(self, order) -> Dict[str, Any]:
        """Extract comprehensive order details"""
        return {
            'order_id': order.ref,
            'size': order.size,
            'price': order.price or self.data.close[0],
            'order_type': order.ordertypename(),
            'status': order.getstatusname(),
            'data_name': getattr(order.data, '_name', 'unknown'),
            'created_timestamp': datetime.utcnow().isoformat()
        }

    def stop(self):
        """Final processing and storage when analysis completes"""
        # Generate summary statistics
        summary = {
            'agent_id': self.agent_id,
            'user_id': self.user_id,
            'run_id': self.run_id,
            'session_id': self.session_id,
            'mode': self.mode,
            'total_decisions': len(self.decisions),
            'total_decision_points': self.decision_count,
            'actions_taken': len([d for d in self.decisions if d.get('action') not in [None, 'hold']]),
            'trades_closed': len([d for d in self.decisions if d.get('type') == 'trade_closed']),
            'executions': len([d for d in self.decisions if d.get('type') == 'execution']),
            'completed_at': datetime.utcnow().isoformat(),
            'duration_seconds': (datetime.utcnow() - datetime.fromisoformat(
                self.run_id.split('_')[-2] + 'T' + self.run_id.split('_')[-1].replace('_', ':')
            )).total_seconds() if '_' in self.run_id else 0
        }

        # Store data based on mode
        if self.mode == 'BACKTEST':
            # Batch storage for backtesting
            self.storage.store_backtest_results(self.decisions, summary)
        else:
            # Summary storage for paper trading (decisions already streamed)
            self.storage.store_paper_summary(summary)

        logging.info(f"FMEL Recording completed: {summary}")

    def get_analysis(self) -> Dict[str, Any]:
        """Return analysis data for Backtrader"""
        return {
            'total_decisions': len(self.decisions),
            'total_decision_points': self.decision_count,
            'mode': self.mode,
            'run_id': self.run_id,
            'sample_decisions': self.decisions[:5] if self.decisions else []  # Sample for debugging
        }