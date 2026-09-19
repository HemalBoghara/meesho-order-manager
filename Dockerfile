# Use Microsoft Playwright Python base image matching Playwright 1.63.0
FROM mcr.microsoft.com/playwright/python:v1.63.0-jammy

# Install Xvfb (X Virtual Framebuffer) and xauth for virtual display support
RUN apt-get update && apt-get install -y xvfb xauth && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    HEADLESS=false \
    DISPLAY=:99 \
    PORT=10000

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium

# Copy application code
COPY . .

# Expose default port (Render standard is 10000)
EXPOSE 10000

# Start Xvfb virtual display in background and execute python web server
CMD ["sh", "-c", "Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset & sleep 1 && exec python run.py"]
