"""
Spooky Labs FMEL (Foundation Model Explainability Layer) Library

This library provides a unified Backtrader Analyzer for recording trading decisions
in both backtesting and paper trading environments.
"""

from .recorder import FMELRecorder
from .storage import FMELStorage
from .utils import FMELUtils

__version__ = "1.0.0"
__all__ = ["FMELRecorder", "FMELStorage", "FMELUtils"]