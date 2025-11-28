#ifdef ESP8266
#include <ESP8266WiFi.h>
#include <FirebaseESP8266.h>
#include <addons/TokenHelper.h>
#include <addons/RTDBHelper.h>

// WiFi credentials
//#define WIFI_SSID "Rath"
//#define WIFI_PASSWORD "@@##rath2025@2m"

#define WIFI_SSID "HUAWEI-TEST"
#define WIFI_PASSWORD "@1234567890@abc@"

// Firebase project credentials
#define API_KEY "AIzaSyCiz6UMdlXMS1X__EM1z8HT1we0uK3E7Ko"
#define DATABASE_URL "https://rccontroller-977ef-default-rtdb.firebaseio.com/"

// Device configuration
#define DEVICE_ID "rover1"

// Status LED (built-in LED on ESP01)
#define STATUS_LED 2  // GPIO2

// Firebase objects
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;

// State variables
String lastCommand = "";
String currentStatus = "ready";
unsigned long lastCheck = 0;
unsigned long lastStatusUpdate = 0;
unsigned long lastWiFiCheck = 0;
const unsigned long CHECK_INTERVAL = 200;
const unsigned long STATUS_UPDATE_INTERVAL = 5000;
const unsigned long WIFI_CHECK_INTERVAL = 10000;
bool isConnected = false;

void setup() {
  Serial.begin(9600);
  delay(1000); // Allow time for serial to initialize
  
  Serial.println();
  Serial.println("=== ESP01 Starting ===");
  
  // Check reset reason
  Serial.print("Reset reason: ");
  Serial.println(ESP.getResetReason());
  
  // Initialize status LED
  pinMode(STATUS_LED, OUTPUT);
  digitalWrite(STATUS_LED, HIGH); // LED off initially (inverted logic)
  
  // Print pin states for debugging
  printPinStates();
  
  // Print system information
  printSystemInfo();
  
  // Add startup delay for stability
  Serial.println("Waiting 2 seconds for system stability...");
  delay(2000);
  
  // Connect to WiFi with enhanced debugging
  connectToWiFi();
  
  if (isConnected) {
    // Initialize Firebase
    initFirebase();
    
    delay(1000);
    Serial.println("WIFI_READY"); // Signal to Arduino that WiFi is ready
    Serial.println("=== ESP01 Setup Complete ===");
  } else {
    Serial.println("WIFI_FAILED");
    Serial.println("=== ESP01 Setup Failed ===");
  }
}

void loop() {
  // Blink status LED to show we're alive
  static unsigned long lastBlink = 0;
  if (millis() - lastBlink > 1000) {
    digitalWrite(STATUS_LED, !digitalRead(STATUS_LED));
    lastBlink = millis();
  }
  
  // Check WiFi connection periodically
  if (millis() - lastWiFiCheck > WIFI_CHECK_INTERVAL) {
    checkWiFiConnection();
    lastWiFiCheck = millis();
  }
  
  // Check for Arduino serial data
  if (Serial.available()) {
    String data = Serial.readStringUntil('\n');
    data.trim();
    
    // Echo back to Arduino for debugging
    if (data.startsWith("Arduino:")) {
      Serial.println("ESP01: Received - " + data);
    }
    
    if (data.startsWith("STATUS:")) {
      String status = data.substring(7);
      currentStatus = status;
      updateArduinoStatus(status);
    }
    else if (data.startsWith("SPEED:")) {
      int speed = data.substring(6).toInt();
      updateCurrentSpeed(speed);
    }
    else if (data.startsWith("ERROR:")) {
      String error = data.substring(6);
      updateErrorStatus(error);
    }
  }
  
  // Check Firebase for new commands
  if (millis() - lastCheck > CHECK_INTERVAL && isConnected) {
    checkFirebaseCommand();
    lastCheck = millis();
  }
  
  // Update status periodically
  if (millis() - lastStatusUpdate > STATUS_UPDATE_INTERVAL && isConnected) {
    updateRoverStatus(currentStatus);
    updateHeartbeat();
    lastStatusUpdate = millis();
  }
  
  delay(10);
}

