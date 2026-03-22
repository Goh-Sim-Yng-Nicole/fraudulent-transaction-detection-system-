const WebSocket = require('ws');
const logger = require('../config/logger');
const config = require('../config');
const analyticsService = require('./analyticsService');

class WebSocketService {
  constructor() {
    this.wss = null;
    this.clients = new Set();
    this.updateInterval = null;
  }

  // Handles initialize.
  initialize(server) {
    if (!config.websocket.enabled) {
      logger.info('WebSocket disabled');
      return;
    }

    this.wss = new WebSocket.Server({ server, path: '/ws' });

    this.wss.on('connection', (ws, req) => {
      logger.info('WebSocket client connected', { 
        ip: req.socket.remoteAddress,
        totalClients: this.clients.size + 1,
      });

      this.clients.add(ws);
      this._sendInitialData(ws);
      ws.isAlive = true;
      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          this._handleMessage(ws, data);
        } catch (err) {
          logger.error('WebSocket message parse error', { error: err.message });
        }
      });

      ws.on('close', () => {
        logger.info('WebSocket client disconnected', { 
          totalClients: this.clients.size - 1,
        });
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        logger.error('WebSocket error', { error: err.message });
        this.clients.delete(ws);
      });
    });
    this._startHeartbeat();
    this._startRealTimeUpdates();

    logger.info('WebSocket server initialized', { path: '/ws' });
  }

  // Handles broadcast.
  broadcast(type, data) {
    const message = JSON.stringify({ type, data, timestamp: new Date().toISOString() });

    let sent = 0;
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(message);
          sent++;
        } catch (err) {
          logger.error('WebSocket send error', { error: err.message });
        }
      }
    }

    if (sent > 0) {
      logger.debug('WebSocket broadcast', { type, clients: sent });
    }
  }

  // Handles send initial data.
  async _sendInitialData(ws) {
    try {
      const realTimeStats = await analyticsService.getRealTimeStats();
      ws.send(JSON.stringify({
        type: 'init',
        data: { realTimeStats },
        timestamp: new Date().toISOString(),
      }));
    } catch (err) {
      logger.error('Error sending initial data', { error: err.message });
    }
  }

  // Handles handle message.
  _handleMessage(ws, data) {
    logger.debug('WebSocket message received', { type: data.type });

    switch (data.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
        break;
      case 'subscribe':
        break;
      default:
        logger.warn('Unknown WebSocket message type', { type: data.type });
    }
  }

  // Handles start heartbeat.
  _startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      for (const ws of this.clients) {
        if (ws.isAlive === false) {
          logger.debug('Terminating inactive WebSocket client');
          this.clients.delete(ws);
          return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
      }
    }, config.websocket.heartbeatInterval);
  }

  // Handles start real time updates.
  _startRealTimeUpdates() {
    if (!config.analytics.enableRealTimeUpdates) {
      return;
    }
    this.updateInterval = setInterval(async () => {
      if (this.clients.size === 0) return;

      try {
        const realTimeStats = await analyticsService.getRealTimeStats();
        this.broadcast('realtime_update', realTimeStats);
      } catch (err) {
        logger.error('Error in real-time update', { error: err.message });
      }
    }, 5000);

    logger.info('Real-time updates started', { interval: '5s' });
  }

  // Handles stop.
  stop() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    for (const client of this.clients) {
      client.close();
    }

    if (this.wss) {
      this.wss.close();
    }

    logger.info('WebSocket service stopped');
  }
}

module.exports = new WebSocketService();