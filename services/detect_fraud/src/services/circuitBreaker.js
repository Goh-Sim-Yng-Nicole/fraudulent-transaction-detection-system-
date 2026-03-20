class CircuitBreaker {
  constructor({ failureThreshold = 5, resetTimeoutMs = 30000 } = {}) {
    this.failureThreshold = failureThreshold;
    this.resetTimeoutMs = resetTimeoutMs;
    this.failureCount = 0;
    this.openedAt = null;
  }

  isOpen() {
    if (!this.openedAt) return false;
    const elapsed = Date.now() - this.openedAt;
    if (elapsed >= this.resetTimeoutMs) {
      this.failureCount = 0;
      this.openedAt = null;
      return false;
    }
    return true;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.openedAt = null;
  }

  recordFailure() {
    this.failureCount += 1;
    if (this.failureCount >= this.failureThreshold) {
      this.openedAt = Date.now();
    }
  }
}

module.exports = CircuitBreaker;