void printPinStates() {
  Serial.println("=== Pin States ===");
  Serial.print("GPIO0: ");
  Serial.println(digitalRead(0) ? "HIGH" : "LOW");
  Serial.print("GPIO2: ");
  Serial.println(digitalRead(2) ? "HIGH" : "LOW");
  Serial.println("Note: EN and RST pins should be HIGH (3.3V)");
  Serial.println("If ESP01 keeps resetting, check EN pin connection!");
  Serial.println("================");
}

void printSystemInfo() {
  Serial.println("=== System Information ===");
  Serial.print("Chip ID: 0x");
  Serial.println(ESP.getChipId(), HEX);
  Serial.print("Flash Size: ");
  Serial.println(ESP.getFlashChipSize());
  Serial.print("Free Heap: ");
  Serial.println(ESP.getFreeHeap());
  Serial.print("SDK Version: ");
  Serial.println(ESP.getSdkVersion());
  Serial.print("Boot Version: ");
  Serial.println(ESP.getBootVersion());
  Serial.print("CPU Frequency: ");
  Serial.print(ESP.getCpuFreqMHz());
  Serial.println(" MHz");
  
  // Check if we have enough memory
  if (ESP.getFreeHeap() < 10000) {
    Serial.println("WARNING: Low memory! May cause instability.");
  }
  Serial.println("=========================");
}

void connectToWiFi() {
  Serial.println("Starting WiFi connection...");
  
  // Ensure we're in the right mode
  WiFi.mode(WIFI_STA);
  WiFi.disconnect();
  delay(1000);
  
  // Print credentials (be careful in production)
  Serial.print("Connecting to SSID: ");
  Serial.println(WIFI_SSID);
  
  // Scan for networks first
  Serial.println("Scanning for networks...");
  int n = WiFi.scanNetworks();
  Serial.print("Networks found: ");
  Serial.println(n);
  
  bool networkFound = false;
  for (int i = 0; i < n; ++i) {
    Serial.print(i + 1);
    Serial.print(": ");
    Serial.print(WiFi.SSID(i));
    Serial.print(" (");
    Serial.print(WiFi.RSSI(i));
    Serial.println("dBm)");
    
    if (WiFi.SSID(i) == WIFI_SSID) {
      networkFound = true;
      Serial.println("*** Target network found! ***");
    }
  }
  
  if (!networkFound) {
    Serial.println("ERROR: Target network not found!");
    return;
  }
  
  // Attempt connection
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting");
  
  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 30) {
    delay(1000);
    Serial.print(".");
    
    // Print detailed status every 5 attempts
    if (attempts % 5 == 0) {
      Serial.print(" (");
      Serial.print(attempts + 1);
      Serial.print("/30) Status: ");
      printWiFiStatus();
      Serial.print(" ");
    }
    attempts++;
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println();
    Serial.println("*** WiFi Connected! ***");
    Serial.print("IP: ");
    Serial.println(WiFi.localIP());
    Serial.print("RSSI: ");
    Serial.print(WiFi.RSSI());
    Serial.println(" dBm");
    isConnected = true;
  } else {
    Serial.println();
    Serial.println("*** WiFi Connection Failed! ***");
    Serial.print("Final status: ");
    printWiFiStatus();
    Serial.println();
    Serial.println("Troubleshooting:");
    Serial.println("1. Check EN pin -> 3.3V");
    Serial.println("2. Check power supply (3.3V, not 5V)");
    Serial.println("3. Check WiFi credentials");
    Serial.println("4. Check antenna/range");
    isConnected = false;
  }
}

