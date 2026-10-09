# Use official Microsoft Playwright Node.js base image (includes Node 20 + all Chromium browser dependencies)
FROM mcr.microsoft.com/playwright:v1.43.0-jammy

# Set environment variables
ENV NODE_ENV=production \
    HEADLESS=true \
    PORT=8000

# Set working directory
WORKDIR /app

# Copy package files first for optimal docker layer caching
COPY package*.json ./

# Install npm dependencies
RUN npm install --omit=dev

# Install Playwright Chromium browser
RUN npx playwright install chromium

# Copy application code
COPY . .

# Expose server port
EXPOSE 8000

# Start Node.js Express server
CMD ["node", "server.js"]
