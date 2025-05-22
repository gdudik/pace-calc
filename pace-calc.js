const dgram = require('dgram');
const moment = require('moment');

// Create UDP socket to listen for incoming packets on port 55566
const server = dgram.createSocket('udp4');
const client = dgram.createSocket('udp4');

// Listen for UDP packets on port 55566
server.on('message', (msg, rinfo) => {
  console.log(`Received packet from ${rinfo.address}:${rinfo.port}`);
  console.log(`Packet data: ${msg.toString()}`);
  // Find the position of the 0x04 control character (ETX)
  let etxIndex = msg.indexOf(0x04);
  
  // If ETX character is found, trim the packet to exclude anything after it
  if (etxIndex !== -1) {
    // Trim the packet up to the ETX character and remove the \r\n (0x0D0A) after it
    msg = msg.slice(0, etxIndex).toString().replace(/\r?\n$/, ''); // Remove \r\n at the end if it exists
    console.log('ETX character found, data after ETX will be discarded');
  } else {
    msg = msg.toString();
  }

  console.log(`Packet data after ETX trimming: ${msg}`);
  let packet = msg.toString();  // Convert packet to string
  let data = parseData(packet); // Parse the key-value pairs

  console.log(`Parsed Data:`, data);

  // Handle 1 or 2-mile races by converting them to the appropriate meter distance
  if (data.distance === 1) {
    console.log("Handling 1-mile race, setting distance to 1609 meters");
    data.distance = 1609; // 1 mile in meters
  } else if (data.distance === 2) {
    console.log("Handling 2-mile race, setting distance to 3218 meters");
    data.distance = 3218; // 2 miles in meters
  }

  // Check if the race is longer than 400 meters
  if (data.distance > 400) {
    // Calculate estimated time of finish
    let estimatedFinish = calculateEstimatedFinish(data);
    console.log(`Estimated finish time: ${estimatedFinish}`);
    // Append the estimated finish time to the packet
    packet += `\r\nest_finish=${estimatedFinish}\r\n`;
  }

  // Convert the packet string to a Buffer before sending
  const buffer = Buffer.from(packet);
  
  console.log(`Retransmitting packet to port 55567`);
  
  // Send using the buffer's length
  client.send(buffer, 0, buffer.length, 55567, '192.168.1.44', (err) => {
    if (err) {
      console.error('Error sending packet:', err);
    } else {
      console.log('Packet successfully retransmitted');
    }
  });
});

// Helper function to parse the key-value pairs from the packet
function parseData(packet) {
  let data = {};
  let lines = packet.split('\n');
  
  lines.forEach(line => {
    let [key, value] = line.split('=');
    if (key && value) {
      data[key.trim()] = value.trim();
    }
  });

  // Log the values of cum_split_time and laps_to_go before processing
  console.log('cum_split_time:', data.cum_split_time);
  console.log('laps_to_go:', data.laps_to_go);

  // Convert distance to a number
  data.distance = parseInt(data.distance);
  
  // Handle the cumulative split time (could be in seconds or HH:MM:SS.ss)
  if (data.cum_split_time && data.cum_split_time.includes(':')) {
    // If the time is in HH:MM:SS.ss or MM:SS.ss format, convert to seconds
    data.cum_split_time = convertToSeconds(data.cum_split_time);
  } else if (data.cum_split_time) {
    // If the time is a numeric value (e.g., 17.46 seconds), convert it directly
    data.cum_split_time = parseFloat(data.cum_split_time);
  } else {
    data.cum_split_time = NaN;  // In case of missing value or invalid format
  }

  // Handle laps to go, converting to distance covered
  data.laps_to_go = parseInt(data.laps_to_go);
  if (isNaN(data.laps_to_go)) {
    console.log('laps_to_go is missing or invalid, setting default to 0');
    data.laps_to_go = 0;  // Default value if laps_to_go is invalid or missing
  }

  // Calculate the distance covered
  data.distance_covered = (data.distance - (data.laps_to_go * 400));

  return data;
}

// Convert formatted time (HH:MM:SS.ss or MM:SS.ss) to seconds
function convertToSeconds(time) {
  let parts = time.split(':');
  if (parts.length === 2) {
    // Format: MM:SS.ss
    let minutes = parseInt(parts[0]);
    let seconds = parseFloat(parts[1]);
    return (minutes * 60) + seconds;
  } else if (parts.length === 3) {
    // Format: HH:MM:SS.ss
    let hours = parseInt(parts[0]);
    let minutes = parseInt(parts[1]);
    let seconds = parseFloat(parts[2]);
    return (hours * 3600) + (minutes * 60) + seconds;
  } else {
    console.error('Invalid time format:', time);
    return NaN;
  }
}

// Convert formatted time (HH:MM:SS.ss) to seconds
function convertToSeconds(time) {
  let parts = time.split(':');
  if (parts.length === 2) {
    // Format: MM:SS.ss
    let minutes = parseInt(parts[0]);
    let seconds = parseFloat(parts[1]);
    return (minutes * 60) + seconds;
  } else if (parts.length === 3) {
    // Format: HH:MM:SS.ss
    let hours = parseInt(parts[0]);
    let minutes = parseInt(parts[1]);
    let seconds = parseFloat(parts[2]);
    return (hours * 3600) + (minutes * 60) + seconds;
  } else {
    console.error('Invalid time format:', time);
    return NaN;
  }
}

// Calculate the estimated finish time based on the data
function calculateEstimatedFinish(data) {
  let pace = data.cum_split_time / data.distance_covered;  // pace per meter
  let remainingDistance = data.distance - data.distance_covered;  // remaining distance
  let remainingTime = pace * remainingDistance;  // estimated remaining time
  let totalTime = data.cum_split_time + remainingTime;  // total estimated time

  // Ensure the calculated time is a valid number
  if (isNaN(totalTime) || totalTime <= 0) {
    console.error('Invalid estimated finish time:', totalTime);
    return 'Invalid';
  }

  return formatTime(totalTime);
}

// Format time in seconds as H:mm:ss.ss (drop leading zeroes if less than 1 hour)
function formatTime(seconds) {
  // Round up to nearest hundredth by multiplying by 100, ceiling, then dividing by 100
  seconds = Math.ceil(seconds * 100) / 100;
  
  let momentTime = moment.utc(seconds * 1000);  // Convert to milliseconds for moment.js
  
  // Format the time to drop leading zeroes in hours when under 1 hour
  if (momentTime.hours() === 0) {
    return momentTime.format('m:ss.SS');  // Format as m:ss.SS (no leading zero for hours)
  } else {
    return momentTime.format('HH:mm:ss.SS');  // Format as HH:mm:ss.SS (standard)
  }
}

// Bind the server to listen on port 55566
server.bind(55566, () => {
  console.log('Server is listening on port 55566...');
});
