var canvas;
var ctx;

function resizeCanvas() {
  canvas.width = document.documentElement.clientWidth;
  canvas.height = document.documentElement.clientHeight;
}

function hideUI() {
  $(".app").hide();
}

function fadeInUI() {
  setTimeout(() => {
    $(".app").fadeIn(300);
  }, 1000);
}

function init() {
  canvas = document.getElementById('canvas');
  ctx = canvas.getContext('2d'); // do whatever
  window.network = new Network();
  network.connect();
  resizeCanvas();
}

function getString(view, offset) {
	var nick = "";
	for(;;){
		var v = view.getUint16(offset, true);
		offset += 2;
		if(v == 0) {
			break;
		}

		nick += String.fromCharCode(v);
	}
	return {
		nick: nick,
		offset: offset
	};
}

var cursors = new Map();

var myId;
var myColor;
var myNick;

var OPCODE_SC_PING = 0x00
var OPCODE_SC_PONG = 0x01
var OPCODE_CONFIG = 0xA0
var OPCODE_ENTERED_ROOM = 0xA1
var OPCODE_INFO = 0xB0
var OPCODE_EVENTS = 0xA2

var OPCODE_CS_PING = 0x00
var OPCODE_CS_PONG = 0x01
var OPCODE_SCREEN = 0x02
var OPCODE_ENTER_ROOM = 0x03
var OPCODE_LEAVE_ROOM = 0x04
var OPCODE_CURSOR = 0x05
var OPCODE_CLICK = 0x06
var OPCODE_NICK = 0x07
var OPCODE_COLOR = 0x08
var OPCODE_DISPATCH = 0x09

var FLAG_CURSOR = 0x00;

window.Cursor = class Cursor {
  constructor() {
    this.r = 0;
    this.g = 0;
    this.b = 0;
    this.nick = "";
    this.x = 0;
    this.y = 0;
    this.element = document.createElement('div');
    this.element.style.height = '15px';
    this.element.style.padding = '5px';
    this.element.style.backgroundColor = '#ffffff';
    this.element.textContent = `
      hiii
    `;
    document.body.appendChild(this.element);
  }

  updateCursor(x, y) {
    this.x = x;
    this.y = y;
    this.element.style.left = x;
    this.element.style.top = y;
  }

  updateNick(nick) {
    this.nick = nick;
    this.element.textContent = nick;
  }

  updateColor(r, g, b) {
    this.r = r; this.g = g: this.b = b;
    this.element.style.color = 'rgb('+r+', '+g+', '+b+')';
  }
}

