(function (global) {
  'use strict'

  function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v))
  }

  function colorForStone(c) {
    if (c === 1) return '#111'
    if (c === -1) return '#f5f5f5'
    return null
  }

  function Board(element, options) {
    this.element = element
    this.options = options || {}
    this.size = this.options.size || 19
    this.width = this.options.width || 640
    this.objects = []
    this.listeners = { click: [] }
    this.canvas = document.createElement('canvas')
    this.canvas.width = this.width
    this.canvas.height = this.width
    this.canvas.className = 'wgo-board-canvas'
    this.element.innerHTML = ''
    this.element.appendChild(this.canvas)
    this.ctx = this.canvas.getContext('2d')
    this.canvas.addEventListener('click', this.handleClick.bind(this))
    this.draw()
  }

  Board.prototype.handleClick = function (event) {
    var rect = this.canvas.getBoundingClientRect()
    var x = event.clientX - rect.left
    var y = event.clientY - rect.top
    var step = this.width / (this.size + 1)
    var gx = Math.round(x / step) - 1
    var gy = Math.round(y / step) - 1
    gx = clamp(gx, 0, this.size - 1)
    gy = clamp(gy, 0, this.size - 1)
    var handlers = this.listeners.click || []
    for (var i = 0; i < handlers.length; i += 1) {
      handlers[i](gx, gy)
    }
  }

  Board.prototype.addEventListener = function (name, handler) {
    if (!this.listeners[name]) this.listeners[name] = []
    this.listeners[name].push(handler)
  }

  Board.prototype.removeAllObjects = function () {
    this.objects = []
    this.draw()
  }

  Board.prototype.addObject = function (obj) {
    this.objects.push(obj)
    this.draw()
  }

  Board.prototype.setSize = function (size) {
    this.size = size
    this.draw()
  }

  Board.prototype.draw = function () {
    if (!this.ctx) return
    var ctx = this.ctx
    ctx.clearRect(0, 0, this.width, this.width)
    ctx.fillStyle = '#d6b276'
    ctx.fillRect(0, 0, this.width, this.width)

    var step = this.width / (this.size + 1)
    var i
    ctx.strokeStyle = '#5e4023'
    ctx.lineWidth = 1
    for (i = 0; i < this.size; i += 1) {
      var pos = step * (i + 1)
      ctx.beginPath()
      ctx.moveTo(step, pos)
      ctx.lineTo(step * this.size, pos)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(pos, step)
      ctx.lineTo(pos, step * this.size)
      ctx.stroke()
    }

    for (i = 0; i < this.objects.length; i += 1) {
      var obj = this.objects[i]
      var fill = colorForStone(obj.c)
      if (!fill) continue
      var cx = step * (obj.x + 1)
      var cy = step * (obj.y + 1)
      var r = step * 0.42
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fillStyle = fill
      ctx.fill()
      ctx.lineWidth = 1
      ctx.strokeStyle = obj.c === -1 ? '#777' : '#000'
      ctx.stroke()
    }
  }

  global.WGo = {
    B: 1,
    W: -1,
    Board: Board,
  }
})(window)
