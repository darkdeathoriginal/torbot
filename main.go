package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/amarnathcjd/gogram/telegram"
	"github.com/joho/godotenv"
)

const (
	// MaxFileSize defines the Telegram upload limit threshold (e.g., 1.95 GB)
	MaxFileSize int64 = 1950 * 1024 * 1024 // 1.95 GB to be safe
	// PartSize defines the target size for *non-video* split parts. Should be <= MaxFileSize.
	PartSize int64 = MaxFileSize
	// SafetyFactor for video splitting (e.g., 0.95 means aim for 95% of MaxFileSize)
	VideoSizeSafetyFactor float64 = 0.95
	// MinVideoSegmentDurationSec is the minimum duration for a video segment.
	MinVideoSegmentDurationSec float64 = 1.0
	// MimeDetectBufferSize is the number of bytes to read for MIME type detection.
	MimeDetectBufferSize = 512
)

// --- Main Function ---

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
	}

	chatID := os.Args[1]
	filePath := os.Args[2]

	// --- Get File Metadata ---
	fileInfo, err := os.Stat(filePath)
	if err != nil {
		log.Fatalf("Error getting file metadata for %s: %v", filePath, err)
	}
	originalFileName := fileInfo.Name()
	fileSize := fileInfo.Size()

	// --- Initialize Telegram Client ---
	client, err := telegram.NewClient(telegram.ClientConfig{
		AppID:   int32(appID),
		AppHash: appHash,
	})
	if err != nil {
		log.Fatalf("Error creating Telegram client: %v", err)
	}

	// Connect and Login
	_, err = client.Conn()
	if err != nil {
		log.Fatalf("Error connecting client: %v", err)
	}
	err = client.LoginBot(botToken)
	if err != nil {
		log.Fatalf("Error logging in as bot: %v", err)
	}
	log.Println("Telegram client logged in.")

	// --- File Handling Logic ---
	if fileSize <= MaxFileSize {
		log.Printf("File '%s' is small enough, sending directly.", originalFileName)
		id := sendFile(client, chatID, filePath, originalFileName)
		if id == -1 {
			log.Fatalf("Failed to send file '%s' to chat '%s'", filePath, chatID)
		}
		fmt.Printf("%d", id) // Output single message ID
	} else {
		log.Printf("File '%s' is larger than MaxFileSize (%d bytes). Checking type...", originalFileName, MaxFileSize)

		// --- Detect File Type ---
		mimeType, err := detectMimeType(filePath)
		if err != nil {
			log.Printf("Warning: Could not detect MIME type for %s: %v. Proceeding with generic splitting.", originalFileName, err)
			mimeType = "application/octet-stream" // Default fallback
		}
		log.Printf("Detected MIME type: %s", mimeType)

		var partPaths []string
		var splitErr error
		var cleanupPaths []string // Keep track of files to delete
		isVideo := strings.HasPrefix(mimeType, "video/")

		if isVideo {
			log.Println("File identified as video. Attempting to split into segments based on size using ffmpeg...")
			partPaths, splitErr = splitVideoBySize(filePath, MaxFileSize)
			if splitErr != nil {
				log.Fatalf("Error splitting video file '%s': %v", filePath, splitErr)
			}
			cleanupPaths = partPaths // Video parts are temporary
			log.Printf("Video split into %d segments.", len(partPaths))
		} else {
			log.Println("File is not a video or detection failed. Splitting into generic parts...")
			partPaths, splitErr = splitGenericFile(filePath, PartSize)
			if splitErr != nil {
				log.Fatalf("Error splitting generic file '%s': %v", filePath, splitErr)
			}
			cleanupPaths = partPaths // Generic parts are also temporary
			log.Printf("File split into %d parts.", len(partPaths))
		}

		// Schedule cleanup for all temporary parts
		for _, partPath := range cleanupPaths {
			pathToClean := partPath // Capture loop variable for defer
			defer func() {
				log.Printf("Cleaning up temporary part: %s", pathToClean)
				err := os.Remove(pathToClean)
				if err != nil && !os.IsNotExist(err) {
					log.Printf("Warning: Failed to remove temporary part %s: %v", pathToClean, err)
				}
			}()
		}

		// --- Send Parts ---
		initialMsg, _ := client.SendMessage(chatID, fmt.Sprintf("Sending '%s' in %d parts...", originalFileName, len(partPaths)))
		var msgIdArray []int32
		failed := false

		for i, partPath := range partPaths {
			partNum := i + 1
			partFileName := fmt.Sprintf("%s (Part %d/%d)", originalFileName, partNum, len(partPaths))
			log.Printf("Sending part %d: %s", partNum, partPath)

			// Send the current part
			id := sendFile(client, chatID, partPath, partFileName)
			if id != -1 {
				log.Printf("Sent part %d, message ID: %v", partNum, id)
				msgIdArray = append(msgIdArray, id)
			} else {
				log.Printf("Failed to send part '%s' (part %d) to chat '%s'", partPath, partNum, chatID)
				failed = true
				// break // Uncomment to stop after first failure
			}
		}

		// --- Final Status ---
		var finalStatusMsg string
		var outputIds string

		if failed {
			finalStatusMsg = fmt.Sprintf("Finished sending '%s'. %d parts sent, but some failed.", originalFileName, len(msgIdArray))
		} else {
			finalStatusMsg = fmt.Sprintf("Finished sending '%s' in %d parts.", originalFileName, len(partPaths))
		}

		if initialMsg != nil {
			_, err := initialMsg.Edit(finalStatusMsg)
			if err != nil {
				log.Printf("Warning: Failed to edit final status message: %v", err)
				client.SendMessage(chatID, finalStatusMsg)
			}
		} else {
			client.SendMessage(chatID, finalStatusMsg)
		}

		// Output the comma-separated list of successful message IDs
		for i, id := range msgIdArray {
			outputIds += fmt.Sprintf("%v", id)
			if i < len(msgIdArray)-1 {
				outputIds += ","
			}
		}
		fmt.Printf("%s", outputIds) // Output comma-separated message IDs

		if failed {
			os.Exit(1) // Indicate failure
		}
	}
}

