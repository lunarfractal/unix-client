var canvas;
var ctx;

var debug = true;

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
  canvas = document.getElementById("canvas");
  ctx = canvas.getContext("2d"); // do whatever
  window.network = new window.Network();
  window.network.connect();
  resizeCanvas();
  addListeners();
}

function addListeners() {
  document.addEventListener("mousemove", (e) => {
    window.network.sendCursor(e.clientX, e.clientY);
  });
}

function getString(view, offset) {
  var nick = "";
  for (;;) {
    var v = view.getUint16(offset, true);
    offset += 2;
    if (v == 0) {
      break;
    }

    nick += String.fromCharCode(v);
  }
  return {
    nick: nick,
    offset: offset,
  };
}

var cursors = new Map();

var myId;
var myColor;
var myNick;

// Client -> Server
const OPCODE_CS_PING = 0x00;
const OPCODE_CS_PONG = 0x01;
const OPCODE_DIMENSIONS = 0x02;
const OPCODE_ENTER_GAME = 0x03;
const OPCODE_LEAVE_GAME = 0x04;
const OPCODE_CURSOR = 0x05;
const OPCODE_CLICK = 0x06;
const OPCODE_NICK = 0x07;
const OPCODE_COLOR = 0x08;
const OPCODE_DISPATCH = 0x09

// Server -> Client
const OPCODE_SC_PING = 0x00;
const OPCODE_SC_PONG = 0x01;
const OPCODE_CONFIG = 0xA0;
const OPCODE_ENTERED_GAME = 0xA1;
const OPCODE_INFO = 0xB0;
const OPCODE_EVENTS = 0xA2;

// Client -> Server
const DISPATCH_CHANGE_DIRECTORY = 0x01;
const DISPATCH_LIST_DIRECTORY = 0x02;

// Server -> Client
const FLAG_CURSOR = 0x11;
const FLAG_DIRECTORY = 0x12;
const FLAG_FILE = 0x13;

const EVENT_CURSOR_ADD = 0x00;
const EVENT_CURSOR_DELETE = 0x01;
const EVENT_CHANGE_DIRECTORY = 0x02;
const EVENT_ENTER_DIRECTORY = 0x03;


window.Cursor = class Cursor {
  constructor(maybeShow) {
    this.element = document.createElement("div");
    this.element.className = "cursor";
    this.initElement();
    if(!maybeShow)
      document.getElementById("cursor-place").appendChild(this.element);
  }

  initElement() {
    let img = document.createElement("img");
    img.src = "http://brutal.nekoweb.org/cursor.png";
    this.element.appendChild(img);
  }

  hide() {
    this.element.style.display = 'none';
  }

  show() {
    this.element.style.display = 'block';
  }
  
  delete() {
    document.getElementById("cursor-place").removeChild(this.element);
  }

  updateCursor(x, y) {
    this.element.style.marginLeft = x + "px";
    this.element.style.marginTop = y + "px";
  }

  updateNick(nick) {}

  updateColor(r, g, b) {}
};

