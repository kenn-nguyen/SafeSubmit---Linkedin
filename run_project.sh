#!/bin/bash

# Kill processes on ports 3000 and 5002
echo "Killing any processes on ports 3000 and 5002..."
kill -9 $(lsof -t -i:3000) 2>/dev/null
kill -9 $(lsof -t -i:5002) 2>/dev/null

# Start the frontend
echo "Starting frontend..."
npm run dev &

# Start the backend
echo "Starting backend..."
cd backend_crewai_service && FLASK_DEBUG=1 python app.py &
