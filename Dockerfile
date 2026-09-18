# Use Microsoft Playwright Python base image matching Playwright 1.63.0
FROM mcr.microsoft.com/playwright/python:v1.63.0-jammy

# Install Xvfb (X Virtual Framebuffer) to run real headed Chrome on Linux without a physical monitor
RUN apt-get update && apt-get install -y xvfb && rm -rf /var/lib/apt/lists/*

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    HEADLESS=false \
    DISPLAY=:99 \
    PORT=8000

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium

# Copy application code
COPY . .

# Expose default port
EXPOSE 8000

# Start server using xvfb virtual display
CMD ["xvfb-run", "--auto-servernum", "--server-args=-screen 0 1920x1080x24 -ac", "python", "run.py"]
