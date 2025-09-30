"""
FMEL Storage - Handles BigQuery and Firestore storage for FMEL data
"""

import json
import logging
from datetime import datetime
from typing import Dict, Any, List, Optional

from google.cloud import bigquery, firestore
from google.cloud.exceptions import GoogleCloudError


class FMELStorage:
    """
    FMEL Storage handler for BigQuery and Firestore operations

    Handles different storage patterns:
    - Backtesting: Batch upload to BigQuery at completion
    - Paper Trading: Real-time streaming to BigQuery + Firestore updates
    """

    def __init__(self, mode: str, agent_id: str, user_id: str, run_id: str, stream_realtime: bool = False):
        """Initialize storage clients and configuration"""
        self.mode = mode
        self.agent_id = agent_id
        self.user_id = user_id
        self.run_id = run_id
        self.stream_realtime = stream_realtime

        # Initialize Google Cloud clients
        try:
            self.bq_client = bigquery.Client()
            self.firestore_client = firestore.Client()
        except Exception as e:
            logging.error(f"Failed to initialize Google Cloud clients: {e}")
            raise

        # Project and dataset configuration
        self.project_id = self.bq_client.project
        self.bq_dataset = 'fmel'

        # BigQuery table references
        self.decisions_table = f"{self.project_id}.{self.bq_dataset}.trading_decisions"
        self.summaries_table = f"{self.project_id}.{self.bq_dataset}.run_summaries"

        logging.info(f"FMEL Storage initialized: mode={mode}, streaming={stream_realtime}")

    def stream_decision(self, decision: Dict[str, Any]) -> bool:
        """Stream a single decision to BigQuery (paper trading)"""
        if not self.stream_realtime:
            return False

        try:
            # Prepare row for BigQuery
            row = self._prepare_decision_row(decision)

            # Insert into BigQuery
            errors = self.bq_client.insert_rows_json(self.decisions_table, [row])

            if errors:
                logging.error(f"BigQuery streaming error: {errors}")
                return False

            logging.debug(f"Streamed decision {decision.get('decision_id', 'unknown')}")
            return True

        except Exception as e:
            logging.error(f"Failed to stream decision: {e}")
            return False

    def stream_order_update(self, decision: Dict[str, Any]) -> bool:
        """Update Firestore with order information (paper trading)"""
        if not self.stream_realtime:
            return False

        try:
            # Update Firestore for real-time monitoring
            doc_ref = (self.firestore_client
                      .collection('paper_trading_sessions')
                      .document(self.agent_id)
                      .collection('fmel_decisions')
                      .document(str(decision.get('decision_number', 'unknown'))))

            doc_ref.set({
                'timestamp': decision.get('timestamp'),
                'action': decision.get('action'),
                'order_details': decision.get('order_details'),
                'reasoning': decision.get('reasoning'),
                'confidence': decision.get('confidence'),
                'portfolio': decision.get('portfolio'),
                'updated_at': datetime.utcnow().isoformat()
            }, merge=True)

            return True

        except Exception as e:
            logging.error(f"Failed to update Firestore: {e}")
            return False

    def stream_execution(self, execution: Dict[str, Any]) -> bool:
        """Stream execution details to BigQuery"""
        return self.stream_decision(execution)

    def stream_trade_close(self, trade_record: Dict[str, Any]) -> bool:
        """Stream trade closure details to BigQuery"""
        return self.stream_decision(trade_record)

    def store_backtest_results(self, decisions: List[Dict[str, Any]], summary: Dict[str, Any]) -> bool:
        """Store complete backtest results in BigQuery (batch operation)"""
        try:
            # Prepare all decision rows
            decision_rows = [self._prepare_decision_row(decision) for decision in decisions]

            # Batch insert decisions
            if decision_rows:
                errors = self.bq_client.insert_rows_json(self.decisions_table, decision_rows)
                if errors:
                    logging.error(f"Failed to insert backtest decisions: {errors}")
                    return False

            # Store summary
            summary_row = self._prepare_summary_row(summary)
            errors = self.bq_client.insert_rows_json(self.summaries_table, [summary_row])

            if errors:
                logging.error(f"Failed to insert backtest summary: {errors}")
                return False

            logging.info(f"Stored backtest results: {len(decision_rows)} decisions")
            return True

        except Exception as e:
            logging.error(f"Failed to store backtest results: {e}")
            return False

    def store_paper_summary(self, summary: Dict[str, Any]) -> bool:
        """Store paper trading summary"""
        try:
            # Update Firestore
            doc_ref = (self.firestore_client
                      .collection('paper_trading_sessions')
                      .document(self.agent_id)
                      .collection('fmel_summaries')
                      .document(self.run_id))

            doc_ref.set(summary)

            # Also store in BigQuery for analysis
            summary_row = self._prepare_summary_row(summary)
            errors = self.bq_client.insert_rows_json(self.summaries_table, [summary_row])

            if errors:
                logging.error(f"Failed to insert paper trading summary: {errors}")

            logging.info(f"Stored paper trading summary: {self.run_id}")
            return True

        except Exception as e:
            logging.error(f"Failed to store paper trading summary: {e}")
            return False

    def _prepare_decision_row(self, decision: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare a decision record for BigQuery insertion"""
        return {
            'decision_id': decision.get('decision_id', f"unknown_{datetime.utcnow().timestamp()}"),
            'timestamp': self._ensure_timestamp(decision.get('timestamp')),
            'agent_id': self.agent_id,
            'user_id': self.user_id,
            'run_id': self.run_id,
            'session_id': decision.get('session_id', self.run_id),
            'mode': self.mode,

            # Core decision data
            'symbol': self._extract_primary_symbol(decision.get('market_data', {})),
            'action_type': decision.get('action', 'hold'),
            'quantity': self._extract_order_quantity(decision.get('order_details', {})),
            'price': self._extract_current_price(decision.get('market_data', {})),
            'confidence': self._safe_float(decision.get('confidence')),
            'reasoning': decision.get('reasoning', ''),

            # Market context
            'market_context': self._prepare_market_context(decision),
            'portfolio_value': self._safe_float(decision.get('portfolio', {}).get('value')),
            'position_value': self._safe_float(decision.get('portfolio', {}).get('positions_value')),
            'indicators': json.dumps(decision.get('indicators', {}), default=str),

            # Trade metrics (if available)
            'trade_pnl': self._safe_float(decision.get('trade_pnl')),
            'daily_return': self._calculate_daily_return(decision),

            # Metadata
            'recorded_at': datetime.utcnow().isoformat(),
            'decision_type': decision.get('type', 'decision'),
            'decision_number': decision.get('decision_number', 0)
        }

    def _prepare_summary_row(self, summary: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare a summary record for BigQuery insertion"""
        return {
            'run_id': self.run_id,
            'agent_id': self.agent_id,
            'user_id': self.user_id,
            'session_id': summary.get('session_id', self.run_id),
            'mode': self.mode,
            'total_decisions': summary.get('total_decisions', 0),
            'total_decision_points': summary.get('total_decision_points', 0),
            'actions_taken': summary.get('actions_taken', 0),
            'trades_closed': summary.get('trades_closed', 0),
            'executions': summary.get('executions', 0),
            'duration_seconds': summary.get('duration_seconds', 0),
            'completed_at': self._ensure_timestamp(summary.get('completed_at')),
            'recorded_at': datetime.utcnow().isoformat()
        }

    def _prepare_market_context(self, decision: Dict[str, Any]) -> Dict[str, Any]:
        """Prepare market context structure for BigQuery"""
        market_data = decision.get('market_data', {})
        portfolio = decision.get('portfolio', {})

        # Get primary symbol data
        primary_symbol_data = None
        if market_data:
            primary_symbol_data = list(market_data.values())[0] if market_data else {}

        return {
            'current_price': self._safe_float(primary_symbol_data.get('close') if primary_symbol_data else None),
            'volume': self._safe_int(primary_symbol_data.get('volume') if primary_symbol_data else None),
            'daily_change': self._safe_float(primary_symbol_data.get('change_1d') if primary_symbol_data else None),
            'portfolio_cash': self._safe_float(portfolio.get('cash')),
            'portfolio_equity': self._safe_float(portfolio.get('equity')),
            'market_sentiment': decision.get('news_sentiment', {}).get('label', 'neutral') if decision.get('news_sentiment') else 'neutral'
        }

    def _extract_primary_symbol(self, market_data: Dict[str, Any]) -> str:
        """Extract the primary trading symbol"""
        if not market_data:
            return 'UNKNOWN'
        return list(market_data.keys())[0] if market_data else 'UNKNOWN'

    def _extract_order_quantity(self, order_details: Dict[str, Any]) -> Optional[int]:
        """Extract order quantity"""
        if not order_details:
            return None
        return self._safe_int(order_details.get('size'))

    def _extract_current_price(self, market_data: Dict[str, Any]) -> Optional[float]:
        """Extract current price from market data"""
        if not market_data:
            return None
        primary_data = list(market_data.values())[0] if market_data else {}
        return self._safe_float(primary_data.get('close'))

    def _calculate_daily_return(self, decision: Dict[str, Any]) -> Optional[float]:
        """Calculate daily return percentage"""
        market_data = decision.get('market_data', {})
        if not market_data:
            return None

        primary_data = list(market_data.values())[0] if market_data else {}
        return self._safe_float(primary_data.get('change_1d'))

    def _ensure_timestamp(self, timestamp_str: Optional[str]) -> str:
        """Ensure timestamp is in proper ISO format"""
        if not timestamp_str:
            return datetime.utcnow().isoformat()

        try:
            # Validate and reformat timestamp
            dt = datetime.fromisoformat(timestamp_str.replace('Z', '+00:00'))
            return dt.isoformat()
        except (ValueError, AttributeError):
            return datetime.utcnow().isoformat()

    def _safe_float(self, value: Any) -> Optional[float]:
        """Safely convert value to float"""
        if value is None:
            return None
        try:
            return float(value)
        except (ValueError, TypeError):
            return None

    def _safe_int(self, value: Any) -> Optional[int]:
        """Safely convert value to int"""
        if value is None:
            return None
        try:
            return int(value)
        except (ValueError, TypeError):
            return None