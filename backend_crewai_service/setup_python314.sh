#!/bin/bash
# Setup script for Python 3.14 users - installs Python 3.13 via pyenv

echo "=========================================="
echo "CrewAI Setup for Python 3.14 Users"
echo "=========================================="
echo ""
echo "This script will install Python 3.13 via pyenv"
echo "since CrewAI requires Python 3.13 or earlier."
echo ""

# Check if pyenv is installed
if ! command -v pyenv &> /dev/null; then
    echo "❌ pyenv is not installed."
    echo ""
    echo "Please install pyenv first:"
    echo "  brew install pyenv"
    echo ""
    echo "Then add to your ~/.zshrc:"
    echo "  eval \"\$(pyenv init -)\""
    echo ""
    echo "Then run: source ~/.zshrc"
    echo ""
    exit 1
fi

echo "✓ pyenv is installed"
echo ""

# Check if Python 3.13 is already installed
if pyenv versions | grep -q "3.13.0"; then
    echo "✓ Python 3.13.0 is already installed"
else
    echo "Installing Python 3.13.0 (this may take a few minutes)..."
    pyenv install 3.13.0
    if [ $? -ne 0 ]; then
        echo "❌ Failed to install Python 3.13.0"
        exit 1
    fi
    echo "✓ Python 3.13.0 installed successfully"
fi

# Set local Python version
echo ""
echo "Setting local Python version to 3.13.0..."
pyenv local 3.13.0

# Verify Python version
CURRENT_PYTHON=$(python --version 2>&1)
echo "✓ Current Python: $CURRENT_PYTHON"
echo ""

# Remove old venv if it exists
if [ -d ".venv" ]; then
    echo "Removing old virtual environment..."
    rm -rf .venv
fi

# Create virtual environment
echo "Creating new virtual environment..."
python -m venv .venv

# Activate and install dependencies
echo "Installing dependencies..."
source .venv/bin/activate
pip install --upgrade pip --quiet
pip install -r requirements.txt

if [ $? -eq 0 ]; then
    echo ""
    echo "=========================================="
    echo "✅ Setup complete!"
    echo "=========================================="
    echo ""
    echo "To activate the environment, run:"
    echo "  source .venv/bin/activate"
    echo ""
    echo "Then start the server with:"
    echo "  python app.py"
    echo ""
else
    echo ""
    echo "❌ Installation failed. Please check the error messages above."
    exit 1
fi

