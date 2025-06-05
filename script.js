// Import Firebase SDKs from CDN v11.8.1
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-app.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/11.8.1/firebase-analytics.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  get,
  child,
  update,
  serverTimestamp,
  off
} from "https://www.gstatic.com/firebasejs/11.8.1/firebase-database.js";

// Firebase configuration with analytics
const firebaseConfig = {
  apiKey: "AIzaSyCiz6UMdlXMS1X__EM1z8HT1we0uK3E7Ko",
  authDomain: "rccontroller-977ef.firebaseapp.com",
  databaseURL: "https://rccontroller-977ef-default-rtdb.firebaseio.com",
  projectId: "rccontroller-977ef",
  storageBucket: "rccontroller-977ef.firebasestorage.app",
  messagingSenderId: "602859402821",
  appId: "1:602859402821:web:01ddfa65552c0c4c8ad52c",
  measurementId: "G-BNSS61CNZL"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
const database = getDatabase(app);

// UI Elements
const deviceSelect = document.getElementById("deviceSelect");
const userIdInput = document.getElementById("userIdInput");
const connectBtn = document.getElementById("connectBtn");
const controlsSection = document.getElementById("controlsSection");
const connectionStatusEl = document.getElementById("connectionStatus");
const currentDeviceEl = document.getElementById("currentDevice");
const currentControllerEl = document.getElementById("currentController");
const roverStatusEl = document.getElementById("roverStatus");
const lastCommandEl = document.getElementById("lastCommand");
const currentMovementEl = document.getElementById("currentMovement");
const arduinoStatusEl = document.getElementById("arduinoStatus");
const speedDisplayEl = document.getElementById("speedDisplay");
const testBtn = document.getElementById("testBtn");
const testSpeedBtn = document.getElementById("testSpeedBtn");
const disconnectBtn = document.getElementById("disconnectBtn");

// State
let currentDevice = null;
let currentUser = null;
let motorSpeed = 255;
let deviceListeners = [];
let isConnected = false;
let activeCommands = new Set();
let commandInterval = null;

// Generate unique user ID if not provided
function generateUserId() {
  return 'guest_' + Math.random().toString(36).substr(2, 6);
}

// Connection status tracking
function updateConnectionStatus(connected, message = '') {
  if (connected) {
    connectionStatusEl.textContent = message || "🟢 Connected to Firebase";
    connectionStatusEl.classList.remove("disconnected", "warning");
    connectionStatusEl.classList.add("connected");
  } else if (message.includes("warning")) {
    connectionStatusEl.textContent = message;
    connectionStatusEl.classList.remove("connected", "disconnected");
    connectionStatusEl.classList.add("warning");
  } else {
    connectionStatusEl.textContent = message || "🔴 Disconnected from Firebase";
    connectionStatusEl.classList.remove("connected", "warning");
    connectionStatusEl.classList.add("disconnected");
  }
}

// Firebase connection check
const connectedRef = ref(database, ".info/connected");
onValue(connectedRef, (snap) => {
  const connected = snap.val() === true;
  if (!currentDevice) {
    updateConnectionStatus(connected);
  }
});

// Load available devices
async function loadDevices() {
  try {
    const devicesRef = ref(database, "devices");
    const snapshot = await get(devicesRef);
    const devices = snapshot.val() || {};
    
    deviceSelect.innerHTML = '<option value="">Select a device...</option>';
    
    Object.keys(devices).forEach(deviceId => {
      const option = document.createElement('option');
      option.value = deviceId;
      option.textContent = `${deviceId} (${devices[deviceId].name || 'Unnamed Device'})`;
      deviceSelect.appendChild(option);
    });

    // If no devices exist, create some default ones
    if (Object.keys(devices).length === 0) {
      const defaultDevices = {
        'rover_01': { name: 'Rover Alpha', status: 'available' },
        'rover_02': { name: 'Rover Beta', status: 'available' },
        'rover_03': { name: 'Rover Gamma', status: 'available' }
      };
      
      await set(ref(database, "devices"), defaultDevices);
      loadDevices(); // Reload after creating defaults
    }
  } catch (error) {
    console.error("Error loading devices:", error);
    updateConnectionStatus(false, "🔴 Error loading devices");
  }
}

// Connect to device
async function connectToDevice() {
  const selectedDevice = deviceSelect.value;
  const userId = userIdInput.value.trim();
  
  if (!selectedDevice) {
    alert("Please select a device");
    return;
  }

  if (!userId) {
    alert("Please enter your name or ID");
    return;
  }

  try {
    connectBtn.disabled = true;
    connectBtn.textContent = "Connecting...";

    // Check if device is available
    const deviceStatusRef = ref(database, `devices/${selectedDevice}/controller`);
    const statusSnapshot = await get(deviceStatusRef);
    const currentController = statusSnapshot.val();

    if (currentController && currentController !== userId) {
      alert(`Device ${selectedDevice} is currently controlled by "${currentController}". Please try another device or wait.`);
      connectBtn.disabled = false;
      connectBtn.textContent = "Connect to Device";
      return;
    }

    // Claim the device
    await set(deviceStatusRef, userId);
    await set(ref(database, `devices/${selectedDevice}/lastActivity`), serverTimestamp());

    currentDevice = selectedDevice;
    currentUser = userId;
    isConnected = true;

    // Update UI
    currentDeviceEl.textContent = selectedDevice;
    currentControllerEl.textContent = userId;
    controlsSection.classList.add("active");
    updateConnectionStatus(true, `🟢 Connected to ${selectedDevice}`);

    // Setup device listeners
    setupDeviceListeners();
    setupControlEventListeners();

    connectBtn.textContent = "Connected";
    
  } catch (error) {
    console.error("Error connecting to device:", error);
    updateConnectionStatus(false, "🔴 Connection failed");
    connectBtn.disabled = false;
    connectBtn.textContent = "Connect to Device";
  }
}

// Setup listeners for current device
function setupDeviceListeners() {
  if (!currentDevice) return;

  // Clean up existing listeners
  deviceListeners.forEach(unsubscribe => unsubscribe());
  deviceListeners = [];

  const devicePath = `devices/${currentDevice}`;

  // Listen for status updates
  const statusRef = ref(database, `${devicePath}/rover/status`);
  const statusUnsubscribe = onValue(statusRef, (snapshot) => {
    const status = snapshot.val();
    roverStatusEl.textContent = status || "Unknown";
    currentMovementEl.textContent = status || "Unknown";
  });
  deviceListeners.push(() => off(statusRef, 'value', statusUnsubscribe));

  // Listen for arduino status updates
  const arduinoRef = ref(database, `${devicePath}/rover/arduinoStatus`);
  const arduinoUnsubscribe = onValue(arduinoRef, (snapshot) => {
    arduinoStatusEl.textContent = snapshot.val() || "Waiting...";
  });
  deviceListeners.push(() => off(arduinoRef, 'value', arduinoUnsubscribe));

  // Listen for motor speed updates
  const speedRef = ref(database, `${devicePath}/rover/motorSpeed`);
  const speedUnsubscribe = onValue(speedRef, (snapshot) => {
    const speedVal = snapshot.val();
    if (typeof speedVal === "number") {
      motorSpeed = speedVal;
      speedDisplayEl.textContent = motorSpeed;
    }
  });
  deviceListeners.push(() => off(speedRef, 'value', speedUnsubscribe));

  // Listen for controller changes (device takeover detection)
  const controllerRef = ref(database, `${devicePath}/controller`);
  const controllerUnsubscribe = onValue(controllerRef, (snapshot) => {
    const controller = snapshot.val();
    if (controller && controller !== currentUser && isConnected) {
      alert(`Device ${currentDevice} has been taken over by "${controller}"`);
      disconnectFromDevice();
    }
  });
  deviceListeners.push(() => off(controllerRef, 'value', controllerUnsubscribe));

  // Keep alive mechanism
  setInterval(() => {
    if (isConnected && currentDevice) {
      set(ref(database, `devices/${currentDevice}/lastActivity`), serverTimestamp());
    }
  }, 30000); // Update every 30 seconds
}

// Setup control event listeners for press and hold functionality
function setupControlEventListeners() {
  const controlButtons = document.querySelectorAll('.control-btn[data-command]');
  const speedButtons = document.querySelectorAll('.speed-btn[data-command]');

  // Movement control buttons (press and hold)
  controlButtons.forEach(button => {
    const command = button.dataset.command;
    
    // Mouse events
    button.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startCommand(command, button);
    });

    button.addEventListener('mouseup', (e) => {
      e.preventDefault();
      stopCommand(command, button);
    });

    button.addEventListener('mouseleave', (e) => {
      e.preventDefault();
      stopCommand(command, button);
    });

    // Touch events for mobile
    button.addEventListener('touchstart', (e) => {
      e.preventDefault();
      startCommand(command, button);
    });

    button.addEventListener('touchend', (e) => {
      e.preventDefault();
      stopCommand(command, button);
    });

    button.addEventListener('touchcancel', (e) => {
      e.preventDefault();
      stopCommand(command, button);
    });
  });

  // Speed control buttons (single click)
  speedButtons.forEach(button => {
    const command = button.dataset.command;
    
    button.addEventListener('click', (e) => {
      e.preventDefault();
      sendSpeedCommand(command);
    });
  });

  // Prevent context menu on long press
  document.addEventListener('contextmenu', (e) => {
    if (e.target.classList.contains('control-btn')) {
      e.preventDefault();
    }
  });
}

