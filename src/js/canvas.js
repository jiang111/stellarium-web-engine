/* Stellarium Web Engine - Copyright (c) 2022 - Stellarium Labs SRL
 *
 * This program is licensed under the terms of the GNU AGPL v3, or
 * alternatively under a commercial licence.
 *
 * The terms of the AGPL v3 license can be found in the main directory of this
 * repository.
 */

Module.afterInit(function() {
  if (!Module.canvas) return;

  // XXX: remove this I guess.
  var mouseDown = false;
  var mouseButtons = 0;
  var mousePos;
  var contextLost = false;

  // Handle WebGL context loss (common on iOS under GPU memory pressure).
  // When context is lost, all GL resources (shaders, textures, buffers)
  // become invalid. Since the C/WASM layer caches GL handles internally,
  // the only reliable recovery is to reload the page.
  Module.canvas.addEventListener('webglcontextlost', function(e) {
    console.warn('[SWE] WebGL context lost');
    e.preventDefault(); // Allow browser to attempt context restoration
    contextLost = true;
  }, false);

  Module.canvas.addEventListener('webglcontextrestored', function(e) {
    console.warn('[SWE] WebGL context restored, reloading page to rebuild GL resources');
    location.reload();
  }, false);

  // Function called at each frame
  var render = function(timestamp) {

    // Skip rendering when WebGL context is lost to avoid invalid GL calls.
    // The requestAnimationFrame loop continues so that rendering resumes
    // automatically if the context is restored (before reload kicks in).
    if (contextLost) {
      window.requestAnimationFrame(render);
      return;
    }

    if (mouseDown)
      Module._core_on_mouse(0, 1, mousePos.x, mousePos.y, mouseButtons);

    // Check for canvas resize
    var canvas = Module.canvas;

    // Get the device pixel ratio, falling back to 1.
    var dpr = window.devicePixelRatio || 1;

    // Get the size of the canvas in CSS pixels.
    var rect = canvas.getBoundingClientRect();

    var displayWidth  = rect.width;
    var displayHeight = rect.height;
    var sizeChanged = (canvas.width  !== displayWidth) ||
                      (canvas.height !== displayHeight);

    if (sizeChanged) {
      canvas.width = displayWidth * dpr;
      canvas.height = displayHeight * dpr;
    }

    // TODO: manage paning and flicking here

    Module._core_update();
    Module._core_render(displayWidth, displayHeight, dpr);

    window.requestAnimationFrame(render)
  }

  var fixPageXY = function(e) {
    if (e.pageX == null && e.clientX != null ) {
      var html = document.documentElement
      var body = document.body
      e.pageX = e.clientX + (html.scrollLeft || body && body.scrollLeft || 0)
      e.pageX -= html.clientLeft || 0
      e.pageY = e.clientY + (html.scrollTop || body && body.scrollTop || 0)
      e.pageY -= html.clientTop || 0
    }
  };

  var setupMouse = function() {
    var canvas = Module.canvas;
    function getMousePos(evt) {
      var rect = canvas.getBoundingClientRect();
      return {
        x: evt.clientX - rect.left,
        y: evt.clientY - rect.top
      };
    }

    canvas.addEventListener('mousedown', function(e) {
      var that = this;
      e = e || event;
      fixPageXY(e);
      mouseDown = true;
      mousePos = getMousePos(e);
      mouseButtons = e.buttons;

      document.onmouseup = function(e) {
        e = e || event;
        fixPageXY(e);
        mouseDown = false;
        mousePos = getMousePos(e);
        Module._core_on_mouse(0, 0, mousePos.x, mousePos.y, mouseButtons);
      };
      document.onmouseleave = function(e) {
        mouseDown = false;
      };

      document.onmousemove = function(e) {
        e = e || event;
        fixPageXY(e);
        mousePos = getMousePos(e);
      }
    });

    canvas.addEventListener('touchstart', function(e) {
      var rect = canvas.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var id = e.changedTouches[i].identifier;
        var relX = e.changedTouches[i].pageX - rect.left;
        var relY = e.changedTouches[i].pageY - rect.top;
        Module._core_on_mouse(id, 1, relX, relY, 1);
      }
    }, {passive: true});
    canvas.addEventListener('touchmove', function(e) {
      if (e.cancelable) {
        e.preventDefault();
      }
      var rect = canvas.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var id = e.changedTouches[i].identifier;
        var relX = e.changedTouches[i].pageX - rect.left;
        var relY = e.changedTouches[i].pageY - rect.top;
        Module._core_on_mouse(id, -1, relX, relY, 1);
      }
    }, {passive: false});
    canvas.addEventListener('touchend', function(e) {
      var rect = canvas.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var id = e.changedTouches[i].identifier;
        var relX = e.changedTouches[i].pageX - rect.left;
        var relY = e.changedTouches[i].pageY - rect.top;
        Module._core_on_mouse(id, 0, relX, relY, 1);
      }
    });

    // Handle touchcancel: iOS fires this instead of touchend when system
    // gestures (e.g. multitasking swipe) intercept touch events.
    // Without this, touch points remain "down" in the C gesture state machine,
    // causing it to get stuck and stop accepting new gestures.
    canvas.addEventListener('touchcancel', function(e) {
      var rect = canvas.getBoundingClientRect();
      for (var i = 0; i < e.changedTouches.length; i++) {
        var id = e.changedTouches[i].identifier;
        var relX = e.changedTouches[i].pageX - rect.left;
        var relY = e.changedTouches[i].pageY - rect.top;
        Module._core_on_mouse(id, 0, relX, relY, 1);
      }
    });

    // Fallback: when the page regains visibility (e.g. app returns from
    // background), force-release all touch points to recover from any
    // stuck gesture state that touchcancel might have missed.
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        Module._core_on_mouse(0, 0, 0, 0, 0);
        Module._core_on_mouse(1, 0, 0, 0, 0);
        mouseDown = false;
      }
    });

    function getMouseWheelDelta(event) {
      var delta = 0;
      switch (event.type) {
        case 'DOMMouseScroll':
          delta = -event.detail;
          break;
        case 'mousewheel':
          delta = event.wheelDelta / 120;
          break;
        default:
          throw 'unrecognized mouse wheel event: ' + event.type;
      }
      return delta;
    }

    var onWheelEvent = function(e) {
      e.preventDefault();
      fixPageXY(e);
      var pos = getMousePos(e);
      var zoom_factor = 1.05;
      var delta = getMouseWheelDelta(e) * 2;
      Module._core_on_zoom(Math.pow(zoom_factor, delta), pos.x, pos.y);
      return false;
    };
    canvas.addEventListener('mousewheel', onWheelEvent, {passive: false});
    canvas.addEventListener('DOMMouseScroll', onWheelEvent, {passive: false});

    canvas.oncontextmenu = function(e) {
      e.preventDefault();
      e.stopPropagation();
    }

  };

  setupMouse();

  // Kickoff rendering at max FPS, normally 60 FPS on a browser.
  window.requestAnimationFrame(render)
})
