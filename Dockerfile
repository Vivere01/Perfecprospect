FROM node:20-bookworm

WORKDIR /app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install

# Install Playwright browsers and their OS dependencies
RUN npx playwright install --with-deps chromium

# Copy the rest of the application
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build TypeScript code
RUN npm run build

# Start the application, ensuring the database is updated first
CMD npm run db:push && npm start
