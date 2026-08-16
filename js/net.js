/* ============================================================
   Net -- tiny WebSocket pub/sub wrapper for local-network
   multiplayer. Connects back to whatever host served this page
   (so every player just opens the host's LAN address in a
   browser -- no separate address to configure). If there's no
   server to talk to (e.g. the page was opened as a local file,
   or nothing is listening), it fails quietly and the game falls
   back to solo play.
============================================================ */
(function(){
  "use strict";

  var Net = {
    ws: null,
    connected: false,
    handlers: {},

    connect: function(){
      if (window.location.protocol === 'file:') {
        this._emit('unavailable');
        return;
      }
      var proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + window.location.host;
      var self = this;
      var socket;
      try {
        socket = new WebSocket(url);
      } catch (e) {
        this._emit('unavailable');
        return;
      }
      this.ws = socket;

      var settled = false;
      var timeout = setTimeout(function(){
        if (!settled && socket.readyState !== WebSocket.OPEN){
          settled = true;
          self._emit('unavailable');
        }
      }, 2500);

      socket.addEventListener('open', function(){
        settled = true;
        clearTimeout(timeout);
        self.connected = true;
        self._emit('open');
      });
      socket.addEventListener('close', function(){
        self.connected = false;
        self._emit('close');
      });
      socket.addEventListener('error', function(){
        if (!settled){
          settled = true;
          clearTimeout(timeout);
          self._emit('unavailable');
        }
      });
      socket.addEventListener('message', function(ev){
        var msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        self._emit(msg.type, msg);
      });
    },

    on: function(type, fn){
      (this.handlers[type] = this.handlers[type] || []).push(fn);
    },

    _emit: function(type, msg){
      (this.handlers[type] || []).forEach(function(fn){ fn(msg); });
    },

    send: function(obj){
      if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(obj));
    }
  };

  window.Net = Net;
})();
