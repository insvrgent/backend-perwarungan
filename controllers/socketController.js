const axios = require("axios");
const db = require("../models");

let io = null;
let access_token = "";
let device_id = "";
let currentTrack = [];
let clerkSockets = {};

//if theres a success transaction, this will be called
const emitTransaction = (table_id, transaction_id) => {
  if (!io) {
    console.error("Socket.IO not initialized");
    return;
  }

  Object.values(clerkSockets).forEach(socketId => {
    console.error(socketId);
    io.to(socketId).emit("transaction", { table_id, transaction_id });
  });
};

//this will be called by signcheck if theres a clerk load
const signClerk = (socketId, user_id) => {
  clerkSockets[user_id] = socketId;
};

//this will be called if clerk is login spotify
const setAccessToken = (token) => {
  access_token = token;
};

//this will be called if clerk is login spotify
const setDeviceId = (token) => {
  device_id = token;
};

//this will be called sometime by its own interval
const getCurrentTrack = async (io) => {
  try {
    if (access_token === "") throw "no token";
    const response = await axios.get(
      `https://api.spotify.com/v1/me/player/currently-playing`,
      {
        headers: {
          Authorization: `Bearer ${access_token}`,
        },
      }
    );

    const { item } = response.data;
    const trackName = item.name;
    const trackImage = item.album.images[0].url; // Assuming you want the first image
    const artists = item.artists.map((artist) => artist.name).join(", ");
    const duration = item.duration_ms;

    const progress_ms = response.data.progress_ms;
    const remaining_ms = duration - progress_ms;
    const intervalTime = remaining_ms > 0 ? remaining_ms : 1000;

    console.log("Track Name:", trackName);
    console.log("Track Image URL:", trackImage);
    console.log("Artists:", artists);

    // Update current track information
    currentTrack = item;

    // Emit current track information to all sockets
    io.emit("current", currentTrack);

    setTimeout(() => getCurrentTrack(io), intervalTime);
  } catch (error) {
    console.error("Error fetching currently playing track:", error);
    setTimeout(() => getCurrentTrack(io), 10000); // Retry after 10 seconds on error
  }
};

//this will be called when clerk is login, to detect if there a song played
const emitCurrentTrack = async (io) => {
  try {
    io.emit("current", currentTrack);
  } catch (error) {
    console.error("Error fetching currently playing track:", error);
  }
};

module.exports = (socketIo) => {
  io = socketIo; // Assign the passed socketIo to the io variable
  io.on("connection", (socket) => {
    io.emit("current", currentTrack);
    console.log("A user connected");

    socket.on("disconnect", () => {
      console.log("User disconnected");
      // Remove the user_id association on disconnect
      Object.keys(clerkSockets).forEach((user_id) => {
        if (clerkSockets[user_id] === socket.id) {
          delete clerkSockets[user_id];
        }
      });
    });

    socket.on("chat message", (msg) => {
      console.log("message: " + msg);
      io.emit("chat message", msg); // Broadcast the message to all clients
    });

    //will be called if a user search for a song
    socket.on("reqtrack", async (data) => {
      const { searchTerm } = data;
      const socketId = socket.id;

      try {
        const response = await axios.get(
          `https://api.spotify.com/v1/search?q=${searchTerm}&type=track&limit=5`,
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
          }
        );

        const tracks = response.data.tracks.items;
        io.to(socketId).emit("restrack", {
          action: "reqtrack",
          tracks,
          socketId,
        });

        // Send current track information if available
        if (currentTrack) {
          socket.emit("current", currentTrack);
        }
      } catch (error) {
        console.error("Error fetching tracks:", error);
      }
    });

    //will be called if user request a song
    socket.on("addtrack", async (trackId) => {
      console.log(trackId);
      console.log(device_id);
      const socketId = socket.id;

      try {
        await axios.post(
          `https://api.spotify.com/v1/me/player/queue?uri=spotify%3Atrack%3A${trackId}&device_id=${device_id}`,
          null, // No data to send in the request body
          {
            headers: {
              Authorization: `Bearer ${access_token}`,
            },
          }
        );

        // Assuming you want to inform the client that the track was added successfully
        io.to(socketId).emit("trackadded", { success: true });
      } catch (error) {
        console.error("Error adding track to queue:", error);
        // Emit an error event to inform the client about the failure
        io.to(socketId).emit("trackadded", {
          success: false,
          error: error.message,
        });
      }
    });

    //called on user login
    emitCurrentTrack(io);
  });

  //called on start
  getCurrentTrack(io);
};

module.exports.signClerk = signClerk;
module.exports.setAccessToken = setAccessToken;
module.exports.setDeviceId = setDeviceId;
module.exports.emitTransaction = emitTransaction;
module.exports.clerkSockets = clerkSockets;
