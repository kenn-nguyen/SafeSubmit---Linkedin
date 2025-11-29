# Quick Start Guide for Python 3.14 Users

Since you have Python 3.14, but CrewAI requires Python 3.13 or earlier, here's the fastest way to get set up:

## Quick Setup (Recommended)

### Step 1: Install pyenv (if not already installed)

**macOS:**
```bash
brew install pyenv
```

Add to your `~/.zshrc`:
```bash
eval "$(pyenv init -)"
```

Then reload:
```bash
source ~/.zshrc
```

### Step 2: Install Python 3.13

```bash
pyenv install 3.13.0
cd /Users/kennng/SafeSubmit/SafeSubmit---Linkedin/backend_crewai_service
pyenv local 3.13.0
```

### Step 3: Recreate Virtual Environment

```bash
# Remove old venv
rm -rf .venv

# Create new venv with Python 3.13
python -m venv .venv
source .venv/bin/activate

# Install dependencies
pip install --upgrade pip
pip install -r requirements.txt
```

### Step 4: Run the Server

```bash
python app.py
```

## Alternative: Try Python 3.14 (May Not Work)

If you want to try with Python 3.14 anyway:

```bash
rm -rf .venv
python3.14 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
python app.py
```

**Note:** This will likely fail with Pydantic compatibility errors. If it does, use the pyenv solution above.

