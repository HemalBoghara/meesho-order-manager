# Use Microsoft Playwright Python base image with pre-installed Chromium and Linux dependencies
FROM mcr.microsoft.com/playwright/python:v1.40.0-jammy

# Set environment variables
ENV PYTHONUNBUFFERED=1 \
    HEADLESS=true \
    PORT=8000

# Set working directory
WORKDIR /app

# Copy requirements and install dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose default port
EXPOSE 8000

# Start server
CMD ["python", "run.py"]
