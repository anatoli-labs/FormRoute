// Simple in-memory rate limiting for serverless functions
const submissions = new Map();

function isRateLimited(ip, windowMs = 15 * 60 * 1000, maxRequests = 10) {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  if (!submissions.has(ip)) {
    submissions.set(ip, []);
  }
  
  const userSubmissions = submissions.get(ip);
  
  // Remove old submissions outside the window
  const recentSubmissions = userSubmissions.filter(timestamp => timestamp > windowStart);
  submissions.set(ip, recentSubmissions);
  
  if (recentSubmissions.length >= maxRequests) {
    return {
      limited: true,
      remainingTime: Math.ceil((recentSubmissions[0] + windowMs - now) / 1000)
    };
  }
  
  // Add current submission
  recentSubmissions.push(now);
  submissions.set(ip, recentSubmissions);
  
  return {
    limited: false,
    remaining: maxRequests - recentSubmissions.length
  };
}

// Clean up old entries periodically (for memory management)
setInterval(() => {
  const now = Date.now();
  const maxAge = 60 * 60 * 1000; // 1 hour
  
  for (const [ip, timestamps] of submissions.entries()) {
    const recent = timestamps.filter(t => t > now - maxAge);
    if (recent.length === 0) {
      submissions.delete(ip);
    } else {
      submissions.set(ip, recent);
    }
  }
}, 10 * 60 * 1000); // Run every 10 minutes

module.exports = { isRateLimited };