import os
import json
import base64
from io import BytesIO
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from pypdf import PdfReader
from crews import build_evaluation_panel, run_evaluation_crew, run_resume_crew

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__)
CORS(app) # Enable CORS for all routes

# Basic route to check if the server is running
@app.route('/')
def home():
    return "CrewAI Backend Service is running!"

@app.route('/resume/upload_pdf', methods=['POST'])
def upload_pdf():
    data = request.json
    pdf_base64 = data.get('pdf_base64')
    if not pdf_base64:
        return jsonify({"error": "Missing pdf_base64 in request"}), 400

    try:
        pdf_bytes = base64.b64decode(pdf_base64)
        pdf_file = BytesIO(pdf_bytes)
        reader = PdfReader(pdf_file)
        
        resume_text = ""
        for page in reader.pages:
            resume_text += page.extract_text() + "\n"
        
        if not resume_text.strip():
            return jsonify({"error": "No text extracted from PDF"}), 400

        return jsonify({"resumeText": resume_text}), 200
    except Exception as e:
        print(f"Error processing PDF: {e}")
        return jsonify({"error": f"Failed to process PDF: {str(e)}"}), 500

@app.route('/test_gemini', methods=['GET'])
def test_gemini():
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        return jsonify({"error": "API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY not set"}), 500
    
    # Check model names (matching crews.py configuration)
    evaluation_model_name = os.getenv("GEMINI_EVALUATION_MODEL_NAME", "gemini-2.5-flash")
    panel_creation_model_name = os.getenv("GEMINI_PANEL_CREATION_MODEL_NAME", "gemini-2.5-pro")
    resume_model_name = os.getenv("GEMINI_RESUME_MODEL_NAME", "gemini-2.5-pro")

    return jsonify({
        "message": "API_KEY is set (though not verified)",
        "api_key_first_5_chars": api_key[:5] if len(api_key) >= 5 else "*****",
        "evaluation_model": evaluation_model_name,
        "panel_creation_model": panel_creation_model_name,
        "resume_model": resume_model_name
    }), 200

@app.route('/agents/create_panel', methods=['POST'])
def create_panel():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')

    if not all([resume_text, user_intent]):
        return jsonify({"error": "Missing resumeText or userIntent"}), 400

    def backend_on_log(message: str, type: str, agent_name: str = "Backend"):
        print(f"[Backend Log - {type.upper()}] {agent_name}: {message}")
    
    try:
        agent_panel = build_evaluation_panel(resume_text, user_intent, backend_on_log)
        if not agent_panel:
             return jsonify({"error": "Failed to create agent panel"}), 500
        return jsonify({"agents": agent_panel}), 200
    except Exception as e:
        print(f"Error creating agent panel: {e}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/jobs/analyze_batch', methods=['POST'])
def analyze_batch():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')
    jobs = data.get('jobs')
    agent_panel = data.get('agents') # Expect the pre-built agent panel

    if not all([resume_text, user_intent, jobs, agent_panel]):
        return jsonify({"error": "Missing resumeText, userIntent, jobs, or agents panel"}), 400

    def backend_on_log(message: str, type: str, agent_name: str = "Backend"):
        print(f"[Backend Log - {type.upper()}] {agent_name}: {message}")

    results = []
    try:
        for job in jobs:
            job_id = job.get('id', 'N/A')
            def make_logger(jid):
                return lambda msg, type, name: backend_on_log(f"(Job ID: {jid}) {msg}", type, name)
            on_log_with_job = make_logger(job_id)

            result = run_evaluation_crew(resume_text, user_intent, job, agent_panel, on_log_with_job)
            results.append(result)

        # The agent panel is now managed by the frontend, so we don't return it here.
        return jsonify({"results": results}), 200
    except Exception as e:
        print(f"Error analyzing job batch: {e}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/resume/generate', methods=['POST'])
def generate_resume():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent') # User's career goal
    job = data.get('job')

    if not all([resume_text, user_intent, job]):
        return jsonify({"error": "Missing resumeText, userIntent, or job"}), 400
    
    def backend_on_log(message: str, type: str, agent_name: str = "Backend"):
        print(f"[Backend Log - {type.upper()}] {agent_name}: {message}")

    try:
        # The new autonomous crew handles its own panel creation.
        generated_resume = run_resume_crew(resume_text, user_intent, job, backend_on_log)
        return jsonify({"generatedResume": generated_resume}), 200
    except Exception as e:
        print(f"Error generating resume: {e}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

if __name__ == '__main__':
    # Check for API key (supports multiple environment variable names)
    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY") or os.getenv("API_KEY")
    if not api_key:
        print("WARNING: API_KEY, GEMINI_API_KEY, or GOOGLE_API_KEY not set.")
        print("Please set one of these in your .env file or environment variables.")
        print("The server will start but API calls will fail without a valid key.")

    # Set default model names if not in .env
    # Evaluation crew: faster model for batch processing
    os.environ.setdefault("GEMINI_EVALUATION_MODEL_NAME", "gemini-2.5-flash")
    # Panel creation: more powerful model for intelligent crew assembly
    os.environ.setdefault("GEMINI_PANEL_CREATION_MODEL_NAME", "gemini-2.5-pro")
    # Resume generation crew: more powerful model for high-quality content
    os.environ.setdefault("GEMINI_RESUME_MODEL_NAME", "gemini-2.5-pro")
    
    print(f"Configuration:")
    print(f"  Evaluation Model: {os.getenv('GEMINI_EVALUATION_MODEL_NAME')}")
    print(f"  Panel Creation Model: {os.getenv('GEMINI_PANEL_CREATION_MODEL_NAME')}")
    print(f"  Resume Model: {os.getenv('GEMINI_RESUME_MODEL_NAME')}")
    
    app.run(host='0.0.0.0', port=5002)
