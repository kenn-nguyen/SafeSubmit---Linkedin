# CrewAI Backend Service

This Flask backend service provides CrewAI-powered endpoints for job evaluation and resume generation.

## Python Version Compatibility

**IMPORTANT**: CrewAI currently uses Pydantic V1, which is incompatible with Python 3.14. You have two options:

### Option 1: Use Python 3.13 or Earlier (Recommended)

The easiest solution is to use Python 3.13 or earlier. If you have Python 3.14 installed, you can use `pyenv` to manage multiple Python versions:

1. **Install pyenv** (if not already installed):
   ```bash
   # macOS
   brew install pyenv
   
   # Add to your shell profile (~/.zshrc or ~/.bashrc):
   eval "$(pyenv init -)"
   ```

2. **Install Python 3.13:**
   ```bash
   pyenv install 3.13.0
   pyenv local 3.13.0
   ```

3. **Run the setup script:**
   ```bash
   ./setup_python314.sh
   ```

### Option 2: Try with Python 3.14 (Experimental)

We've updated to CrewAI 1.6.1 and forced Pydantic V2. This may work but is experimental:

1. **Create a virtual environment:**
   ```bash
   python3.14 -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies:**
   ```bash
   pip install --upgrade pip
   pip install -r requirements.txt
   ```

3. **If you encounter Pydantic errors**, fall back to Option 1.

## Setup Instructions

1. **Create a virtual environment:**
   ```bash
   python -m venv .venv
   source .venv/bin/activate
   ```

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **Create a `.env` file in the `backend_crewai_service` directory:**
   ```env
   # API Key (set one of these)
   API_KEY=your_gemini_api_key_here
   # OR
   GEMINI_API_KEY=your_gemini_api_key_here
   # OR
   GOOGLE_API_KEY=your_gemini_api_key_here

   # Model Configuration (optional - defaults are set)
   # Used for: job evaluation agents
   # Faster model for efficient batch processing
   GEMINI_EVALUATION_MODEL_NAME=gemini-2.5-flash
   
   # Used for: agent panel/crew creation (both evaluation and resume crews)
   # More powerful model for intelligent crew assembly
   GEMINI_PANEL_CREATION_MODEL_NAME=gemini-2.5-pro
   
   # Used for: resume writing, editing, and finalization
   # More powerful model for high-quality content creation
   GEMINI_RESUME_MODEL_NAME=gemini-2.5-pro
   ```

4. **Run the Flask server:**
   ```bash
   python app.py
   ```

The server will start on `http://0.0.0.0:5001`

## Architecture

This backend implements two autonomous "meta-crews" that create their own specialized teams:

1. **Job Evaluation Crew (The "Hiring Committee")**
   - Automatically recruits a 4-person panel led by a domain-specific Hiring Manager
   - Panel creation uses `gemini-2.5-pro` by default (configurable via `GEMINI_PANEL_CREATION_MODEL_NAME`)
   - Job evaluation uses `gemini-2.5-flash` by default (configurable via `GEMINI_EVALUATION_MODEL_NAME`)
   - Provides multi-faceted analysis of job opportunities

2. **Resume Generation Crew (The "Editorial Team")**
   - Automatically recruits a 4-person team for sequential workflow (Strategist → Writer → Quantifier → Finisher)
   - Panel creation uses `gemini-2.5-pro` by default (configurable via `GEMINI_PANEL_CREATION_MODEL_NAME`)
   - Resume writing/editing uses `gemini-2.5-pro` by default (configurable via `GEMINI_RESUME_MODEL_NAME`)
   - Produces tailored, ATS-friendly resumes

## API Endpoints

- `GET /` - Health check
- `GET /test_gemini` - Test Gemini API configuration and model settings
- `POST /jobs/analyze_batch` - Analyze a batch of jobs (requires `resumeText`, `userIntent`, and `jobs`)
- `POST /resume/generate` - Generate a tailored resume (requires `resumeText`, `userIntent`, and `job`)

**Note:** The `/agents/create_panel` endpoint has been removed. Agent creation is now handled autonomously by each crew.

## Troubleshooting

If you encounter Pydantic errors, ensure you're using Python 3.11 or 3.12, not Python 3.14.

