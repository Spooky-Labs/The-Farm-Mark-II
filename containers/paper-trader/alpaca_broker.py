"""
Custom Alpaca Broker for Backtrader Paper Trading
Routes all orders through Alpaca Paper Trading API
"""
import uuid
from datetime import datetime, timezone
from typing import Dict, Any, Optional, List
import backtrader as bt
import alpaca_trade_api as tradeapi
from alpaca_trade_api.rest import TimeFrame


class AlpacaBroker(bt.brokers.BackBroker):
    """
    Custom Backtrader broker that routes orders to Alpaca Paper Trading API
    This integrates Backtrader strategies with real Alpaca paper trading
    """

    params = (
        ('api_key', ''),
        ('secret_key', ''),
        ('base_url', 'https://paper-api.alpaca.markets'),
        ('cash', 100000.0),
        ('commission', 0.0),  # Alpaca commission-free
        ('margin', None),
        ('mult', 1.0),
        ('interest', 0.0),
        ('interest_long', False),
        ('leverage', 1.0),
        ('checksubmit', True),
        ('filler', None),
        ('coc', False),  # Cheat on close
    )

    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        # Initialize Alpaca API
        self.alpaca_api = tradeapi.REST(
            self.p.api_key,
            self.p.secret_key,
            self.p.base_url,
            api_version='v2'
        )

        # Track orders and positions
        self.alpaca_orders = {}  # Backtrader order ID -> Alpaca order
        self.pending_orders = {}  # Orders waiting for execution
        self.position_cache = {}  # Cache of current positions

        # Initialize account
        self._sync_account()

        print(f"Initialized Alpaca Broker")
        print(f"Account status: {self.account.status}")
        print(f"Buying power: ${float(self.account.buying_power):,.2f}")

    def _sync_account(self):
        """
        Sync account information from Alpaca
        """
        try:
            self.account = self.alpaca_api.get_account()

            # Update broker cash to match Alpaca account
            self.cash = float(self.account.cash)
            self.value = float(self.account.portfolio_value)

            # Update positions
            positions = self.alpaca_api.list_positions()
            for position in positions:
                symbol = position.symbol
                self.position_cache[symbol] = {
                    'size': float(position.qty),
                    'price': float(position.avg_cost),
                    'value': float(position.market_value)
                }

            print(f"Synced account: Cash=${self.cash:,.2f}, Value=${self.value:,.2f}")

        except Exception as e:
            print(f"Error syncing account: {e}")
            # Fallback to default values
            self.cash = self.p.cash
            self.value = self.p.cash

    def start(self):
        """
        Called when broker starts
        """
        super().start()
        self._sync_account()

    def submit(self, order):
        """
        Submit order to Alpaca
        Called by Backtrader when strategy places an order
        """
        try:
            # Get order details
            data = order.data
            symbol = getattr(data, 'name', getattr(data, '_name', 'UNKNOWN'))

            # Determine order type and side
            if order.isbuy():
                side = 'buy'
            elif order.issell():
                side = 'sell'
            else:
                self.reject(order)
                return order

            # Determine order type
            if order.exectype == bt.Order.Market:
                order_type = 'market'
                limit_price = None
                stop_price = None
            elif order.exectype == bt.Order.Limit:
                order_type = 'limit'
                limit_price = order.price
                stop_price = None
            elif order.exectype == bt.Order.Stop:
                order_type = 'stop'
                limit_price = None
                stop_price = order.price
            elif order.exectype == bt.Order.StopLimit:
                order_type = 'stop_limit'
                limit_price = order.price
                stop_price = order.auxprice
            else:
                print(f"Unsupported order type: {order.exectype}")
                self.reject(order)
                return order

            # Prepare order request
            order_request = {
                'symbol': symbol,
                'qty': abs(order.size),
                'side': side,
                'type': order_type,
                'time_in_force': 'day',  # Default to day orders
                'client_order_id': str(uuid.uuid4())
            }

            # Add price parameters if needed
            if limit_price is not None:
                order_request['limit_price'] = limit_price
            if stop_price is not None:
                order_request['stop_price'] = stop_price

            print(f"Submitting {side} order for {abs(order.size)} shares of {symbol}")
            print(f"Order type: {order_type}, Details: {order_request}")

            # Submit to Alpaca
            alpaca_order = self.alpaca_api.submit_order(**order_request)

            # Store order mapping
            self.alpaca_orders[order.ref] = alpaca_order
            self.pending_orders[order.ref] = order

            # Accept the order
            self.accept(order)

            print(f"Order submitted to Alpaca: {alpaca_order.id}")
            return order

        except Exception as e:
            print(f"Error submitting order: {e}")
            self.reject(order)
            return order

    def cancel(self, order):
        """
        Cancel order in Alpaca
        """
        try:
            if order.ref in self.alpaca_orders:
                alpaca_order = self.alpaca_orders[order.ref]
                self.alpaca_api.cancel_order(alpaca_order.id)

                # Remove from tracking
                del self.alpaca_orders[order.ref]
                if order.ref in self.pending_orders:
                    del self.pending_orders[order.ref]

                # Mark as canceled
                self.cancel(order)
                print(f"Canceled order: {alpaca_order.id}")

            return order

        except Exception as e:
            print(f"Error canceling order: {e}")
            return order

    def get_notification(self):
        """
        Check for order updates from Alpaca
        Called by Backtrader to get order status updates
        """
        notifications = []

        try:
            # Check pending orders for updates
            for order_ref, bt_order in list(self.pending_orders.items()):
                if order_ref in self.alpaca_orders:
                    alpaca_order = self.alpaca_orders[order_ref]

                    # Get latest order status
                    updated_order = self.alpaca_api.get_order(alpaca_order.id)

                    if updated_order.status == 'filled':
                        # Order filled - create execution notification
                        execution = self._create_execution(bt_order, updated_order)
                        notifications.append(execution)

                        # Remove from pending
                        del self.pending_orders[order_ref]

                        print(f"Order filled: {updated_order.id}, "
                              f"Qty: {updated_order.filled_qty}, "
                              f"Price: {updated_order.filled_avg_price}")

                    elif updated_order.status in ['canceled', 'rejected', 'expired']:
                        # Order canceled/rejected
                        self.cancel(bt_order)
                        del self.pending_orders[order_ref]

                        print(f"Order {updated_order.status}: {updated_order.id}")

        except Exception as e:
            print(f"Error checking order notifications: {e}")

        return notifications

    def _create_execution(self, order, alpaca_order):
        """
        Create Backtrader execution from Alpaca order
        """
        try:
            # Create execution object
            execution = bt.Order.Execution(
                dt=datetime.now(),
                size=float(alpaca_order.filled_qty) if order.isbuy() else -float(alpaca_order.filled_qty),
                price=float(alpaca_order.filled_avg_price),
                closed=float(alpaca_order.filled_qty),
                closedvalue=float(alpaca_order.filled_qty) * float(alpaca_order.filled_avg_price),
                openedvalue=0,
                opened=0,
                barlen=0,
                commission=0  # Alpaca is commission-free
            )

            # Update order with execution
            order.execute(
                dt=execution.dt,
                size=execution.size,
                price=execution.price,
                closed=execution.closed,
                closedvalue=execution.closedvalue,
                openedvalue=execution.openedvalue,
                opened=execution.opened,
                barlen=execution.barlen,
                commission=execution.commission
            )

            return execution

        except Exception as e:
            print(f"Error creating execution: {e}")
            return None

    def getposition(self, data, clone=True):
        """
        Get current position for a data feed
        """
        symbol = getattr(data, 'name', getattr(data, '_name', 'UNKNOWN'))

        try:
            # Try to get from Alpaca
            try:
                position = self.alpaca_api.get_position(symbol)
                size = float(position.qty)
                price = float(position.avg_cost)
            except:
                # No position in Alpaca
                size = 0.0
                price = 0.0

            # Create Backtrader position
            pos = bt.Position(size=size, price=price)
            return pos

        except Exception as e:
            print(f"Error getting position for {symbol}: {e}")
            return bt.Position()

    def getvalue(self, datas=None):
        """
        Get current portfolio value
        """
        try:
            # Sync with latest account data
            account = self.alpaca_api.get_account()
            return float(account.portfolio_value)
        except Exception as e:
            print(f"Error getting portfolio value: {e}")
            return self.value

    def getcash(self):
        """
        Get current cash balance
        """
        try:
            account = self.alpaca_api.get_account()
            return float(account.cash)
        except Exception as e:
            print(f"Error getting cash balance: {e}")
            return self.cash

    def get_fundshares(self, fundname, shares):
        """
        Get fund shares (not applicable for Alpaca)
        """
        return 0.0

    def get_fundvalue(self, fundname):
        """
        Get fund value (not applicable for Alpaca)
        """
        return 0.0

    def get_account_info(self) -> Dict[str, Any]:
        """
        Get comprehensive account information
        """
        try:
            account = self.alpaca_api.get_account()
            positions = self.alpaca_api.list_positions()

            return {
                'account_number': account.account_number,
                'status': account.status,
                'currency': account.currency,
                'cash': float(account.cash),
                'portfolio_value': float(account.portfolio_value),
                'buying_power': float(account.buying_power),
                'equity': float(account.equity),
                'last_equity': float(account.last_equity),
                'multiplier': float(account.multiplier),
                'day_trading_buying_power': float(account.day_trading_buying_power),
                'regt_buying_power': float(account.regt_buying_power),
                'daytrading_buying_power': float(account.daytrading_buying_power),
                'sma': float(account.sma),
                'pattern_day_trader': account.pattern_day_trader,
                'trading_blocked': account.trading_blocked,
                'transfers_blocked': account.transfers_blocked,
                'account_blocked': account.account_blocked,
                'created_at': account.created_at,
                'trade_suspended_by_user': account.trade_suspended_by_user,
                'positions_count': len(positions),
                'positions': [
                    {
                        'symbol': pos.symbol,
                        'qty': float(pos.qty),
                        'market_value': float(pos.market_value),
                        'avg_cost': float(pos.avg_cost),
                        'unrealized_pl': float(pos.unrealized_pl),
                        'unrealized_plpc': float(pos.unrealized_plpc),
                        'side': pos.side
                    }
                    for pos in positions
                ]
            }

        except Exception as e:
            print(f"Error getting account info: {e}")
            return {
                'error': str(e),
                'cash': self.cash,
                'value': self.value
            }