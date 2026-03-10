# Use Node 24 LTS
FROM node:24-alpine

# Set working directory
WORKDIR /app

# Copy package.json and lock first for better caching
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy the rest of the application
COPY . .

# Expose port 3000
EXPOSE 3000

# Start the application
CMD ["npm", "start"]