window.Network = class Network {
  constructor() {
    this.webSocket = null;

    this.address = "ws://192.168.1.7:8081";
    this.hasConnection = false;
    this.sentHello = false;
    this.lastPing = 0;
  }

  connect() {
    try {
      this.webSocket = new WebSocket("ws://192.168.1.7:8081");
    } catch (e) {
      setTimeout(() => this.connect(), 1e3);
      return;
    }
    this.webSocket.binaryType = "arraybuffer";
    this.webSocket.onopen = this.onSocketOpen;
    this.webSocket.onclose = this.onSocketClose;
    this.webSocket.onerror = this.onError;
    this.webSocket.onmessage = this.onSocketMessage;
  }

  onSocketOpen() {
    console.log("Connected!");
    window.network.hello();
  }

  onSocketClose() {
    console.log("disconnected");
    setTimeout(() => this.connect(), 1e3);
  }

  onError(a) {
    console.error(a);
  }

  onSocketMessage(event) {
    if (debug) console.log(new Uint8Array(event.data));
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
    let buffer = new ArrayBuffer(2);
    let view = new DataView(buffer);

    view.setUint8(0, 6);

    let flags = 0x0;

    if (shooting) {
      flags |= 0x1;
    }

    view.setUint8(1, flags);

    this.webSocket.send(buffer);
  }

  sendNick(nick) {
    let buffer = new ArrayBuffer(1 + 2 * nick.length + 3);
    let view = new DataView(buffer);

    view.setUint8(0, 3);

    for (let i = 0; i < nick.length; i++) {
      view.setUint16(1 + i * 2, nick.charCodeAt(i), true);
    }

    this.webSocket.send(buffer);
  }

  changeDirectory(directoryId) {
    let buffer = new ArrayBuffer(1+1+4);
    let view = new DataView(buffer);

    view.setUint8(0, OPCODE_DISPATCH);
    view.setUint8(1, DISPATCH_CHANGE_DIRECTORY);

    view.setUint32(2, directoryId);

    this.webSocket.send(buffer);
  }

  processMessage(buffer) {
    let view = new DataView(buffer);
    let op = view.getUint8(0);
    switch (op) {
      case OPCODE_SC_PING:
        this.pong();
        break;
      case OPCODE_SC_PONG:
        console.log("Pong", +new Date() - this.lastPing);
        window.network.sendNick("hi");
        break;
      case OPCODE_ENTERED_ROOM:
        console.log("Did enter room!");
        window.myId = view.getUint32(1, true);
        console.log(myId);
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
        console.log("unknown opcode:", op);
        break;
    }
  }

  processConfig(view) {
    let offset = 1;
    let flags = view.getUint8(offset);
    offset += 1;
    switch (flags) {
      case FLAG_CURSOR: {
        while (true) {
          let id = view.getUint32(offset, true);
          offset += 4;
          if (id == 0x00) break;
          let cursor;
          if (id === myId) {
            console.log("its my id");
            cursor = new window.Cursor(true);
          } else {
            cursor = new window.Cursor(false);
          }
          cursor.id = id;
          let x = view.getUint16(offset, true);
          offset += 2;
          let y = view.getUint16(offset, true);
          offset += 2;
          cursor.updateCursor(x, y);
          let res = getString(view, offset);
          cursor.updateNick(res.nick);
          offset = res.offset;
          let r = view.getUint8(offset++),
            g = view.getUint8(offset++),
            b = view.getUint8(offset++);
          cursor.updateColor(r, g, b);
          cursors.set(id, cursor);
          if (debug) console.log("Cursor", cursor);
        }
        break;
      }
      default:
        console.log("unknown flags", flags);
        break;
    }
  }

  processEvents(view) {
    let offset = 1;
    let type = view.getUint8(offset);
    offset++;
    while (true) {
        let id = view.getUint32(offset, true);
        offset += 4;
        if (id == 0x00) break;
        let flags = view.getUint8(offset);
        offset++;
        switch (flags) {
          case EVENT_CURSOR_ADD:
          {
            let cursor;
            if(id == myId) {
              cursor = new Cursor(true);
            } else {
              cursor = new Cursor(false);
            }
            cursor.id = id;
            let x = (view.getUint16(offset, true) / 65535) * window.innerWidth;
            offset += 2;
            let y = (view.getUint16(offset, true) / 65535) * window.innerHeight;
            offset += 2;
            let res = getString(view, offset);
            offset = res.offset;
            let r = view.getUint8(offset++),
              g = view.getUint8(offset++),
              b = view.getUint8(offset++);
            cursor.updateCursor(x, y);
            cursor.updateNick(res.nick);
            cursor.updateColor(r, g, b);
            cursors.set(id, cursor);
            if (debug) console.log("Cursor Add", cursor);
            break;
          }

          case EVENT_CURSOR_DELETE:
          {
            let cursor = cursors.get(id);
            if(debug) console.log('Cursor delete', cursor);
            if (cursor) {
              cursor.delete();
              cursors.delete(id);
            }
            break;
          }

          case EVENT_CHANGE_DIRECTORY:
          {
            let cursor = cursors.get(id);
            if(debug) console.log('Cursor hide', cursor);
            if (cursor) {
              cursor.hide();
            }
            break;
          }

          case EVENT_ENTER_DIRECTORY:
          {
            let cursor = cursors.get(id);
            if(debug) console.log('Cursor show', cursor);
            if (cursor) {
              cursor.show();
            }
            break;
          }

          default:
            console.log("unknown flags", flags);
            break;
        }
      }
    }
  }

  processInfo(view) {
    let offset = 1;
    let flags = view.getUint8(offset);
    offset += 1;
    switch (flags) {
      case FLAG_CURSOR: {
        let id = view.getUint32(offset, true);
        offset += 4;
        if (id == myId) break;
        let x = (view.getUint16(offset, true) / 65535) * window.innerWidth;
        offset += 2;
        let y = (view.getUint16(offset, true) / 65535) * window.innerHeight;
        offset += 2;
        let cursor = cursors.get(id);
        if (cursor) {
          cursor.updateCursor(x, y);
          if (debug) console.log(cursor);
        } else {
          console.log("Cursor with id " + id + " not found");
        }
        break;
      }
      default:
        console.log("unknown flag", flags);
        break;
    }
  }
};

window.onload = init;
window.onresize = resizeCanvas;