// --- Helper Functions ---

// detectMimeType sniffs the file's beginning to detect its MIME type.
func detectMimeType(filePath string) (string, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to open file for MIME detection %s: %w", filePath, err)
	}
	defer file.Close()

	buffer := make([]byte, MimeDetectBufferSize)
	n, err := file.Read(buffer)
	if err != nil && err != io.EOF {
		return "", fmt.Errorf("failed to read file for MIME detection %s: %w", filePath, err)
	}
	mimeType := http.DetectContentType(buffer[:n])
	return mimeType, nil
}

// getVideoDuration uses ffprobe to get the duration of a video file in seconds.
// Returns duration, error
func getVideoDuration(filePath string) (float64, error) {
	ffprobePath, err := exec.LookPath("ffprobe")
	if err != nil {
		return 0, fmt.Errorf("ffprobe not found in PATH: %w", err)
	}

	cmd := exec.Command(ffprobePath,
		"-v", "error",
		"-show_entries", "format=duration",
		"-of", "json", // Use JSON for easier parsing
		filePath,
	)

	var out bytes.Buffer
	var stderr bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &stderr

	// log.Printf("Running ffprobe command: %s", cmd.String()) // Verbose
	err = cmd.Run()
	if err != nil {
		return 0, fmt.Errorf("ffprobe failed for %s: %w\nStderr: %s", filePath, err, stderr.String())
	}

	var probeData struct {
		Format struct {
			Duration string `json:"duration"`
		} `json:"format"`
	}

	if err := json.Unmarshal(out.Bytes(), &probeData); err != nil {
		return 0, fmt.Errorf("failed to parse ffprobe JSON output for %s: %w\nOutput: %s", filePath, err, out.String())
	}

	if probeData.Format.Duration == "" {
		// Try reading stream duration if format duration is missing (less common)
		cmdStreams := exec.Command(ffprobePath,
			"-v", "error",
			"-show_entries", "stream=duration",
			"-select_streams", "v:0", // Select the first video stream
			"-of", "json",
			filePath,
		)
		out.Reset()
		stderr.Reset()
		cmdStreams.Stdout = &out
		cmdStreams.Stderr = &stderr
		err = cmdStreams.Run()
		if err != nil {
			return 0, fmt.Errorf("ffprobe (streams) failed for %s: %w\nStderr: %s", filePath, err, stderr.String())
		}
		var streamsData struct {
			Streams []struct {
				Duration string `json:"duration"`
			} `json:"streams"`
		}
		if err := json.Unmarshal(out.Bytes(), &streamsData); err != nil || len(streamsData.Streams) == 0 {
			return 0, fmt.Errorf("failed to parse ffprobe stream duration JSON for %s or no video stream found\nOutput: %s", filePath, out.String())
		}
		probeData.Format.Duration = streamsData.Streams[0].Duration
	}

	duration, err := strconv.ParseFloat(probeData.Format.Duration, 64)
	if err != nil {
		return 0, fmt.Errorf("failed to parse duration string '%s' from ffprobe for %s: %w", probeData.Format.Duration, filePath, err)
	}

	// log.Printf("Detected video duration for %s: %.3f seconds", filepath.Base(filePath), duration) // Verbose
	return duration, nil
}

