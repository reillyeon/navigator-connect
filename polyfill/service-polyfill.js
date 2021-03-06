// Polyfill for the service worker side of navigator.connect. This is not quite
// a perfect polyfill since it doesn't perfectly mimic what the actual API will
// look like.
//
// To use this polyfill, add eventhandlers by calling addEventListener.
// Assigning to oncrossoriginconnnect/oncrossoriginmessage isn't supported.
//
// Furthermore this polyfill might interfere with normal use of fetch and
// message events, although it tries to only handle fetch and message events
// that are specifically related to navigator.connect usage.
//
// The objects passed to crossoriginmessage and crossoriginconnect event
// handlers aren't true events, or even objects of the right type. Additionally
// these 'event' objects don't include all the fields the real events should
// have.
(function(self){

if ('oncrossoriginconnect' in self) return;

var kCrossOriginConnectMessageTag = 'crossOriginConnect';
var kCrossOriginMessageMessageTag = 'crossOriginMessage';
var kUrlSuffix = '?navigator-connect-service';

var customListeners = {'crossoriginconnect': [], 'crossoriginmessage': []};

var addEventListener = self.addEventListener;
self.addEventListener = function(type, listener, useCapture) {
  if (type in customListeners) {
    customListeners[type].push(listener);
  } else {
    return addEventListener(type, listener, useCapture);
  }
};

function dispatchCustomEvent(type, event) {
  for (var i = 0; i < customListeners[type].length; ++i) {
    customListeners[type][i](event);
  }
}

self.addEventListener('fetch', function(event) {
  var targetUrl = event.request.url;
  if (targetUrl.indexOf(kUrlSuffix, targetUrl.length - kUrlSuffix.length) === -1) {
    // Not a navigator-connect attempt
    return;
  }
  // In the real world this should not reply to all fetches.
  event.respondWith(
    new Response("<!DOCTYPE html><script>" +
      "window.onmessage = function(e) {\n" +
//      "console.log(e);\n" +
        "if ('connect' in e.data) {\n" +
          "var service_channel = new MessageChannel();\n" +
          "service_channel.port1.onmessage = function(ep) {\n" +
//          "console.log(ep);\n" +
            "if (!ep.data.connectResult) {\n" +
              "e.data.connect.postMessage({connected: false});\n" +
              "return;\n" +
            "}\n" +
            "var client_channel = new MessageChannel();\n" +
            "client_channel.port1.onmessage = function(ec) {\n" +
              "var msg_channel = new MessageChannel();\n" +
              "msg_channel.port1.onmessage = function(em) {\n" +
                "client_channel.port1.postMessage(em.data, em.ports);\n" +
              "};\n" +
              "navigator.serviceWorker.controller.postMessage({" + kCrossOriginMessageMessageTag + ": document.location.href, origin: ec.origin, data: ec.data, port: msg_channel.port2}, [msg_channel.port2]);\n" +
            "};\n" +
            "e.data.connect.postMessage({connected: client_channel.port2}, [client_channel.port2]);\n" +
          "};\n" +
          "navigator.serviceWorker.controller.postMessage({" + kCrossOriginConnectMessageTag + ": document.location.href, origin: e.origin, port: service_channel.port2}, [service_channel.port2]);\n" +
        "}\n" +
      "};</script>",
                 {headers: {'content-type': 'text/html'}})
  );
  event.stopImmediatePropagation();
});

function CrossOriginServiceWorkerClient(origin, targetUrl, port) {
  this.origin = origin;
  this.targetUrl = targetUrl;
  this.port_ = port;
};

CrossOriginServiceWorkerClient.prototype.postMessage =
    function(msg, transfer) {
  this.port_.postMessage(msg, transfer);
};

function CrossOriginConnectEvent(client, port) {
  this.client = client;
  this.replied_ = false;
  this.port_ = port;
};

CrossOriginConnectEvent.prototype.acceptConnection = function(accept) {
  this.replied_ = true;
  this.port_.postMessage({connectResult: accept});
};

function handleCrossOriginConnect(data) {
  var targetUrl = data[kCrossOriginConnectMessageTag];
  if (targetUrl.indexOf(kUrlSuffix, targetUrl.length - kUrlSuffix.length) !== -1) {
    targetUrl = targetUrl.substr(0, targetUrl.length - kUrlSuffix.length);
  }

  var client =
      new CrossOriginServiceWorkerClient(data.origin, targetUrl, undefined);
  var connectEvent = new CrossOriginConnectEvent(client, data.port);
  dispatchCustomEvent('crossoriginconnect', connectEvent);
  if (!connectEvent.replied_) {
    data.port.postMessage({connectResult: false});
  }
}

function handleCrossOriginMessage(event) {
  var ports = [];
  for (var i = 0; i < event.ports; ++i) {
    if (event.ports[i] != event.data.port) ports.push(even.ports[i]);
  }

  var targetUrl = event.data[kCrossOriginMessageMessageTag];
  if (targetUrl.indexOf(kUrlSuffix, targetUrl.length - kUrlSuffix.length) !== -1) {
    targetUrl = targetUrl.substr(0, targetUrl.length - kUrlSuffix.length);
  }

  var client = new CrossOriginServiceWorkerClient(
      event.data.origin, targetUrl, event.data.port);
  var crossOriginMessageEvent = {
    data: event.data.data,
    ports: ports,
    source: client
  };
  dispatchCustomEvent('crossoriginmessage', crossOriginMessageEvent);
}

self.addEventListener('message', function(event) {
  // In the real world this should be more careful about what messages to listen to.
  if (kCrossOriginConnectMessageTag in event.data) {
    handleCrossOriginConnect(event.data);
    event.stopImmediatePropagation();
    return;
  }
  if (kCrossOriginMessageMessageTag in event.data) {
    handleCrossOriginMessage(event);
    event.stopImmediatePropagation();
    return;
  }
});

})(self);