void printWiFiStatus() {
  switch (WiFi.status()) {
    case WL_IDLE_STATUS:     Serial.print("IDLE"); break;
    case WL_NO_SSID_AVAIL:   Serial.print("NO_SSID"); break;
    case WL_SCAN_COMPLETED:  Serial.print("SCAN_DONE"); break;
    case WL_CONNECTED:       Serial.print("CONNECTED"); break;
    case WL_CONNECT_FAILED:  Serial.print("FAILED"); break;
    case WL_CONNECTION_LOST: Serial.print("LOST"); break;
    case WL_WRONG_PASSWORD:  Serial.print("WRONG_PASS"); break;
    case WL_DISCONNECTED:    Serial.print("DISCONNECTED"); break;
    default: Serial.print("UNKNOWN_"); Serial.print(WiFi.status()); break;
  }
}

void checkWiFiConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    if (isConnected) {
      Serial.println("WiFi connection lost!");
      isConnected = false;
    }
    
    // Try to reconnect
    Serial.println("Attempting reconnection...");
    connectToWiFi();
    
    if (isConnected) {
      initFirebase();
    }
  } else {
    if (!isConnected) {
      Serial.println("WiFi connection restored!");
      isConnected = true;
      initFirebase();
    }
  }
}

void registerDevice() {
  if (!isConnected) {
    Serial.println("Cannot register device - no WiFi");
    return;
  }
  
  Serial.println("Registering device in Firebase...");
  
  // Register the device with proper structure expected by website
  String deviceBasePath = "/devices/" + String(DEVICE_ID);
  
  // Set device name and status
  Firebase.setString(fbdo, deviceBasePath + "/name", "RC Rover " + String(DEVICE_ID));
  Firebase.setString(fbdo, deviceBasePath + "/status", "available");
  Firebase.setString(fbdo, deviceBasePath + "/controller", ""); // No controller initially
  
  // Initialize rover sub-structure
  Firebase.setString(fbdo, deviceBasePath + "/rover/status", "ready");
  Firebase.setString(fbdo, deviceBasePath + "/rover/arduinoStatus", "ESP01 Connected");
  Firebase.setInt(fbdo, deviceBasePath + "/rover/motorSpeed", 255);
  Firebase.setString(fbdo, deviceBasePath + "/rover/command", "");
  Firebase.setString(fbdo, deviceBasePath + "/rover/lastError", "");
  
  // Set timestamps
  Firebase.setString(fbdo, deviceBasePath + "/lastActivity", String(millis()));
  Firebase.setString(fbdo, deviceBasePath + "/rover/heartbeat", String(millis()));
  
  Serial.println("Device registered successfully");
}

void initFirebase() {
  if (!isConnected) {
    Serial.println("Cannot init Firebase - no WiFi");
    return;
  }
  
  Serial.println("Initializing Firebase...");
  
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  config.signer.tokens.legacy_token = "Z1MJVQ0rkpKqncI1zXajzKZqY6gRWpoJ92ZXfkEd";
  
  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);
  fbdo.setResponseSize(4096);
  
  Serial.println("Firebase initialized");
  
  // Register the device after Firebase is initialized
  registerDevice();
}

void checkFirebaseCommand() {
  String commandPath = "/devices/" + String(DEVICE_ID) + "/rover/command";
  
  if (Firebase.getString(fbdo, commandPath)) {
    String command = fbdo.stringData();
    
    if (command != lastCommand && command != "null" && command.length() > 0) {
      Serial.println(command); // Send to Arduino
      lastCommand = command;
      updateLastSent();
      Firebase.setString(fbdo, commandPath, ""); // Clear command after reading
    }
  }
}

void updateRoverStatus(String status) {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/status";
  Firebase.setString(fbdo, path, status);
}

void updateArduinoStatus(String status) {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/arduinoStatus";
  Firebase.setString(fbdo, path, status);
}

void updateCurrentSpeed(int speed) {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/motorSpeed";
  Firebase.setInt(fbdo, path, speed);
}

void updateErrorStatus(String error) {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/lastError";
  Firebase.setString(fbdo, path, error);
}

void updateLastSent() {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/commandTimestamp";
  Firebase.setString(fbdo, path, String(millis()));
}

void updateHeartbeat() {
  String path = "/devices/" + String(DEVICE_ID) + "/rover/heartbeat";
  Firebase.setString(fbdo, path, String(millis()));
}

#endif