// formatDuration converts seconds to HH:MM:SS.ms format for ffmpeg -ss
func formatDurationHHMMSSms(seconds float64) string {
	if seconds < 0 {
		seconds = 0
	}
	totalSeconds := int64(math.Floor(seconds))
	milliseconds := int64(math.Round((seconds - float64(totalSeconds)) * 1000))
	hours := totalSeconds / 3600
	minutes := (totalSeconds % 3600) / 60
	secs := totalSeconds % 60
	return fmt.Sprintf("%02d:%02d:%02d.%03d", hours, minutes, secs, milliseconds)
}

// splitVideoBySize splits a video iteratively, aiming for size constraints.
func splitVideoBySize(sourcePath string, targetPartSize int64) ([]string, error) {
	ffmpegPath, err := exec.LookPath("ffmpeg")
	if err != nil {
		return nil, fmt.Errorf("ffmpeg not found in PATH: %w. Please install ffmpeg", err)
	}
	if _, err := exec.LookPath("ffprobe"); err != nil {
		return nil, fmt.Errorf("ffprobe not found in PATH: %w. Please install ffprobe", err)
	}

	sourceInfo, err := os.Stat(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("failed to get file info for %s: %w", sourcePath, err)
	}
	sourceDir := filepath.Dir(sourcePath)
	sourceBaseName := filepath.Base(sourcePath)
	sourceExt := filepath.Ext(sourceBaseName)
	sourceNameOnly := strings.TrimSuffix(sourceBaseName, sourceExt)
	totalSize := sourceInfo.Size()

	totalDuration, err := getVideoDuration(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("could not get video duration for %s: %w", sourcePath, err)
	}
	if totalDuration <= 0 {
		return nil, fmt.Errorf("video duration reported as zero or less for %s", sourcePath)
	}

	// Calculate average bitrate and estimate target duration per segment
	averageBytesPerSecond := float64(totalSize) / totalDuration
	if averageBytesPerSecond <= 0 {
		return nil, fmt.Errorf("calculated average bitrate is zero or negative for %s", sourcePath)
	}

	// Aim for slightly less than MaxFileSize due to bitrate fluctuations
	effectiveTargetSize := float64(targetPartSize) * VideoSizeSafetyFactor
	estimatedDurationPerSegment := effectiveTargetSize / averageBytesPerSecond
	if estimatedDurationPerSegment < MinVideoSegmentDurationSec {
		estimatedDurationPerSegment = MinVideoSegmentDurationSec
		log.Printf("Warning: Estimated segment duration is very short (%.2fs). Minimum set to %.2fs. Segments might exceed target size.", estimatedDurationPerSegment, MinVideoSegmentDurationSec)
	}

	log.Printf("Total duration: %.3fs, Total size: %d bytes", totalDuration, totalSize)
	log.Printf("Average bitrate: %.2f bytes/sec", averageBytesPerSecond)
	log.Printf("Targeting segment duration estimate: %.3fs (based on %.2f MB target size)", estimatedDurationPerSegment, effectiveTargetSize/1024/1024)

	var partPaths []string
	startTime := 0.0
	partNum := 1

	for startTime < totalDuration {
		// Ensure we don't try to read past the actual end of the video
		remainingDuration := totalDuration - startTime
		currentSegmentTargetDuration := math.Min(estimatedDurationPerSegment, remainingDuration)

		// Prevent creating tiny segments at the end if estimate is large
		if remainingDuration < MinVideoSegmentDurationSec && remainingDuration > 0 {
			currentSegmentTargetDuration = remainingDuration
		}
		// Ensure duration is positive
		if currentSegmentTargetDuration <= 0 {
			break // Should not happen if totalDuration > 0, but safety check
		}

		partFileName := fmt.Sprintf("%s_part%03d%s", sourceNameOnly, partNum, sourceExt)
		partFilePath := filepath.Join(sourceDir, partFileName)

		// Format times for ffmpeg command
		startTimeFormatted := formatDurationHHMMSSms(startTime)
		// -t takes duration in seconds
		durationFormatted := strconv.FormatFloat(currentSegmentTargetDuration, 'f', 3, 64) // 3 decimal places precision

		log.Printf("------------------------------------")
		log.Printf("Part %d: Start time: %.3fs, Target duration: %.3fs", partNum, startTime, currentSegmentTargetDuration)

		cmdArgs := []string{
			"-v", "error",
			"-ss", startTimeFormatted, // Seek *before* input for speed
			"-i", sourcePath,
			"-t", durationFormatted, // Duration to copy *from* the seek point
			"-c", "copy", // Copy streams without re-encoding
			"-map", "0", // Map all streams
			// "-avoid_negative_ts", "disabled", // Try replacing this
			// "-copyts", // Often used with disabled, maybe remove when using make_non_negative
			"-avoid_negative_ts", "make_non_negative", // More robust timestamp handling for cuts
			"-movflags", "+faststart", // Good practice for MP4 (harmless for MKV usually)
			partFilePath,
		}
		cmd := exec.Command(ffmpegPath, cmdArgs...)

		var stderr bytes.Buffer
		cmd.Stderr = &stderr

		log.Printf("Running ffmpeg for part %d: %s", partNum, cmd.String())
		err = cmd.Run()

		ffmpegStderr := stderr.String()
		if err != nil {
			// Cleanup the potentially incomplete part file
			os.Remove(partFilePath)
			// Attempt to delete previously created parts as well
			cleanupParts(partPaths)
			return nil, fmt.Errorf("ffmpeg execution failed for part %d (start %.3fs, duration %.3fs): %w\nStderr: %s",
				partNum, startTime, currentSegmentTargetDuration, err, ffmpegStderr)
		}

		// Check if the output file was actually created and has size
		partInfo, err := os.Stat(partFilePath)
		if err != nil {
			// ffmpeg might succeed but produce no output in some edge cases (e.g., tiny duration request at end)
			if os.IsNotExist(err) {
				log.Printf("Warning: ffmpeg ran for part %d but output file %s not found. Assuming end of video.", partNum, partFilePath)
				break // Stop processing if no file was created
			}
			cleanupParts(partPaths) // Cleanup previous parts on other stat errors
			return nil, fmt.Errorf("failed to stat created part %d file %s: %w", partNum, partFilePath, err)
		}

		if partInfo.Size() == 0 {
			log.Printf("Warning: Created part %d (%s) is zero bytes. Removing and stopping.", partNum, partFilePath)
			os.Remove(partFilePath)
			break // Stop if a zero-byte file is created
		}

		// --- Critical: Get the *actual* duration of the segment just created ---
		actualSegmentDuration, err := getVideoDuration(partFilePath)
		if err != nil {
			log.Printf("Warning: Could not get duration of created part %d (%s): %v. Cannot reliably continue.", partNum, partFilePath, err)
			// Decide whether to stop or try to continue with estimate (risky)
			// Safest is to stop and let user know.
			cleanupParts(append(partPaths, partFilePath)) // Cleanup everything including current part
			return nil, fmt.Errorf("failed to get duration of created part %d, cannot continue accurately", partNum)
		}

		if actualSegmentDuration <= 0 {
			log.Printf("Warning: Created part %d (%s) reported duration %.3fs. Stopping.", partNum, partFilePath, actualSegmentDuration)
			// Keep the part? Maybe, if it has size. But advancing startTime is problematic.
			partPaths = append(partPaths, partFilePath) // Add it, but we can't continue
			break
		}

		log.Printf("Part %d created: %s (Size: %.2f MB, Actual Duration: %.3fs)",
			partNum, partFilePath, float64(partInfo.Size())/1024/1024, actualSegmentDuration)

		// Check if the created part exceeds the *original* target size (not the safety-factored one)
		if partInfo.Size() > targetPartSize {
			log.Printf("Warning: Part %d size (%d bytes) exceeds target MaxFileSize (%d bytes). Input video bitrate likely fluctuates significantly.",
				partNum, partInfo.Size(), targetPartSize)
			// Continue anyway, but the user is warned.
		}

		partPaths = append(partPaths, partFilePath)

		// Update start time for the next segment using the *actual* duration
		startTime += actualSegmentDuration
		partNum++

		// Small safeguard against infinite loops if durations are weirdly reported
		if partNum > 1000 { // Arbitrary limit
			cleanupParts(partPaths)
			return nil, fmt.Errorf("potential infinite loop detected after 1000 parts, stopping")
		}
	}

	log.Printf("------------------------------------")
	log.Printf("Finished splitting video into %d parts.", len(partPaths))
	return partPaths, nil
}

