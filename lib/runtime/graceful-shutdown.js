"use strict";

function createGracefulShutdown(options = {}) {
  const server = options.server;
  if (!server || typeof server.close !== "function") throw new Error("HTTP server with close() is required");
  const resources = Array.isArray(options.resources) ? options.resources : [];
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 5000);
  const logger = options.logger || console;
  const exit = options.exit || ((code) => process.exit(code));
  const setTimer = options.setTimer || setTimeout;
  const clearTimer = options.clearTimer || clearTimeout;
  let started = false;
  let finished = false;
  let timer = null;

  function closeResources() {
    const errors = [];
    resources.forEach((resource) => {
      try {
        if (typeof resource === "function") resource();
        else if (resource && typeof resource.close === "function") resource.close();
      } catch (error) {
        errors.push(error);
        logger.error("shutdown resource close failed", error && error.stack ? error.stack : error);
      }
    });
    return errors;
  }

  function finish(code) {
    if (finished) return false;
    finished = true;
    if (timer !== null) clearTimer(timer);
    const errors = closeResources();
    exit(errors.length ? 1 : code);
    return true;
  }

  return function shutdown(signal = "SIGTERM") {
    if (started) return false;
    started = true;
    timer = setTimer(() => {
      logger.error(`graceful shutdown timed out after ${timeoutMs}ms`, signal);
      try {
        if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      } catch (error) {
        logger.error("forced connection close failed", error && error.stack ? error.stack : error);
      }
      finish(1);
    }, timeoutMs);
    if (timer && typeof timer.unref === "function") timer.unref();

    try {
      server.close((error) => {
        if (error) logger.error("HTTP server close failed", error && error.stack ? error.stack : error);
        finish(error ? 1 : 0);
      });
      if (typeof server.closeIdleConnections === "function") server.closeIdleConnections();
    } catch (error) {
      logger.error("HTTP server shutdown failed", error && error.stack ? error.stack : error);
      finish(1);
    }
    return true;
  };
}

module.exports = { createGracefulShutdown };