window.Network = class Network {
  constructor() {
    this.webSocket = null;

    this.address = "ws://192.168.1.12:8081";
    this.hasConnection = false;
    this.sentHello = false;
    this.lastPing = 0;
  }

  connect() {
    try {
      this.webSocket = new WebSocket('ws://192.168.1.12:8081');
    } catch(e) {
      setTimeout(() => this.connect(), 1E3);
      return;
    }
    this.webSocket.binaryType = 'arraybuffer';
    this.webSocket.onopen = this.onSocketOpen;
    this.webSocket.onclose = this.onSocketClose;
    this.webSocket.onerror = this.onError;
    this.webSocket.onmessage = this.onSocketMessage;
  }

  onSocketOpen() {
    console.log('Connected!');
    window.network.hello();
  }

  onSocketClose() {
    console.log('disconnected');
    setTimeout(() => this.connect(), 1E3);
  }

  onError(a) {
    console.error(a);
  }

  onSocketMessage(event) {
    window.network.processMessage(event.data);
  }

  hello() {
    this.ping();
    this.sendScreen();
  }

  ping() {
    let buffer = new ArrayBuffer(1);
    let view = new DataView(buffer);

    view.setUint8(0, 0);

    this.webSocket.send(buffer);
    this.lastPing = +new Date();
  }

  pong() {
    let buffer = new ArrayBuffer(1);
    let view = new DataView(buffer);

    view.setUint8(0, 1);

    this.webSocket.send(buffer);
  }

  sendScreen() {
    let buffer = new ArrayBuffer(5);
    let view = new DataView(buffer);

    view.setUint8(0, 2);

    view.setUint16(1, window.innerWidth, true);
    view.setUint16(3, window.innerHeight, true);

    this.webSocket.send(buffer);
  }

  leave() {
    let buffer = new ArrayBuffer(1);
    let view = new DataView(buffer);

    view.setUint8(0, 4);

    this.webSocket.send(buffer);
  }

  sendCursor(x, y) {
    let buffer = new ArrayBuffer(5);
    let view = new DataView(buffer);

    view.setUint8(0, 5);

    view.setUint16(1, x, true);
    view.setUint16(3, y, true);

    this.webSocket.send(buffer);
  }

  sendClick(shooting) {
    let buffer = new ArrayBuffer(1);
    let view = new DataView(buffer);

    view.setUint8(0, 6);

    shooting ? view.setUint8(1, 1) : view.setUint8(1, 0);

    this.webSocket.send(buffer);
  }
  
  sendNick(nick) {
    let buffer = new ArrayBuffer(1 + 2 * nick.length + 3);
    let view = new DataView(buffer);

    view.setUint8(0, 3);

    for(let i = 0; i < nick.length; i++) {
      view.setUint16(1 + i * 2, nick.charCodeAt(i), true);
    }
    
    this.webSocket.send(buffer);
  }

  processMessage(view) {
    let op = view.getUint8(0);
    switch(op) {
      case OPCODE_SC_PING:
        this.pong();
        break;
      case OPCODE_SC_PONG:
        console.log('Pong', +new Date() - this.lastPing);
        break;
      case OPCODE_ENTERED_ROOM:
        console.log('Did enter room!');
        window.myId = view.getUint32(1, true);
        break;
      case OPCODE_CONFIG:
        this.processConfig(view);
        break;
      case OPCODE_INFO:
        this.processInfo(view);
        break;
      case OPCODE_EVENTS:
        this.processEvents(view);
        break;
      default:
        console.log('unknown opcode:', op);
        break;
    }
  }

  processConfig(view) {
    let offset = 1;
    let flags = view.getUint8(offset);
    offset += 1;
    switch(flags) {
      case FLAG_CURSOR:
      {
        while(true) {
          let id = view.getUint32(offset, true);
          if(id == 0x00) break;
          let cursor = new Cursor();
          cursor.id = id;
          let x = view.getUint16(offset, true);
          offset += 2;
          let y = view.getUint16(offset, true);
          offset += 2;
          cursor.updateCursor(x, y);
          let res = getString(view, offset);
          cursor.updateNick(res.nick);
          offset = res.offset;
          let r = view.getUint8(offset++), g = view.getUint8(offset++), b = view.getUint8(offset++);
          cursor.updateColor(r,g,b);
          cursors.set(id, cursor);
        }
        break;
      }
      default:
        console.log('unknown flags', flags);
        break;
    }
  }

  processInfo(view) {
    let offset = 1;
    let flags = view.getUint8(offset);
    offset += 1;
    switch(flags) {
      case FLAG_CURSOR:
      {
        let id = view.getUint32(offset, true);
        offset += 4;
        if(id == myId) break;
        let x = view.getUint16(offset, true) / 65535 * window.innerWidth;
        offset += 2;
        let y = view.getUint16(offset, true) / 65535 * window.innerHeight;
        offset += 2;
        let cursor = cursors.get(id);
        if(cursor) {
          cursor.updateCursor(x, y);
        } else {
          console.log('Cursor with id ' + id + ' not found');
        }
        break;
      }
      default:
        console.log('unknown flag', flags);
        break;
    }
  }
}

window.onload = init;
window.onresize = resizeCanvas;