// splitGenericFile splits a file into raw byte parts of partSize bytes.
// (Implementation remains the same as before)
func splitGenericFile(sourcePath string, partSize int64) ([]string, error) {
	if partSize <= 0 {
		return nil, fmt.Errorf("part size must be positive")
	}

	sourceFile, err := os.Open(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("failed to open source file %s: %w", sourcePath, err)
	}
	defer sourceFile.Close()

	sourceInfo, err := sourceFile.Stat()
	if err != nil {
		return nil, fmt.Errorf("failed to get file info for %s: %w", sourcePath, err)
	}
	sourceBaseName := sourceInfo.Name()
	sourceDir := filepath.Dir(sourcePath)

	var partPaths []string
	partNum := 1
	reader := bufio.NewReader(sourceFile)
	// Increase buffer size potentially for larger reads, though LimitedReader caps it
	buffer := make([]byte, 1*1024*1024) // 1MB buffer

	totalBytesRead := int64(0)

	for {
		partFileName := fmt.Sprintf("%s.part%03d", sourceBaseName, partNum)
		partFilePath := filepath.Join(sourceDir, partFileName)

		// Ensure we don't try to create a part if we've already read the whole file
		if totalBytesRead >= sourceInfo.Size() {
			log.Printf("Reached end of source file (%d bytes read), stopping part creation.", totalBytesRead)
			break
		}

		partFile, err := os.Create(partFilePath)
		if err != nil {
			cleanupParts(partPaths) // Cleanup already created parts
			return nil, fmt.Errorf("failed to create part file %s: %w", partFilePath, err)
		}

		// Use io.LimitedReader to ensure we don't read more than partSize for this part
		limitedReader := io.LimitedReader{R: reader, N: partSize}
		bytesWritten, err := io.CopyBuffer(partFile, &limitedReader, buffer)

		closeErr := partFile.Close() // Close immediately after writing

		// Error handling: Prefer checking CopyBuffer error first
		if err != nil && err != io.EOF { // EOF from Copy is expected when source ends
			os.Remove(partFilePath) // Clean up failed part
			cleanupParts(partPaths) // Clean up previous parts
			return nil, fmt.Errorf("error writing to part %s after %d bytes: %w", partFilePath, bytesWritten, err)
		}
		// Now check close error
		if closeErr != nil {
			os.Remove(partFilePath) // Clean up failed part
			cleanupParts(partPaths) // Clean up previous parts
			return nil, fmt.Errorf("error closing part file %s: %w", partFilePath, closeErr)
		}

		// Check if any bytes were written. Don't add zero-byte parts unless original file is 0 bytes.
		if bytesWritten > 0 {
			partPaths = append(partPaths, partFilePath)
			totalBytesRead += bytesWritten
		} else {
			// No bytes written means we likely hit EOF immediately
			log.Printf("No bytes written for part %d (%s), likely EOF reached. Removing empty part.", partNum, partFilePath)
			os.Remove(partFilePath) // Remove empty part file
			break                   // Exit loop as we are at the end
		}

		// Determine if we should continue. We stop if the CopyBuffer error was EOF,
		// or if the limitedReader shows N == 0 (meaning it hit EOF before the limit)
		if err == io.EOF || limitedReader.N == 0 {
			log.Printf("EOF reached while writing part %d.", partNum)
			break
		}

		partNum++
	}

	// Final check: if source was > 0 bytes but no parts were made, something is wrong
	if len(partPaths) == 0 && sourceInfo.Size() > 0 {
		return nil, fmt.Errorf("no parts created for non-empty file %s (size: %d)", sourcePath, sourceInfo.Size())
	}
	if len(partPaths) == 0 && sourceInfo.Size() == 0 {
		log.Printf("Source file %s is empty, no parts created.", sourcePath)
		// Return empty slice is correct for empty file
	}

	log.Printf("Successfully created %d generic parts.", len(partPaths))
	return partPaths, nil // Success
}

