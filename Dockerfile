# -------- Stage 1: Build Go binary --------
FROM golang:1.24 AS go-builder

WORKDIR /goapp

COPY go.mod go.sum ./
RUN go mod download

COPY main.go ./

RUN go build main.go


# ---- Stage 1: Build native modules ----
FROM node:20 AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# ---- Stage 2: Final Image ----
FROM node:22


WORKDIR /app

COPY --from=builder /app /app

# Copy Go binary from the builder
COPY --from=go-builder /goapp/main ./main

# Optional: make sure it’s executable
RUN chmod +x ./main

EXPOSE 3000

CMD ["npm", "start"]
    