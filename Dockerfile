# -------- Stage 1: Build Go binary --------
    FROM golang:1.24 AS go-builder

    WORKDIR /goapp
    
    COPY go.mod go.sum ./
    RUN go mod download
    
    COPY main.go ./
    
    # Build the Go application - consider static linking if possible for smaller images
    # RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o main main.go
    RUN go build -o main main.go
    
    
    # ---- Stage 2: Build/Prepare Node.js App ----
    # Renamed stage for clarity
    FROM node:20 AS node-builder
    
    WORKDIR /app
    
    # Copy only package files first to leverage Docker cache
    COPY package*.json ./
    # Install production dependencies only if devDependencies aren't needed
    RUN npm install --omit=dev
    # Or just RUN npm install if you need devDeps
    
    # Copy the rest of your Node application code
    # Be more specific if possible, e.g., COPY src ./src
    COPY . .
    
    # Add any build steps for your Node app here if necessary
    # RUN npm run build
    
    
    # ---- Stage 3: Final Image ----
    FROM node:22
    
    WORKDIR /app
    
    # Install ffmpeg - essential for the Go binary's video splitting
    # Run updates, install ffmpeg, and clean up apt lists in one layer
    RUN apt-get update && \
        apt-get install -y --no-install-recommends ffmpeg && \
        rm -rf /var/lib/apt/lists/*
    
    # Copy Node.js application files and installed modules from the node-builder stage
    COPY --from=node-builder /app /app
    
    # Copy Go binary from the go-builder stage
    COPY --from=go-builder /goapp/main ./main
    
    # Make sure the Go binary is executable
    RUN chmod +x ./main
    
    # Optional: If your Node app runs as a non-root user (like 'node'),
    # you might need to ensure the binary has correct ownership.
    # Check your base image documentation or uncomment if needed:
    # RUN chown node:node ./main
    
    EXPOSE 8080
    
    # Optional: Switch to a non-root user if the base image provides one
    # USER node
    
    CMD ["npm", "start"]