// cleanupParts removes a list of temporary part files.
func cleanupParts(paths []string) {
	log.Printf("Cleaning up %d potentially created parts due to error or completion...", len(paths))
	for _, p := range paths {
		err := os.Remove(p)
		if err != nil && !os.IsNotExist(err) {
			log.Printf("Warning: Failed to clean up part %s: %v", p, err)
		}
	}
}

// sendFile handles sending a single file (or part) with progress and flood handling
// (Implementation remains the same as before)
func sendFile(client *telegram.Client, chatID, filePath, captionFileName string) int32 {
	metadata, err := os.Stat(filePath)
	if err != nil {
		log.Printf("Error stating file %s for sending: %v", filePath, err)
		client.SendMessage(chatID, fmt.Sprintf("Error preparing to send %s: %v", captionFileName, err))
		return -1
	}

	progressCaption := fmt.Sprintf("⬆️ Sending: %s (%.2f MB)", captionFileName, float64(metadata.Size())/1024/1024)
	msg, err := client.SendMessage(chatID, progressCaption)
	if err != nil {
		log.Printf("Warning: Could not send initial status message for %s: %v", captionFileName, err)
		// Proceed without progress message if sending the status fails
	}

	var lastProgress int = -1
	// Update progress less frequently if needed (e.g., every 5%)
	pm := telegram.NewProgressManager(5, func(totalSize, currentSize int64) {
		if totalSize == 0 {
			return
		}
		progress := int(float64(currentSize) / float64(totalSize) * 100)
		// Update only on significant progress change to reduce API calls
		if progress != lastProgress && progress%5 == 0 && msg != nil {
			_, err := msg.Edit(fmt.Sprintf("⬆️ Sending: %s (%.2f/%.2f MB) %d%%",
				captionFileName,
				float64(currentSize)/1024/1024,
				float64(totalSize)/1024/1024,
				progress))
			if err != nil {
				if !handleIfFlood(err) {
					log.Printf("Warning: Could not update progress message for %s: %v", captionFileName, err)
				}
			}
			lastProgress = progress
		}
	})

	mediaOptions := &telegram.MediaOptions{
		ProgressManager: pm,
		FileName:        captionFileName,
	}

	startTime := time.Now()
	log.Printf("Starting upload for: %s", captionFileName)
	result, err := client.SendMedia(chatID, filePath, mediaOptions)
	uploadDuration := time.Since(startTime)

	deleteProgressMsg := true

	if err != nil {
		log.Printf("Error sending %s: %v", captionFileName, err)
		if handleIfFlood(err) {
			log.Printf("Flood wait detected and handled for %s. Retrying...", captionFileName)
			err = nil // Clear error for retry
			result, err = client.SendMedia(chatID, filePath, mediaOptions)
			uploadDuration = time.Since(startTime) // Recalculate duration
		}

		if err != nil {
			errMsg := fmt.Sprintf("❌ Failed to send %s after %.2f s: %v", captionFileName, uploadDuration.Seconds(), err)
			log.Println(errMsg)
			if msg != nil {
				msg.Edit(errMsg) // Show error in status message
				deleteProgressMsg = false
			} else {
				client.SendMessage(chatID, errMsg)
			}
			return -1
		}
		log.Printf("Retry successful for %s.", captionFileName)
	}

	successMsg := fmt.Sprintf("✅ Sent: %s (%.2f MB) in %.2f s", captionFileName, float64(metadata.Size())/1024/1024, uploadDuration.Seconds())
	log.Println(successMsg)

	if msg != nil && deleteProgressMsg {
		_, editErr := msg.Edit(successMsg)
		if editErr == nil {
			time.Sleep(3 * time.Second)
			_, delErr := msg.Delete()
			if delErr != nil && !telegram.MatchError(delErr, "MESSAGE_ID_INVALID") {
				log.Printf("Warning: Failed to delete final status message for %s: %v", captionFileName, delErr)
			}
		} else {
			log.Printf("Warning: Failed to edit success message for %s: %v", captionFileName, editErr)
			_, delErr := msg.Delete() // Attempt delete anyway
			if delErr != nil && !telegram.MatchError(delErr, "MESSAGE_ID_INVALID") {
				log.Printf("Warning: Failed to delete original status message for %s: %v", captionFileName, delErr)
			}
		}
	} else if msg == nil {
		client.SendMessage(chatID, successMsg)
	}

	if result != nil {
		return result.ID
	}
	log.Printf("Error: SendMedia returned nil result despite no error for %s", captionFileName)
	return -1
}

