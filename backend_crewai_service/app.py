import os
import json
import base64
from io import BytesIO
from flask import Flask, request, jsonify, Response, stream_with_context
import traceback
from flask_cors import CORS
from dotenv import load_dotenv
from pypdf import PdfReader
from crews import (
    build_evaluation_panel,
    run_evaluation_crew,
    run_resume_crew,
    build_resume_panel,
    generate_evaluation_instructions,
    run_evaluation_batch_llm,
    run_resume_crew_streaming,
)

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
    
    return jsonify({
        "message": "API_KEY is set (though not verified)",
        "api_key_first_5_chars": api_key[:5] if len(api_key) >= 5 else "*****"
    }), 200

@app.route('/agents/create_panel', methods=['POST'])
def create_panel():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')
    job_payload = data.get('job') or {}
    job_description = data.get('jobDescription') or job_payload.get('description') or user_intent

    if not all([resume_text, user_intent]):
        return jsonify({"error": "Missing resumeText or userIntent"}), 400

    def backend_on_log(message: str, type: str, agent_name: str = "Backend"):
        print(f"[Backend Log - {type.upper()}] {agent_name}: {message}")
    
    try:
        agent_panel = build_evaluation_panel(resume_text, user_intent, backend_on_log)
        if not agent_panel:
             return jsonify({"error": "Failed to create agent panel"}), 500
        return jsonify({"agents": agent_panel}), 200
    except ValueError as e:
        status = 429 if "rate limit" in str(e).lower() or "quota" in str(e).lower() else 400
        return jsonify({"error": str(e)}), status
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
            print(f"[Backend Log - INFO] Dispatcher: (Job ID: {job_id}) Normalized result: {result}")
            results.append(result)

        # The agent panel is now managed by the frontend, so we don't return it here.
        return jsonify({"results": results}), 200
    except ValueError as e:
        print(f"Validation error during batch analysis: {e}")
        traceback.print_exc()
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        print(f"Error analyzing job batch: {e}")
        traceback.print_exc()
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/agents/create_resume_panel', methods=['POST'])
def create_resume_panel():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')
    job_payload = data.get('job') or {}
    job_description = data.get('jobDescription') or job_payload.get('description') or user_intent

    if not all([resume_text, user_intent]):
        return jsonify({"error": "Missing resumeText or userIntent"}), 400

    def backend_on_log(message: str, type: str, agent_name: str = "Backend"):
        print(f"[Backend Log - {type.upper()}] {agent_name}: {message}")
    
    try:
        panel = build_resume_panel(resume_text, user_intent, job_description, backend_on_log)
        if not panel:
            return jsonify({"error": "Failed to create resume panel"}), 500
        return jsonify({"agents": panel}), 200
    except ValueError as e:
        status = 429 if "rate limit" in str(e).lower() or "quota" in str(e).lower() else 400
        return jsonify({"error": str(e)}), status
    except Exception as e:
        print(f"Error creating resume panel: {e}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/instructions/evaluation', methods=['POST'])
def create_evaluation_instructions():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')
    if not all([resume_text, user_intent]):
        return jsonify({"error": "Missing resumeText or userIntent"}), 400
    try:
        instructions = generate_evaluation_instructions(resume_text, user_intent)
        return jsonify({"instructions": instructions}), 200
    except Exception as e:
        print(f"Error generating instructions: {e}")
        return jsonify({"error": f"An unexpected error occurred: {str(e)}"}), 500

@app.route('/jobs/evaluate_batch_v2', methods=['POST'])
def evaluate_batch_v2():
    data = request.json
    resume_text = data.get('resumeText')
    user_intent = data.get('userIntent')
    jobs = data.get('jobs')
    instructions = data.get('instructions')

    if not all([resume_text, user_intent, jobs, instructions]):
        return jsonify({"error": "Missing resumeText, userIntent, jobs, or instructions"}), 400

    try:
        results = run_evaluation_batch_llm(resume_text, user_intent, jobs, instructions)
        return jsonify({"results": results}), 200
    except ValueError as e:
        status = 429 if "rate limit" in str(e).lower() or "quota" in str(e).lower() else 400
        return jsonify({"error": str(e)}), status
    except Exception as e:
        print(f"Error in evaluate_batch_v2: {e}")
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
        # Stream crew progress and final resume back to the frontend as JSONL
        def event_stream():
            try:
                for chunk in run_resume_crew_streaming(resume_text, user_intent, job, backend_on_log):
                    yield json.dumps(chunk) + "\n"
            except Exception as e:
                print(f"Streaming error: {e}")
                yield json.dumps({"error": str(e)}) + "\n"

        return Response(stream_with_context(event_stream()), mimetype='text/event-stream')
    except ValueError as e:
        status = 429 if "rate limit" in str(e).lower() or "quota" in str(e).lower() else 400
        return jsonify({"error": str(e)}), status
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

    app.run(host='0.0.0.0', port=5002)