// Start sending command continuously
function startCommand(command, button) {
  if (!currentDevice || !isConnected) {
    alert("Please connect to a device first");
    return;
  }

  // Add to active commands and update UI
  activeCommands.add(command);
  button.classList.add('pressed');

  // Send initial command
  sendMovementCommand(command);

  // Start continuous sending if not already running
  if (!commandInterval) {
    commandInterval = setInterval(() => {
      if (activeCommands.size > 0) {
        // Send the most recent command (last one added)
        const lastCommand = Array.from(activeCommands).pop();
        sendMovementCommand(lastCommand);
      }
    }, 100); // Send every 100ms while button is pressed
  }
}

// Stop sending command
function stopCommand(command, button) {
  if (!activeCommands.has(command)) return;

  // Remove from active commands and update UI
  activeCommands.delete(command);
  button.classList.remove('pressed');

  // If no more active commands, stop the rover and clear interval
  if (activeCommands.size === 0) {
    sendMovementCommand('S'); // Send stop command
    if (commandInterval) {
      clearInterval(commandInterval);
      commandInterval = null;
    }
  }
}

// Send movement command
function sendMovementCommand(cmd) {
  if (!currentDevice || !isConnected) return;

  const devicePath = `devices/${currentDevice}/rover`;
  
  set(ref(database, `${devicePath}/command`), cmd);
  set(ref(database, `${devicePath}/commandTimestamp`), serverTimestamp());
  lastCommandEl.textContent = cmd;

  // Update last activity
  set(ref(database, `devices/${currentDevice}/lastActivity`), serverTimestamp());
}

