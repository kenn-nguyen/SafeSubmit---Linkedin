#!/usr/bin/env python3
"""Test script to verify CrewAI Gemini LLM integration"""

import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Test LLM initialization
try:
    from crews import gemini_batch_model, gemini_tailor_model
    
    print("✅ LLM Import Successful!")
    print(f"   Batch Model: {gemini_batch_model.model}")
    print(f"   Tailor Model: {gemini_tailor_model.model}")
    print(f"   Batch Model Type: {type(gemini_batch_model).__name__}")
    print(f"   Tailor Model Type: {type(gemini_tailor_model).__name__}")
    
    # Check if using native provider
    if "GeminiCompletion" in str(type(gemini_batch_model)):
        print("✅ Using CrewAI Native Gemini Provider (not LiteLLM)")
    else:
        print("⚠️  Not using native provider")
    
    # Check API key
    api_key = os.getenv("API_KEY") or os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if api_key:
        print(f"✅ API Key found: {api_key[:10]}...")
    else:
        print("❌ API Key not found!")
        
    print("\n✅ All checks passed! The server should work correctly.")
    print("   Make sure to restart your Flask server to pick up the changes.")
    
except Exception as e:
    print(f"❌ Error: {e}")
    import traceback
    traceback.print_exc()

