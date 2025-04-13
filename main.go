package main

import (
	"fmt"
	"log"
	"os"
	"strconv"

	"github.com/amarnathcjd/gogram/telegram"
	"github.com/joho/godotenv"
)

func main() {
	godotenv.Load()
	appIDStr := os.Getenv("API_ID")
	appHash := os.Getenv("API_HASH")
	botToken := os.Getenv("BOT_TOKEN")

	appID, err := strconv.Atoi(appIDStr)
	if err != nil {
		log.Fatalf("Invalid APP_ID: %v", err)
	}
	if len(os.Args) < 3 {
		log.Fatalf("Usage: %s <chat_id> <file_path>", os.Args[0])
		os.Exit(1)
	}

	chatID := os.Args[1]
	filePath := os.Args[2]

	client, err := telegram.NewClient(telegram.ClientConfig{
		AppID:   int32(appID),
		AppHash: appHash,
	})

	if err != nil {
		log.Fatal(err)
	}

	client.Conn()

	client.LoginBot(botToken)
	result, err := client.SendMedia(chatID, filePath)
	if err != nil {
		log.Fatalf("Error sending file: %v", err)
	}
	fmt.Printf("File sent successfully: %v\n", result)
}