// Send speed command
function sendSpeedCommand(cmd) {
  if (!currentDevice || !isConnected) {
    alert("Please connect to a device first");
    return;
  }

  const devicePath = `devices/${currentDevice}/rover`;

  if (cmd === "SPEED_UP") {
    motorSpeed = Math.min(motorSpeed + 25, 255);
    set(ref(database, `${devicePath}/motorSpeed`), motorSpeed);
  } else if (cmd === "SPEED_DOWN") {
    motorSpeed = Math.max(motorSpeed - 25, 0);
    set(ref(database, `${devicePath}/motorSpeed`), motorSpeed);
  }

  // Update last activity
  set(ref(database, `devices/${currentDevice}/lastActivity`), serverTimestamp());
}

// Test functions
function sendTestCommand() {
  if (!currentDevice || !isConnected) {
    alert("Please connect to a device first");
    return;
  }
  sendMovementCommand("TEST");
}

function sendTestSpeed() {
  if (!currentDevice || !isConnected) {
    alert("Please connect to a device first");
    return;
  }
  motorSpeed = 150;
  set(ref(database, `devices/${currentDevice}/rover/motorSpeed`), motorSpeed);
  speedDisplayEl.textContent = motorSpeed;
}

// Disconnect from device
async function disconnectFromDevice() {
  if (currentDevice) {
    // Stop all active commands
    activeCommands.clear();
    if (commandInterval) {
      clearInterval(commandInterval);
      commandInterval = null;
    }

    // Remove pressed state from all buttons
    document.querySelectorAll('.control-btn.pressed').forEach(btn => {
      btn.classList.remove('pressed');
    });

    try {
      // Send stop command before disconnecting
      await set(ref(database, `devices/${currentDevice}/rover/command`), 'S');
      
      // Release the device
      await set(ref(database, `devices/${currentDevice}/controller`), null);
      await set(ref(database, `devices/${currentDevice}/lastActivity`), serverTimestamp());
    } catch (error) {
      console.error("Error disconnecting:", error);
    }
  }

  // Clean up listeners
  deviceListeners.forEach(unsubscribe => unsubscribe());
  deviceListeners = [];

  // Reset state
  currentDevice = null;
  currentUser = null;
  isConnected = false;
  motorSpeed = 255;

  // Reset UI
  controlsSection.classList.remove("active");
  connectBtn.disabled = false;
  connectBtn.textContent = "Connect to Device";
  currentDeviceEl.textContent = "None";
  currentControllerEl.textContent = "None";
  roverStatusEl.textContent = "Waiting...";
  lastCommandEl.textContent = "None";
  currentMovementEl.textContent = "Unknown";
  arduinoStatusEl.textContent = "Waiting...";
  speedDisplayEl.textContent = "255";
  updateConnectionStatus(true, "🟢 Connected to Firebase");
}

// Event listeners
connectBtn.addEventListener('click', connectToDevice);
testBtn.addEventListener('click', sendTestCommand);
testSpeedBtn.addEventListener('click', sendTestSpeed);
disconnectBtn.addEventListener('click', disconnectFromDevice);

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
  disconnectFromDevice();
});

// Prevent default drag behavior on buttons
document.addEventListener('dragstart', (e) => {
  if (e.target.classList.contains('control-btn')) {
    e.preventDefault();
  }
});

// Initialize
loadDevices();