// handleIfFlood checks for Telegram flood wait errors and sleeps accordingly.
// (Implementation remains the same as before)
func handleIfFlood(err error) bool {
	if err == nil {
		return false
	}

	waitMatch := "FLOOD_WAIT_"
	premiumWaitMatch := "FLOOD_PREMIUM_WAIT_"
	errMsg := err.Error()

	isFlood := false
	waitPrefix := ""

	if strings.Contains(errMsg, waitMatch) {
		isFlood = true
		waitPrefix = waitMatch
	} else if strings.Contains(errMsg, premiumWaitMatch) {
		isFlood = true
		waitPrefix = premiumWaitMatch
	}

	if isFlood {
		parts := strings.Split(errMsg, waitPrefix)
		if len(parts) > 1 {
			waitValStr := strings.TrimSpace(parts[1])
			numericPart := ""
			for _, r := range waitValStr {
				if r >= '0' && r <= '9' {
					numericPart += string(r)
				} else {
					break
				}
			}

			if waitVal, convErr := strconv.ParseInt(numericPart, 10, 64); convErr == nil && waitVal > 0 {
				sleepDuration := time.Duration(waitVal+2) * time.Second // Add buffer
				log.Printf("Flood wait encountered: Waiting for %v...", sleepDuration)
				time.Sleep(sleepDuration)
				return true
			} else {
				log.Printf("Warning: Could not parse flood wait time from error: %s (parsed: '%s')", errMsg, numericPart)
			}
		} else {
			log.Printf("Warning: Could not extract wait time from flood error: %s", errMsg)
		}
		// Fallback sleep
		log.Printf("Flood wait detected (parsing failed), sleeping for 15s fallback...")
		time.Sleep(15 * time.Second)
		return true
	}

	return false
}
