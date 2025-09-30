"""
Setup configuration for Spooky Labs FMEL (Foundation Model Explainability Layer) Library
"""

from setuptools import setup, find_packages

setup(
    name="spooky-fmel",
    version="1.0.0",
    description="Foundation Model Explainability Layer for Spooky Labs AI Trading Platform",
    author="Spooky Labs",
    author_email="dev@spookylabs.com",
    packages=find_packages(),
    install_requires=[
        "backtrader>=1.9.76.123",
        "google-cloud-bigquery>=3.11.4",
        "google-cloud-firestore>=2.11.1",
        "google-cloud-pubsub>=2.18.0",
        "pandas>=1.5.3",
        "numpy>=1.24.3",
        "python-dateutil>=2.8.2"
    ],
    python_requires=">=3.8",
    classifiers=[
        "Development Status :: 5 - Production/Stable",
        "Intended Audience :: Developers",
        "License :: OSI Approved :: MIT License",
        "Programming Language :: Python :: 3",
        "Programming Language :: Python :: 3.8",
        "Programming Language :: Python :: 3.9",
        "Programming Language :: Python :: 3.10",
        "Programming Language :: Python :: 3.11",
    ],
    keywords="trading, ai, backtrader, explainability, fmel",
)